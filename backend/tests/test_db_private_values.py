"""A database error never repeats the values its statement was given (backend/db.py).

By default SQLAlchemy writes a failed statement's error with every value bound to it: a password
hash, a session token's hash, an email, a transcript. An error that a route does not catch is
logged whole (uvicorn's "Exception in ASGI application"), so those values would reach the server
log. Every engine db.make_engine builds leaves them out.

The tests cannot reach Postgres (see test_db.py), so the Postgres engine is checked by its
setting, and the SQLite engines by the errors they raise.
"""

import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import Connection, Engine, insert, select
from sqlalchemy.exc import IntegrityError, OperationalError

from backend import db

NEON_URL = "postgresql://speech_coach:not-a-real-password@ep-quiet-sky-123456.neon.tech/neondb"
NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
EMAIL = "ann@example.com"
# The shape of an Argon2 hash (made up).
PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2g"
TOKEN_HASH = hashlib.sha256(b"a session token").hexdigest()
SPOKEN_WORD = "confidential"
NO_SUCH_USER = 999


@pytest.fixture(params=["in memory", "in a file"])
def engine(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[Engine]:
    """A new database with the five tables: SQLite in memory as in the tests, or in a file."""
    url = "sqlite://" if request.param == "in memory" else f"sqlite:///{tmp_path}/accounts.db"
    engine = db.make_engine(url)
    db.create_tables(engine)
    yield engine
    engine.dispose()


def sign_up(connection: Connection) -> int:
    """Create the account EMAIL and return its id."""
    signup = insert(db.users).values(email=EMAIL, password_hash=PASSWORD_HASH, created_at=NOW)
    return connection.execute(signup).inserted_primary_key[0]


def test_a_second_signup_for_an_email_names_neither_the_email_nor_the_hash(engine: Engine) -> None:
    with engine.begin() as connection:
        sign_up(connection)

    with pytest.raises(IntegrityError, match="UNIQUE") as refusal, engine.begin() as connection:
        sign_up(connection)

    assert EMAIL not in str(refusal.value)
    assert PASSWORD_HASH not in str(refusal.value)


def test_a_sign_in_for_an_account_that_is_gone_does_not_name_the_token_hash(
    engine: Engine,
) -> None:
    sign_in = insert(db.auth_sessions).values(
        token_hash=TOKEN_HASH, user_id=NO_SUCH_USER, expires_at=NOW
    )

    with (
        pytest.raises(IntegrityError, match="FOREIGN KEY") as refusal,
        engine.begin() as connection,
    ):
        connection.execute(sign_in)

    assert TOKEN_HASH not in str(refusal.value)


def test_a_take_refused_for_a_missing_report_does_not_repeat_its_words(engine: Engine) -> None:
    with engine.begin() as connection:
        user_id = sign_up(connection)
    take = insert(db.speech_sessions).values(
        id="t-1",
        user_id=user_id,
        created_at=NOW,
        report=None,
        transcript=[{"text": SPOKEN_WORD, "start": 0.4, "end": 0.9}],
    )

    with pytest.raises(IntegrityError, match="NOT NULL") as refusal, engine.begin() as connection:
        connection.execute(take)

    assert SPOKEN_WORD not in str(refusal.value)


def test_a_lookup_before_the_tables_exist_does_not_name_the_token_hash() -> None:
    # As when the database could not be reached at startup, so the tables were never created.
    engine = db.make_engine("sqlite://")
    lookup = select(db.auth_sessions.c.user_id).where(db.auth_sessions.c.token_hash == TOKEN_HASH)

    with (
        pytest.raises(OperationalError, match="no such table") as failure,
        engine.connect() as connection,
    ):
        connection.execute(lookup)
    engine.dispose()

    assert TOKEN_HASH not in str(failure.value)


@pytest.mark.parametrize("url", [NEON_URL, "sqlite://", "sqlite:////srv/speech-coach/accounts.db"])
def test_every_engine_leaves_the_values_out_of_its_errors(url: str) -> None:
    assert db.make_engine(url).hide_parameters
