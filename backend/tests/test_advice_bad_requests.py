"""POST /api/advice refuses a hand-made body with a 422, never a 500 (backend/app.py, PLAN T40).

The Results screen sends numbers from the take's report, so they are finite and small. A body
written by hand can hold what the browser never sends: a count hundreds of digits long, NaN or
Infinity (Python's JSON parser reads both, and reads 1e400 as Infinity), or half of a UTF-16
surrogate pair. Each is refused with a 422 that names the field and the problem without echoing
the value, since an answer cannot hold NaN or half a surrogate pair, and there is no need to send
a rejected excerpt back.
"""

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.advice import coach

ADVICE_URL = "/api/advice"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The app with no API key, answering a server error as a 500 rather than raising it."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    coach.client_for_key.cache_clear()
    yield TestClient(app_module.app, raise_server_exceptions=False)
    coach.client_for_key.cache_clear()


def advice_body(**summary_changes: object) -> dict[str, Any]:
    """A request for a 2-minute take at 150 wpm with one restart, its summary changed."""
    summary = {
        "duration_seconds": 120.0,
        "words_per_minute": 150.0,
        "filler_count": 2,
        "restart_count": 1,
        "mid_sentence_pause_count": 0,
        "long_pause_count": 0,
        "target_wpm": [140, 160],
        "transcript_excerpt": "We should adopt the plan because it works.",
        **summary_changes,
    }
    return {"session_id": "take-1", "summary": summary, "tier": "Contender", "shown_ids": []}


def post_json_text(client: TestClient, text: str) -> Any:
    """POST a body written as JSON text, which can hold what json.dumps would not write."""
    return client.post(ADVICE_URL, content=text, headers={"content-type": "application/json"})


def with_raw_value(body: dict[str, Any], placeholder: str, raw: str) -> str:
    """`body` as JSON text with the string `placeholder` replaced by the raw JSON `raw`."""
    return json.dumps(body).replace(json.dumps(placeholder), raw)


# --- numbers -------------------------------------------------------------------------------------

COUNTS = ["filler_count", "restart_count", "mid_sentence_pause_count", "long_pause_count"]


@pytest.mark.parametrize("field", COUNTS)
def test_a_count_hundreds_of_digits_long_is_refused(client: TestClient, field: str) -> None:
    text = with_raw_value(advice_body(**{field: "COUNT"}), "COUNT", "9" * 400)

    response = post_json_text(client, text)

    assert response.status_code == 422


@pytest.mark.parametrize("field", COUNTS)
def test_counts_up_to_the_limit_are_accepted_and_one_more_is_refused(
    client: TestClient, field: str
) -> None:
    at_limit = client.post(ADVICE_URL, json=advice_body(**{field: coach.MAX_COUNT}))
    over_limit = client.post(ADVICE_URL, json=advice_body(**{field: coach.MAX_COUNT + 1}))

    assert at_limit.status_code == 200
    assert over_limit.status_code == 422


NOT_FINITE = ["NaN", "Infinity", "-Infinity", "1e400"]
NUMBER_FIELDS = ["duration_seconds", "words_per_minute", "band low", "band high"]


@pytest.mark.parametrize("raw", NOT_FINITE)
@pytest.mark.parametrize("field", NUMBER_FIELDS)
def test_a_number_that_is_not_finite_is_refused(client: TestClient, field: str, raw: str) -> None:
    if field == "band low":
        body = advice_body(target_wpm=["NUMBER", 160])
    elif field == "band high":
        body = advice_body(target_wpm=[140, "NUMBER"])
    else:
        body = advice_body(**{field: "NUMBER"})

    response = post_json_text(client, with_raw_value(body, "NUMBER", raw))

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("field", "limit"),
    [
        ("duration_seconds", coach.MAX_SECONDS),
        ("words_per_minute", coach.MAX_WORDS_PER_MINUTE),
    ],
)
def test_a_time_or_pace_up_to_its_limit_is_accepted_and_past_it_refused(
    client: TestClient, field: str, limit: float
) -> None:
    at_limit = client.post(ADVICE_URL, json=advice_body(**{field: limit}))
    over_limit = client.post(ADVICE_URL, json=advice_body(**{field: limit + 1}))

    assert at_limit.status_code == 200
    assert over_limit.status_code == 422


def test_a_band_past_the_pace_limit_is_refused(client: TestClient) -> None:
    band = [140, coach.MAX_WORDS_PER_MINUTE + 1]

    response = client.post(ADVICE_URL, json=advice_body(target_wpm=band))

    assert response.status_code == 422


# --- text ----------------------------------------------------------------------------------------

LONE_SURROGATE = '"\\ud83d"'  # the first half of an emoji's surrogate pair, as JSON writes it


@pytest.mark.parametrize("field", ["session_id", "tier", "shown id", "transcript_excerpt"])
def test_half_a_surrogate_pair_is_refused(client: TestClient, field: str) -> None:
    body = advice_body()
    if field == "transcript_excerpt":
        body["summary"]["transcript_excerpt"] = "TEXT"
    elif field == "shown id":
        body["shown_ids"] = ["TEXT"]
    else:
        body[field] = "TEXT"

    response = post_json_text(client, with_raw_value(body, "TEXT", LONE_SURROGATE))

    assert response.status_code == 422


# --- what a refusal says -------------------------------------------------------------------------


def test_a_refusal_names_the_field_and_the_problem_without_echoing_the_value(
    client: TestClient,
) -> None:
    excerpt = "MARKER " + "a" * coach.MAX_EXCERPT_CHARACTERS

    response = client.post(ADVICE_URL, json=advice_body(transcript_excerpt=excerpt))

    assert response.status_code == 422
    [problem] = response.json()["detail"]
    assert problem["loc"] == ["body", "summary", "transcript_excerpt"]
    assert problem["type"] == "string_too_long"
    assert problem["msg"]
    assert "input" not in problem
    assert "MARKER" not in response.text


def test_a_refused_number_that_is_not_finite_is_named_without_its_value(
    client: TestClient,
) -> None:
    text = with_raw_value(advice_body(words_per_minute="NUMBER"), "NUMBER", "NaN")

    response = post_json_text(client, text)

    assert response.status_code == 422
    [problem] = response.json()["detail"]
    assert problem["loc"] == ["body", "summary", "words_per_minute"]
    assert "input" not in problem


def test_a_body_that_is_not_json_is_still_refused_with_a_422(client: TestClient) -> None:
    response = post_json_text(client, '{"session_id": ')

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "json_invalid"
