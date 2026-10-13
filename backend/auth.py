"""Accounts (docs/PLAN.md T47): sign up, log in, log out, and the signed-in account.

    POST   /api/auth/signup  {email, password}  201 {email}; this browser is signed in
    POST   /api/auth/login   {email, password}  200 {email}; this browser is signed in
    POST   /api/auth/logout                     204; this browser's session is over
    GET    /api/me                              200 {email} of the signed-in account
    DELETE /api/me                              204; the account and every row it owns are gone

Accounts are optional. With DATABASE_URL unset every route here answers 503 (db.accounts_engine)
and guests carry on as before, their takes kept in the browser.

A password is 10 to 256 characters and is kept only as an Argon2id hash (argon2-cffi). An email is
kept trimmed and lowercased; signing up checks that it looks like an address, and nothing more.

A session is 32 random bytes, sent as URL-safe base64 in the sc_session cookie (HttpOnly; Secure;
SameSite=Lax; Path=/), and lasts 30 days from sign-in, cookie and session alike. The database
keeps only a digest of the token, so its rows sign no one in: HMAC-SHA256 keyed by SESSION_SECRET
when that is set, plain SHA-256 when it is not. Either is safe to keep, as 32 random bytes cannot
be worked back from their digest. The key adds one thing: someone who can write to the database
but does not know SESSION_SECRET cannot add a session of their own. Setting or changing
SESSION_SECRET ends every session.

A wrong password and an email with no account get the same 401 "email or password is wrong",
after the same Argon2 check: an unknown email is checked against a stand-in hash. Five failed
logins for one email from one IP address within 15 minutes turn that pair away with 429 until the
oldest of them is 15 minutes old (FailedLoginLimiter, kept in this process's memory).

Signing up with an email that already has an account is refused with 409 "an account with this
email already exists: log in instead", and the account is left exactly as it was. That answer
tells whoever asks that the email has an account. Sign-up could hide it only by writing to the
address, and this app sends no email, so the answer says that much and nothing else about the
account.

Every route that changes something accepts JSON only (require_json, 415 otherwise), so another
site cannot sign a speaker up, in or out, or delete their account. Nothing here logs an email, a
password or a token.
"""

import hashlib
import hmac
import math
import os
import re
import secrets
import threading
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cache
from typing import Annotated

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import Connection, Engine, delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from backend import db

# The session cookie. HttpOnly: no script on the page can read it. Secure: it travels over https
# only. SameSite=Lax: a form posted from another site goes without it. Path=/: every route gets
# it. It names no Domain, so it goes back to this host alone.
SESSION_COOKIE_NAME = "sc_session"
SESSION_LIFETIME = timedelta(days=30)
SESSION_COOKIE_MAX_AGE_SECONDS = int(SESSION_LIFETIME.total_seconds())
# 256 random bits: a token no one can guess.
SESSION_TOKEN_BYTES = 32
# Where the server finds the key for session digests: the environment only (the Render dashboard,
# or .env locally), never a file in the repo. It is never logged.
SESSION_SECRET_VARIABLE = "SESSION_SECRET"

MIN_PASSWORD_LENGTH = 10
# Room for any passphrase, while a request cannot hand Argon2 an essay.
MAX_PASSWORD_LENGTH = 256
# The longest address mail can be delivered to: RFC 5321's 256-octet path, less its two brackets.
MAX_EMAIL_LENGTH = 254
# something@something.something with no spaces: enough to catch a slip, not an RFC 5322 parser.
EMAIL_SHAPE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

# Argon2id at OWASP's recommended minimum: 19 MiB of memory, 2 passes, 1 lane, about 15 ms on a
# laptop. argon2-cffi's default (RFC 9106's low-memory choice) holds 64 MiB per hash, and the
# server has 512 MB for everything, so a burst of logins could run it out of memory.
ARGON2_TIME_COST = 2
ARGON2_MEMORY_KIB = 19_456
ARGON2_PARALLELISM = 1
# Hashes beyond this many wait their turn, so password checks never hold more than 4 x 19 MiB,
# however many logins arrive at once.
MAX_CONCURRENT_HASHES = 4

MAX_FAILED_LOGINS = 5
FAILED_LOGIN_WINDOW = timedelta(minutes=15)
# How many (email, address) pairs the failed-login count keeps: under 10 MB, even when every email
# is as long as allowed. Past it, the pair whose last failure is oldest is forgotten first.
MAX_PAIRS_TRACKED = 10_000
# Where a request came from when the server cannot say (an ASGI server may leave it out).
UNKNOWN_ADDRESS = "unknown"

JSON_MEDIA_TYPE = "application/json"

# What the routes answer when they turn a request down.
WRONG_EMAIL_OR_PASSWORD = "email or password is wrong"
NOT_SIGNED_IN = "not signed in"
EMAIL_TAKEN = "an account with this email already exists: log in instead"
INVALID_EMAIL = "enter a valid email address"
PASSWORD_LENGTH_RULE = (
    f"use a password of {MIN_PASSWORD_LENGTH} to {MAX_PASSWORD_LENGTH} characters"
)
TOO_MANY_FAILED_LOGINS = "too many failed logins: try again in {minutes} min"
JSON_REQUIRED = "send this request as JSON (Content-Type: application/json)"

PASSWORD_HASHER = PasswordHasher(
    time_cost=ARGON2_TIME_COST,
    memory_cost=ARGON2_MEMORY_KIB,
    parallelism=ARGON2_PARALLELISM,
    type=Type.ID,
)
HASHING_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_HASHES)

# Every route here needs the database, so while accounts are off each answers 503 before anything
# else is looked at.
router = APIRouter(prefix="/api", dependencies=[Depends(db.accounts_engine)])

# (normalized email, IP address): what failed logins are counted by.
LoginPair = tuple[str, str]


class Credentials(BaseModel):
    """What the sign-up and log-in forms send."""

    email: str
    password: str


@dataclass(frozen=True)
class SignedInAccount:
    """The account a request's session cookie belongs to."""

    user_id: int
    email: str


class FailedLoginLimiter:
    """Failed logins per (email, IP address), counted in this process's memory (PLAN T47).

    A pair that has failed max_failures times within the last `window` is turned away until the
    oldest of those failures is `window` old. An attempt counts as failed from the moment it
    starts until forget() says it succeeded, so attempts sent all at once cannot each be let
    through before any of them is counted. A pair is forgotten once its last failure is `window`
    old, and past max_pairs the pair whose last failure is oldest goes first.

    The count lives as long as the process: a restart clears it, and each server process keeps
    its own (Render runs one).
    """

    def __init__(
        self,
        max_failures: int = MAX_FAILED_LOGINS,
        window: timedelta = FAILED_LOGIN_WINDOW,
        max_pairs: int = MAX_PAIRS_TRACKED,
    ) -> None:
        self.max_failures = max_failures
        self.window = window
        self.max_pairs = max_pairs
        # Each pair's failures, oldest first, with the pairs in the order of their last failure.
        self._failures: OrderedDict[LoginPair, list[datetime]] = OrderedDict()
        self._lock = threading.Lock()

    def start_attempt(self, pair: LoginPair, now: datetime) -> timedelta | None:
        """Count an attempt by `pair` as failed and return None, or turn it away.

        A pair that has no failures left is not counted again; the answer is then how long it
        must wait before it may try.
        """
        with self._lock:
            cutoff = now - self.window
            self._forget_pairs_quiet_since(cutoff)
            failures = [moment for moment in self._failures.get(pair, []) if moment > cutoff]
            if len(failures) >= self.max_failures:
                return failures[0] + self.window - now
            failures.append(now)
            self._failures[pair] = failures
            self._failures.move_to_end(pair)
            while len(self._failures) > self.max_pairs:
                self._failures.popitem(last=False)
            return None

    def forget(self, pair: LoginPair) -> None:
        """Forget every failure of `pair`: its attempt succeeded."""
        with self._lock:
            self._failures.pop(pair, None)

    def __len__(self) -> int:
        """How many pairs have a failure on record."""
        with self._lock:
            return len(self._failures)

    def _forget_pairs_quiet_since(self, cutoff: datetime) -> None:
        # The pairs are in the order of their last failure, so the quiet ones are at the front.
        while self._failures:
            last_failure = next(iter(self._failures.values()))[-1]
            if last_failure > cutoff:
                return
            self._failures.popitem(last=False)


LOGIN_LIMITER = FailedLoginLimiter()


# --- emails and passwords ------------------------------------------------------------------------


def normalized_email(email: str) -> str:
    """`email` as accounts keep it: without surrounding spaces, lowercased."""
    return email.strip().lower()


def signup_problem(email: str, password: str) -> str | None:
    """Why `email` (normalized) and `password` cannot open an account, or None when they can.

    The email must look like an address (EMAIL_SHAPE) of at most MAX_EMAIL_LENGTH characters,
    all of them printable, and the password must be MIN_PASSWORD_LENGTH to MAX_PASSWORD_LENGTH
    characters long.
    """
    looks_like_an_address = (
        len(email) <= MAX_EMAIL_LENGTH
        and email.isprintable()
        and EMAIL_SHAPE.fullmatch(email) is not None
    )
    if not looks_like_an_address:
        return INVALID_EMAIL
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        return PASSWORD_LENGTH_RULE
    return None


def could_belong_to_an_account(email: str, password: str) -> bool:
    """False when no account can have this email (normalized) and password, whatever is stored.

    Nothing longer than the limits is ever stored, and no stored email holds a character that is
    not printable, such as NUL (which Postgres cannot hold) or half of a UTF-16 surrogate pair
    (which UTF-8 cannot write). A login that fails here is neither looked up nor counted.
    """
    return (
        len(email) <= MAX_EMAIL_LENGTH
        and email.isprintable()
        and len(password) <= MAX_PASSWORD_LENGTH
    )


def password_bytes(password: str) -> bytes:
    """`password` as Argon2 takes it: its UTF-8 bytes.

    JSON can carry half of a UTF-16 surrogate pair, which no browser sends and UTF-8 has no
    bytes for. "surrogatepass" writes it out rather than failing, so such a password is hashed
    and checked like any other, and every other password is plain UTF-8.
    """
    return password.encode("utf-8", "surrogatepass")


def hash_password(hasher: PasswordHasher, password: str) -> str:
    """`password`'s Argon2 hash, made while holding one of the MAX_CONCURRENT_HASHES slots."""
    with HASHING_SLOTS:
        return hasher.hash(password_bytes(password))


def password_matches(hasher: PasswordHasher, password_hash: str, password: str) -> bool:
    """Whether `password` is the one `password_hash` was made from, checked in a hashing slot."""
    with HASHING_SLOTS:
        try:
            return hasher.verify(password_hash, password_bytes(password))
        except (VerificationError, InvalidHashError):
            return False


@cache
def stand_in_hash(hasher: PasswordHasher) -> str:
    """A hash, made once by `hasher`, of a random password that no account has.

    A login for an email with no account checks its password against this, so it is refused
    after the same work as a wrong password, and the time taken does not tell the two apart.
    """
    return hash_password(hasher, secrets.token_urlsafe(SESSION_TOKEN_BYTES))


# --- sessions ------------------------------------------------------------------------------------


def session_secret() -> str:
    """SESSION_SECRET from the environment, or "" when it is unset or blank."""
    return os.environ.get(SESSION_SECRET_VARIABLE, "").strip()


def token_hash(token: str, secret: str) -> str:
    """The digest auth_sessions keeps of a session token, in hex; never the token itself.

    HMAC-SHA256 keyed by `secret` (SESSION_SECRET) when there is one, plain SHA-256 when not.
    """
    if secret:
        return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(connection: Connection, user_id: int, now: datetime) -> str:
    """Sign `user_id` in for SESSION_LIFETIME from `now`, and return the token for the cookie."""
    token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    connection.execute(
        insert(db.auth_sessions).values(
            token_hash=token_hash(token, session_secret()),
            user_id=user_id,
            expires_at=now + SESSION_LIFETIME,
        )
    )
    return token


def set_session_cookie(response: Response, token: str) -> None:
    """Give the browser `token` in the session cookie, for as long as the session lasts."""
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_COOKIE_MAX_AGE_SECONDS,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    """Tell the browser to drop the session cookie (written with the same attributes)."""
    response.delete_cookie(
        SESSION_COOKIE_NAME, path="/", secure=True, httponly=True, samesite="lax"
    )


def client_address(request: Request) -> str:
    """The IP address a request came from, as the ASGI server reports it.

    Behind a proxy, as on Render, that is the proxy's address unless uvicorn is told to trust
    the proxy's X-Forwarded-For (--forwarded-allow-ips). Failed logins are then counted per email
    across everyone behind the proxy: never looser, but five wrong passwords from anyone hold
    that email's logins up for 15 minutes. Reading X-Forwarded-For here instead would let a
    client name any address it likes, and so start a fresh count whenever it liked.
    """
    return request.client.host if request.client else UNKNOWN_ADDRESS


def wrong_email_or_password() -> HTTPException:
    """The one answer to every login that fails on its email or password."""
    return HTTPException(status_code=401, detail=WRONG_EMAIL_OR_PASSWORD)


def too_many_failed_logins(wait: timedelta) -> HTTPException:
    """The 429 for a pair that must wait `wait`.

    The wait is rounded up: to whole seconds in Retry-After, to whole minutes in the message.
    """
    seconds = math.ceil(wait.total_seconds())
    return HTTPException(
        status_code=429,
        detail=TOO_MANY_FAILED_LOGINS.format(minutes=math.ceil(seconds / 60)),
        headers={"Retry-After": str(seconds)},
    )


# --- dependencies --------------------------------------------------------------------------------


def current_time() -> datetime:
    """Now, in UTC: the time every account route works with. Tests replace it with their clock."""
    return datetime.now(UTC)


def password_hasher() -> PasswordHasher:
    """The hasher every account route uses (PASSWORD_HASHER). Tests may replace it."""
    return PASSWORD_HASHER


def login_limiter() -> FailedLoginLimiter:
    """The failed-login count log_in keeps (LOGIN_LIMITER). Each test brings its own."""
    return LOGIN_LIMITER


def require_json(request: Request) -> None:
    """Turn away, with 415, a request that changes something but was not sent as JSON.

    This is the guard against cross-site request forgery. A form or a script on another site can
    send a request without asking this server first only with a form's Content-Type or
    text/plain. For application/json the browser asks first (a CORS preflight), and this server
    never says yes. The SameSite=Lax cookie already stays home when another site posts, but a
    login or a sign-up needs no cookie: without this guard, a form on another site could sign a
    speaker in to an account of the other site's choosing. Media types ignore case, and a
    charset may follow.
    """
    media_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    if media_type != JSON_MEDIA_TYPE:
        raise HTTPException(status_code=415, detail=JSON_REQUIRED)


SessionCookie = Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)]


def signed_in_account(
    engine: Annotated[Engine, Depends(db.accounts_engine)],
    now: Annotated[datetime, Depends(current_time)],
    token: SessionCookie = None,
) -> SignedInAccount:
    """The FastAPI dependency of every route for a signed-in speaker: the account, or 401.

    The cookie's token must match a session that has not expired. An expired session is
    refused like a made-up one.
    """
    if not token:
        raise HTTPException(status_code=401, detail=NOT_SIGNED_IN)
    sessions, users = db.auth_sessions, db.users
    lookup = (
        select(users.c.id, users.c.email)
        .join(sessions, sessions.c.user_id == users.c.id)
        .where(sessions.c.token_hash == token_hash(token, session_secret()))
        .where(sessions.c.expires_at > now)
    )
    with engine.connect() as connection:
        account = connection.execute(lookup).first()
    if account is None:
        raise HTTPException(status_code=401, detail=NOT_SIGNED_IN)
    return SignedInAccount(user_id=account.id, email=account.email)


# --- routes --------------------------------------------------------------------------------------


@router.post("/auth/signup", status_code=201, dependencies=[Depends(require_json)])
def sign_up(
    credentials: Credentials,
    response: Response,
    engine: Annotated[Engine, Depends(db.accounts_engine)],
    now: Annotated[datetime, Depends(current_time)],
    hasher: Annotated[PasswordHasher, Depends(password_hasher)],
) -> dict[str, str]:
    """Open an account and sign this browser in to it: 201 {"email": ...}.

    400 when the email does not look like an address or the password is not 10 to 256
    characters long; 409 when the email already has an account, which is left as it was.
    """
    email = normalized_email(credentials.email)
    problem = signup_problem(email, credentials.password)
    if problem is not None:
        raise HTTPException(status_code=400, detail=problem)
    password_hash = hash_password(hasher, credentials.password)
    with engine.begin() as connection:
        try:
            signup = insert(db.users).values(
                email=email, password_hash=password_hash, created_at=now
            )
            user_id = connection.execute(signup).inserted_primary_key[0]
        except IntegrityError:
            # The one rule a checked sign-up can break is one account per email. The database's
            # error names the email (Postgres's DETAIL line), so it goes no further than here.
            raise HTTPException(status_code=409, detail=EMAIL_TAKEN) from None
        token = start_session(connection, user_id, now)
    set_session_cookie(response, token)
    return {"email": email}


@router.post("/auth/login", dependencies=[Depends(require_json)])
def log_in(
    credentials: Credentials,
    request: Request,
    response: Response,
    engine: Annotated[Engine, Depends(db.accounts_engine)],
    now: Annotated[datetime, Depends(current_time)],
    hasher: Annotated[PasswordHasher, Depends(password_hasher)],
    limiter: Annotated[FailedLoginLimiter, Depends(login_limiter)],
) -> dict[str, str]:
    """Sign this browser in to the account with this email and password: 200 {"email": ...}.

    Every failure on the email or the password is 401 "email or password is wrong". Once an
    email has failed 5 times from one address within 15 minutes, the next attempt is turned
    away with 429 and Retry-After before any password is checked. Logging in also replaces a
    hash made with older Argon2 settings and clears the account's expired sessions.
    """
    email = normalized_email(credentials.email)
    password = credentials.password
    if not could_belong_to_an_account(email, password):
        raise wrong_email_or_password()
    pair = (email, client_address(request))
    wait = limiter.start_attempt(pair, now)
    if wait is not None:
        raise too_many_failed_logins(wait)
    users = db.users
    with engine.connect() as connection:
        account = connection.execute(
            select(users.c.id, users.c.password_hash).where(users.c.email == email)
        ).first()
    if account is None:
        # The same Argon2 check a wrong password gets, so the time taken does not tell.
        password_matches(hasher, stand_in_hash(hasher), password)
        raise wrong_email_or_password()
    if not password_matches(hasher, account.password_hash, password):
        raise wrong_email_or_password()
    limiter.forget(pair)

    rehashed = None
    if hasher.check_needs_rehash(account.password_hash):
        rehashed = hash_password(hasher, password)
    sessions = db.auth_sessions
    with engine.begin() as connection:
        if rehashed is not None:
            connection.execute(
                update(users).where(users.c.id == account.id).values(password_hash=rehashed)
            )
        connection.execute(
            delete(sessions).where(sessions.c.user_id == account.id, sessions.c.expires_at <= now)
        )
        token = start_session(connection, account.id, now)
    set_session_cookie(response, token)
    return {"email": email}


@router.post("/auth/logout", status_code=204, dependencies=[Depends(require_json)])
def log_out(
    engine: Annotated[Engine, Depends(db.accounts_engine)],
    token: SessionCookie = None,
) -> Response:
    """End this browser's session and clear its cookie: 204, whether it was signed in or not.

    Only the session in this browser's cookie ends; the account's other browsers stay signed in.
    """
    if token:
        sessions = db.auth_sessions
        with engine.begin() as connection:
            connection.execute(
                delete(sessions).where(sessions.c.token_hash == token_hash(token, session_secret()))
            )
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@router.get("/me")
def show_account(
    account: Annotated[SignedInAccount, Depends(signed_in_account)],
) -> dict[str, str]:
    """The signed-in account: 200 {"email": ...}, or 401 "not signed in"."""
    return {"email": account.email}


@router.delete("/me", status_code=204, dependencies=[Depends(require_json)])
def delete_account(
    engine: Annotated[Engine, Depends(db.accounts_engine)],
    account: Annotated[SignedInAccount, Depends(signed_in_account)],
) -> Response:
    """Delete the signed-in account with every row it owns, and clear the cookie: 204.

    Its sessions, takes, shown advice and path progress go with it (ON DELETE CASCADE,
    backend/db.py), so every browser signed in to it is signed out. 401 when not signed in.
    """
    with engine.begin() as connection:
        connection.execute(delete(db.users).where(db.users.c.id == account.user_id))
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response
