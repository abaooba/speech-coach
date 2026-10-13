"""POST /api/advice when the accounts database fails (backend/app.py, PLAN T48).

Advice never needs the database: a guest's tips come from the request alone. So when the account
part of the route fails, whether finding who the browser is, reading what the speaker was shown or
recording the tips given, the speaker still gets their tips. A browser whose account cannot be
read is served as a guest, by the shown ids its request sends, and tips that cannot be recorded
are given all the same. The fault is logged by its kind alone: the database's own message can
name its host, its user or its file.

Every database here is SQLite: in memory, or a file in a folder that does not exist, which no
connection can open. No test asks the model: /api/advice answers with the library's own tips.
"""

import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select

from backend import app as app_module
from backend import auth, db
from backend.advice import load_library
from backend.advice.select import ReportSummary, candidates, weakest_skills

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
ANN = "ann@example.com"
PASSWORD = "correct horse battery staple"
# What a browser holds when it was never signed in to this server: a made-up session.
MADE_UP_COOKIE = {"cookie": f"sc_session={'a' * 43}"}

# The owner's 2026-10-11 uniforms take as the Results screen asks /api/advice about it.
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


class Database:
    """The engine every route gets; a test may swap it for one that fails."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine


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
def unreachable(tmp_path: Path) -> Iterator[Engine]:
    """An engine for a database file in a folder that does not exist: every connection fails."""
    engine = db.make_engine(f"sqlite:///{tmp_path / 'missing-folder' / 'speech.db'}")
    yield engine
    engine.dispose()


@pytest.fixture
def without_tables() -> Iterator[Engine]:
    """A database whose tables were never made, as on a first deploy whose start could not."""
    engine = db.make_engine("sqlite://")
    yield engine
    engine.dispose()


@pytest.fixture
def database(engine: Engine) -> Iterator[Database]:
    """Accounts on, with no model: every route gets `database.engine` and NOW."""
    database = Database(engine)
    overrides = app_module.app.dependency_overrides
    overrides[db.accounts_engine_or_none] = lambda: database.engine
    overrides[auth.current_time] = lambda: NOW
    overrides[app_module.advice_client] = lambda: None
    yield database
    for dependency in (db.accounts_engine_or_none, auth.current_time, app_module.advice_client):
        overrides.pop(dependency, None)


@pytest.fixture
def logs(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.WARNING)
    return caplog


def browser() -> TestClient:
    """A browser that keeps its own cookies, on https as in production."""
    return TestClient(app_module.app, base_url="https://testserver")


def signed_in() -> TestClient:
    """A browser that has signed up as Ann, and so is signed in."""
    client = browser()
    response = client.post("/api/auth/signup", json={"email": ANN, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


def advice_body(shown_ids: list[str]) -> dict[str, Any]:
    """The body the Results screen sends for the uniforms take."""
    return {
        "session_id": TAKE_ID,
        "summary": {**NUMBERS, "transcript_excerpt": EXCERPT},
        "tier": TIER,
        "shown_ids": shown_ids,
    }


def tips_for(
    client: TestClient, shown_ids: list[str], headers: dict[str, str] | None = None
) -> list[str]:
    """POST /api/advice for the uniforms take; the ids of the tips in the 200 answer."""
    response = client.post("/api/advice", json=advice_body(shown_ids), headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "library"
    return [tip["entry_id"] for tip in response.json()["tips"]]


def library_tips_for(shown_ids: list[str]) -> list[str]:
    """The ids of the tips the uniforms take gets with no model, given those shown oldest first."""
    weak_skills = weakest_skills(NUMBERS)
    offered = candidates(load_library(), weak_skills, TIER, shown_ids, session_id=TAKE_ID)
    return [entry.id for entry in offered[:3]]


def shown_rows(engine: Engine) -> list[tuple[str, datetime]]:
    with engine.connect() as connection:
        table = db.shown_advice
        rows = connection.execute(select(table.c.entry_id, table.c.shown_at).order_by("entry_id"))
        return [tuple(row) for row in rows]


def assert_logged_by_kind_alone(logs: pytest.LogCaptureFixture, kind: str, *secrets: str) -> None:
    """A warning names the fault's kind, and no record holds any of `secrets`."""
    assert any(kind in record.getMessage() for record in logs.records), logs.text
    for secret in secrets:
        assert secret not in logs.text
    assert not any(record.exc_info for record in logs.records)


# --- the database cannot be reached ---------------------------------------------------------------


def test_a_browser_with_a_session_cookie_gets_advice_while_the_database_is_unreachable(
    database: Database, unreachable: Engine, logs: pytest.LogCaptureFixture
) -> None:
    database.engine = unreachable
    first_tips = library_tips_for([])

    tips = tips_for(browser(), first_tips, headers=MADE_UP_COOKIE)

    assert tips == library_tips_for(first_tips)
    assert_logged_by_kind_alone(logs, "OperationalError", "unable to open", "missing-folder")


def test_a_signed_in_speaker_is_served_as_a_guest_once_the_database_goes_down(
    database: Database, unreachable: Engine, logs: pytest.LogCaptureFixture
) -> None:
    ann = signed_in()
    database.engine = unreachable
    first_tips = library_tips_for([])

    tips = tips_for(ann, first_tips)

    assert tips == library_tips_for(first_tips)
    assert_logged_by_kind_alone(logs, "OperationalError", "unable to open", "missing-folder")


def test_a_browser_with_a_session_cookie_gets_advice_when_the_tables_were_never_created(
    database: Database, without_tables: Engine, logs: pytest.LogCaptureFixture
) -> None:
    # Every session lookup meets a missing table.
    database.engine = without_tables
    first_tips = library_tips_for([])

    tips = tips_for(browser(), first_tips, headers=MADE_UP_COOKIE)

    assert tips == library_tips_for(first_tips)
    assert_logged_by_kind_alone(logs, "OperationalError", "no such table")


# --- the account is found, then the database fails -----------------------------------------------


def test_a_speaker_whose_shown_advice_cannot_be_read_is_served_by_the_request(
    database: Database, engine: Engine, logs: pytest.LogCaptureFixture
) -> None:
    ann = signed_in()
    with engine.begin() as connection:
        db.shown_advice.drop(connection)
    first_tips = library_tips_for([])

    tips = tips_for(ann, first_tips)

    assert tips == library_tips_for(first_tips)
    assert_logged_by_kind_alone(logs, "OperationalError", "no such table")


def test_tips_that_cannot_be_recorded_are_given_all_the_same(
    database: Database, engine: Engine, logs: pytest.LogCaptureFixture
) -> None:
    ann = signed_in()
    seen = library_tips_for([])
    earlier = (NOW - timedelta(hours=1)).isoformat()
    progress = {"shown_advice": [{"entry_id": entry_id, "shown_at": earlier} for entry_id in seen]}
    assert ann.post("/api/progress", json=progress).status_code == 200
    before = shown_rows(engine)
    # As a database over its storage quota: reads still work, every write is refused.
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA query_only = ON")

    # The account's history is read, so the request's own list is passed over.
    tips = tips_for(ann, shown_ids=[])

    assert tips == library_tips_for(sorted(seen))
    assert shown_rows(engine) == before
    assert_logged_by_kind_alone(logs, "OperationalError", "readonly")


def test_a_speaker_whose_tips_are_recorded_logs_nothing(
    database: Database, engine: Engine, logs: pytest.LogCaptureFixture
) -> None:
    ann = signed_in()

    tips = tips_for(ann, shown_ids=[])

    with engine.connect() as connection:
        count = connection.execute(select(func.count()).select_from(db.shown_advice)).scalar_one()
    assert count == len(tips)
    assert logs.records == []
