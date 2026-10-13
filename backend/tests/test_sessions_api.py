"""The Sessions API (backend/sessions_api.py, PLAN T48): takes and progress kept for an account.

    GET    /api/sessions          200 [take, ...], the newest first
    POST   /api/sessions          a take: 200 {"id"}, in place of the speaker's take with that id
    DELETE /api/sessions          204: every take the speaker kept is gone
    DELETE /api/sessions/{id}     204: the speaker's take with that id is gone, if there was one
    POST   /api/sessions/import   {"sessions": [take, ...]}: 200 {"imported", "skipped"}
    GET    /api/progress          200 {"shown_advice": [...], "path_progress": [...]}, oldest first
    POST   /api/progress          the same shape: 200, the progress once merged in

A take is {id, created_at, report, transcript}. Its report (a JSON object) and transcript (a JSON
array) come back exactly as sent, up to 1,000,000 bytes together, and audio is never kept. An
import of at most 500 takes keeps only the ids the speaker does not have yet, so importing twice
keeps one copy. Progress merges idempotently: an entry keeps the latest time it was shown, a level
the first time it was cleared. Every route needs a signed-in speaker (401), reads and writes that
speaker's rows only, answers 503 while accounts are off, and takes JSON only when it changes
something (415).

POST /api/advice serves guests as before, by the shown ids they send. For a signed-in speaker the
shown ids come from the database instead, oldest first, and the tips given are recorded there.

Every database here is SQLite in memory, and every route reads the time from the test's clock. A
browser is a TestClient at https://testserver, so its Secure session cookie goes back. No test
asks the model: /api/advice answers with the library's own tips.
"""

import json
import math
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, Table, func, select
from sqlalchemy.dialects import mysql

from backend import app as app_module
from backend import auth, db, sessions_api
from backend.advice import load_library
from backend.advice.select import ReportSummary, candidates, weakest_skills

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
NOW_TEXT = "2026-10-12T18:30:00Z"
SESSION_LIFETIME = timedelta(days=30)
ANN = "ann@example.com"
BOB = "bob@example.com"
PASSWORD = "correct horse battery staple"
# A Neon connection string (made up). An engine for it connects on first use, which no test makes.
NEON_URL = "postgresql://speech_coach:not-a-real-password@ep-quiet-sky-123456.neon.tech/neondb"

NOT_SIGNED_IN = {"detail": "not signed in"}
JSON_REQUIRED = {"detail": "send this request as JSON (Content-Type: application/json)"}
ACCOUNTS_OFF = {"detail": "accounts are not configured"}
JSON_HEADERS = {"content-type": "application/json"}

MAX_IMPORT_TAKES = 500
MAX_TAKE_BYTES = 1_000_000
MAX_PROGRESS_ROWS = 2_000

# A take as the browser sends one: frontend/store.js's session, its metrics and details as the
# report and its words as the transcript. The id is what crypto.randomUUID() gave it.
TAKE_ID = "8b1f6c2e-5d4a-4f1e-9c3b-2a7d6e0f1a2b"
REPORT = {
    "passageId": "uniforms",
    "passageTitle": "School uniforms",
    "durationSeconds": 42.9,
    "metrics": {
        "words_per_minute": 159.5,
        "pauses": [[12.4, 1.8]],
        "repeats": [{"text": "the few decisions a", "at": 9.1}],
    },
}
TRANSCRIPT = [
    {"text": "a", "start": 8.61, "end": 8.7},
    {"text": "day—", "start": 8.7, "end": 9.02},
    {"text": "uh,", "start": 9.1, "end": 9.3},
]
# The first bytes of a WAV file, as base64: what a take that carried its recording would hold.
AUDIO = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA="

ROUTES = [
    ("GET", "/api/sessions"),
    ("POST", "/api/sessions"),
    ("DELETE", "/api/sessions"),
    ("DELETE", f"/api/sessions/{TAKE_ID}"),
    ("POST", "/api/sessions/import"),
    ("GET", "/api/progress"),
    ("POST", "/api/progress"),
]
STATE_CHANGING_ROUTES = [route for route in ROUTES if route[0] != "GET"]

# The owner's 2026-10-11 uniforms take as the Results screen asks /api/advice about it.
ADVICE_TAKE_ID = "8b1f6c2e-take-one"
TIER = "Contender"
NUMBERS: ReportSummary = {
    "duration_seconds": 42.882,
    "words_per_minute": 159.5,
    "filler_count": 2,
    "restart_count": 1,
    "mid_sentence_pause_count": 0,
    "long_pause_count": 0,
    "target_wpm": [140, 160],
}
EXCERPT = (
    "Choosing how to present yourself is one of the few decisions a day— uh, the few decisions."
)


class Clock:
    """The time every account route sees: NOW until the test moves it."""

    def __init__(self) -> None:
        self.now = NOW

    def advance(self, by: timedelta) -> None:
        self.now += by


# --- set-up --------------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def no_session_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test starts without SESSION_SECRET, whatever .env holds."""
    monkeypatch.delenv("SESSION_SECRET", raising=False)


@pytest.fixture(autouse=True)
def library_tips() -> Iterator[None]:
    """No model: /api/advice answers with the library's own tips, and nothing reaches a network."""
    overrides = app_module.app.dependency_overrides
    overrides[app_module.advice_client] = lambda: None
    yield
    overrides.pop(app_module.advice_client, None)


@pytest.fixture
def engine() -> Iterator[Engine]:
    """A new, empty in-memory database with the five tables."""
    engine = db.make_engine("sqlite://")
    db.create_tables(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def accounts_on(engine: Engine, clock: Clock) -> Iterator[None]:
    """Accounts on: every route, /api/advice too, gets the test's database and clock."""
    overrides = app_module.app.dependency_overrides
    overrides[db.accounts_engine_or_none] = lambda: engine
    overrides[auth.current_time] = lambda: clock.now
    yield
    for dependency in (db.accounts_engine_or_none, auth.current_time):
        overrides.pop(dependency, None)


def browser() -> TestClient:
    """A browser that keeps its own cookies, on https as in production."""
    return TestClient(app_module.app, base_url="https://testserver")


def signed_in(email: str = ANN) -> TestClient:
    """A browser that has signed up as `email`, and so is signed in."""
    client = browser()
    response = client.post("/api/auth/signup", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


# --- takes and progress --------------------------------------------------------------------------


def take(take_id: str = TAKE_ID, **changes: object) -> dict[str, Any]:
    """A take as the browser sends it, changed by `changes`. Its time is UTC, as given back."""
    return {
        "id": take_id,
        "created_at": NOW_TEXT,
        "report": REPORT,
        "transcript": TRANSCRIPT,
        **changes,
    }


def at(hours: float = 0, minutes: int = 0) -> str:
    """The time `hours` and `minutes` after NOW, as the API writes it."""
    moment = NOW + timedelta(hours=hours, minutes=minutes)
    return moment.isoformat().replace("+00:00", "Z")


def shown(entry_id: str, shown_at: str) -> dict[str, str]:
    return {"entry_id": entry_id, "shown_at": shown_at}


def cleared(level_id: str, cleared_at: str) -> dict[str, str]:
    return {"level_id": level_id, "cleared_at": cleared_at}


def body_for(method: str, path: str) -> object:
    """A body `path` accepts, so a test of a route's guards tests nothing else; None for a GET."""
    if method == "GET":
        return None
    if (method, path) == ("POST", "/api/sessions"):
        return take()
    if path == "/api/sessions/import":
        return {"sessions": [take("guest-take")]}
    if path == "/api/progress":
        return {
            "shown_advice": [shown("pace_fast-001", NOW_TEXT)],
            "path_progress": [cleared("pace-1", NOW_TEXT)],
        }
    return {}


def post_raw(client: TestClient, path: str, body: object) -> httpx2.Response:
    """POST `body` as Python's json module writes it, for JSON the test client would not send.

    Such as NaN, or half of a surrogate pair: the client's own JSON writer refuses both.
    """
    return client.post(path, content=json.dumps(body), headers=JSON_HEADERS)


def keep(client: TestClient, sent: object) -> httpx2.Response:
    return client.post("/api/sessions", json=sent)


def takes_of(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/sessions")
    assert response.status_code == 200, response.text
    return response.json()


def ids_of(client: TestClient) -> list[str]:
    return [kept["id"] for kept in takes_of(client)]


def import_takes(client: TestClient, takes: list[dict[str, Any]]) -> httpx2.Response:
    return client.post("/api/sessions/import", json={"sessions": takes})


def delete_take(client: TestClient, take_id: str) -> httpx2.Response:
    return client.request("DELETE", f"/api/sessions/{take_id}", json={})


def delete_every_take(client: TestClient) -> httpx2.Response:
    return client.request("DELETE", "/api/sessions", json={})


def post_progress(
    client: TestClient,
    shown_advice: list[dict[str, str]] | None = None,
    path_progress: list[dict[str, str]] | None = None,
) -> httpx2.Response:
    body = {"shown_advice": shown_advice or [], "path_progress": path_progress or []}
    return client.post("/api/progress", json=body)


def progress_of(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/progress")
    assert response.status_code == 200, response.text
    return response.json()


NO_PROGRESS = {"shown_advice": [], "path_progress": []}


# --- the database --------------------------------------------------------------------------------


def row_count(engine: Engine, table: Table) -> int:
    with engine.connect() as connection:
        return connection.execute(select(func.count()).select_from(table)).scalar_one()


def everything_in(engine: Engine) -> str:
    """Every row of every table, written out."""
    with engine.connect() as connection:
        return repr(
            [list(connection.execute(select(table))) for table in db.metadata.sorted_tables]
        )


# --- advice --------------------------------------------------------------------------------------


def advice_body(
    take_id: str = ADVICE_TAKE_ID, shown_ids: list[str] | None = None
) -> dict[str, Any]:
    """The body the Results screen sends for the uniforms take."""
    return {
        "session_id": take_id,
        "summary": {**NUMBERS, "transcript_excerpt": EXCERPT},
        "tier": TIER,
        "shown_ids": shown_ids or [],
    }


def ask_for_advice(
    client: TestClient, take_id: str = ADVICE_TAKE_ID, shown_ids: list[str] | None = None
) -> list[str]:
    """POST /api/advice for the uniforms take; the ids of the tips in the 200 answer."""
    response = client.post("/api/advice", json=advice_body(take_id, shown_ids))
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "library"
    return [tip["entry_id"] for tip in response.json()["tips"]]


def library_tips_for(shown_ids: list[str], take_id: str = ADVICE_TAKE_ID) -> list[str]:
    """The ids of the tips the uniforms take gets with no model, given those shown oldest first."""
    weak_skills = weakest_skills(NUMBERS)
    offered = candidates(load_library(), weak_skills, TIER, shown_ids, session_id=take_id)
    return [entry.id for entry in offered[:3]]


# --- keeping takes -------------------------------------------------------------------------------


def test_a_take_kept_comes_back_exactly_as_sent(accounts_on: None) -> None:
    ann = signed_in()

    response = keep(ann, take())

    assert response.status_code == 200
    assert response.json() == {"id": TAKE_ID}
    assert takes_of(ann) == [take()]


def test_a_report_and_transcript_of_any_json_come_back_unchanged(accounts_on: None) -> None:
    ann = signed_in()
    report = {
        "passageTitle": "Résumé ✓ 🎤",
        "nested": {"deeper": [[1, 2.5, None, True, False, "x"]], "empty": {}},
        "negative": -0.001,
    }
    transcript = [{"text": "ner—", "start": 0.0, "end": 0.25, "speaker": None}, "word", 7, [], {}]

    keep(ann, take(report=report, transcript=transcript))

    assert takes_of(ann) == [take(report=report, transcript=transcript)]


def test_a_takes_time_comes_back_in_utc(accounts_on: None) -> None:
    ann = signed_in()
    # A browser in California, and the milliseconds toISOString writes.
    keep(ann, take("evening", created_at="2026-10-11T20:15:00-07:00"))
    keep(ann, take("browser-time", created_at="2026-10-11T08:00:00.123Z"))

    times = {kept["id"]: kept["created_at"] for kept in takes_of(ann)}

    assert times == {
        "evening": "2026-10-12T03:15:00Z",
        "browser-time": "2026-10-11T08:00:00.123000Z",
    }


def test_takes_are_listed_newest_first(accounts_on: None) -> None:
    ann = signed_in()
    keep(ann, take("monday", created_at="2026-10-12T09:00:00Z"))
    keep(ann, take("wednesday", created_at="2026-10-14T09:00:00Z"))
    keep(ann, take("tuesday", created_at="2026-10-13T09:00:00Z"))

    assert ids_of(ann) == ["wednesday", "tuesday", "monday"]


def test_a_new_speaker_has_no_takes(accounts_on: None) -> None:
    assert takes_of(signed_in()) == []


def test_keeping_a_take_again_replaces_the_speakers_copy(accounts_on: None) -> None:
    ann = signed_in()
    keep(ann, take(report={"version": 1}))
    resaved = take(created_at="2026-10-13T08:00:00Z", report={"version": 2}, transcript=[])

    response = keep(ann, resaved)

    assert response.status_code == 200
    assert takes_of(ann) == [resaved]


# --- what a take may hold ------------------------------------------------------------------------


@pytest.mark.parametrize("missing", ["id", "created_at", "report", "transcript"])
def test_a_take_missing_a_field_is_refused(accounts_on: None, missing: str) -> None:
    ann = signed_in()
    sent = take()
    del sent[missing]

    response = keep(ann, sent)

    assert response.status_code == 422
    assert takes_of(ann) == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("report", [REPORT]),
        ("report", "a report"),
        ("report", 42),
        ("report", None),
        ("transcript", {"words": TRANSCRIPT}),
        ("transcript", "uh, the few decisions"),
        ("transcript", None),
    ],
)
def test_a_report_must_be_an_object_and_a_transcript_an_array(
    accounts_on: None, field: str, value: object
) -> None:
    ann = signed_in()

    response = keep(ann, take(**{field: value}))

    assert response.status_code == 422
    assert takes_of(ann) == []


@pytest.mark.parametrize("field", ["audio", "blob"])
def test_a_take_never_carries_audio(accounts_on: None, engine: Engine, field: str) -> None:
    # The fields frontend/store.js refuses to keep (AUDIO_FIELDS), on the take or in its report.
    ann = signed_in()

    on_the_take = keep(ann, take(**{field: AUDIO}))
    in_the_report = keep(ann, take(report={**REPORT, field: AUDIO}))
    imported = import_takes(ann, [take(**{field: AUDIO})])

    assert on_the_take.status_code == in_the_report.status_code == imported.status_code == 422
    assert row_count(engine, db.speech_sessions) == 0
    assert AUDIO not in everything_in(engine)


def test_a_take_of_up_to_1_mb_is_kept_and_a_byte_more_is_refused(accounts_on: None) -> None:
    ann = signed_in()
    # As JSON.stringify writes them, {} takes 2 bytes and ["x...x"] the x's and 4 more.
    largest = take("largest", report={}, transcript=["x" * (MAX_TAKE_BYTES - 6)])
    too_large = take("too-large", report={}, transcript=["x" * (MAX_TAKE_BYTES - 5)])

    assert keep(ann, largest).status_code == 200
    assert keep(ann, too_large).status_code == 422
    assert import_takes(ann, [too_large]).status_code == 422
    assert ids_of(ann) == ["largest"]


def test_the_size_limit_counts_bytes_not_characters(accounts_on: None) -> None:
    ann = signed_in()
    # 250,000 microphones are 250,006 characters of JSON, but 1,000,006 bytes of UTF-8.
    microphones = take(report={}, transcript=["🎤" * 250_000])

    assert keep(ann, microphones).status_code == 422
    assert takes_of(ann) == []


@pytest.mark.parametrize("number", [math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("field", ["report", "transcript"])
def test_a_take_holding_nan_or_infinity_is_refused(
    accounts_on: None, engine: Engine, field: str, number: float
) -> None:
    # JSON has neither and Postgres refuses both, but Python's JSON reader takes them.
    ann = signed_in()
    holding = {"report": {"metrics": {"words_per_minute": number}}, "transcript": [number]}
    sent = take(**{field: holding[field]})

    kept = post_raw(ann, "/api/sessions", sent)
    imported = post_raw(ann, "/api/sessions/import", {"sessions": [sent]})

    assert kept.status_code == imported.status_code == 422
    assert row_count(engine, db.speech_sessions) == 0


def test_a_take_holding_half_a_surrogate_pair_is_refused(accounts_on: None) -> None:
    # JSON can carry one, but UTF-8 cannot write it: kept, it would break every listing after.
    ann = signed_in()
    sent = take(transcript=[{"text": "\ud83c", "start": 1.0, "end": 1.2}])

    kept = post_raw(ann, "/api/sessions", sent)
    imported = post_raw(ann, "/api/sessions/import", {"sessions": [sent]})

    assert kept.status_code == imported.status_code == 422
    assert takes_of(ann) == []


def test_a_refused_take_is_not_quoted_back(accounts_on: None) -> None:
    ann = signed_in()
    refused = [
        take(report={**REPORT, "audio": AUDIO}),
        take(report={"carries": AUDIO}, transcript=["x" * MAX_TAKE_BYTES]),
        take(report={"carries": AUDIO, "words_per_minute": math.nan}),
    ]

    responses = [post_raw(ann, "/api/sessions", sent) for sent in refused]

    assert [response.status_code for response in responses] == [422, 422, 422]
    assert not any(AUDIO in response.text for response in responses)


@pytest.mark.parametrize(
    "take_id", ["", "a" * 101, "take\x00one", "take\none", "take\u200bone", "\ud83c"]
)
def test_a_take_id_is_1_to_100_printable_characters(
    accounts_on: None, engine: Engine, take_id: str
) -> None:
    ann = signed_in()

    kept = post_raw(ann, "/api/sessions", take(take_id))
    imported = post_raw(ann, "/api/sessions/import", {"sessions": [take(take_id)]})

    assert kept.status_code == imported.status_code == 422
    assert row_count(engine, db.speech_sessions) == 0


def test_an_id_of_100_characters_is_accepted(accounts_on: None) -> None:
    ann = signed_in()

    assert keep(ann, take("a" * 100)).status_code == 200
    assert ids_of(ann) == ["a" * 100]


@pytest.mark.parametrize(
    "created_at",
    [
        "2026-10-12T18:30:00",
        "yesterday",
        "",
        # No UTC time for either: the first would be in year 0, the second in year 10000.
        "0001-01-01T00:00:00+05:00",
        "9999-12-31T23:00:00-05:00",
    ],
)
def test_a_time_without_a_zone_or_out_of_range_is_refused(
    accounts_on: None, created_at: str
) -> None:
    ann = signed_in()

    response = keep(ann, take(created_at=created_at))

    assert response.status_code == 422
    assert takes_of(ann) == []


# --- deleting takes ------------------------------------------------------------------------------


def test_deleting_a_take_removes_that_take_only(accounts_on: None) -> None:
    ann = signed_in()
    keep(ann, take("first"))
    keep(ann, take("second"))

    response = delete_take(ann, "first")

    assert response.status_code == 204
    assert response.content == b""
    assert ids_of(ann) == ["second"]


def test_deleting_a_take_the_speaker_does_not_have_does_no_harm(accounts_on: None) -> None:
    ann = signed_in()
    keep(ann, take())

    response = delete_take(ann, "never-kept")

    assert response.status_code == 204
    assert ids_of(ann) == [TAKE_ID]


def test_deleting_by_an_id_no_take_could_have_is_refused(accounts_on: None) -> None:
    ann = signed_in()
    keep(ann, take())

    assert delete_take(ann, "a" * 101).status_code == 422
    assert delete_take(ann, "take%00one").status_code == 422
    assert ids_of(ann) == [TAKE_ID]


def test_deleting_every_take_keeps_the_progress_and_the_account(accounts_on: None) -> None:
    ann = signed_in()
    keep(ann, take("first"))
    keep(ann, take("second"))
    post_progress(ann, [shown("filler-001", NOW_TEXT)], [cleared("fillers-1", NOW_TEXT)])

    response = delete_every_take(ann)

    assert response.status_code == 204
    assert takes_of(ann) == []
    assert progress_of(ann) == {
        "shown_advice": [shown("filler-001", NOW_TEXT)],
        "path_progress": [cleared("fillers-1", NOW_TEXT)],
    }
    assert ann.get("/api/me").json() == {"email": ANN}


# --- importing guest history ---------------------------------------------------------------------


def guest_history(count: int = 3) -> list[dict[str, Any]]:
    """`count` takes a guest kept in the browser, a day apart, the oldest first."""
    return [take(f"guest-{day}", created_at=at(hours=24 * day)) for day in range(count)]


def test_importing_guest_history_keeps_every_take(accounts_on: None) -> None:
    ann = signed_in()

    response = import_takes(ann, guest_history())

    assert response.status_code == 200
    assert response.json() == {"imported": 3, "skipped": 0}
    assert takes_of(ann) == guest_history()[::-1]


def test_importing_the_same_history_twice_keeps_one_copy_of_each(accounts_on: None) -> None:
    ann = signed_in()
    import_takes(ann, guest_history())

    again = import_takes(ann, guest_history())

    assert again.status_code == 200
    assert again.json() == {"imported": 0, "skipped": 3}
    assert takes_of(ann) == guest_history()[::-1]


def test_an_import_leaves_a_take_the_speaker_already_has_as_it_was(accounts_on: None) -> None:
    ann = signed_in()
    keep(ann, take("synced", report={"kept": "on the server"}))

    response = import_takes(ann, [take("synced", report={"kept": "by the guest"}), take("new")])

    assert response.json() == {"imported": 1, "skipped": 1}
    reports = {kept["id"]: kept["report"] for kept in takes_of(ann)}
    assert reports == {"synced": {"kept": "on the server"}, "new": REPORT}


def test_a_take_listed_twice_in_one_import_is_kept_once_as_first_listed(
    accounts_on: None,
) -> None:
    ann = signed_in()

    response = import_takes(ann, [take(report={"copy": 1}), take(report={"copy": 2})])

    assert response.json() == {"imported": 1, "skipped": 1}
    assert takes_of(ann) == [take(report={"copy": 1})]


def test_an_import_holds_at_most_500_takes(accounts_on: None) -> None:
    ann = signed_in()
    small_takes = [take(f"guest-{n:03}", report={}, transcript=[]) for n in range(501)]

    too_many = import_takes(ann, small_takes)
    most = import_takes(ann, small_takes[:MAX_IMPORT_TAKES])

    assert too_many.status_code == 422
    assert most.json() == {"imported": 500, "skipped": 0}
    assert len(takes_of(ann)) == 500


def test_an_import_with_one_bad_take_keeps_none_of_them(accounts_on: None) -> None:
    ann = signed_in()

    response = import_takes(ann, [take("good"), take("bad", report="not an object")])

    assert response.status_code == 422
    assert [problem["loc"] for problem in response.json()["detail"]] == [
        ["body", "sessions", 1, "report"]
    ]
    assert takes_of(ann) == []


def test_an_empty_import_keeps_nothing(accounts_on: None) -> None:
    ann = signed_in()

    response = import_takes(ann, [])

    assert response.json() == {"imported": 0, "skipped": 0}
    assert takes_of(ann) == []


# --- progress ------------------------------------------------------------------------------------


def test_a_new_speaker_has_no_progress(accounts_on: None) -> None:
    assert progress_of(signed_in()) == NO_PROGRESS


def test_progress_comes_back_oldest_first(accounts_on: None) -> None:
    ann = signed_in()
    # Two entries shown at once come in the order of their ids.
    oldest_first = {
        "shown_advice": [
            shown("filler-007", at(hours=1)),
            shown("filler-003", at(hours=2)),
            shown("restart-002", at(hours=2)),
            shown("pace_fast-001", at(hours=3)),
        ],
        "path_progress": [cleared("fillers-1", at(hours=4)), cleared("fillers-2", at(hours=5))],
    }
    scrambled = [oldest_first["shown_advice"][place] for place in (3, 2, 0, 1)]

    response = post_progress(ann, scrambled, oldest_first["path_progress"][::-1])

    assert response.status_code == 200
    assert response.json() == oldest_first
    assert progress_of(ann) == oldest_first


def test_posting_the_same_progress_twice_changes_nothing(accounts_on: None) -> None:
    ann = signed_in()
    shown_advice = [shown("filler-001", at(hours=1)), shown("restart-004", at(hours=2))]
    path_progress = [cleared("fillers-1", at(hours=3))]

    first = post_progress(ann, shown_advice, path_progress)
    second = post_progress(ann, shown_advice, path_progress)

    assert first.json() == second.json() == progress_of(ann)
    assert progress_of(ann) == {"shown_advice": shown_advice, "path_progress": path_progress}


def test_an_entry_keeps_the_latest_time_it_was_shown(accounts_on: None) -> None:
    ann = signed_in()
    post_progress(ann, [shown("filler-001", at(hours=1))])
    post_progress(ann, [shown("filler-001", at(hours=3))])
    post_progress(ann, [shown("filler-001", at(hours=2))])

    assert progress_of(ann)["shown_advice"] == [shown("filler-001", at(hours=3))]


def test_a_level_keeps_the_first_time_it_was_cleared(accounts_on: None) -> None:
    ann = signed_in()
    post_progress(ann, path_progress=[cleared("fillers-1", at(hours=2))])
    post_progress(ann, path_progress=[cleared("fillers-1", at(hours=1))])
    post_progress(ann, path_progress=[cleared("fillers-1", at(hours=3))])

    assert progress_of(ann)["path_progress"] == [cleared("fillers-1", at(hours=1))]


def test_an_entry_or_level_listed_twice_in_one_post_is_kept_once(accounts_on: None) -> None:
    ann = signed_in()

    response = post_progress(
        ann,
        [shown("filler-001", at(hours=1)), shown("filler-001", at(hours=2))],
        [cleared("fillers-1", at(hours=2)), cleared("fillers-1", at(hours=1))],
    )

    assert response.json() == {
        "shown_advice": [shown("filler-001", at(hours=2))],
        "path_progress": [cleared("fillers-1", at(hours=1))],
    }


def test_either_list_may_be_left_out(accounts_on: None) -> None:
    ann = signed_in()

    levels_only = ann.post("/api/progress", json={"path_progress": [cleared("pace-1", NOW_TEXT)]})
    advice_only = ann.post("/api/progress", json={"shown_advice": [shown("pace-002", NOW_TEXT)]})
    neither = ann.post("/api/progress", json={})

    assert levels_only.status_code == advice_only.status_code == neither.status_code == 200
    assert neither.json() == {
        "shown_advice": [shown("pace-002", NOW_TEXT)],
        "path_progress": [cleared("pace-1", NOW_TEXT)],
    }


@pytest.mark.parametrize(
    "body",
    [
        {"shown_advice": [{"entry_id": "filler-001"}]},
        {"shown_advice": [shown("filler-001", "2026-10-12T18:30:00")]},
        {"shown_advice": [shown("", NOW_TEXT)]},
        {"shown_advice": [shown("a" * 101, NOW_TEXT)]},
        {"shown_advice": [shown("filler\x00001", NOW_TEXT)]},
        {"shown_advice": [shown("filler-001", NOW_TEXT)], "path_progress": None},
        {"path_progress": [cleared("fillers-1", "0001-01-01T00:00:00+05:00")]},
        {"path_progress": [{**cleared("fillers-1", NOW_TEXT), "stars": 3}]},
        {"pathProgress": [cleared("fillers-1", NOW_TEXT)]},
        {"shown_advice": "filler-001"},
        {"shown_advice": [shown(f"e-{n}", NOW_TEXT) for n in range(MAX_PROGRESS_ROWS + 1)]},
        {"path_progress": [cleared(f"l-{n}", NOW_TEXT) for n in range(MAX_PROGRESS_ROWS + 1)]},
    ],
)
def test_progress_that_cannot_be_kept_is_refused(accounts_on: None, body: object) -> None:
    ann = signed_in()

    response = post_raw(ann, "/api/progress", body)

    assert response.status_code == 422
    assert progress_of(ann) == NO_PROGRESS


def test_a_post_of_2000_entries_and_2000_levels_is_kept(accounts_on: None) -> None:
    ann = signed_in()
    shown_advice = [shown(f"e-{n:04}", NOW_TEXT) for n in range(MAX_PROGRESS_ROWS)]
    path_progress = [cleared(f"l-{n:04}", NOW_TEXT) for n in range(MAX_PROGRESS_ROWS)]

    response = post_progress(ann, shown_advice, path_progress)

    assert response.status_code == 200
    assert response.json() == {"shown_advice": shown_advice, "path_progress": path_progress}


# --- one speaker, one set of rows ----------------------------------------------------------------


def test_a_speaker_lists_only_their_own_takes(accounts_on: None) -> None:
    ann, bob = signed_in(ANN), signed_in(BOB)
    keep(ann, take("ann-take"))
    keep(bob, take("bob-take"))

    assert ids_of(ann) == ["ann-take"]
    assert ids_of(bob) == ["bob-take"]


def test_a_speaker_cannot_overwrite_another_speakers_take(accounts_on: None) -> None:
    ann, bob = signed_in(ANN), signed_in(BOB)
    keep(bob, take(report={"by": "bob"}))

    response = keep(ann, take(report={"by": "ann"}))

    # The id is Bob's too, but Ann has no take with it: hers is kept, and his is untouched.
    assert response.status_code == 200
    assert takes_of(bob) == [take(report={"by": "bob"})]
    assert takes_of(ann) == [take(report={"by": "ann"})]


def test_an_import_cannot_overwrite_another_speakers_take(accounts_on: None) -> None:
    ann, bob = signed_in(ANN), signed_in(BOB)
    keep(bob, take(report={"by": "bob"}))

    response = import_takes(ann, [take(report={"by": "ann"})])

    assert response.json() == {"imported": 1, "skipped": 0}
    assert takes_of(bob) == [take(report={"by": "bob"})]
    assert takes_of(ann) == [take(report={"by": "ann"})]


def test_a_speaker_cannot_delete_another_speakers_takes(accounts_on: None) -> None:
    ann, bob = signed_in(ANN), signed_in(BOB)
    keep(bob, take())

    one = delete_take(ann, TAKE_ID)
    every = delete_every_take(ann)

    assert one.status_code == every.status_code == 204
    assert takes_of(bob) == [take()]


def test_a_speaker_reads_and_changes_only_their_own_progress(accounts_on: None) -> None:
    ann, bob = signed_in(ANN), signed_in(BOB)
    post_progress(ann, [shown("filler-001", at(hours=1))], [cleared("fillers-1", at(hours=1))])

    # The same entry and level, shown later and cleared earlier: Ann's would move, were they hers.
    post_progress(bob, [shown("filler-001", at(hours=5))], [cleared("fillers-1", at(hours=-5))])

    assert progress_of(ann) == {
        "shown_advice": [shown("filler-001", at(hours=1))],
        "path_progress": [cleared("fillers-1", at(hours=1))],
    }
    assert progress_of(bob) == {
        "shown_advice": [shown("filler-001", at(hours=5))],
        "path_progress": [cleared("fillers-1", at(hours=-5))],
    }


def test_a_new_speaker_sees_nothing_of_anyone_elses(accounts_on: None) -> None:
    bob = signed_in(BOB)
    keep(bob, take())
    post_progress(bob, [shown("filler-001", NOW_TEXT)], [cleared("fillers-1", NOW_TEXT)])

    ann = signed_in(ANN)

    assert takes_of(ann) == []
    assert progress_of(ann) == NO_PROGRESS


# --- who may ask ---------------------------------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_route_needs_a_signed_in_speaker(
    accounts_on: None, engine: Engine, method: str, path: str
) -> None:
    ann = signed_in()
    keep(ann, take())
    before = everything_in(engine)

    response = browser().request(method, path, json=body_for(method, path))

    assert response.status_code == 401
    assert response.json() == NOT_SIGNED_IN
    assert everything_in(engine) == before


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_route_answers_503_while_accounts_are_off(method: str, path: str) -> None:
    response = browser().request(method, path, json=body_for(method, path))

    assert response.status_code == 503
    assert response.json() == ACCOUNTS_OFF


@pytest.mark.parametrize(
    "content_type",
    [
        None,
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=speech-coach",
    ],
)
@pytest.mark.parametrize(("method", "path"), STATE_CHANGING_ROUTES)
def test_a_request_that_changes_something_must_be_sent_as_json(
    accounts_on: None, engine: Engine, method: str, path: str, content_type: str | None
) -> None:
    ann = signed_in()
    keep(ann, take())
    post_progress(ann, [shown("filler-001", NOW_TEXT)])
    before = everything_in(engine)
    # What a form or a script on another site could send without asking first.
    headers = {} if content_type is None else {"content-type": content_type}

    response = ann.request(
        method, path, content=json.dumps(body_for(method, path)), headers=headers
    )

    assert response.status_code == 415
    assert response.json() == JSON_REQUIRED
    assert everything_in(engine) == before


# --- advice for a signed-in speaker --------------------------------------------------------------


def test_a_signed_in_speaker_is_not_offered_again_what_the_database_says_they_saw(
    accounts_on: None,
) -> None:
    ann = signed_in()
    seen = library_tips_for([])
    post_progress(ann, [shown(entry_id, at(hours=-1)) for entry_id in seen])

    tips = ask_for_advice(ann)

    assert tips == library_tips_for(sorted(seen))
    assert not set(tips) & set(seen)


def test_a_signed_in_speakers_request_does_not_say_what_they_have_seen(
    accounts_on: None,
) -> None:
    ann = signed_in()
    first_tips = library_tips_for([])

    # The browser's list is not the account's: the database has nothing shown yet.
    tips = ask_for_advice(ann, shown_ids=first_tips)

    assert tips == first_tips


def test_the_tips_a_signed_in_speaker_gets_are_recorded_as_shown_then(
    accounts_on: None, clock: Clock
) -> None:
    ann = signed_in()

    first = ask_for_advice(ann)
    clock.advance(timedelta(minutes=10))
    second = ask_for_advice(ann, take_id="the-next-take")

    assert not set(first) & set(second)
    assert progress_of(ann)["shown_advice"] == [
        *[shown(entry_id, NOW_TEXT) for entry_id in sorted(first)],
        *[shown(entry_id, at(minutes=10)) for entry_id in sorted(second)],
    ]


def test_a_tip_shown_again_is_recorded_at_its_latest_showing(accounts_on: None) -> None:
    ann = signed_in()
    first_tips = library_tips_for([])
    # Every entry for the take's two weakest skills was shown before, the first tips longest ago.
    weak_skills = set(weakest_skills(NUMBERS)[:2])
    others = [
        entry.id
        for entry in load_library()
        if weak_skills & set(entry.targets) and entry.id not in first_tips
    ]
    post_progress(ann, [shown(entry_id, at(hours=-2)) for entry_id in first_tips])
    post_progress(ann, [shown(entry_id, at(hours=-1)) for entry_id in others])

    tips = ask_for_advice(ann)

    assert tips == library_tips_for(sorted(first_tips) + sorted(others))
    assert set(tips) & set(first_tips)
    when = {row["entry_id"]: row["shown_at"] for row in progress_of(ann)["shown_advice"]}
    assert [when[entry_id] for entry_id in tips] == [NOW_TEXT] * len(tips)


def test_once_every_entry_was_shown_the_least_recently_shown_come_back_first(
    accounts_on: None,
) -> None:
    ann = signed_in()
    library_ids = [entry.id for entry in load_library()]
    # Shown a minute apart, the library's first entry last: oldest first is the library's order
    # backwards, which is neither the order of the ids nor the order the rows were written in.
    post_progress(
        ann, [shown(entry_id, at(minutes=-place)) for place, entry_id in enumerate(library_ids)]
    )

    tips = ask_for_advice(ann)

    assert tips == library_tips_for(library_ids[::-1])
    assert tips != library_tips_for(library_ids)
    assert tips != library_tips_for(sorted(library_ids))


def test_another_speakers_shown_advice_is_neither_read_nor_written(accounts_on: None) -> None:
    ann, bob = signed_in(ANN), signed_in(BOB)
    first_tips = library_tips_for([])
    post_progress(bob, [shown(entry_id, at(hours=-1)) for entry_id in first_tips])

    tips = ask_for_advice(ann)

    assert tips == first_tips
    assert progress_of(bob)["shown_advice"] == [
        shown(entry_id, at(hours=-1)) for entry_id in sorted(first_tips)
    ]


# --- advice for a guest --------------------------------------------------------------------------


def test_a_guest_gets_advice_by_the_shown_ids_they_send(accounts_on: None, engine: Engine) -> None:
    signed_in()
    first_tips = library_tips_for([])

    tips = ask_for_advice(browser(), shown_ids=first_tips)

    assert tips == library_tips_for(first_tips)
    assert row_count(engine, db.shown_advice) == 0


def test_a_browser_whose_session_has_ended_gets_advice_as_a_guest(
    accounts_on: None, engine: Engine, clock: Clock
) -> None:
    ann = signed_in()
    clock.advance(SESSION_LIFETIME)
    first_tips = library_tips_for([])

    tips = ask_for_advice(ann, shown_ids=first_tips)

    assert tips == library_tips_for(first_tips)
    assert row_count(engine, db.shown_advice) == 0


def test_with_accounts_off_a_browser_with_a_session_cookie_gets_advice_as_a_guest() -> None:
    first_tips = library_tips_for([])

    response = browser().post(
        "/api/advice",
        json=advice_body(shown_ids=first_tips),
        headers={"cookie": f"sc_session={'a' * 43}"},
    )

    assert response.status_code == 200
    assert [tip["entry_id"] for tip in response.json()["tips"]] == library_tips_for(first_tips)


# --- Postgres ------------------------------------------------------------------------------------


def test_every_upsert_is_written_for_postgres_too() -> None:
    # Production is Neon Postgres and the tests run on SQLite, where each statement runs above.
    postgres = db.make_engine(NEON_URL).dialect
    sent = sessions_api.TakeToKeep.model_validate(take())
    statements = {
        "keep": sessions_api.keep_take_statement(postgres, 1, sent),
        "import": sessions_api.import_statement(postgres, 1, [sent]),
        "shown": sessions_api.shown_advice_statement(postgres, 1, {"filler-001": NOW}),
        "cleared": sessions_api.cleared_levels_statement(postgres, 1, {"fillers-1": NOW}),
    }

    sql = {name: str(statement.compile(dialect=postgres)) for name, statement in statements.items()}

    assert sql["keep"].endswith(
        "ON CONFLICT (user_id, id) DO UPDATE SET created_at = excluded.created_at, "
        "report = excluded.report, transcript = excluded.transcript"
    )
    assert sql["import"].endswith(
        "ON CONFLICT (user_id, id) DO NOTHING RETURNING speech_sessions.id"
    )
    # An entry keeps its latest showing, and a level its first clearing.
    assert sql["shown"].endswith(
        "ON CONFLICT (user_id, entry_id) DO UPDATE SET shown_at = excluded.shown_at "
        "WHERE shown_advice.shown_at < excluded.shown_at"
    )
    assert sql["cleared"].endswith(
        "ON CONFLICT (user_id, level_id) DO UPDATE SET cleared_at = excluded.cleared_at "
        "WHERE path_progress.cleared_at > excluded.cleared_at"
    )


def test_a_database_other_than_postgres_or_sqlite_is_named_in_the_error() -> None:
    with pytest.raises(ValueError, match="mysql"):
        db.insert_for(mysql.dialect(), db.speech_sessions)
