"""The accounts database (docs/PLAN.md T46): five tables, written with SQLAlchemy Core.

Accounts are optional and guests come first: whatever a guest does stays in the browser
(frontend/store.js). When DATABASE_URL is set, a signed-in speaker's takes, the advice they have
been shown and their skill-path progress are kept here as well. In production that is Neon
Postgres, reached through psycopg; the tests use SQLite in memory. With DATABASE_URL unset,
accounts are off: the app serves guests as before and every account route answers 503
(accounts_engine).

Every table but users belongs to one account, and deleting the account deletes its rows (ON
DELETE CASCADE). No table has a column for audio: recordings are never stored.
"""

import os
from datetime import UTC, datetime
from functools import cache
from typing import Any

from fastapi import HTTPException
from sqlalchemy import (
    JSON,
    URL,
    CheckConstraint,
    Column,
    DateTime,
    Dialect,
    Engine,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    String,
    Table,
    TypeDecorator,
    create_engine,
    event,
    make_url,
)
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.pool import ConnectionPoolEntry, StaticPool

# Where the server finds the database: the environment only (the Render dashboard, or .env
# locally), never a file in the repo. The URL holds the database password, so it is never logged.
DATABASE_URL_VARIABLE = "DATABASE_URL"
# What an account route answers, with a 503, while DATABASE_URL is unset.
ACCOUNTS_NOT_CONFIGURED = "accounts are not configured"

# Neon and most hosts write Postgres URLs as postgresql:// or postgres://, naming no driver.
# SQLAlchemy knows no dialect called "postgres", and its default driver for "postgresql" was
# psycopg2 before version 2.1, so the URL names the driver requirements.txt installs: psycopg 3.
DRIVERLESS_POSTGRES_SCHEMES = ("postgres", "postgresql")
PSYCOPG_SCHEME = "postgresql+psycopg"
# Long enough for Neon to wake a suspended database, short enough that a database that cannot
# be reached fails the startup or the request instead of holding it for minutes.
CONNECT_TIMEOUT_SECONDS = 10
# How SQLAlchemy writes a SQLite database that lives in memory: no file name, or ":memory:".
IN_MEMORY_SQLITE_DATABASES = (None, "", ":memory:")

# A session token's sha256, written as hex.
TOKEN_HASH_LENGTH = 64


class UTCDateTime(TypeDecorator[datetime]):
    """A moment in time: written as UTC, read back as an aware datetime in UTC.

    Postgres keeps the zone (timestamp with time zone), but SQLite has no date type and keeps
    the time as text without one. Writing UTC and attaching UTC on the way back makes both give
    the same datetime, and makes SQLite compare times, such as an expiry with now, by the moment
    they name. A datetime without a zone is refused rather than guessed at.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.utcoffset() is None:
            raise ValueError("A time must carry its zone, such as datetime.now(UTC)")
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


metadata = MetaData()


def _user_id_column() -> Column[int]:
    """The account a row belongs to. Deleting the account deletes the row (ON DELETE CASCADE)."""
    return Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)


# One row per account. The email is kept lowercased, and the database checks it rather than
# trusting every caller, so Ann@Example.com and ann@example.com cannot be two accounts.
# password_hash is an Argon2 hash; the password itself is never stored.
users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String, nullable=False, unique=True),
    Column("password_hash", String, nullable=False),
    Column("created_at", UTCDateTime, nullable=False),
    CheckConstraint("email = lower(email)", name="users_email_is_lowercase"),
)

# A browser signed in to an account until expires_at. token_hash is the sha256 of the token in
# its cookie, so the database never holds a token that would sign anyone in. As the primary key
# it is the index every signed-in request looks the token up by.
auth_sessions = Table(
    "auth_sessions",
    metadata,
    Column("token_hash", String(TOKEN_HASH_LENGTH), primary_key=True),
    _user_id_column(),
    Column("expires_at", UTCDateTime, nullable=False),
    # Signing out everywhere and deleting an account find a speaker's sign-ins by user.
    Index("ix_auth_sessions_user_id", "user_id"),
)

# A take kept for a signed-in speaker, as IndexedDB keeps it: the id the browser gave it, when
# it was recorded, its report (the take's metrics and details) and its transcript (the words
# with their timings). The key is (user_id, id), so two speakers' ids can never collide, and an
# import that meets an id the speaker already has can skip it: importing twice keeps one copy.
speech_sessions = Table(
    "speech_sessions",
    metadata,
    Column("id", String, nullable=False),
    _user_id_column(),
    Column("created_at", UTCDateTime, nullable=False),
    # none_as_null: a missing report or transcript fails NOT NULL instead of being kept as null.
    Column("report", JSON(none_as_null=True), nullable=False),
    Column("transcript", JSON(none_as_null=True), nullable=False),
    PrimaryKeyConstraint("user_id", "id"),
    # History, Progress and the calendar list a speaker's takes newest first.
    Index("ix_speech_sessions_user_id_created_at", "user_id", "created_at"),
)

# Library advice (backend/advice/library.json) a speaker has been shown, and when last: a tip is
# not repeated while new ones are left, then the least recently shown come back first.
shown_advice = Table(
    "shown_advice",
    metadata,
    _user_id_column(),
    Column("entry_id", String, nullable=False),
    Column("shown_at", UTCDateTime, nullable=False),
    PrimaryKeyConstraint("user_id", "entry_id"),
    # candidates() (backend/advice/select.py) takes the ids shown to a speaker oldest first.
    Index("ix_shown_advice_user_id_shown_at", "user_id", "shown_at"),
)

# Skill-path levels (frontend/path.js) a speaker has cleared, and when.
path_progress = Table(
    "path_progress",
    metadata,
    _user_id_column(),
    Column("level_id", String, nullable=False),
    Column("cleared_at", UTCDateTime, nullable=False),
    PrimaryKeyConstraint("user_id", "level_id"),
)


def normalize_database_url(url: str) -> str:
    """`url` with the psycopg driver named, when it is a Postgres URL that names none.

    postgres://... and postgresql://... become postgresql+psycopg://...; the rest, credentials
    and options such as sslmode included, is kept exactly. Any other URL is returned unchanged.
    """
    scheme, separator, rest = url.partition("://")
    if separator and scheme in DRIVERLESS_POSTGRES_SCHEMES:
        return f"{PSYCOPG_SCHEME}://{rest}"
    return url


def make_engine(url: str) -> Engine:
    """A new engine for `url`, normalized first. It connects on first use, not here.

    Postgres connections are pinged before each use, because Neon closes idle ones when it
    suspends the database, and give up after CONNECT_TIMEOUT_SECONDS. SQLite (the tests, or a
    file for local work) is made to enforce foreign keys, ON DELETE CASCADE included, which it
    otherwise ignores. Every engine keeps the values bound to a statement out of its errors
    (_new_engine).
    """
    database_url = make_url(normalize_database_url(url))
    if database_url.get_backend_name() == "sqlite":
        return _sqlite_engine(database_url)
    return _new_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
    )


def _new_engine(database_url: URL, **options: Any) -> Engine:
    """create_engine with `options` and what every engine here shares.

    hide_parameters: an error names the statement that failed but not the values bound to it,
    such as a password hash, a token hash, an email or a transcript. A route's error that is not
    caught is logged whole, and those values must never reach the log.
    """
    return create_engine(database_url, hide_parameters=True, **options)


def _sqlite_engine(database_url: URL) -> Engine:
    if database_url.database in IN_MEMORY_SQLITE_DATABASES:
        # An in-memory database lives inside its connection, so there is one connection and
        # every thread shares it: FastAPI runs each plain `def` route on a worker thread.
        engine = _new_engine(
            database_url, poolclass=StaticPool, connect_args={"check_same_thread": False}
        )
    else:
        engine = _new_engine(database_url)
    event.listen(engine, "connect", _enforce_foreign_keys)
    return engine


def _enforce_foreign_keys(
    dbapi_connection: DBAPIConnection, connection_record: ConnectionPoolEntry
) -> None:
    """Turn on foreign keys for a new SQLite connection; each one starts with them off."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.close()


def create_tables(engine: Engine) -> None:
    """Create whichever of the five tables are missing (the app does this on startup).

    A table that exists is left exactly as it is, rows and columns alike.
    """
    metadata.create_all(engine)


@cache
def configured_engine() -> Engine | None:
    """The engine for DATABASE_URL, built on the first call; None when it is unset or blank.

    The process keeps this one engine, so every request draws on the same connection pool.
    """
    url = os.environ.get(DATABASE_URL_VARIABLE, "").strip()
    return make_engine(url) if url else None


def accounts_engine() -> Engine:
    """The FastAPI dependency of every account route: the engine, or a 503 when accounts are off.

    A route that declares `engine: Annotated[Engine, Depends(accounts_engine)]` does not run
    without DATABASE_URL; the browser gets 503 {"detail": "accounts are not configured"}.
    Tests hand a route their own engine by overriding this dependency.
    """
    engine = configured_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail=ACCOUNTS_NOT_CONFIGURED)
    return engine
