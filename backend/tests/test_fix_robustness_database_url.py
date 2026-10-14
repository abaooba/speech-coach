"""A DATABASE_URL no engine can be built from leaves accounts off; it never stops the app.

backend/db.py configured_engine built the engine at startup with nothing around it, so a URL
that does not parse (ArgumentError), has a port that is not a number (ValueError) or names a
driver that is not installed (ModuleNotFoundError) raised out of the app's startup, and guests
lost the app along with accounts. Now such a URL is logged by the error's class alone, since it
holds the database password, and treated as no URL: account routes answer 503 and guests are
served.

No test connects anywhere: each URL fails before a connection is tried, and pytest-socket blocks
the network.
"""

import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import db

# Made-up parts of a Neon connection string. A log line that holds one has leaked the URL.
HOST = "ep-quiet-sky-123456.us-east-2.aws.neon.tech"
PASSWORD = "not-a-real-password"

# Each malformed DATABASE_URL, with the error that building an engine from it raises.
BAD_DATABASE_URLS = [
    # The host and database without a scheme, as copied from the Neon console's fields.
    pytest.param(f"{HOST}/neondb", "ArgumentError", id="no-scheme"),
    pytest.param(
        f"postgresql://speech_coach:{PASSWORD}@{HOST}:notaport/neondb",
        "ValueError",
        id="port-not-a-number",
    ),
    # psycopg2: requirements.txt installs psycopg 3, which the app names itself.
    pytest.param(
        f"postgresql+psycopg2://speech_coach:{PASSWORD}@{HOST}/neondb",
        "ModuleNotFoundError",
        id="driver-not-installed",
    ),
]

# A guest's request for coach notes, as the Results screen sends it.
GUEST_ADVICE_REQUEST = {
    "session_id": "8b1f6c2e-take-one",
    "summary": {
        "duration_seconds": 42.882,
        "words_per_minute": 159.5,
        "filler_count": 2,
        "restart_count": 1,
        "mid_sentence_pause_count": 0,
        "long_pause_count": 0,
        "target_wpm": [140, 160],
        "transcript_excerpt": "Consider what we lose.",
    },
    "tier": "Contender",
    "shown_ids": [],
}


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """No DATABASE_URL, no engine built from it yet and no API key; a test sets the URL.

    configured_engine keeps its first answer (functools.cache), so it is cleared before and
    after. Without a key the notes are the library's own, and no client is built.
    """
    monkeypatch.delenv(db.DATABASE_URL_VARIABLE, raising=False)
    monkeypatch.delenv(app_module.ANTHROPIC_API_KEY_VARIABLE, raising=False)
    db.configured_engine.cache_clear()
    yield monkeypatch
    db.configured_engine.cache_clear()


@pytest.mark.parametrize(("url", "error"), BAD_DATABASE_URLS)
def test_the_app_starts_and_serves_guests_and_the_log_never_holds_the_url(
    environment: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, url: str, error: str
) -> None:
    environment.setenv(db.DATABASE_URL_VARIABLE, url)
    caplog.set_level(logging.DEBUG)

    with TestClient(app_module.app) as client:
        health = client.get("/api/health")
        advice = client.post("/api/advice", json=GUEST_ADVICE_REQUEST)

    assert health.status_code == 200
    assert advice.status_code == 200, advice.text
    assert advice.json()["source"] == "library"
    for secret in (url, HOST, PASSWORD):
        assert secret not in caplog.text


@pytest.mark.parametrize(("url", "error"), BAD_DATABASE_URLS)
def test_the_error_is_logged_once_by_its_class_alone(
    environment: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, url: str, error: str
) -> None:
    environment.setenv(db.DATABASE_URL_VARIABLE, url)

    with TestClient(app_module.app) as client:
        # Each account route asks for the engine again; the answer was kept from startup.
        client.get("/api/me")
        client.get("/api/me")

    [record] = [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert error in record.getMessage()
    assert "DATABASE_URL" in record.getMessage()


@pytest.mark.parametrize(("url", "error"), BAD_DATABASE_URLS)
def test_account_routes_answer_503_as_when_no_url_is_set(
    environment: pytest.MonkeyPatch, url: str, error: str
) -> None:
    environment.setenv(db.DATABASE_URL_VARIABLE, url)

    with TestClient(app_module.app) as client:
        response = client.get("/api/me")

    assert response.status_code == 503
    assert response.json() == {"detail": db.ACCOUNTS_NOT_CONFIGURED}


@pytest.mark.parametrize(("url", "error"), BAD_DATABASE_URLS)
def test_no_engine_is_built_from_a_malformed_url(
    environment: pytest.MonkeyPatch, url: str, error: str
) -> None:
    environment.setenv(db.DATABASE_URL_VARIABLE, url)

    assert db.configured_engine() is None
