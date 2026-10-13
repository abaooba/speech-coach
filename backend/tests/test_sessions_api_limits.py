"""What one take, one request and one account may hold (backend/sessions_api.py, PLAN T48).

A report or a transcript nests at most 64 arrays and objects deep; real ones go about 5 deep.
Deeper JSON is refused (422) before it is kept, by POST /api/sessions and by an import alike, so
nothing kept can break the listing that gives it back.

An import holds 2,000,000 bytes of takes at most, counted as each take is (json_bytes): a longer
history goes in parts (422 otherwise). No request to these routes may carry a body over
3,000,000 bytes: it is refused with 413 before it is read in full, as its Content-Length says or
as its bytes arrive, because FastAPI parses a JSON body before any other check runs.

Every database here is SQLite in memory, and every route reads the time from NOW. A browser is a
TestClient at https://testserver, so its Secure session cookie goes back.
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
