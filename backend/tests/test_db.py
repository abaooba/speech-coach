"""The accounts database (backend/db.py, PLAN T46): five tables written with SQLAlchemy Core.

users holds one row per account. auth_sessions, speech_sessions, shown_advice and path_progress
hold rows that each belong to one account, and deleting the account deletes them (ON DELETE
CASCADE). No table can hold audio. The app reads DATABASE_URL, Neon Postgres in production, and
creates the tables on startup. With it unset accounts are off: the app serves guests as before
and an account route answers 503 {"detail": "accounts are not configured"}.

Every database here is SQLite in memory, built by db.make_engine("sqlite://"). pytest blocks the
network, so a Postgres URL is only ever turned into an engine (which connects on first use) and
no test lets one connect.
"""

import hashlib
import logging
import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Connection, Engine, LargeBinary, delete, event, func, insert, inspect, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError, StatementError

from backend import app as app_module
from backend import db

# A connection string as the Neon console writes it (made up). Some hosts write postgres://.
NEON_URL = (
    "postgresql://speech_coach:not-a-real-password@ep-quiet-sky-123456.us-east-2.aws.neon.tech"
    "/neondb?sslmode=require&channel_binding=require"
)
PSYCOPG_NEON_URL = NEON_URL.replace("postgresql://", "postgresql+psycopg://")

TABLES = ["auth_sessions", "path_progress", "shown_advice", "speech_sessions", "users"]
# The tables whose rows belong to an account, each with a user_id.
PER_USER_TABLES = ["auth_sessions", "speech_sessions", "shown_advice", "path_progress"]
PLANNED_COLUMNS = {
    "users": {"id", "email", "password_hash", "created_at"},
    "auth_sessions": {"token_hash", "user_id", "expires_at"},
    "speech_sessions": {"id", "user_id", "created_at", "report", "transcript"},
    "shown_advice": {"user_id", "entry_id", "shown_at"},
    "path_progress": {"user_id", "level_id", "cleared_at"},
}

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
# A zone seven hours behind UTC: a time written in it must still be compared by its moment.
UTC_MINUS_7 = timezone(timedelta(hours=-7))
SIGN_IN_LIFETIME = timedelta(days=30)
# The shape of an Argon2 hash (made up): the database only ever sees the hash.
PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2g"
NO_SUCH_USER = 999

# A take as frontend/store.js keeps it: crypto.randomUUID() for its id, a report and the words.
TAKE_ID = "8b1f6c2e-5d4a-4f1e-9c3b-2a7d6e0f1a2b"
REPORT = {
    "passageId": "uniforms",
    "passageTitle": "School uniforms",
    "durationSeconds": 42.882,
    "metrics": {"words_per_minute": 159.5, "filler_count": 2, "repeats": [{"start": 9.1}]},
}
TRANSCRIPT = [
    {"text": "a", "start": 8.61, "end": 8.7, "confidence": 0.99},
    {"text": "day—", "start": 8.7, "end": 9.02, "confidence": 0.93},
    {"text": "uh,", "start": 9.1, "end": 9.3, "confidence": 0.88},
]


class StoppedBeforeConnecting(Exception):
    """Raised by a test in place of opening a real database connection."""


@pytest.fixture
def engine() -> Iterator[Engine]:
    """A new, empty in-memory database with the five tables."""
    engine = db.make_engine("sqlite://")
    db.create_tables(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """DATABASE_URL unset and no engine built from it yet; a test may set it. Reset afterwards."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    db.configured_engine.cache_clear()
    yield monkeypatch
    db.configured_engine.cache_clear()


def add_user(connection: Connection, email: str = "ann@example.com") -> int:
    """Create an account and return its id."""
    result = connection.execute(
        insert(db.users).values(email=email, password_hash=PASSWORD_HASH, created_at=NOW)
    )
    return result.inserted_primary_key[0]


def add_take(connection: Connection, user_id: int, **changes: Any) -> None:
    """Keep the take TAKE_ID for `user_id`, changed by `changes`."""
    take = {
        "id": TAKE_ID,
        "user_id": user_id,
        "created_at": NOW,
        "report": REPORT,
        "transcript": TRANSCRIPT,
    }
    connection.execute(insert(db.speech_sessions).values({**take, **changes}))


def token_hash(token: str) -> str:
    """A session token as the database holds it: its sha256, in hex."""
    return hashlib.sha256(token.encode()).hexdigest()


def rows_for(user_id: int) -> dict[str, dict[str, Any]]:
    """One row for `user_id` in each table that belongs to an account, by table name."""
    return {
        "auth_sessions": {
            "token_hash": token_hash(f"token of user {user_id}"),
            "user_id": user_id,
            "expires_at": NOW + SIGN_IN_LIFETIME,
        },
        "speech_sessions": {
            "id": TAKE_ID,
            "user_id": user_id,
            "created_at": NOW,
            "report": REPORT,
            "transcript": TRANSCRIPT,
        },
        "shown_advice": {"user_id": user_id, "entry_id": "filler-001", "shown_at": NOW},
        "path_progress": {"user_id": user_id, "level_id": "fillers-1", "cleared_at": NOW},
    }


def add_rows_for(connection: Connection, user_id: int) -> None:
    """Give `user_id` one row in each table that belongs to an account."""
    for table_name, row in rows_for(user_id).items():
        connection.execute(insert(db.metadata.tables[table_name]).values(row))


def rows_held(connection: Connection, user_id: int) -> list[int]:
    """How many rows `user_id` has in each of PER_USER_TABLES, in that order."""
    counts = []
    for table_name in PER_USER_TABLES:
        table = db.metadata.tables[table_name]
        count = select(func.count()).select_from(table).where(table.c.user_id == user_id)
        counts.append(connection.execute(count).scalar_one())
    return counts


def query_plan(engine: Engine, sql: str) -> list[str]:
    """The steps SQLite takes to run `sql`: "SEARCH ..." uses an index, "SCAN ..." reads all."""
    with engine.connect() as connection:
        return [row.detail for row in connection.exec_driver_sql(f"EXPLAIN QUERY PLAN {sql}")]


def accounts_app() -> FastAPI:
    """An app with one stand-in account route that declares db.accounts_engine, as T47's will."""
    stand_in = FastAPI()

    @stand_in.get("/api/me")
    def me(engine: Annotated[Engine, Depends(db.accounts_engine)]) -> dict[str, str]:
        return {"database": engine.dialect.name}

    return stand_in


# --- DATABASE_URL --------------------------------------------------------------------------------


@pytest.mark.parametrize("scheme", ["postgres", "postgresql"])
def test_a_postgres_url_without_a_driver_is_given_psycopg(scheme: str) -> None:
    url = NEON_URL.replace("postgresql://", f"{scheme}://")

    assert db.normalize_database_url(url) == PSYCOPG_NEON_URL


@pytest.mark.parametrize(
    "url", [PSYCOPG_NEON_URL, "sqlite://", "sqlite:////srv/speech-coach/accounts.db"]
)
def test_any_other_url_is_kept_as_it_is(url: str) -> None:
    assert db.normalize_database_url(url) == url


def test_a_neon_url_makes_a_postgres_engine_that_uses_psycopg() -> None:
    engine = db.make_engine(NEON_URL)

    assert (engine.dialect.name, engine.dialect.driver) == ("postgresql", "psycopg")
    assert engine.url.query == {"sslmode": "require", "channel_binding": "require"}


def test_postgres_connections_are_checked_before_use_and_give_up_after_10_seconds() -> None:
    engine = db.make_engine(NEON_URL)
    connect_arguments: dict[str, Any] = {}

    @event.listens_for(engine, "do_connect")
    def stop_before_connecting(
        dialect: Any, connection_record: Any, cargs: Any, cparams: dict[str, Any]
    ) -> None:
        connect_arguments.update(cparams)
        raise StoppedBeforeConnecting

    with pytest.raises(StoppedBeforeConnecting):
        engine.connect()

    assert connect_arguments["connect_timeout"] == 10
    # Neon closes idle connections when it suspends the database; each is pinged before use.
    assert engine.pool._pre_ping


# --- accounts on and off -------------------------------------------------------------------------


@pytest.mark.parametrize("database_url", [None, "", "   "])
def test_without_a_database_url_accounts_are_off(
    environment: pytest.MonkeyPatch, database_url: str | None
) -> None:
    if database_url is not None:
        environment.setenv("DATABASE_URL", database_url)

    assert db.configured_engine() is None


def test_one_engine_is_built_from_database_url(environment: pytest.MonkeyPatch) -> None:
    # Pasted into a dashboard with a stray space around it.
    environment.setenv("DATABASE_URL", " sqlite:// ")

    engine = db.configured_engine()

    assert engine is not None
    assert engine.dialect.name == "sqlite"
    assert db.configured_engine() is engine


def test_an_account_route_answers_503_while_accounts_are_off(
    environment: pytest.MonkeyPatch,
) -> None:
    response = TestClient(accounts_app()).get("/api/me")

    assert response.status_code == 503
    assert response.json() == {"detail": "accounts are not configured"}


def test_an_account_route_gets_the_engine_when_accounts_are_on(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("DATABASE_URL", "sqlite://")

    response = TestClient(accounts_app()).get("/api/me")

    assert response.status_code == 200
    assert response.json() == {"database": "sqlite"}


# --- startup -------------------------------------------------------------------------------------


def test_without_a_database_the_app_starts_and_serves_guests(
    environment: pytest.MonkeyPatch,
) -> None:
    with TestClient(app_module.app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/").status_code == 200


def test_the_app_creates_the_tables_on_startup(environment: pytest.MonkeyPatch) -> None:
    environment.setenv("DATABASE_URL", "sqlite://")

    with TestClient(app_module.app) as client:
        engine = db.configured_engine()
        assert engine is not None
        assert sorted(inspect(engine).get_table_names()) == TABLES
        assert client.get("/api/health").status_code == 200


def test_a_database_that_cannot_be_reached_is_logged_and_guests_are_still_served(
    environment: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    # SQLite cannot open a file in a folder that does not exist, so every connection fails.
    environment.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/no-such-folder/accounts.db")

    with TestClient(app_module.app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}

    [error] = [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert "OperationalError" in error.getMessage()
    # The URL is never logged: in production it holds the database password.
    assert str(tmp_path) not in caplog.text


# --- the tables ----------------------------------------------------------------------------------


def test_the_tables_have_the_planned_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    columns = {
        table_name: {column["name"] for column in inspector.get_columns(table_name)}
        for table_name in inspector.get_table_names()
    }

    assert columns == PLANNED_COLUMNS


def test_no_column_can_hold_audio() -> None:
    for table in db.metadata.sorted_tables:
        for column in table.columns:
            assert not isinstance(column.type, LargeBinary), column
            assert "audio" not in column.name, column


def test_every_table_but_users_belongs_to_an_account_and_goes_with_it() -> None:
    for table in db.metadata.sorted_tables:
        if table is db.users:
            continue
        [foreign_key] = table.foreign_keys
        assert foreign_key.parent is table.c.user_id, table
        assert foreign_key.column is db.users.c.id, table
        assert foreign_key.ondelete == "CASCADE", table
        assert not table.c.user_id.nullable, table


def test_creating_the_tables_again_keeps_every_row(engine: Engine) -> None:
    with engine.begin() as connection:
        user_id = add_user(connection)
        add_rows_for(connection, user_id)

    db.create_tables(engine)

    with engine.connect() as connection:
        assert rows_held(connection, user_id) == [1, 1, 1, 1]


# --- accounts ------------------------------------------------------------------------------------


def test_one_account_per_email(engine: Engine) -> None:
    with engine.begin() as connection:
        add_user(connection, "ann@example.com")

    with pytest.raises(IntegrityError, match="UNIQUE"), engine.begin() as connection:
        add_user(connection, "ann@example.com")


def test_an_email_is_kept_lowercased_so_capitals_cannot_make_a_second_account(
    engine: Engine,
) -> None:
    with pytest.raises(IntegrityError, match="lowercase"), engine.begin() as connection:
        add_user(connection, "Ann@Example.com")


@pytest.mark.parametrize("table_name", PER_USER_TABLES)
def test_a_row_for_an_account_that_does_not_exist_is_refused(
    engine: Engine, table_name: str
) -> None:
    row = rows_for(NO_SUCH_USER)[table_name]

    with pytest.raises(IntegrityError, match="FOREIGN KEY"), engine.begin() as connection:
        connection.execute(insert(db.metadata.tables[table_name]).values(row))


def test_deleting_an_account_deletes_its_rows_in_every_table_and_no_one_elses(
    engine: Engine,
) -> None:
    with engine.begin() as connection:
        ann = add_user(connection, "ann@example.com")
        bob = add_user(connection, "bob@example.com")
        add_rows_for(connection, ann)
        add_rows_for(connection, bob)

    with engine.begin() as connection:
        connection.execute(delete(db.users).where(db.users.c.id == ann))

    with engine.connect() as connection:
        assert rows_held(connection, ann) == [0, 0, 0, 0]
        assert rows_held(connection, bob) == [1, 1, 1, 1]


# --- takes ---------------------------------------------------------------------------------------


def test_two_speakers_can_keep_takes_with_the_same_id(engine: Engine) -> None:
    with engine.begin() as connection:
        ann = add_user(connection, "ann@example.com")
        bob = add_user(connection, "bob@example.com")
        add_take(connection, ann)
        add_take(connection, bob, report={"durationSeconds": 61.0})

    takes = db.speech_sessions
    with engine.connect() as connection:
        reports = connection.execute(
            select(takes.c.user_id, takes.c.report).where(takes.c.id == TAKE_ID)
        ).all()

    assert sorted(reports) == [(ann, REPORT), (bob, {"durationSeconds": 61.0})]


def test_a_speaker_keeps_one_take_per_id(engine: Engine) -> None:
    with engine.begin() as connection:
        user_id = add_user(connection)
        add_take(connection, user_id)

    with pytest.raises(IntegrityError, match="UNIQUE"), engine.begin() as connection:
        add_take(connection, user_id)


def test_importing_the_same_takes_twice_keeps_one_copy_of_each(engine: Engine) -> None:
    with engine.begin() as connection:
        user_id = add_user(connection)
    guest_history = [
        {**rows_for(user_id)["speech_sessions"], "id": take_id} for take_id in ("t-1", "t-2")
    ]
    # An import that skips the ids the speaker already has, as the key lets it (PLAN T48).
    skip_ids_already_held = sqlite_insert(db.speech_sessions).on_conflict_do_nothing()

    for _ in range(2):
        with engine.begin() as connection:
            connection.execute(skip_ids_already_held, guest_history)

    with engine.connect() as connection:
        ids = connection.execute(select(db.speech_sessions.c.id)).scalars().all()
    assert sorted(ids) == ["t-1", "t-2"]


def test_a_take_keeps_its_report_and_transcript_as_sent(engine: Engine) -> None:
    with engine.begin() as connection:
        add_take(connection, add_user(connection))

    with engine.connect() as connection:
        take = connection.execute(select(db.speech_sessions)).one()

    assert (take.id, take.created_at) == (TAKE_ID, NOW)
    assert take.report == REPORT
    assert take.transcript == TRANSCRIPT


@pytest.mark.parametrize("missing", ["report", "transcript"])
def test_a_take_without_its_report_or_transcript_is_refused(engine: Engine, missing: str) -> None:
    with engine.begin() as connection:
        user_id = add_user(connection)

    with pytest.raises(IntegrityError, match="NOT NULL"), engine.begin() as connection:
        add_take(connection, user_id, **{missing: None})


# --- times ---------------------------------------------------------------------------------------


def test_a_time_comes_back_as_the_same_moment_in_utc(engine: Engine) -> None:
    recorded = datetime(2026, 10, 11, 20, 15, tzinfo=UTC_MINUS_7)
    with engine.begin() as connection:
        add_take(connection, add_user(connection), created_at=recorded)

    with engine.connect() as connection:
        created_at = connection.execute(select(db.speech_sessions.c.created_at)).scalar_one()

    assert created_at == datetime(2026, 10, 12, 3, 15, tzinfo=UTC) == recorded
    assert created_at.tzinfo is UTC


def test_a_time_without_a_zone_is_refused(engine: Engine) -> None:
    no_zone = NOW.replace(tzinfo=None)

    with pytest.raises(StatementError, match="zone"), engine.begin() as connection:
        connection.execute(
            insert(db.users).values(
                email="ann@example.com", password_hash=PASSWORD_HASH, created_at=no_zone
            )
        )


def test_an_expired_sign_in_is_told_apart_by_its_moment_not_its_wall_clock(
    engine: Engine,
) -> None:
    with engine.begin() as connection:
        user_id = add_user(connection)
        connection.execute(
            insert(db.auth_sessions),
            [
                {
                    "token_hash": token_hash("expired"),
                    "user_id": user_id,
                    "expires_at": NOW - timedelta(seconds=1),
                },
                {
                    "token_hash": token_hash("live"),
                    "user_id": user_id,
                    "expires_at": NOW + timedelta(seconds=1),
                },
            ],
        )
    # The same moment as NOW, written seven hours behind: 11:30 on the wall clock.
    now_elsewhere = NOW.astimezone(UTC_MINUS_7)

    sign_ins = db.auth_sessions
    with engine.connect() as connection:
        live = connection.execute(
            select(sign_ins.c.token_hash).where(sign_ins.c.expires_at > now_elsewhere)
        ).scalars()

        assert list(live) == [token_hash("live")]


# --- indexes -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "lookup",
    [
        "SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = 'x'",
        "SELECT token_hash FROM auth_sessions WHERE user_id = 1",
        "SELECT id, password_hash FROM users WHERE email = 'ann@example.com'",
        "SELECT * FROM speech_sessions WHERE user_id = 1",
        "SELECT * FROM speech_sessions WHERE user_id = 1 AND id = 'x'",
        "SELECT * FROM shown_advice WHERE user_id = 1",
        "SELECT * FROM path_progress WHERE user_id = 1",
    ],
)
def test_lookups_by_token_email_and_speaker_use_an_index(engine: Engine, lookup: str) -> None:
    steps = query_plan(engine, lookup)

    assert steps and all(step.startswith("SEARCH") for step in steps), steps


@pytest.mark.parametrize(
    "listing",
    [
        # History, Progress and the calendar: a speaker's takes, newest first.
        "SELECT * FROM speech_sessions WHERE user_id = 1 ORDER BY created_at DESC",
        # candidates() (backend/advice/select.py): the ids shown to a speaker, oldest first.
        "SELECT entry_id FROM shown_advice WHERE user_id = 1 ORDER BY shown_at",
    ],
)
def test_a_speakers_takes_and_shown_advice_are_read_in_order_without_a_sort(
    engine: Engine, listing: str
) -> None:
    steps = query_plan(engine, listing)

    assert steps and steps[0].startswith("SEARCH"), steps
    assert not any("TEMP B-TREE" in step for step in steps), steps


# --- SQLite in memory ----------------------------------------------------------------------------


def test_every_thread_sees_the_one_in_memory_database(engine: Engine) -> None:
    with engine.begin() as connection:
        add_user(connection)
    emails_seen: list[str] = []

    def read_emails() -> None:
        with engine.connect() as connection:
            emails_seen.extend(connection.execute(select(db.users.c.email)).scalars())

    # FastAPI runs a plain `def` route on a worker thread, as here.
    worker = threading.Thread(target=read_emails)
    worker.start()
    worker.join()

    assert emails_seen == ["ann@example.com"]
