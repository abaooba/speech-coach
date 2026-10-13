"""What one take, one request and one account may hold (backend/sessions_api.py, PLAN T48).

A report or a transcript nests at most 64 arrays and objects deep; real ones go about 5 deep.
Deeper JSON is refused (422) before it is kept, by POST /api/sessions and by an import alike, so
nothing kept can break the listing that gives it back.

An import holds 2,000,000 bytes of takes at most, counted as each take is (json_bytes): a longer
history goes in parts (422 otherwise). No request to these routes may carry a body over
3,000,000 bytes: it is refused with 413 before it is read in full, as its Content-Length says or
as its bytes arrive, because FastAPI parses a JSON body before any other check runs.

One account keeps 20,000,000 bytes of takes at most, counted as the database keeps their reports
and transcripts, and 2,000 shown entries and 2,000 cleared levels at most. A request that would
leave it holding more is refused (409) and changes nothing. /api/advice reads the 2,000 most
recently shown entries at most, as many as a guest's request may send. GET /api/sessions sends
each take's JSON as the database keeps it, never parsed, so listing an account needs about as
much memory as its takes take.

Every database here is SQLite in memory, and every route reads the time from NOW. A browser is a
TestClient at https://testserver, so its Secure session cookie goes back.
"""

import json
import tracemalloc
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, insert, select

from backend import app as app_module
from backend import auth, db, sessions_api

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
NOW_TEXT = "2026-10-12T18:30:00Z"
ANN = "ann@example.com"
PASSWORD = "correct horse battery staple"
JSON_HEADERS = {"content-type": "application/json"}

MAX_JSON_DEPTH = 64
MAX_TAKE_BYTES = 1_000_000
MAX_IMPORT_BYTES = 2_000_000
MAX_REQUEST_BYTES = 3_000_000
REQUEST_TOO_LARGE = {
    "detail": "send at most 3,000,000 bytes in one request: import a long history in parts"
}
MAX_STORED_BYTES_PER_SPEAKER = 20_000_000
MAX_PROGRESS_ROWS = 2_000
MAX_SHOWN_IDS = 2_000
TAKES_FULL = {
    "detail": "this account keeps at most 20,000,000 bytes of takes: delete some to keep more"
}
PROGRESS_FULL = {
    "detail": "this account keeps at most 2,000 shown entries and 2,000 cleared levels"
}
BOB = "bob@example.com"
# A marker no answer may quote back.
SECRET = "the-words-of-a-refused-take"


# --- set-up --------------------------------------------------------------------------------------


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
def accounts_on(engine: Engine) -> Iterator[None]:
    """Accounts on: every route gets the test's database and NOW."""
    overrides = app_module.app.dependency_overrides
    overrides[db.accounts_engine_or_none] = lambda: engine
    overrides[auth.current_time] = lambda: NOW
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


def take(take_id: str = "take-one", **changes: object) -> dict[str, Any]:
    """A take as the browser sends it, changed by `changes`."""
    return {
        "id": take_id,
        "created_at": NOW_TEXT,
        "report": {"passageId": "uniforms", "durationSeconds": 42.9},
        "transcript": [{"text": "uh,", "start": 9.1, "end": 9.3}],
        **changes,
    }


def keep(client: TestClient, sent: object) -> httpx2.Response:
    return client.post("/api/sessions", json=sent)


def import_takes(client: TestClient, takes: list[dict[str, Any]]) -> httpx2.Response:
    return client.post("/api/sessions/import", json={"sessions": takes})


def takes_of(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/sessions")
    assert response.status_code == 200, response.text
    return response.json()


def row_count(engine: Engine) -> int:
    with engine.connect() as connection:
        query = select(func.count()).select_from(db.speech_sessions)
        return connection.execute(query).scalar_one()


# --- how deep a take may nest --------------------------------------------------------------------


def nested_object(depth: int, inside: object = SECRET) -> dict[str, Any]:
    """{"k": {"k": ... {"words": inside}}}: `depth` objects deep."""
    value: dict[str, Any] = {"words": inside}
    for _ in range(depth - 1):
        value = {"k": value}
    return value


def nested_array(depth: int, inside: object = SECRET) -> list[Any]:
    """[[...[inside]...]]: `depth` arrays deep."""
    value: list[Any] = [inside]
    for _ in range(depth - 1):
        value = [value]
    return value


@pytest.mark.parametrize(
    ("value", "depth"),
    [
        ("a word", 0),
        (42.5, 0),
        (None, 0),
        ({}, 1),
        ([], 1),
        ({"metrics": {"pauses": [[12.4, 1.8]]}}, 4),
        ([{"text": "a"}, [[[]]], {"deep": {"er": [1]}}], 4),
        (nested_object(64), 64),
        (nested_array(65), 65),
    ],
)
def test_nesting_depth_counts_the_arrays_and_objects_on_the_deepest_branch(
    value: object, depth: int
) -> None:
    assert sessions_api.nesting_depth(value) == depth


def test_nesting_depth_walks_any_depth_without_recursion() -> None:
    # Far deeper than Python's recursion limit, which a recursive walk would hit.
    assert sessions_api.nesting_depth(nested_array(100_000)) == 100_000


def test_a_take_nested_64_deep_is_kept_and_comes_back(accounts_on: None) -> None:
    ann = signed_in()
    deepest = take(report=nested_object(MAX_JSON_DEPTH), transcript=nested_array(MAX_JSON_DEPTH))

    response = keep(ann, deepest)

    assert response.status_code == 200
    assert takes_of(ann) == [deepest]


@pytest.mark.parametrize("depth", [MAX_JSON_DEPTH + 1, 300, 3_000])
@pytest.mark.parametrize("field", ["report", "transcript"])
def test_a_take_nested_deeper_than_64_is_refused_and_the_listing_still_works(
    accounts_on: None, engine: Engine, field: str, depth: int
) -> None:
    ann = signed_in()
    keep(ann, take("kept-before"))
    nested = {"report": nested_object(depth), "transcript": nested_array(depth)}
    too_deep = take("too-deep", **{field: nested[field]})
    # Written by Python's json module: the test client's own writer stops short of 3,000 deep.
    body = json.dumps(too_deep)

    kept = ann.post("/api/sessions", content=body, headers=JSON_HEADERS)
    imported = ann.post(
        "/api/sessions/import", content=f'{{"sessions": [{body}]}}', headers=JSON_HEADERS
    )

    assert kept.status_code == imported.status_code == 422
    assert SECRET not in kept.text + imported.text
    assert row_count(engine) == 1
    assert [kept["id"] for kept in takes_of(ann)] == ["kept-before"]


# --- how much one request may carry --------------------------------------------------------------


def take_of_size(take_id: str, size: int) -> dict[str, Any]:
    """A take whose report and transcript come to `size` bytes as json_bytes() counts them.

    {} is 2 bytes and ["x...x"] the x's and 4 more.
    """
    return take(take_id, report={}, transcript=["x" * (size - 6)])


def test_an_import_of_up_to_2_mb_is_kept_and_a_byte_more_is_refused(
    accounts_on: None, engine: Engine
) -> None:
    ann = signed_in()
    # Two of the largest takes, then the same bytes and one more spread over three.
    most = [take_of_size("most-1", MAX_TAKE_BYTES), take_of_size("most-2", MAX_TAKE_BYTES)]
    one_byte_over = [
        take_of_size("over-1", MAX_TAKE_BYTES),
        take_of_size("over-2", MAX_TAKE_BYTES - 3),
        take("over-3", report={}, transcript=[]),
    ]

    over = import_takes(ann, one_byte_over)
    kept = import_takes(ann, most)

    assert over.status_code == 422
    assert kept.status_code == 200
    assert kept.json() == {"imported": 2, "skipped": 0}
    assert sorted(kept["id"] for kept in takes_of(ann)) == ["most-1", "most-2"]


def padded_to(body: object, size: int) -> bytes:
    """`body` as JSON, followed by as many spaces as make it `size` bytes long."""
    text = json.dumps(body).encode()
    return text + b" " * (size - len(text))


BODIES = {
    "/api/sessions": take("padded"),
    "/api/sessions/import": {"sessions": [take("padded")]},
    "/api/progress": {"shown_advice": [{"entry_id": "filler-001", "shown_at": NOW_TEXT}]},
}


@pytest.mark.parametrize("path", BODIES)
def test_a_body_over_3_mb_is_refused_with_413(
    accounts_on: None, engine: Engine, path: str
) -> None:
    ann = signed_in()

    response = ann.post(
        path, content=padded_to(BODIES[path], MAX_REQUEST_BYTES + 1), headers=JSON_HEADERS
    )

    assert response.status_code == 413
    assert response.json() == REQUEST_TOO_LARGE
    assert row_count(engine) == 0
    assert ann.get("/api/progress").json()["shown_advice"] == []


@pytest.mark.parametrize("path", BODIES)
def test_a_body_of_3_mb_is_read(accounts_on: None, path: str) -> None:
    ann = signed_in()

    response = ann.post(
        path, content=padded_to(BODIES[path], MAX_REQUEST_BYTES), headers=JSON_HEADERS
    )

    assert response.status_code == 200


def test_a_body_sent_without_its_length_is_counted_as_it_arrives(
    accounts_on: None, engine: Engine
) -> None:
    ann = signed_in()
    body = padded_to(BODIES["/api/sessions/import"], MAX_REQUEST_BYTES + 1)
    # Sent in chunks, the request has no Content-Length: Transfer-Encoding: chunked.
    chunks = iter([body[:1_000], body[1_000:]])

    response = ann.post("/api/sessions/import", content=chunks, headers=JSON_HEADERS)

    assert "content-length" not in response.request.headers
    assert response.status_code == 413
    assert row_count(engine) == 0


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/sessions"),
        ("POST", "/api/sessions/import"),
        ("POST", "/api/progress"),
        ("DELETE", "/api/sessions"),
        ("DELETE", "/api/sessions/take-one"),
    ],
)
def test_a_request_that_says_it_carries_over_3_mb_is_refused_before_it_is_read(
    accounts_on: None, engine: Engine, method: str, path: str
) -> None:
    ann = signed_in()
    keep(ann, take("take-one"))
    # The body itself is small and would be taken: only its stated length is refused.
    small = json.dumps(BODIES.get(path, {})).encode()
    headers = {**JSON_HEADERS, "content-length": str(MAX_REQUEST_BYTES + 1)}

    response = ann.request(method, path, content=small, headers=headers)

    assert response.status_code == 413
    assert [kept["id"] for kept in takes_of(ann)] == ["take-one"]


# --- how much one account may keep ---------------------------------------------------------------
# A take's report and transcript take as many bytes in the database as JSON with a space after
# each comma and colon, and \u escapes for whatever is not ASCII. {} and ["x...x"] have neither,
# so take_of_size() makes a take of the same size there as json_bytes() counts it.

TAKE_KEPT_SIZE = 1_000_000
TAKES_THAT_FILL_AN_ACCOUNT = MAX_STORED_BYTES_PER_SPEAKER // TAKE_KEPT_SIZE
# The sizes of takes that fill an account to the byte.
FULL = [TAKE_KEPT_SIZE] * TAKES_THAT_FILL_AN_ACCOUNT


def user_id_of(engine: Engine, email: str) -> int:
    with engine.connect() as connection:
        query = select(db.users.c.id).where(db.users.c.email == email)
        return connection.execute(query).scalar_one()


def keep_directly(engine: Engine, sizes: list[int], email: str = ANN) -> list[str]:
    """Keep takes of these `sizes` for `email`, straight into the database; their ids.

    Each is the take take_of_size() makes, kept as the API keeps it, a day before the last.
    """
    user_id = user_id_of(engine, email)
    ids = [f"kept-{n:02}" for n in range(len(sizes))]
    rows = [
        {
            "id": take_id,
            "user_id": user_id,
            "created_at": NOW - timedelta(days=place),
            "report": {},
            "transcript": ["x" * (size - 6)],
        }
        for place, (take_id, size) in enumerate(zip(ids, sizes, strict=True))
    ]
    with engine.begin() as connection:
        connection.execute(insert(db.speech_sessions), rows)
    return ids


def ids_of(client: TestClient) -> list[str]:
    return sorted(kept["id"] for kept in takes_of(client))


def test_an_account_keeps_up_to_20_mb_of_takes_and_no_more(accounts_on: None) -> None:
    ann = signed_in()
    kept = [
        keep(ann, take_of_size(f"take-{n:02}", TAKE_KEPT_SIZE))
        for n in range(TAKES_THAT_FILL_AN_ACCOUNT)
    ]

    over = keep(ann, take("one-more", report={}, transcript=[]))

    assert [response.status_code for response in kept] == [200] * TAKES_THAT_FILL_AN_ACCOUNT
    assert over.status_code == 409
    assert over.json() == TAKES_FULL
    assert len(takes_of(ann)) == TAKES_THAT_FILL_AN_ACCOUNT


def test_keeping_a_take_again_counts_only_its_new_copy(accounts_on: None, engine: Engine) -> None:
    ann = signed_in()
    # 500 bytes of room are left, and one take can grow by more than that.
    ids = keep_directly(engine, [*FULL[:-1], TAKE_KEPT_SIZE - 1_000, 500])
    growing = ids[-2]

    to_the_limit = keep(ann, take_of_size(growing, TAKE_KEPT_SIZE - 500))
    past_it = keep(ann, take_of_size(growing, TAKE_KEPT_SIZE - 499))

    assert to_the_limit.status_code == 200
    assert past_it.status_code == 409
    assert past_it.json() == TAKES_FULL
    sizes = {kept["id"]: len(kept["transcript"][0]) + 6 for kept in takes_of(ann)}
    assert sizes[growing] == TAKE_KEPT_SIZE - 500


def test_an_import_that_would_fill_an_account_past_20_mb_keeps_none_of_it(
    accounts_on: None, engine: Engine
) -> None:
    ann = signed_in()
    ids = keep_directly(engine, [*FULL[:-1], TAKE_KEPT_SIZE - 10])

    response = import_takes(
        ann, [take("fits", report={}, transcript=[]), take_of_size("over", TAKE_KEPT_SIZE)]
    )

    assert response.status_code == 409
    assert response.json() == TAKES_FULL
    assert ids_of(ann) == ids


def test_a_full_account_may_import_the_takes_it_has_again(
    accounts_on: None, engine: Engine
) -> None:
    ann = signed_in()
    ids = keep_directly(engine, FULL)

    response = import_takes(ann, [take_of_size(ids[0], TAKE_KEPT_SIZE)])

    assert response.status_code == 200
    assert response.json() == {"imported": 0, "skipped": 1}


def test_deleting_a_take_makes_room_again(accounts_on: None, engine: Engine) -> None:
    ann = signed_in()
    ids = keep_directly(engine, FULL)

    ann.request("DELETE", f"/api/sessions/{ids[0]}", json={})
    response = keep(ann, take_of_size("new", TAKE_KEPT_SIZE))

    assert response.status_code == 200
    assert ids_of(ann) == sorted([*ids[1:], "new"])


def test_one_full_account_leaves_every_other_account_its_room(
    accounts_on: None, engine: Engine
) -> None:
    signed_in(ANN)
    bob = signed_in(BOB)
    keep_directly(engine, FULL, ANN)

    response = keep(bob, take_of_size("bobs", TAKE_KEPT_SIZE))

    assert response.status_code == 200


def shown(entry_id: str, shown_at: datetime) -> dict[str, str]:
    return {"entry_id": entry_id, "shown_at": shown_at.isoformat().replace("+00:00", "Z")}


def cleared(level_id: str, cleared_at: datetime) -> dict[str, str]:
    return {"level_id": level_id, "cleared_at": cleared_at.isoformat().replace("+00:00", "Z")}


@pytest.mark.parametrize(("field", "row"), [("shown_advice", shown), ("path_progress", cleared)])
def test_an_account_keeps_up_to_2000_entries_and_2000_levels(
    accounts_on: None, field: str, row: Any
) -> None:
    ann = signed_in()
    ids = [f"id-{n:04}" for n in range(MAX_PROGRESS_ROWS)]
    most = ann.post("/api/progress", json={field: [row(each, NOW) for each in ids]})
    kept = ann.get("/api/progress").json()

    one_more = ann.post("/api/progress", json={field: [row("one-more", NOW)]})
    the_same_later = ann.post(
        "/api/progress", json={field: [row(each, NOW + timedelta(hours=1)) for each in ids]}
    )

    assert most.status_code == 200
    assert one_more.status_code == 409
    assert one_more.json() == PROGRESS_FULL
    assert the_same_later.status_code == 200
    assert len(ann.get("/api/progress").json()[field]) == MAX_PROGRESS_ROWS
    assert len(kept[field]) == MAX_PROGRESS_ROWS


def test_advice_reads_the_2000_most_recently_shown_entries_at_most(
    accounts_on: None, engine: Engine
) -> None:
    signed_in()
    user_id = user_id_of(engine, ANN)
    # One more than a request may send, the first shown longest ago, as the database can hold
    # once advice has recorded tips on top of a full post.
    rows = [
        {"user_id": user_id, "entry_id": f"e-{n:04}", "shown_at": NOW + timedelta(minutes=n)}
        for n in range(MAX_SHOWN_IDS + 1)
    ]
    with engine.begin() as connection:
        connection.execute(insert(db.shown_advice), rows)

    shown_ids = sessions_api.shown_entry_ids(engine, user_id)

    assert shown_ids == [f"e-{n:04}" for n in range(1, MAX_SHOWN_IDS + 1)]


def test_listing_an_account_takes_about_the_memory_of_its_takes(accounts_on: None) -> None:
    ann = signed_in()
    # [{}, {}, ...]: the JSON that takes most memory parsed for its size, 1,000,000 bytes each as
    # the database keeps it (750,001 as sent, with no spaces).
    for n in range(4):
        response = keep(ann, take(f"objects-{n}", report={}, transcript=[{}] * 250_000))
        assert response.status_code == 200
    kept_bytes = 4 * 1_000_000

    tracemalloc.start()
    try:
        response = ann.get("/api/sessions")
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert response.status_code == 200
    assert [len(kept["transcript"]) for kept in response.json()] == [250_000] * 4
    # Parsed, the four transcripts alone would take over 60,000,000 bytes.
    assert peak < 4 * kept_bytes
