"""What a browser sends the Sessions API, and in what shape (backend/sessions_api.py, PLAN T48).

Every id, a take's, a library entry's or a skill-path level's, is 1 to 100 letters, digits, hyphens
and underscores: what crypto.randomUUID(), store.js's own fallback, the library and path.js make.
So a take's id stands in DELETE /api/sessions/{id} as it is, and every take kept can be deleted by
its id. An id with any other character, such as "/", "." or "..", is refused (422).

A take is not the record frontend/store.js keeps. The browser sends {id, created_at, report,
transcript}: created_at is the record's createdAt, the report holds its passageId, passageTitle,
durationSeconds and metrics, and the transcript is its transcript. The record as store.js keeps it
is refused (422).
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

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

# Ids the app makes: crypto.randomUUID(), store.js's fallback (Date.now and Math.random in base
# 36), the longest an id may be, and every kind of character an id may hold.
IDS_THE_APP_MAKES = [
    "8b1f6c2e-5d4a-4f1e-9c3b-2a7d6e0f1a2b",
    "mgo4k1x2k3j9d0a1b2c",
    "a" * 100,
    "Az09-_",
]
# Ids no take may have: each holds a character outside letters, digits, "-" and "_".
IDS_REFUSED = ["a/b", ".", "..", "a.b", "a b", "a?b", "a#b", "a%2Fb", "a~b", "é", "take\u200bone"]

# A session as frontend/store.js keeps it (SESSION_FIELDS), never with audio.
STORE_RECORD = {
    "id": "8b1f6c2e-5d4a-4f1e-9c3b-2a7d6e0f1a2b",
    "createdAt": "2026-10-11T08:00:00.123Z",
    "passageId": "uniforms",
    "passageTitle": "School uniforms",
    "durationSeconds": 42.9,
    "metrics": {"words_per_minute": 159.5, "pauses": [[12.4, 1.8]]},
    "transcript": [{"text": "uh,", "start": 9.1, "end": 9.3}],
}
REPORT_FIELDS = ("passageId", "passageTitle", "durationSeconds", "metrics")


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


def signed_in() -> TestClient:
    """A browser, on https as in production, that has signed up as Ann."""
    client = TestClient(app_module.app, base_url="https://testserver")
    response = client.post("/api/auth/signup", json={"email": ANN, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


def take(take_id: str) -> dict[str, Any]:
    return {"id": take_id, "created_at": NOW_TEXT, "report": {}, "transcript": []}


def keep(client: TestClient, sent: object) -> httpx2.Response:
    return client.post("/api/sessions", json=sent)


def ids_of(client: TestClient) -> list[str]:
    response = client.get("/api/sessions")
    assert response.status_code == 200, response.text
    return [kept["id"] for kept in response.json()]


def takes_kept(engine: Engine) -> int:
    with engine.connect() as connection:
        query = select(func.count()).select_from(db.speech_sessions)
        return connection.execute(query).scalar_one()


# --- ids -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("take_id", IDS_REFUSED)
def test_a_take_id_holds_letters_digits_hyphens_and_underscores_only(
    accounts_on: None, engine: Engine, take_id: str
) -> None:
    ann = signed_in()

    kept = keep(ann, take(take_id))
    imported = ann.post("/api/sessions/import", json={"sessions": [take(take_id)]})

    assert kept.status_code == imported.status_code == 422
    assert takes_kept(engine) == 0


@pytest.mark.parametrize("take_id", IDS_THE_APP_MAKES)
def test_every_take_kept_can_be_deleted_by_its_id(accounts_on: None, take_id: str) -> None:
    ann = signed_in()
    keep(ann, take(take_id))
    keep(ann, take("another"))

    response = ann.request("DELETE", f"/api/sessions/{quote(take_id, safe='')}", json={})

    assert response.status_code == 204
    assert ids_of(ann) == ["another"]


@pytest.mark.parametrize(
    "body",
    [
        {"shown_advice": [{"entry_id": "filler/001", "shown_at": NOW_TEXT}]},
        {"shown_advice": [{"entry_id": "filler.001", "shown_at": NOW_TEXT}]},
        {"path_progress": [{"level_id": "pace 1", "cleared_at": NOW_TEXT}]},
        {"path_progress": [{"level_id": "..", "cleared_at": NOW_TEXT}]},
    ],
)
def test_an_entry_or_level_id_follows_the_same_rule(accounts_on: None, body: object) -> None:
    ann = signed_in()

    response = ann.post("/api/progress", json=body)

    assert response.status_code == 422
    assert ann.get("/api/progress").json() == {"shown_advice": [], "path_progress": []}


def test_the_ids_of_the_library_and_the_path_are_kept(accounts_on: None) -> None:
    ann = signed_in()
    body = {
        "shown_advice": [{"entry_id": "pace_fast-001", "shown_at": NOW_TEXT}],
        "path_progress": [{"level_id": "long-pauses-3", "cleared_at": NOW_TEXT}],
    }

    response = ann.post("/api/progress", json=body)

    assert response.status_code == 200
    assert response.json() == body


# --- a store.js record ---------------------------------------------------------------------------


def take_from(record: dict[str, Any]) -> dict[str, Any]:
    """The take the browser sends for a store.js record, as the module's docstring maps it."""
    return {
        "id": record["id"],
        "created_at": record["createdAt"],
        "report": {field: record[field] for field in REPORT_FIELDS},
        "transcript": record["transcript"],
    }


def record_from(kept: dict[str, Any]) -> dict[str, Any]:
    """The store.js record for a take the server gives back."""
    return {
        "id": kept["id"],
        "createdAt": kept["created_at"],
        **kept["report"],
        "transcript": kept["transcript"],
    }


def test_a_store_js_record_as_it_is_kept_in_the_browser_is_refused(
    accounts_on: None, engine: Engine
) -> None:
    ann = signed_in()

    response = keep(ann, STORE_RECORD)

    assert response.status_code == 422
    assert takes_kept(engine) == 0


def test_a_store_js_record_sent_as_a_take_comes_back_whole(accounts_on: None) -> None:
    ann = signed_in()

    response = keep(ann, take_from(STORE_RECORD))
    [kept] = ann.get("/api/sessions").json()

    assert response.status_code == 200
    # The time comes back in UTC, to the microsecond: toISOString's milliseconds, and three zeros.
    assert record_from(kept) == {**STORE_RECORD, "createdAt": "2026-10-11T08:00:00.123000Z"}
