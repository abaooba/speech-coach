"""Signing out ends the session for good (backend/auth.py, PLAN T47).

A browser drops a cookie only when a Set-Cookie names it with the Path and Domain it was set with.
Logging out and deleting the account both answer with sc_session emptied and expired at once
(Max-Age=0), written with every attribute it was set with: Path=/, Secure, HttpOnly,
SameSite=Lax and no Domain. With SESSION_SECRET set, as in production, logging out still finds
the session's row in the database and deletes it, so the token signs no one in again.
"""

from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, Row, select

from backend import app as app_module
from backend import auth, db

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
EMAIL = "ann@example.com"
PASSWORD = "correct horse battery staple"
SESSION_COOKIE = "sc_session"
SECRET = "a-long-random-session-secret-for-these-tests-only"
# How long a cookie lasts, which signing out sets to nothing: every other attribute stays.
LIFETIME_ATTRIBUTES = ("max-age", "expires")


@pytest.fixture(autouse=True)
def no_session_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test starts without SESSION_SECRET, whatever the environment holds."""
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
    """Accounts on: every route gets the test's database, a failed-login count of its own, NOW."""
    limiter = auth.FailedLoginLimiter()
    overrides = app_module.app.dependency_overrides
    overrides[db.accounts_engine] = lambda: engine
    overrides[auth.current_time] = lambda: NOW
    overrides[auth.login_limiter] = lambda: limiter
    yield
    for dependency in (db.accounts_engine, auth.current_time, auth.login_limiter):
        overrides.pop(dependency, None)


def browser() -> TestClient:
    """A browser that keeps its own cookies, on https as in production."""
    return TestClient(app_module.app, base_url="https://testserver")


def sign_up(client: TestClient) -> httpx2.Response:
    return client.post("/api/auth/signup", json={"email": EMAIL, "password": PASSWORD})


def log_out(client: TestClient) -> httpx2.Response:
    return client.post("/api/auth/logout", json={})


def delete_account(client: TestClient) -> httpx2.Response:
    return client.request("DELETE", "/api/me", json={})


def me_with(token: str) -> httpx2.Response:
    """GET /api/me from a new browser that presents `token` as its session."""
    return browser().get("/api/me", headers={"cookie": f"{SESSION_COOKIE}={token}"})


def cookie_set_by(response: httpx2.Response) -> tuple[str, str, dict[str, str]]:
    """The one cookie `response` sets: its name, its value and its attributes, names lowercased."""
    [header] = response.headers.get_list("set-cookie")
    name_and_value, *attributes = (part.strip() for part in header.split(";"))
    name, _, value = name_and_value.partition("=")
    named = {}
    for attribute in attributes:
        attribute_name, _, attribute_value = attribute.partition("=")
        named[attribute_name.lower()] = attribute_value
    return name, value, named


def beyond_lifetime(attributes: dict[str, str]) -> dict[str, str]:
    """A cookie's attributes but for how long it lasts, values lowercased (they ignore case)."""
    return {
        name: value.lower() for name, value in attributes.items() if name not in LIFETIME_ATTRIBUTES
    }


def sessions_in(engine: Engine) -> list[Row[Any]]:
    with engine.connect() as connection:
        return list(connection.execute(select(db.auth_sessions)))


@pytest.mark.parametrize(
    "sign_out", [log_out, delete_account], ids=["logging out", "deleting the account"]
)
def test_signing_out_expires_the_cookie_with_every_attribute_it_was_set_with(
    accounts_on: None, sign_out: Callable[[TestClient], httpx2.Response]
) -> None:
    client = browser()
    _, _, set_with = cookie_set_by(sign_up(client))

    name, value, cleared_with = cookie_set_by(sign_out(client))

    assert (name, value.strip('"'), cleared_with["max-age"]) == (SESSION_COOKIE, "", "0")
    assert beyond_lifetime(cleared_with) == beyond_lifetime(set_with)
    assert beyond_lifetime(cleared_with) == {
        "path": "/",
        "secure": "",
        "httponly": "",
        "samesite": "lax",
    }


def test_with_session_secret_set_logging_out_ends_the_session(
    accounts_on: None, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    client = browser()
    sign_up(client)
    token = client.cookies[SESSION_COOKIE]

    response = log_out(client)

    assert response.status_code == 204
    assert sessions_in(engine) == []
    assert me_with(token).status_code == 401
