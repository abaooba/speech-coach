"""What the failed-login count counts, and whose (backend/auth.py, PLAN T47).

Five failed logins for one email from one address within 15 minutes turn that pair away with 429.
A failed login is a wrong email or password. A login that ends in a fault instead, such as a
database that cannot be reached, checked no password, so its attempt is taken back: faults cannot
lock out a speaker whose password is right. A login that no account could match, such as one for
an email holding a NUL, is answered at once and not counted.

The address is the one the ASGI server reports, never one the visitor writes in X-Forwarded-For.
Behind a proxy that uvicorn is told to trust (FORWARDED_ALLOW_IPS), it is the address the proxy
appended, so each visitor behind the proxy has a count of their own.

Every database that works here is SQLite in memory, and the clock stands still.
"""

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from starlette.types import ASGIApp
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from backend import app as app_module
from backend import auth, db

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
EMAIL = "ann@example.com"
OTHER_EMAIL = "bob@example.com"
PASSWORD = "correct horse battery staple"
WRONG_PASSWORD = "incorrect horse battery staple"
MAX_FAILED_LOGINS = 5
FAILED_LOGIN_WINDOW = timedelta(minutes=15)
WRONG_EMAIL_OR_PASSWORD = {"detail": "email or password is wrong"}
# Addresses set aside for documentation (RFC 5737): a speaker's, and that of someone guessing
# their password.
ADDRESS = "198.51.100.7"
GUESSER_ADDRESS = "192.0.2.66"
# A proxy in front of the app, as on Render, and the network uvicorn would be told to trust.
PROXY_ADDRESS = "10.214.7.3"
PROXY_NETWORK = "10.0.0.0/8"


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


def visitor_behind(proxy: ASGIApp, forwarded_for: str) -> TestClient:
    """A browser whose requests reach the app through `proxy` with this X-Forwarded-For chain."""
    return TestClient(
        proxy,
        base_url="https://testserver",
        client=(PROXY_ADDRESS, 50000),
        headers={"x-forwarded-for": forwarded_for},
    )


def sign_up(client: TestClient) -> httpx2.Response:
    return client.post("/api/auth/signup", json={"email": EMAIL, "password": PASSWORD})


def log_in(
    client: TestClient,
    email: str = EMAIL,
    password: str = PASSWORD,
    headers: dict[str, str] | None = None,
) -> httpx2.Response:
    return client.post(
        "/api/auth/login", json={"email": email, "password": password}, headers=headers
    )


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


# --- logins no account could match ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("email", "password"),
    [
        ("ann\x00@example.com", PASSWORD),
        ("ann\ud800@example.com", PASSWORD),
        ("a" * 243 + "@example.com", PASSWORD),
        (EMAIL, "a" * 257),
    ],
    ids=["NUL in the email", "half a surrogate pair", "255-character email", "257-char password"],
)
def test_a_login_no_account_could_match_is_answered_without_being_counted(
    accounts_on: None, limiter: auth.FailedLoginLimiter, email: str, password: str
) -> None:
    # A NUL never reaches the lookup: Postgres cannot hold one, and refuses a query with one.
    body = json.dumps({"email": email, "password": password})
    headers = {"content-type": "application/json"}

    response = browser().post("/api/auth/login", content=body, headers=headers)

    assert response.status_code == 401
    assert response.json() == WRONG_EMAIL_OR_PASSWORD
    assert len(limiter) == 0


# --- whose count ---------------------------------------------------------------------------------


def test_a_visitor_cannot_pick_their_address_by_sending_x_forwarded_for(
    accounts_on: None,
) -> None:
    sign_up(browser())
    for number in range(MAX_FAILED_LOGINS):
        forged = {"x-forwarded-for": f"203.0.113.{number}"}
        assert log_in(browser(), password=WRONG_PASSWORD, headers=forged).status_code == 401

    response = log_in(browser(), headers={"x-forwarded-for": "203.0.113.200"})

    assert response.status_code == 429


def test_behind_a_trusted_proxy_each_visitor_is_counted_by_the_address_the_proxy_added(
    accounts_on: None,
) -> None:
    # uvicorn with FORWARDED_ALLOW_IPS naming the proxy's network: it takes the right-most
    # X-Forwarded-For entry from outside that network, which is the one the proxy appended.
    behind_proxy = ProxyHeadersMiddleware(app_module.app, trusted_hosts=PROXY_NETWORK)
    sign_up(visitor_behind(behind_proxy, forwarded_for=ADDRESS))
    for number in range(MAX_FAILED_LOGINS):
        # The guesser writes any address they like, and the proxy appends their real one.
        chain = f"203.0.113.{number}, {GUESSER_ADDRESS}"
        guesser = visitor_behind(behind_proxy, forwarded_for=chain)
        assert log_in(guesser, password=WRONG_PASSWORD).status_code == 401

    guesser_again = visitor_behind(behind_proxy, forwarded_for=f"203.0.113.200, {GUESSER_ADDRESS}")
    speaker = visitor_behind(behind_proxy, forwarded_for=ADDRESS)

    assert log_in(guesser_again).status_code == 429
    assert log_in(speaker).status_code == 200
