"""No string the account, session, progress or advice routes take may hold NUL (U+0000): 422.

Postgres text cannot hold NUL and refuses a statement that carries one, while the SQLite the tests
run on keeps it, so a NUL that reached the database would pass every test here and fail on Neon.
No browser sends one. Every string field is checked as the body is read, before any route code
runs: an email and a password, a take's id and time and every key and text inside its report and
transcript, an entry's or a level's id and time, and every text an advice request carries. The
422 names the field and never quotes it back. A backslash followed by "u0000", six characters a
speaker could type, is not NUL and is kept.

Every database here is SQLite in memory, and no test asks a model.
"""

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select

from backend import app as app_module
from backend import auth, db

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
NOW_TEXT = "2026-10-12T18:30:00Z"
ANN = "ann@example.com"
PASSWORD = "correct horse battery staple"
JSON_HEADERS = {"content-type": "application/json"}
# Sent next to each NUL: an answer that holds it has quoted the refused value back.
MARKER = "MARKER-OF-THE-REFUSED-VALUE"
NUL = "\x00"


@pytest.fixture(autouse=True)
def no_session_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test starts without SESSION_SECRET, whatever .env holds."""
    monkeypatch.delenv("SESSION_SECRET", raising=False)


@pytest.fixture
def engine() -> Iterator[Engine]:
    """A new, empty in-memory database with the five tables."""
    engine = db.make_engine("sqlite://")
    db.create_tables(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def limiter() -> auth.FailedLoginLimiter:
    """A failed-login count of the test's own."""
    return auth.FailedLoginLimiter()


class FakeMessages:
    """Stands in for client.messages and notes every request; no test should make one."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    async def create(self, **request: Any) -> Any:
        self.requests.append(request)
        raise AssertionError("the model was asked")


class FakeAnthropic:
    def __init__(self) -> None:
        self.messages = FakeMessages()


@pytest.fixture
def model() -> FakeAnthropic:
    return FakeAnthropic()


@pytest.fixture
def accounts_on(
    engine: Engine, limiter: auth.FailedLoginLimiter, model: FakeAnthropic
) -> Iterator[None]:
    """Accounts on, with the test's database, NOW, failed-login count and fake model."""
    overrides = app_module.app.dependency_overrides
    overrides[db.accounts_engine_or_none] = lambda: engine
    overrides[auth.current_time] = lambda: NOW
    overrides[auth.login_limiter] = lambda: limiter
    overrides[app_module.advice_client] = lambda: model
    yield
    for dependency in (
        db.accounts_engine_or_none,
        auth.current_time,
        auth.login_limiter,
        app_module.advice_client,
    ):
        overrides.pop(dependency, None)


def browser() -> TestClient:
    """A browser that keeps its own cookies, on https as in production."""
    return TestClient(app_module.app, base_url="https://testserver")


def signed_in() -> TestClient:
    client = browser()
    response = client.post("/api/auth/signup", json={"email": ANN, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


def post_raw(client: TestClient, path: str, body: object) -> httpx2.Response:
    """POST `body` as Python's json module writes it, NUL as the escape \\u0000."""
    return client.post(path, content=json.dumps(body), headers=JSON_HEADERS)


def rows_in(engine: Engine, table_name: str) -> int:
    table = db.metadata.tables[table_name]
    with engine.connect() as connection:
        return connection.execute(select(func.count()).select_from(table)).scalar_one()


def assert_refused(response: httpx2.Response, loc: list[object] | None = None) -> None:
    """A 422 that does not quote the refused value; naming the field at `loc`, if given."""
    assert response.status_code == 422, response.text
    assert MARKER not in response.text
    problems = response.json()["detail"]
    assert all("input" not in problem for problem in problems)
    if loc is not None:
        assert [problem["loc"] for problem in problems] == [loc]
        assert "NUL" in problems[0]["msg"]


# --- accounts ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "credentials"),
    [
        ("email", {"email": f"ann{NUL}{MARKER}@example.com", "password": PASSWORD}),
        ("password", {"email": ANN, "password": f"{PASSWORD}{NUL}{MARKER}"}),
    ],
)
def test_signing_up_with_nul_is_refused_and_opens_no_account(
    accounts_on: None, engine: Engine, field: str, credentials: dict[str, str]
) -> None:
    response = post_raw(browser(), "/api/auth/signup", credentials)

    assert_refused(response, ["body", field])
    assert "set-cookie" not in response.headers
    assert rows_in(engine, "users") == 0


@pytest.mark.parametrize(
    ("field", "credentials"),
    [
        ("email", {"email": f"ann{NUL}{MARKER}@example.com", "password": PASSWORD}),
        ("password", {"email": ANN, "password": f"{PASSWORD}{NUL}{MARKER}"}),
    ],
)
def test_logging_in_with_nul_is_refused_and_not_counted_as_a_failed_login(
    accounts_on: None, limiter: auth.FailedLoginLimiter, field: str, credentials: dict[str, str]
) -> None:
    signed_in()

    response = post_raw(browser(), "/api/auth/login", credentials)

    assert_refused(response, ["body", field])
    assert "set-cookie" not in response.headers
    assert len(limiter) == 0


# --- takes ---------------------------------------------------------------------------------------


def take(**changes: object) -> dict[str, Any]:
    """A take as the browser sends it, changed by `changes`."""
    return {
        "id": "take-one",
        "created_at": NOW_TEXT,
        "report": {"passageTitle": "Uniforms", "metrics": {"pauses": [[12.4, 1.8]]}},
        "transcript": [{"text": "uh,", "start": 9.1, "end": 9.3}],
        **changes,
    }


TAKES_HOLDING_NUL = {
    "the id": take(id=f"take{NUL}{MARKER}"),
    "the time": take(created_at=f"{NOW_TEXT}{NUL}{MARKER}"),
    "a report key": take(report={f"passage{NUL}{MARKER}": "Uniforms"}),
    "a report text": take(report={"passageTitle": f"Uni{NUL}forms {MARKER}"}),
    "a report text deep inside": take(report={"metrics": {"notes": [[f"{NUL}{MARKER}"]]}}),
    "a transcript text": take(transcript=[{"text": f"uh{NUL}{MARKER}", "start": 9.1, "end": 9.3}]),
    "a transcript key": take(transcript=[{f"text{NUL}{MARKER}": "uh,"}]),
    "a transcript string": take(transcript=[f"{MARKER}{NUL}"]),
}


@pytest.mark.parametrize("sent", TAKES_HOLDING_NUL.values(), ids=TAKES_HOLDING_NUL.keys())
def test_a_take_holding_nul_anywhere_is_refused_and_not_kept(
    accounts_on: None, engine: Engine, sent: dict[str, Any]
) -> None:
    ann = signed_in()

    kept = post_raw(ann, "/api/sessions", sent)
    imported = post_raw(ann, "/api/sessions/import", {"sessions": [take(id="fine"), sent]})

    assert_refused(kept)
    assert_refused(imported)
    assert rows_in(engine, "speech_sessions") == 0


def test_a_backslash_and_u0000_written_out_are_not_nul_and_are_kept(accounts_on: None) -> None:
    ann = signed_in()
    written_out = "\\u0000"
    sent = take(
        report={"note": written_out, written_out: [written_out]},
        transcript=[{"text": written_out, "start": 9.1, "end": 9.3}],
    )

    kept = post_raw(ann, "/api/sessions", sent)
    listed = ann.get("/api/sessions")

    assert kept.status_code == 200, kept.text
    assert listed.json() == [sent]


# --- progress ------------------------------------------------------------------------------------


PROGRESS_HOLDING_NUL = {
    "an entry id": (
        {"shown_advice": [{"entry_id": f"filler{NUL}{MARKER}", "shown_at": NOW_TEXT}]},
        ["body", "shown_advice", 0, "entry_id"],
    ),
    "a time shown": (
        {"shown_advice": [{"entry_id": "filler-001", "shown_at": f"{NOW_TEXT}{NUL}{MARKER}"}]},
        ["body", "shown_advice", 0, "shown_at"],
    ),
    "a level id": (
        {"path_progress": [{"level_id": f"pace{NUL}{MARKER}", "cleared_at": NOW_TEXT}]},
        ["body", "path_progress", 0, "level_id"],
    ),
    "a time cleared": (
        {"path_progress": [{"level_id": "pace-1", "cleared_at": f"{NOW_TEXT}{NUL}{MARKER}"}]},
        ["body", "path_progress", 0, "cleared_at"],
    ),
}


@pytest.mark.parametrize(
    ("sent", "loc"), PROGRESS_HOLDING_NUL.values(), ids=PROGRESS_HOLDING_NUL.keys()
)
def test_progress_holding_nul_is_refused_and_not_kept(
    accounts_on: None, engine: Engine, sent: dict[str, Any], loc: list[object]
) -> None:
    ann = signed_in()

    response = post_raw(ann, "/api/progress", sent)

    assert response.status_code == 422, response.text
    assert MARKER not in response.text
    assert [problem["loc"] for problem in response.json()["detail"]] == [loc]
    assert rows_in(engine, "shown_advice") == rows_in(engine, "path_progress") == 0


# --- advice --------------------------------------------------------------------------------------


def advice_body() -> dict[str, Any]:
    return {
        "session_id": "8b1f6c2e-take-one",
        "summary": {
            "duration_seconds": 42.882,
            "words_per_minute": 159.5,
            "filler_count": 2,
            "restart_count": 1,
            "mid_sentence_pause_count": 0,
            "long_pause_count": 0,
            "target_wpm": [140, 160],
            "transcript_excerpt": "One of the few decisions a day— uh, the few.",
        },
        "tier": "Contender",
        "shown_ids": ["filler-001"],
    }


@pytest.mark.parametrize(
    "loc",
    [
        ["body", "session_id"],
        ["body", "tier"],
        ["body", "shown_ids", 0],
        ["body", "summary", "transcript_excerpt"],
    ],
    ids=["session id", "tier", "shown id", "excerpt"],
)
def test_an_advice_request_holding_nul_is_refused_before_the_model_is_asked(
    accounts_on: None, model: FakeAnthropic, loc: list[Any]
) -> None:
    body = advice_body()
    holder: Any = body
    for key in loc[1:-1]:
        holder = holder[key]
    holder[loc[-1]] = f"{NUL}{MARKER}"

    guest = post_raw(browser(), "/api/advice", body)
    speaker = post_raw(signed_in(), "/api/advice", body)

    assert_refused(guest, loc)
    assert_refused(speaker, loc)
    assert model.messages.requests == []
