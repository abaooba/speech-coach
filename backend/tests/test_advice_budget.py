"""The cost ceiling on coach notes (backend/advice/budget.py): AI calls an hour, server-wide.

/api/advice asks Claude for at most 300 coach notes in any rolling hour, counted for the whole
server and never by address: behind Render's proxy every visitor shares one address anyway. Past
the budget the route answers with the library's own tips (source "library"), never an error, and
logs how many calls the hour allows and nothing else. A call counts when the model is asked, so a
request refused as invalid, or answered without a key, spends nothing.

Each test brings its own budget and clock, and the model is a fake: no test opens a socket.
"""

import json
import logging
import threading
from collections.abc import Iterator
from typing import Any

import pytest
from anthropic.types import Message, TextBlock, Usage
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.advice import budget as budget_module
from backend.advice import citation, load_library
from backend.advice.budget import AICallBudget
from backend.advice.select import ReportSummary, candidates, weakest_skills

TAKE_ID = "8b1f6c2e-take-one"
TIER = "Contender"
NUMBERS: ReportSummary = {
    "duration_seconds": 42.882,
    "words_per_minute": 159.5,
    "filler_count": 2,
    "restart_count": 1,
    "mid_sentence_pause_count": 0,
    "long_pause_count": 0,
    "target_wpm": [140, 160],
}
# A log line that holds this has leaked the transcript.
EXCERPT = "Choosing how to present yourself is one of the few decisions a day— uh, the few."
LIBRARY = {entry.id: entry for entry in load_library()}
HOUR = 3_600.0


class Clock:
    """Seconds on a monotonic clock the test moves by hand."""

    def __init__(self) -> None:
        self.seconds = 1_000.0

    def __call__(self) -> float:
        return self.seconds

    def advance(self, seconds: float) -> None:
        self.seconds += seconds


# --- the budget ----------------------------------------------------------------------------------


def spend(budget: AICallBudget, times: int) -> list[bool]:
    return [budget.try_to_spend() for _ in range(times)]


def test_a_budget_allows_its_calls_and_then_refuses() -> None:
    budget = AICallBudget(calls_per_window=3, clock=Clock())

    assert spend(budget, 4) == [True, True, True, False]


def test_a_call_counts_against_the_budget_for_an_hour_after_it_is_made() -> None:
    clock = Clock()
    budget = AICallBudget(calls_per_window=3, clock=clock)
    spend(budget, 3)

    clock.advance(HOUR - 0.5)
    just_before = budget.try_to_spend()
    clock.advance(0.5)
    on_the_hour = spend(budget, 4)

    assert just_before is False
    assert on_the_hour == [True, True, True, False]


def test_the_hour_rolls_one_call_at_a_time() -> None:
    clock = Clock()
    budget = AICallBudget(calls_per_window=3, clock=clock)
    for _ in range(3):
        assert budget.try_to_spend()
        clock.advance(1_000)

    # Now 3,000 s after the first call: all three still count.
    refused = budget.try_to_spend()
    clock.advance(600)
    first_call_gone = budget.try_to_spend()
    clock.advance(1)
    full_again = budget.try_to_spend()

    assert (refused, first_call_gone, full_again) == (False, True, False)


def test_a_refused_call_is_not_counted() -> None:
    clock = Clock()
    budget = AICallBudget(calls_per_window=1, clock=clock)
    assert budget.try_to_spend()

    clock.advance(HOUR / 2)
    refused = budget.try_to_spend()
    clock.advance(HOUR / 2)
    allowed = budget.try_to_spend()

    assert (refused, allowed) == (False, True)


def test_calls_from_many_threads_at_once_never_pass_the_budget() -> None:
    budget = AICallBudget(calls_per_window=300, clock=Clock())
    allowed: list[bool] = []
    lock = threading.Lock()

    def ask_100_times() -> None:
        results = spend(budget, 100)
        with lock:
            allowed.extend(results)

    threads = [threading.Thread(target=ask_100_times) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert allowed.count(True) == 300


def test_the_server_keeps_one_budget_of_300_calls_an_hour() -> None:
    server = budget_module.ADVICE_CALL_BUDGET

    assert budget_module.AI_ADVICE_CALLS_PER_HOUR == 300
    assert (server.calls_per_window, server.window_seconds) == (300, HOUR)
    assert app_module.advice_call_budget() is server


# --- the route -----------------------------------------------------------------------------------


def offered_ids() -> list[str]:
    """The ids of the entries the take's notes may draw on, best first."""
    offered = candidates(load_library(), weakest_skills(NUMBERS), TIER, [], session_id=TAKE_ID)
    return [entry.id for entry in offered]


def advice_body() -> dict[str, Any]:
    return {
        "session_id": TAKE_ID,
        "summary": {**NUMBERS, "transcript_excerpt": EXCERPT},
        "tier": TIER,
        "shown_ids": [],
    }


def library_tips() -> dict[str, Any]:
    """The answer without the model: the first three candidates, word for word."""
    tips = []
    for entry_id in offered_ids()[:3]:
        entry = LIBRARY[entry_id]
        cited = {"label": citation(entry), "url": entry.source.url, "type": entry.source.type}
        tips.append(
            {"entry_id": entry_id, "text": entry.advice, "drill": entry.drill, "citation": cited}
        )
    return {"tips": tips, "source": "library"}


class FakeMessages:
    """Stands in for client.messages: answers every create() with two good tips."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    async def create(self, **request: Any) -> Message:
        self.requests.append(request)
        first, second = offered_ids()[:2]
        tips = [
            {"entry_id": first, "text": "You restarted once. Pause before the clause."},
            {"entry_id": second, "text": "You ran at the top of your band. Let lines land."},
        ]
        return Message(
            id="msg_test",
            type="message",
            role="assistant",
            model="claude-haiku-5-5",
            content=[TextBlock(type="text", text=json.dumps({"tips": tips}))],
            stop_reason="end_turn",
            stop_sequence=None,
            usage=Usage(input_tokens=2400, output_tokens=180),
        )


class FakeAnthropic:
    """Stands in for anthropic.AsyncAnthropic and notes every request it is sent."""

    def __init__(self) -> None:
        self.messages = FakeMessages()


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def budget(clock: Clock) -> Iterator[AICallBudget]:
    """A budget of 2 calls an hour on the test's clock, handed to the route."""
    budget = AICallBudget(calls_per_window=2, clock=clock)
    overrides = app_module.app.dependency_overrides
    overrides[app_module.advice_call_budget] = lambda: budget
    yield budget
    overrides.pop(app_module.advice_call_budget, None)


@pytest.fixture
def model() -> Iterator[FakeAnthropic]:
    """A fake model handed to the route as its client, as when a key is set."""
    fake = FakeAnthropic()
    overrides = app_module.app.dependency_overrides
    overrides[app_module.advice_client] = lambda: fake
    yield fake
    overrides.pop(app_module.advice_client, None)


def browser(address: str = "198.51.100.7") -> TestClient:
    return TestClient(app_module.app, client=(address, 50000))


def sources_of(responses: list[Any]) -> list[str]:
    assert [response.status_code for response in responses] == [200] * len(responses)
    return [response.json()["source"] for response in responses]


def test_the_model_writes_the_notes_until_the_hours_calls_are_spent(
    budget: AICallBudget, model: FakeAnthropic
) -> None:
    responses = [browser().post("/api/advice", json=advice_body()) for _ in range(3)]

    assert sources_of(responses) == ["ai", "ai", "library"]
    assert responses[2].json() == library_tips()
    assert len(model.messages.requests) == 2


def test_every_visitor_draws_on_one_budget_whatever_address_they_give(
    budget: AICallBudget, model: FakeAnthropic
) -> None:
    visitors = [
        browser("198.51.100.7").post("/api/advice", json=advice_body()),
        browser("203.0.113.9").post("/api/advice", json=advice_body()),
        browser("192.0.2.44").post(
            "/api/advice", json=advice_body(), headers={"x-forwarded-for": "203.0.113.200"}
        ),
    ]

    assert sources_of(visitors) == ["ai", "ai", "library"]


def test_the_model_writes_again_once_the_oldest_call_is_an_hour_old(
    budget: AICallBudget, model: FakeAnthropic, clock: Clock
) -> None:
    spent = [browser().post("/api/advice", json=advice_body()) for _ in range(3)]
    clock.advance(HOUR)

    later = [browser().post("/api/advice", json=advice_body()) for _ in range(3)]

    assert sources_of(spent) == ["ai", "ai", "library"]
    assert sources_of(later) == ["ai", "ai", "library"]


def test_a_request_the_model_never_sees_spends_nothing(
    budget: AICallBudget, model: FakeAnthropic
) -> None:
    overrides = app_module.app.dependency_overrides
    invalid = advice_body()
    invalid["summary"]["filler_count"] = -1
    refused = [browser().post("/api/advice", json=invalid) for _ in range(5)]
    overrides[app_module.advice_client] = lambda: None
    without_a_key = [browser().post("/api/advice", json=advice_body()) for _ in range(5)]
    overrides[app_module.advice_client] = lambda: model

    with_a_key = [browser().post("/api/advice", json=advice_body()) for _ in range(3)]

    assert [response.status_code for response in refused] == [422] * 5
    assert sources_of(without_a_key) == ["library"] * 5
    assert sources_of(with_a_key) == ["ai", "ai", "library"]
    assert len(model.messages.requests) == 2


def app_warnings(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.name.startswith("backend")]


def test_a_spent_budget_is_logged_by_its_count_alone(
    budget: AICallBudget, model: FakeAnthropic, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    for _ in range(2):
        browser().post("/api/advice", json=advice_body())
    assert app_warnings(caplog) == []

    browser().post("/api/advice", json=advice_body())

    [record] = app_warnings(caplog)
    assert record.levelno == logging.WARNING
    assert "2 AI calls an hour" in record.getMessage()
    for private in (EXCERPT, "few decisions", TAKE_ID, TIER):
        assert private not in caplog.text
    assert record.exc_info is None
