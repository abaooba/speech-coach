"""What the failed-login count counts (backend/auth.py, PLAN T47).

Five failed logins for one email from one address within 15 minutes turn that pair away with 429.
A failed login is a wrong email or password. A login that ends in a fault instead, such as a
database that cannot be reached, checked no password, so its attempt is taken back: faults cannot
lock out a speaker whose password is right.

Every database that works here is SQLite in memory, and the clock stands still.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from backend import app as app_module
from backend import auth, db

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
EMAIL = "ann@example.com"
OTHER_EMAIL = "bob@example.com"
PASSWORD = "correct horse battery staple"
WRONG_PASSWORD = "incorrect horse battery staple"
MAX_FAILED_LOGINS = 5
FAILED_LOGIN_WINDOW = timedelta(minutes=15)
# An address set aside for documentation (RFC 5737).
ADDRESS = "198.51.100.7"


class Database:
    """The database every account route is handed. A test may swap in one that cannot be reached."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine


@pytest.fixture
def engine() -> Iterator[Engine]:
    """A new, empty in-memory database with the five tables."""
    engine = db.make_engine("sqlite://")
    db.create_tables(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def unreachable_engine(tmp_path: Path) -> Iterator[Engine]:
    """A database that cannot be opened: its folder does not exist, so every connection fails."""
    engine = db.make_engine(f"sqlite:///{tmp_path / 'no-such-folder' / 'accounts.db'}")
    yield engine
    engine.dispose()


@pytest.fixture
def database(engine: Engine) -> Database:
    return Database(engine)


@pytest.fixture
def limiter() -> auth.FailedLoginLimiter:
    """A failed-login count of the test's own."""
    return auth.FailedLoginLimiter()


@pytest.fixture
def accounts_on(database: Database, limiter: auth.FailedLoginLimiter) -> Iterator[None]:
    """Accounts on: every route gets the test's database, its failed-login count, and NOW."""
    overrides = app_module.app.dependency_overrides
    overrides[db.accounts_engine] = lambda: database.engine
    overrides[auth.current_time] = lambda: NOW
    overrides[auth.login_limiter] = lambda: limiter
    yield
    for dependency in (db.accounts_engine, auth.current_time, auth.login_limiter):
        overrides.pop(dependency, None)


def browser(address: str = ADDRESS) -> TestClient:
    """A browser at `address`, on https as in production."""
    return TestClient(app_module.app, base_url="https://testserver", client=(address, 50000))


def browser_shown_server_errors() -> TestClient:
    """A browser at ADDRESS that gets a server error as a 500, as a real browser would."""
    return TestClient(
        app_module.app,
        base_url="https://testserver",
        client=(ADDRESS, 50000),
        raise_server_exceptions=False,
    )


def sign_up(client: TestClient) -> httpx2.Response:
    return client.post("/api/auth/signup", json={"email": EMAIL, "password": PASSWORD})


def log_in(client: TestClient, email: str = EMAIL, password: str = PASSWORD) -> httpx2.Response:
    return client.post("/api/auth/login", json={"email": email, "password": password})


def fail_to_log_in(client: TestClient, times: int) -> None:
    for _ in range(times):
        assert log_in(client, password=WRONG_PASSWORD).status_code == 401


# --- faults --------------------------------------------------------------------------------------


def test_a_login_that_ends_in_a_fault_is_not_counted_as_failed(
    accounts_on: None,
    database: Database,
    unreachable_engine: Engine,
    limiter: auth.FailedLoginLimiter,
) -> None:
    sign_up(browser())
    database.engine = unreachable_engine

    responses = [log_in(browser_shown_server_errors()) for _ in range(MAX_FAILED_LOGINS)]

    assert [response.status_code for response in responses] == [500] * MAX_FAILED_LOGINS
    assert len(limiter) == 0


def test_once_the_database_is_back_the_right_password_signs_the_speaker_in(
    accounts_on: None, database: Database, engine: Engine, unreachable_engine: Engine
) -> None:
    sign_up(browser())
    database.engine = unreachable_engine
    for _ in range(MAX_FAILED_LOGINS):
        log_in(browser_shown_server_errors())
    database.engine = engine

    response = log_in(browser())

    assert response.status_code == 200


def test_a_fault_takes_back_its_own_attempt_and_no_failure_before_it(
    accounts_on: None, database: Database, engine: Engine, unreachable_engine: Engine
) -> None:
    sign_up(browser())
    fail_to_log_in(browser(), times=MAX_FAILED_LOGINS - 1)
    database.engine = unreachable_engine
    log_in(browser_shown_server_errors(), password=WRONG_PASSWORD)
    database.engine = engine
    fail_to_log_in(browser(), times=1)

    response = log_in(browser())

    assert response.status_code == 429


def test_withdrawing_an_attempt_gives_back_that_one_try() -> None:
    limiter = auth.FailedLoginLimiter()
    pair = (EMAIL, ADDRESS)
    for _ in range(MAX_FAILED_LOGINS):
        limiter.start_attempt(pair, NOW)

    limiter.withdraw_attempt(pair, NOW)

    assert limiter.start_attempt(pair, NOW) is None
    assert limiter.start_attempt(pair, NOW) == FAILED_LOGIN_WINDOW


def test_withdrawing_a_pairs_only_attempt_leaves_nothing_on_record() -> None:
    limiter = auth.FailedLoginLimiter()
    limiter.start_attempt((EMAIL, ADDRESS), NOW)

    limiter.withdraw_attempt((EMAIL, ADDRESS), NOW)

    assert len(limiter) == 0


def test_withdrawing_takes_back_only_an_attempt_still_on_record_from_that_moment() -> None:
    limiter = auth.FailedLoginLimiter()
    pair = (EMAIL, ADDRESS)
    limiter.start_attempt(pair, NOW)
    # That login succeeded, and a later one by the same pair is still running.
    limiter.forget(pair)
    later = NOW + timedelta(seconds=1)
    limiter.start_attempt(pair, later)

    limiter.withdraw_attempt(pair, NOW)
    limiter.withdraw_attempt((OTHER_EMAIL, ADDRESS), NOW)

    for _ in range(MAX_FAILED_LOGINS - 1):
        limiter.start_attempt(pair, later)
    assert limiter.start_attempt(pair, later) == FAILED_LOGIN_WINDOW
