"""POST /api/advice serves everyone as a guest: a cookie named sc_session changes nothing.

There are no accounts, so the tips a request gets are the ones its own shown_ids give, the same
as for a request without the cookie. No model is asked (no API key), so the tips are the library's.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.advice import coach, load_library
from backend.advice.select import candidates, weakest_skills

NUMBERS = {
    "duration_seconds": 42.882,
    "words_per_minute": 159.5,
    "filler_count": 2,
    "restart_count": 1,
    "mid_sentence_pause_count": 0,
    "long_pause_count": 0,
    "target_wpm": [140, 160],
}
EXCERPT = "Choosing how to present yourself is one of the few decisions a day— uh, the few."
TAKE_ID = "8b1f6c2e-take-one"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    coach.client_for_key.cache_clear()
    yield TestClient(app_module.app)
    app_module.app.dependency_overrides.clear()
    coach.client_for_key.cache_clear()


def tip_ids(client: TestClient, shown_ids: list[str], cookie: str | None) -> list[str]:
    body = {
        "session_id": TAKE_ID,
        "summary": {**NUMBERS, "transcript_excerpt": EXCERPT},
        "tier": "Contender",
        "shown_ids": shown_ids,
    }
    headers = {"Cookie": f"sc_session={cookie}"} if cookie else {}
    response = client.post("/api/advice", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return [tip["entry_id"] for tip in response.json()["tips"]]


def test_a_session_cookie_gets_the_tips_its_own_shown_ids_give(client: TestClient) -> None:
    library = load_library()
    first = [c.id for c in candidates(library, weakest_skills(NUMBERS), "Contender", [],
                                      session_id=TAKE_ID)]
    shown = first[:2]
    expected = tip_ids(client, shown, None)
    assert expected, "the library should offer tips"
    assert not set(expected) & set(shown)
    assert tip_ids(client, shown, "a-token-for-someone-else") == expected
    assert tip_ids(client, [], "a-token-for-someone-else") == tip_ids(client, [], None)
