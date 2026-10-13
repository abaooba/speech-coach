"""POST /api/advice when the account part fails with something other than a database error.

test_advice_account_faults.py covers the database's own errors (SQLAlchemyError). Any other fault
on the way, such as an error the driver raises that SQLAlchemy does not wrap, or a ValueError
from a statement that cannot be built, is met the same way, so the speaker never gets a 500:

- the browser's session cannot be looked up: it is served as a guest;
- the advice shown to the speaker cannot be read: they are served as a guest, by the shown ids
  their request sends, and the tips are not recorded;
- the tips cannot be recorded: they are given all the same.

Each fault is logged by its kind alone, never by its message, which can name the database's host.
Every database here is SQLite in memory, and no test asks the model.
"""

import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select

from backend import app as app_module
from backend import auth, db, sessions_api
from backend.advice import load_library
from backend.advice.select import ReportSummary, candidates, weakest_skills

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
ANN = "ann@example.com"
PASSWORD = "correct horse battery staple"
# What a fault's message may hold, and no log line may: the database's host.
HOST = "ep-quiet-sky-123456.neon.tech"

TAKE_ID = "8b1f6c2e-take-one"
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
EXCERPT = "Choosing how to present yourself is one of the few decisions a day— uh, the few."


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
    """Accounts on, with no model: every route gets the test's database and NOW."""
    overrides = app_module.app.dependency_overrides
    overrides[db.accounts_engine_or_none] = lambda: engine
    overrides[auth.current_time] = lambda: NOW
    overrides[app_module.advice_client] = lambda: None
    yield
    for dependency in (db.accounts_engine_or_none, auth.current_time, app_module.advice_client):
        overrides.pop(dependency, None)


@pytest.fixture
def logs(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.WARNING)
    return caplog


def signed_in() -> TestClient:
    """A browser that has signed up as Ann, and so is signed in."""
    client = TestClient(app_module.app, base_url="https://testserver")
    response = client.post("/api/auth/signup", json={"email": ANN, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


def library_tips_for(shown_ids: list[str]) -> list[str]:
    """The ids of the tips the take gets with no model, given those shown oldest first."""
    weak_skills = weakest_skills(NUMBERS)
    offered = candidates(load_library(), weak_skills, TIER, shown_ids, session_id=TAKE_ID)
    return [entry.id for entry in offered[:3]]


def tips_for(client: TestClient, shown_ids: list[str]) -> list[str]:
    """POST /api/advice for the take; the ids of the tips in the 200 answer."""
    body: dict[str, Any] = {
        "session_id": TAKE_ID,
        "summary": {**NUMBERS, "transcript_excerpt": EXCERPT},
        "tier": TIER,
        "shown_ids": shown_ids,
    }
    response = client.post("/api/advice", json=body)
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "library"
    return [tip["entry_id"] for tip in response.json()["tips"]]


def shown_rows(engine: Engine) -> int:
    with engine.connect() as connection:
        return connection.execute(select(func.count()).select_from(db.shown_advice)).scalar_one()


def failing(fault: Exception) -> Any:
    """A stand-in for a database step that raises `fault` whatever it is given."""

    def fail(*args: object, **kwargs: object) -> Any:
        raise fault

    return fail


def assert_logged_by_kind_alone(logs: pytest.LogCaptureFixture, kind: str) -> None:
    """A warning names the fault's kind, and nothing logged holds its message or a traceback."""
    assert any(kind in record.getMessage() for record in logs.records), logs.text
    assert HOST not in logs.text
    assert not any(record.exc_info for record in logs.records)


def test_a_browser_whose_session_cannot_be_looked_up_is_served_as_a_guest(
    accounts_on: None, logs: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    ann = signed_in()
    monkeypatch.setattr(auth, "account_signed_in_by", failing(RuntimeError(f"no route to {HOST}")))
    first_tips = library_tips_for([])

    tips = tips_for(ann, first_tips)

    assert tips == library_tips_for(first_tips)
    assert_logged_by_kind_alone(logs, "RuntimeError")


def test_a_speaker_whose_shown_advice_cannot_be_read_is_served_by_their_request(
    accounts_on: None,
    engine: Engine,
    logs: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ann = signed_in()
    monkeypatch.setattr(sessions_api, "shown_entry_ids", failing(ValueError(f"bad {HOST}")))
    first_tips = library_tips_for([])

    tips = tips_for(ann, first_tips)

    assert tips == library_tips_for(first_tips)
    # Served as a guest: nothing is recorded for an account whose history could not be read.
    assert shown_rows(engine) == 0
    assert_logged_by_kind_alone(logs, "ValueError")


def test_tips_that_cannot_be_recorded_for_any_reason_are_given_all_the_same(
    accounts_on: None,
    engine: Engine,
    logs: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ann = signed_in()
    fault = ValueError(f"accounts need Postgres or SQLite, not the one at {HOST}")
    monkeypatch.setattr(sessions_api, "record_shown", failing(fault))

    tips = tips_for(ann, shown_ids=[])

    assert tips == library_tips_for([])
    assert shown_rows(engine) == 0
    assert_logged_by_kind_alone(logs, "ValueError")
