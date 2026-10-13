"""Set-up shared by every backend test: none of them reaches a real database by accident.

backend/app.py loads .env when it is imported, so a DATABASE_URL kept there for local work is in
os.environ for the whole run, and --disable-socket cannot stop psycopg from using it (libpq opens
its sockets in C, out of pytest-socket's reach). Each test therefore starts and ends with
DATABASE_URL unset and no engine built from it. A test that wants a database names one itself,
and the engine it leaves behind is closed. See test_no_real_database.py.
"""

from collections.abc import Iterator

import pytest

from backend import db


def forget_the_configured_engine() -> None:
    """Close the engine built from DATABASE_URL, if a test built one, and drop it."""
    if db.configured_engine.cache_info().currsize:
        engine = db.configured_engine()
        if engine is not None:
            engine.dispose()
    db.configured_engine.cache_clear()


@pytest.fixture(autouse=True)
def no_database_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(db.DATABASE_URL_VARIABLE, raising=False)
    forget_the_configured_engine()
    yield
    forget_the_configured_engine()
