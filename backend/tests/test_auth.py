"""Accounts (backend/auth.py, PLAN T47): sign up, log in, log out, GET and DELETE /api/me.

A password of 10 to 256 characters is kept only as an Argon2id hash. Signing up or logging in
sets the session cookie sc_session (HttpOnly; Secure; SameSite=Lax; Path=/; 30 days), which holds
32 random bytes. The database keeps only their SHA-256, or their HMAC-SHA256 under SESSION_SECRET
when that is set. A session ends when its browser logs out, when the account is deleted, or 30
days after it began. A wrong password and an email with no account get the same 401 after the
same Argon2 check. Five failed logins for one email from one address in 15 minutes turn that pair
away with 429. A route that changes something takes JSON only (415 otherwise), and with accounts
off every route answers 503.

Every database here is SQLite in memory, and every route reads the time from a clock the test
moves, through the app's own dependencies. Each test starts with no failed logins counted and no
SESSION_SECRET. A browser is a TestClient at https://testserver: a Secure cookie is never sent
back over plain http.
"""

import base64
import hashlib
import hmac
import json
import logging
import re
import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx2
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import Engine, Row, func, insert, select

from backend import app as app_module
from backend import auth, db

NOW = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
EMAIL = "ann@example.com"
OTHER_EMAIL = "bob@example.com"
PASSWORD = "correct horse battery staple"
WRONG_PASSWORD = "incorrect horse battery staple"
# Two browsers in different places (addresses set aside for documentation, RFC 5737).
ADDRESS = "198.51.100.7"
OTHER_ADDRESS = "203.0.113.9"
SECRET = "a-long-random-session-secret-for-these-tests-only"

SESSION_COOKIE = "sc_session"
SESSION_LIFETIME = timedelta(days=30)
FAILED_LOGIN_WINDOW = timedelta(minutes=15)
# Argon2id with OWASP's settings: 19 MiB of memory, 2 passes, 1 lane.
ARGON2ID_SETTINGS = "$argon2id$v=19$m=19456,t=2,p=1"

WRONG_EMAIL_OR_PASSWORD = {"detail": "email or password is wrong"}
NOT_SIGNED_IN = {"detail": "not signed in"}
JSON_REQUIRED = {"detail": "send this request as JSON (Content-Type: application/json)"}
ACCOUNTS_OFF = {"detail": "accounts are not configured"}

ACCOUNT_ROUTES = [
    ("POST", "/api/auth/signup"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/me"),
    ("DELETE", "/api/me"),
]
STATE_CHANGING_ROUTES = [route for route in ACCOUNT_ROUTES if route[0] != "GET"]
# The tables whose rows belong to an account.
PER_USER_TABLES = ["auth_sessions", "speech_sessions", "shown_advice", "path_progress"]


class Clock:
    """The time every account route sees: NOW until the test moves it."""

    def __init__(self) -> None:
        self.now = NOW

    def advance(self, by: timedelta) -> None:
        self.now += by


class RecordingHasher(PasswordHasher):
    """The app's own Argon2 settings, noting each hash made and each hash checked against.

    A new one also stands for a server that has just started: nothing made by it is cached yet.
    """

    def __init__(self) -> None:
        settings = auth.PASSWORD_HASHER
        super().__init__(
            time_cost=settings.time_cost,
            memory_cost=settings.memory_cost,
            parallelism=settings.parallelism,
            hash_len=settings.hash_len,
            salt_len=settings.salt_len,
            type=settings.type,
        )
        self.hashes_made = 0
        self.checked_against: list[str] = []

    def hash(self, password: str | bytes, *, salt: bytes | None = None) -> str:
        self.hashes_made += 1
        return super().hash(password, salt=salt)

    def verify(self, hash: str | bytes, password: str | bytes) -> Any:
        self.checked_against.append(hash if isinstance(hash, str) else hash.decode())
        return super().verify(hash, password)


# --- set-up --------------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def no_session_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test starts without SESSION_SECRET, whatever .env holds; a test may set one."""
    monkeypatch.delenv("SESSION_SECRET", raising=False)


@pytest.fixture
def engine() -> Iterator[Engine]:
    """A new, empty in-memory database with the five tables."""
    engine = db.make_engine("sqlite://")
    db.create_tables(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def limiter() -> auth.FailedLoginLimiter:
    """A failed-login count of the test's own, so no test inherits another's failures."""
    return auth.FailedLoginLimiter()


@pytest.fixture
def accounts_on(
    engine: Engine, clock: Clock, limiter: auth.FailedLoginLimiter
) -> Iterator[None]:
    """Accounts on: every route gets the test's database, clock and failed-login count."""
    overrides = app_module.app.dependency_overrides
    overrides[db.accounts_engine] = lambda: engine
    overrides[auth.current_time] = lambda: clock.now
    overrides[auth.login_limiter] = lambda: limiter
    yield
    # With the hasher too, which a test may have swapped in (use_hasher).
    for dependency in (db.accounts_engine, auth.current_time, auth.login_limiter):
        overrides.pop(dependency, None)
    overrides.pop(auth.password_hasher, None)


def use_hasher(hasher: PasswordHasher) -> None:
    """Have every account route hash and check passwords with `hasher` (needs accounts_on)."""
    app_module.app.dependency_overrides[auth.password_hasher] = lambda: hasher


@pytest.fixture
def recording_hasher(accounts_on: None) -> RecordingHasher:
    """Accounts on, with every password hashed and checked by a RecordingHasher."""
    hasher = RecordingHasher()
    use_hasher(hasher)
    return hasher


def browser(address: str = ADDRESS) -> TestClient:
    """A browser at `address` that keeps its own cookies, on https as in production."""
    return TestClient(app_module.app, base_url="https://testserver", client=(address, 50000))


def sign_up(
    client: TestClient, email: str = EMAIL, password: str = PASSWORD
) -> httpx2.Response:
    return client.post("/api/auth/signup", json={"email": email, "password": password})


def log_in(client: TestClient, email: str = EMAIL, password: str = PASSWORD) -> httpx2.Response:
    return client.post("/api/auth/login", json={"email": email, "password": password})


def log_out(client: TestClient) -> httpx2.Response:
    return client.post("/api/auth/logout", json={})


def delete_account(client: TestClient) -> httpx2.Response:
    return client.request("DELETE", "/api/me", json={})


def fail_to_log_in(client: TestClient, times: int, email: str = EMAIL) -> None:
    for _ in range(times):
        assert log_in(client, email, WRONG_PASSWORD).status_code == 401


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


def users_in(engine: Engine) -> list[Row[Any]]:
    with engine.connect() as connection:
        return list(connection.execute(select(db.users).order_by(db.users.c.id)))


def sessions_in(engine: Engine) -> list[Row[Any]]:
    with engine.connect() as connection:
        return list(connection.execute(select(db.auth_sessions)))


def user_id_of(engine: Engine, email: str) -> int:
    with engine.connect() as connection:
        return connection.execute(select(db.users.c.id).where(db.users.c.email == email)).one()[0]


def give_a_row_in_every_table(engine: Engine, user_id: int) -> None:
    """Give `user_id` a take, a shown tip and a cleared level; signing up gave it a session."""
    with engine.begin() as connection:
        connection.execute(
            insert(db.speech_sessions).values(
                id="take-1",
                user_id=user_id,
                created_at=NOW,
                report={"durationSeconds": 42.882, "metrics": {"filler_count": 2}},
                transcript=[{"text": "uh,", "start": 9.1, "end": 9.3}],
            )
        )
        connection.execute(
            insert(db.shown_advice).values(user_id=user_id, entry_id="filler-001", shown_at=NOW)
        )
        connection.execute(
            insert(db.path_progress).values(user_id=user_id, level_id="fillers-1", cleared_at=NOW)
        )


def rows_owned(engine: Engine, user_id: int) -> list[int]:
    """How many rows `user_id` has in each of PER_USER_TABLES, in that order."""
    counts = []
    with engine.connect() as connection:
        for table_name in PER_USER_TABLES:
            table = db.metadata.tables[table_name]
            count = select(func.count()).select_from(table).where(table.c.user_id == user_id)
            counts.append(connection.execute(count).scalar_one())
    return counts


def everything_in(engine: Engine) -> str:
    """Every row of every table, written out."""
    with engine.connect() as connection:
        return repr(
            [list(connection.execute(select(table))) for table in db.metadata.sorted_tables]
        )


def settings_of(password_hash: str) -> str:
    """An Argon2 hash without its salt and digest: the variant, version and cost settings."""
    return password_hash.rsplit("$", 2)[0]


# --- signing up ----------------------------------------------------------------------------------


def test_signing_up_opens_an_account_and_signs_the_browser_in(
    accounts_on: None, engine: Engine
) -> None:
    client = browser()

    response = sign_up(client)

    assert response.status_code == 201
    assert response.json() == {"email": EMAIL}
    assert client.get("/api/me").json() == {"email": EMAIL}
    [user] = users_in(engine)
    assert (user.email, user.created_at) == (EMAIL, NOW)


def test_the_session_cookie_is_httponly_secure_lax_site_wide_and_lasts_30_days(
    accounts_on: None,
) -> None:
    name, value, attributes = cookie_set_by(sign_up(browser()))

    assert name == SESSION_COOKIE
    assert value
    # No Domain: the cookie goes back to this host only. Attribute values ignore case.
    assert {key: setting.lower() for key, setting in attributes.items()} == {
        "httponly": "",
        "secure": "",
        "samesite": "lax",
        "path": "/",
        "max-age": "2592000",
    }


def test_the_cookie_holds_32_random_bytes_and_the_database_only_their_sha256(
    accounts_on: None, engine: Engine
) -> None:
    client = browser()
    sign_up(client)
    token = client.cookies[SESSION_COOKIE]

    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
    assert len(base64.urlsafe_b64decode(token + "=")) == 32
    [session] = sessions_in(engine)
    assert session.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert session.expires_at == NOW + SESSION_LIFETIME
    assert token not in everything_in(engine)


def test_with_session_secret_set_the_database_holds_an_hmac_of_the_token(
    accounts_on: None, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    client = browser()
    sign_up(client)
    token = client.cookies[SESSION_COOKIE]

    [session] = sessions_in(engine)
    assert session.token_hash == hmac.new(SECRET.encode(), token.encode(), "sha256").hexdigest()
    assert client.get("/api/me").json() == {"email": EMAIL}


def test_changing_session_secret_signs_every_browser_out(
    accounts_on: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    client = browser()
    sign_up(client)

    monkeypatch.setenv("SESSION_SECRET", "a-different-secret-after-a-leak")

    assert client.get("/api/me").status_code == 401


def test_every_sign_in_gets_a_token_of_its_own(accounts_on: None, engine: Engine) -> None:
    phone, laptop = browser(), browser(OTHER_ADDRESS)
    sign_up(phone)
    log_in(laptop)

    assert phone.cookies[SESSION_COOKIE] != laptop.cookies[SESSION_COOKIE]
    assert len(sessions_in(engine)) == 2


def test_the_password_is_kept_only_as_an_argon2id_hash(accounts_on: None, engine: Engine) -> None:
    sign_up(browser())

    [user] = users_in(engine)
    assert settings_of(user.password_hash) == ARGON2ID_SETTINGS
    assert PasswordHasher().verify(user.password_hash, PASSWORD)
    assert PASSWORD not in everything_in(engine)


def test_the_email_is_kept_trimmed_and_lowercased(accounts_on: None, engine: Engine) -> None:
    response = sign_up(browser(), email="  Ann@Example.COM ")

    assert response.json() == {"email": EMAIL}
    assert [user.email for user in users_in(engine)] == [EMAIL]
    assert log_in(browser(), email="ANN@example.com").status_code == 200


@pytest.mark.parametrize("password", ["", "short", "a" * 9, "a" * 257])
def test_a_password_under_10_or_over_256_characters_is_refused(
    accounts_on: None, engine: Engine, password: str
) -> None:
    response = sign_up(browser(), password=password)

    assert response.status_code == 400
    assert response.json() == {"detail": "use a password of 10 to 256 characters"}
    assert "set-cookie" not in response.headers
    assert users_in(engine) == []


@pytest.mark.parametrize("password", ["a" * 10, "a" * 256, " " * 10, "pässwörd ✓ 🎤"])
def test_any_password_of_10_to_256_characters_is_accepted(
    accounts_on: None, password: str
) -> None:
    assert sign_up(browser(), password=password).status_code == 201
    assert log_in(browser(), password=password).status_code == 200


def test_a_password_holding_half_of_a_surrogate_pair_is_hashed_like_any_other(
    accounts_on: None,
) -> None:
    # JSON can carry a lone UTF-16 surrogate, which UTF-8 has no bytes for. No browser sends one,
    # but a hand-made request must not break the server.
    body = json.dumps({"email": EMAIL, "password": "\ud800" * 10})
    headers = {"content-type": "application/json"}

    signup = browser().post("/api/auth/signup", content=body, headers=headers)
    login = browser().post("/api/auth/login", content=body, headers=headers)

    assert (signup.status_code, login.status_code) == (201, 200)


@pytest.mark.parametrize(
    "email",
    [
        "",
        "ann",
        "ann@",
        "@example.com",
        "ann@example",
        "ann@example.",
        "ann@.com",
        "ann @example.com",
        "ann@@example.com",
        "ann@bob@example.com",
        "ann\x01@example.com",
        "a" * 243 + "@example.com",
    ],
)
def test_an_email_that_is_not_an_address_is_refused(
    accounts_on: None, engine: Engine, email: str
) -> None:
    response = sign_up(browser(), email=email)

    assert response.status_code == 400
    assert response.json() == {"detail": "enter a valid email address"}
    assert users_in(engine) == []


def test_an_address_of_254_characters_is_accepted(accounts_on: None) -> None:
    longest = "a" * 242 + "@example.com"

    assert sign_up(browser(), email=longest).json() == {"email": longest}


def test_signing_up_again_with_a_taken_email_is_refused_and_leaves_the_account_alone(
    accounts_on: None, engine: Engine
) -> None:
    sign_up(browser())

    response = sign_up(browser(), email="ANN@example.com", password=WRONG_PASSWORD)

    assert response.status_code == 409
    assert response.json() == {
        "detail": "an account with this email already exists: log in instead"
    }
    assert "set-cookie" not in response.headers
    assert len(users_in(engine)) == 1
    assert len(sessions_in(engine)) == 1
    assert log_in(browser(), password=PASSWORD).status_code == 200
    assert log_in(browser(), password=WRONG_PASSWORD).status_code == 401


# --- logging in ----------------------------------------------------------------------------------


def test_logging_in_signs_the_browser_in(accounts_on: None, engine: Engine) -> None:
    sign_up(browser())
    laptop = browser(OTHER_ADDRESS)

    response = log_in(laptop)

    assert response.status_code == 200
    assert response.json() == {"email": EMAIL}
    assert cookie_set_by(response)[0] == SESSION_COOKIE
    assert laptop.get("/api/me").json() == {"email": EMAIL}


def test_logging_in_on_a_second_device_keeps_the_first_signed_in(accounts_on: None) -> None:
    phone, laptop = browser(), browser(OTHER_ADDRESS)
    sign_up(phone)

    log_in(laptop)

    assert phone.get("/api/me").status_code == 200
    assert laptop.get("/api/me").status_code == 200


def test_a_wrong_password_and_an_unknown_email_get_the_same_answer(accounts_on: None) -> None:
    sign_up(browser())

    wrong_password = log_in(browser(), password=WRONG_PASSWORD)
    unknown_email = log_in(browser(), email=OTHER_EMAIL)

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json() == WRONG_EMAIL_OR_PASSWORD
    assert "set-cookie" not in wrong_password.headers
    assert "set-cookie" not in unknown_email.headers


def test_an_unknown_email_costs_the_same_argon2_check_as_a_wrong_password(
    recording_hasher: RecordingHasher, engine: Engine
) -> None:
    sign_up(browser())
    [user] = users_in(engine)

    log_in(browser(), password=WRONG_PASSWORD)
    log_in(browser(), email=OTHER_EMAIL, password=WRONG_PASSWORD)

    [account_hash, stand_in_hash] = recording_hasher.checked_against
    assert account_hash == user.password_hash
    assert stand_in_hash != user.password_hash
    assert settings_of(stand_in_hash) == settings_of(user.password_hash) == ARGON2ID_SETTINGS


def test_the_first_unknown_email_after_a_restart_costs_what_a_wrong_password_costs(
    accounts_on: None,
) -> None:
    # The stand-in hash is made once per server. Were the first unknown email the one to make
    # it, that login would take an extra hash, and its time would tell.
    sign_up(browser())
    work = []
    for email in (EMAIL, OTHER_EMAIL):
        just_started = RecordingHasher()
        use_hasher(just_started)
        log_in(browser(), email=email, password=WRONG_PASSWORD)
        work.append((just_started.hashes_made, len(just_started.checked_against)))

    [wrong_password, unknown_email] = work
    assert wrong_password == unknown_email


@pytest.mark.parametrize(
    ("email", "password"),
    [
        ("a" * 243 + "@example.com", PASSWORD),
        ("ann\x01@example.com", PASSWORD),
        (EMAIL, "a" * 257),
    ],
)
def test_a_login_no_account_could_match_gets_the_same_answer(
    accounts_on: None, email: str, password: str
) -> None:
    sign_up(browser())

    response = log_in(browser(), email=email, password=password)

    assert response.status_code == 401
    assert response.json() == WRONG_EMAIL_OR_PASSWORD


def test_an_email_holding_half_of_a_surrogate_pair_is_refused_without_a_server_error(
    accounts_on: None, engine: Engine
) -> None:
    body = json.dumps({"email": "ann\ud800@example.com", "password": PASSWORD})
    headers = {"content-type": "application/json"}

    signup = browser().post("/api/auth/signup", content=body, headers=headers)
    login = browser().post("/api/auth/login", content=body, headers=headers)

    assert signup.status_code == 400
    assert signup.json() == {"detail": "enter a valid email address"}
    assert login.status_code == 401
    assert login.json() == WRONG_EMAIL_OR_PASSWORD
    assert users_in(engine) == []


def test_an_account_hashed_with_other_settings_is_rehashed_at_its_next_login(
    accounts_on: None, engine: Engine
) -> None:
    older_settings = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    with engine.begin() as connection:
        connection.execute(
            insert(db.users).values(
                email=EMAIL, password_hash=older_settings.hash(PASSWORD), created_at=NOW
            )
        )

    assert log_in(browser()).status_code == 200

    [user] = users_in(engine)
    assert settings_of(user.password_hash) == ARGON2ID_SETTINGS
    assert PasswordHasher().verify(user.password_hash, PASSWORD)


def test_logging_in_clears_the_accounts_expired_sessions(
    accounts_on: None, engine: Engine, clock: Clock
) -> None:
    sign_up(browser())
    clock.advance(SESSION_LIFETIME)

    log_in(browser())

    [session] = sessions_in(engine)
    assert session.expires_at == clock.now + SESSION_LIFETIME


# --- failed logins -------------------------------------------------------------------------------


def test_after_5_failed_logins_the_6th_is_turned_away_even_with_the_right_password(
    accounts_on: None,
) -> None:
    sign_up(browser())
    client = browser()
    fail_to_log_in(client, times=5)

    response = log_in(client)

    assert response.status_code == 429
    assert response.json() == {"detail": "too many failed logins: try again in 15 min"}
    assert response.headers["retry-after"] == "900"
    assert "set-cookie" not in response.headers


def test_a_login_that_is_turned_away_checks_no_password(
    recording_hasher: RecordingHasher,
) -> None:
    sign_up(browser())
    client = browser()
    fail_to_log_in(client, times=5)

    log_in(client)

    assert len(recording_hasher.checked_against) == 5


def test_15_minutes_after_the_failures_logging_in_works_again(
    accounts_on: None, clock: Clock
) -> None:
    sign_up(browser())
    client = browser()
    fail_to_log_in(client, times=5)

    clock.advance(FAILED_LOGIN_WINDOW - timedelta(seconds=1))
    almost = log_in(client)
    clock.advance(timedelta(seconds=1))
    after = log_in(client)

    assert almost.status_code == 429
    assert almost.headers["retry-after"] == "1"
    assert almost.json() == {"detail": "too many failed logins: try again in 1 min"}
    assert after.status_code == 200


def test_each_failure_stops_counting_15_minutes_after_it_happened(
    accounts_on: None, clock: Clock
) -> None:
    sign_up(browser())
    client = browser()
    for minute in (0, 4, 8, 12, 13):
        clock.now = NOW + timedelta(minutes=minute)
        fail_to_log_in(client, times=1)

    clock.now = NOW + timedelta(minutes=14)
    at_14 = log_in(client, password=WRONG_PASSWORD)
    clock.now = NOW + timedelta(minutes=15)
    at_15 = log_in(client, password=WRONG_PASSWORD)
    at_15_again = log_in(client, password=WRONG_PASSWORD)

    assert (at_14.status_code, at_14.headers["retry-after"]) == (429, "60")
    # The failure at minute 0 has left the count, so one more try is let through.
    assert at_15.status_code == 401
    assert (at_15_again.status_code, at_15_again.headers["retry-after"]) == (429, "240")


def test_failures_are_counted_per_email_and_address(accounts_on: None) -> None:
    sign_up(browser())
    sign_up(browser(), email=OTHER_EMAIL)
    fail_to_log_in(browser(ADDRESS), times=5)

    assert log_in(browser(ADDRESS)).status_code == 429
    assert log_in(browser(OTHER_ADDRESS)).status_code == 200
    assert log_in(browser(ADDRESS), email=OTHER_EMAIL).status_code == 200


def test_capitals_and_spaces_in_the_email_count_as_the_same_email(accounts_on: None) -> None:
    sign_up(browser())
    client = browser()
    for email in ["ANN@example.com", " ann@example.com", "Ann@Example.Com ", "ann@EXAMPLE.com"]:
        fail_to_log_in(client, times=1, email=email)
    fail_to_log_in(client, times=1)

    assert log_in(client).status_code == 429


def test_an_email_with_no_account_is_turned_away_the_same_way(accounts_on: None) -> None:
    sign_up(browser())
    client = browser()
    fail_to_log_in(client, times=5)
    fail_to_log_in(client, times=5, email=OTHER_EMAIL)

    account = log_in(client, password=WRONG_PASSWORD)
    no_account = log_in(client, email=OTHER_EMAIL, password=WRONG_PASSWORD)

    assert account.status_code == no_account.status_code == 429
    assert account.json() == no_account.json()
    assert account.headers["retry-after"] == no_account.headers["retry-after"]


def test_logging_in_clears_the_failures_before_it(accounts_on: None) -> None:
    sign_up(browser())
    client = browser()
    fail_to_log_in(client, times=4)
    assert log_in(client).status_code == 200

    fail_to_log_in(client, times=5)

    assert log_in(client).status_code == 429


def test_attempts_still_running_count_as_failures() -> None:
    limiter = auth.FailedLoginLimiter()
    pair = (EMAIL, ADDRESS)

    # Five attempts sent at once, none of them finished yet.
    started = [limiter.start_attempt(pair, NOW) for _ in range(5)]

    assert started == [None] * 5
    assert limiter.start_attempt(pair, NOW) == FAILED_LOGIN_WINDOW


def test_a_pair_whose_last_failure_is_15_minutes_old_is_forgotten() -> None:
    limiter = auth.FailedLoginLimiter()
    for number in range(100):
        limiter.start_attempt((f"guess{number}@example.com", ADDRESS), NOW)

    limiter.start_attempt((EMAIL, ADDRESS), NOW + FAILED_LOGIN_WINDOW)

    assert len(limiter) == 1


def test_beyond_its_limit_the_count_forgets_the_pair_that_failed_longest_ago() -> None:
    limiter = auth.FailedLoginLimiter(max_pairs=3)
    oldest = (EMAIL, ADDRESS)
    for _ in range(5):
        limiter.start_attempt(oldest, NOW)
    for seconds in (1, 2, 3):
        guess = (f"guess{seconds}@example.com", ADDRESS)
        limiter.start_attempt(guess, NOW + timedelta(seconds=seconds))

    assert len(limiter) == 3
    assert limiter.start_attempt(oldest, NOW + timedelta(seconds=4)) is None


def test_the_count_keeps_10000_pairs_by_default() -> None:
    assert auth.FailedLoginLimiter().max_pairs == 10_000


# --- staying signed in ---------------------------------------------------------------------------


def test_without_a_session_cookie_no_one_is_signed_in(accounts_on: None) -> None:
    response = browser().get("/api/me")

    assert response.status_code == 401
    assert response.json() == NOT_SIGNED_IN


def test_a_made_up_token_signs_no_one_in(accounts_on: None) -> None:
    sign_up(browser())

    assert me_with("a" * 43).status_code == 401


def test_a_session_lasts_30_days_to_the_second(accounts_on: None, clock: Clock) -> None:
    client = browser()
    sign_up(client)

    clock.advance(SESSION_LIFETIME - timedelta(seconds=1))
    last_second = client.get("/api/me")
    clock.advance(timedelta(seconds=1))
    expired = client.get("/api/me")

    assert last_second.status_code == 200
    assert expired.status_code == 401
    assert expired.json() == NOT_SIGNED_IN


# --- logging out ---------------------------------------------------------------------------------


def test_logging_out_ends_the_session_and_clears_the_cookie(
    accounts_on: None, engine: Engine
) -> None:
    client = browser()
    sign_up(client)
    token = client.cookies[SESSION_COOKIE]

    response = log_out(client)

    assert response.status_code == 204
    name, value, attributes = cookie_set_by(response)
    assert (name, value.strip('"'), attributes["max-age"]) == (SESSION_COOKIE, "", "0")
    assert sessions_in(engine) == []
    assert client.get("/api/me").status_code == 401
    assert me_with(token).status_code == 401


def test_logging_out_one_browser_keeps_the_others_signed_in(accounts_on: None) -> None:
    phone, laptop = browser(), browser(OTHER_ADDRESS)
    sign_up(phone)
    log_in(laptop)

    log_out(phone)

    assert phone.get("/api/me").status_code == 401
    assert laptop.get("/api/me").json() == {"email": EMAIL}


def test_logging_out_without_a_session_does_no_harm(accounts_on: None, engine: Engine) -> None:
    sign_up(browser())

    response = log_out(browser())

    assert response.status_code == 204
    assert len(sessions_in(engine)) == 1


# --- deleting the account ------------------------------------------------------------------------


def test_deleting_the_account_deletes_every_row_it_owns_and_no_one_elses(
    accounts_on: None, engine: Engine
) -> None:
    ann, bob = browser(), browser(OTHER_ADDRESS)
    sign_up(ann)
    sign_up(bob, email=OTHER_EMAIL)
    ann_id, bob_id = user_id_of(engine, EMAIL), user_id_of(engine, OTHER_EMAIL)
    give_a_row_in_every_table(engine, ann_id)
    give_a_row_in_every_table(engine, bob_id)
    token = ann.cookies[SESSION_COOKIE]

    response = delete_account(ann)

    assert response.status_code == 204
    name, value, attributes = cookie_set_by(response)
    assert (name, value.strip('"'), attributes["max-age"]) == (SESSION_COOKIE, "", "0")
    assert [user.email for user in users_in(engine)] == [OTHER_EMAIL]
    assert rows_owned(engine, ann_id) == [0, 0, 0, 0]
    assert rows_owned(engine, bob_id) == [1, 1, 1, 1]
    assert me_with(token).status_code == 401
    assert bob.get("/api/me").json() == {"email": OTHER_EMAIL}


def test_a_deleted_accounts_email_is_free_again(accounts_on: None) -> None:
    client = browser()
    sign_up(client)
    delete_account(client)

    assert log_in(browser()).status_code == 401
    assert sign_up(browser()).status_code == 201


def test_deleting_the_account_needs_a_session(accounts_on: None, engine: Engine) -> None:
    sign_up(browser())

    response = delete_account(browser())

    assert response.status_code == 401
    assert response.json() == NOT_SIGNED_IN
    assert len(users_in(engine)) == 1


# --- JSON only -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "content_type",
    [
        None,
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=speech-coach",
    ],
)
@pytest.mark.parametrize(("method", "path"), STATE_CHANGING_ROUTES)
def test_a_request_that_changes_something_must_be_sent_as_json(
    accounts_on: None,
    engine: Engine,
    limiter: auth.FailedLoginLimiter,
    method: str,
    path: str,
    content_type: str | None,
) -> None:
    client = browser()
    sign_up(client)
    before = everything_in(engine)
    # What a form or a script on another site could send without asking first.
    body = json.dumps({"email": OTHER_EMAIL, "password": WRONG_PASSWORD})
    headers = {} if content_type is None else {"content-type": content_type}

    response = client.request(method, path, content=body, headers=headers)

    assert response.status_code == 415
    assert response.json() == JSON_REQUIRED
    assert "set-cookie" not in response.headers
    assert everything_in(engine) == before
    assert len(limiter) == 0
    assert client.get("/api/me").json() == {"email": EMAIL}


@pytest.mark.parametrize("content_type", ["application/json; charset=utf-8", "Application/JSON"])
def test_json_is_recognised_with_a_charset_or_in_capitals(
    accounts_on: None, content_type: str
) -> None:
    body = json.dumps({"email": EMAIL, "password": PASSWORD})
    headers = {"content-type": content_type}

    response = browser().post("/api/auth/signup", content=body, headers=headers)

    assert response.status_code == 201


# --- accounts off --------------------------------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), ACCOUNT_ROUTES)
def test_every_account_route_answers_503_while_accounts_are_off(method: str, path: str) -> None:
    options = {} if method == "GET" else {"json": {"email": EMAIL, "password": PASSWORD}}

    response = browser().request(method, path, **options)

    assert response.status_code == 503
    assert response.json() == ACCOUNTS_OFF


def test_accounts_being_off_is_reported_before_anything_about_the_request() -> None:
    response = browser().post("/api/auth/login", content="email=ann%40example.com")

    assert response.status_code == 503
    assert response.json() == ACCOUNTS_OFF


# --- what is never written down ------------------------------------------------------------------


def test_no_password_token_or_email_reaches_the_log(
    accounts_on: None, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    client = browser()

    sign_up(client)
    sign_up(browser())
    log_in(browser(), password=WRONG_PASSWORD)
    log_in(browser(), email=OTHER_EMAIL)
    fail_to_log_in(browser(OTHER_ADDRESS), times=5)
    log_in(browser(OTHER_ADDRESS))
    token = client.cookies[SESSION_COOKIE]
    log_out(client)

    for private in (PASSWORD, WRONG_PASSWORD, token, EMAIL, OTHER_EMAIL):
        assert private not in caplog.text


# --- hashing -------------------------------------------------------------------------------------


def test_at_most_4_passwords_are_hashed_at_once() -> None:
    # Each Argon2 hash takes 19 MiB while it runs, and the server has 512 MB in all.
    entered = threading.Semaphore(0)
    release = threading.Event()

    class HeldHasher(PasswordHasher):
        def hash(self, password: str | bytes, *, salt: bytes | None = None) -> str:
            entered.release()
            release.wait(timeout=10)
            return "held"

    hasher = HeldHasher()
    workers = [
        threading.Thread(target=auth.hash_password, args=(hasher, PASSWORD)) for _ in range(6)
    ]
    for worker in workers:
        worker.start()
    try:
        four_ran = all(entered.acquire(timeout=5) for _ in range(4))
        a_fifth_ran = entered.acquire(timeout=0.3)
    finally:
        release.set()
        for worker in workers:
            worker.join(timeout=10)

    assert four_ran
    assert not a_fifth_ran
    # Once the four are done, the two that waited run.
    assert entered.acquire(timeout=5) and entered.acquire(timeout=5)
