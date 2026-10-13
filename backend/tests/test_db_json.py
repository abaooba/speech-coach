"""Reports and transcripts are kept as standard JSON on every database (backend/db.py).

JSON has no NaN or Infinity, and Postgres refuses them in a json column. Python writes them unless
told not to, and FastAPI accepts them in a request body, so SQLite kept a take that Neon refuses:
a test on SQLite passed where production answered 500. Every engine now writes JSON without them,
so SQLite refuses such a take as well, before the database is reached. (On Postgres, psycopg
raises that refusal as a plain ValueError rather than a StatementError.)
"""

import math
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import Engine, func, insert, select
from sqlalchemy.exc import StatementError

from backend import db

NEON_URL = "postgresql://speech_coach:not-a-real-password@ep-quiet-sky-123456.neon.tech/neondb"
NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
REPORT = {"passageId": "uniforms", "metrics": {"words_per_minute": 159.5, "filler_count": 2}}
TRANSCRIPT = [{"text": "uh,", "start": 9.1, "end": 9.3, "confidence": 0.88}]


@pytest.fixture
def engine() -> Iterator[Engine]:
    """A new, empty in-memory database with the five tables."""
    engine = db.make_engine("sqlite://")
    db.create_tables(engine)
    yield engine
    engine.dispose()


def take_holding(column: str, number: float, user_id: int) -> dict[str, Any]:
    """A take whose report or transcript (`column`) holds `number` where a figure goes."""
    take = {
        "id": "8b1f6c2e-5d4a-4f1e-9c3b-2a7d6e0f1a2b",
        "user_id": user_id,
        "created_at": NOW,
        "report": REPORT,
        "transcript": TRANSCRIPT,
    }
    if column == "report":
        take["report"] = {**REPORT, "metrics": {"words_per_minute": number}}
    else:
        take["transcript"] = [{**TRANSCRIPT[0], "start": number}]
    return take


@pytest.mark.parametrize("number", [math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("column", ["report", "transcript"])
def test_a_take_holding_nan_or_infinity_is_refused_and_nothing_is_kept(
    engine: Engine, column: str, number: float
) -> None:
    with engine.begin() as connection:
        signup = insert(db.users).values(email="ann@example.com", password_hash="x", created_at=NOW)
        user_id = connection.execute(signup).inserted_primary_key[0]

    with (
        pytest.raises(StatementError, match="not JSON compliant"),
        engine.begin() as connection,
    ):
        connection.execute(insert(db.speech_sessions).values(take_holding(column, number, user_id)))

    with engine.connect() as connection:
        takes_kept = connection.execute(select(func.count()).select_from(db.speech_sessions))
        assert takes_kept.scalar_one() == 0


def test_postgres_writes_json_the_same_way_as_sqlite() -> None:
    postgres = db.make_engine(NEON_URL).dialect
    sqlite = db.make_engine("sqlite://").dialect

    assert postgres._json_serializer is not None
    assert postgres._json_serializer is sqlite._json_serializer
