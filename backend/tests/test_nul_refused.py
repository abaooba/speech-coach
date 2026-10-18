"""No string the advice route takes may hold NUL (U+0000): 422.

No browser sends one. Every string field is checked as the body is read, before any route code
runs: a take's id, the tier, every shown id and the transcript excerpt. The 422 names the field
and never quotes it back.

No test asks a model.
"""

import json
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module

JSON_HEADERS = {"content-type": "application/json"}
# Sent next to each NUL: an answer that holds it has quoted the refused value back.
MARKER = "MARKER-OF-THE-REFUSED-VALUE"
NUL = "\x00"


class FakeMessages:
    """Stands in for client.messages and notes every request; no test should make one."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    async def create(self, **request: Any) -> Any:
        self.requests.append(request)
        raise AssertionError("the model was asked")


class FakeAnthropic:
    def __init__(self) -> None:
        self.messages = FakeMessages()


@pytest.fixture
def model() -> Any:
    fake = FakeAnthropic()
    app_module.app.dependency_overrides[app_module.advice_client] = lambda: fake
    yield fake
    app_module.app.dependency_overrides.pop(app_module.advice_client, None)


def post_raw(client: TestClient, path: str, body: object) -> httpx2.Response:
    """POST `body` as Python's json module writes it, NUL as the escape \\u0000."""
    return client.post(path, content=json.dumps(body), headers=JSON_HEADERS)


def assert_refused(response: httpx2.Response, loc: list[object] | None = None) -> None:
    """A 422 that does not quote the refused value; naming the field at `loc`, if given."""
    assert response.status_code == 422, response.text
    assert MARKER not in response.text
    problems = response.json()["detail"]
    assert all("input" not in problem for problem in problems)
    if loc is not None:
        assert [problem["loc"] for problem in problems] == [loc]
        assert "NUL" in problems[0]["msg"]


def advice_body() -> dict[str, Any]:
    return {
        "session_id": "8b1f6c2e-take-one",
        "summary": {
            "duration_seconds": 42.882,
            "words_per_minute": 159.5,
            "filler_count": 2,
            "restart_count": 1,
            "mid_sentence_pause_count": 0,
            "long_pause_count": 0,
            "target_wpm": [140, 160],
            "transcript_excerpt": "One of the few decisions a day— uh, the few.",
        },
        "tier": "Contender",
        "shown_ids": ["filler-001"],
    }


@pytest.mark.parametrize(
    "loc",
    [
        ["body", "session_id"],
        ["body", "tier"],
        ["body", "shown_ids", 0],
        ["body", "summary", "transcript_excerpt"],
    ],
    ids=["session id", "tier", "shown id", "excerpt"],
)
def test_an_advice_request_holding_nul_is_refused_before_the_model_is_asked(
    model: FakeAnthropic, loc: list[Any]
) -> None:
    body = advice_body()
    holder: Any = body
    for key in loc[1:-1]:
        holder = holder[key]
    holder[loc[-1]] = f"{NUL}{MARKER}"

    response = post_raw(TestClient(app_module.app), "/api/advice", body)

    assert_refused(response, loc)
    assert model.messages.requests == []
