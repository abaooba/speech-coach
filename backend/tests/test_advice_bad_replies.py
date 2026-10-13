"""Coach notes fall back to the library on any reply they cannot use (coach.py, PLAN T40).

test_advice_api.py covers the SDK's errors, refusals and replies that break a tip rule. These
tests cover the rest: an answer the SDK cannot read as a message, run through the real
AsyncAnthropic over httpx2.MockTransport so no socket opens; a reply later than the 8 s
deadline, which bounds the whole call rather than each network step; and tip texts that a
count of words between spaces cannot measure.
"""

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import anthropic
import httpx2
import pytest
from anthropic.types import Message, TextBlock, Usage

from backend.advice import coach, load_library
from backend.advice.select import candidates, weakest_skills

LIBRARY = load_library()
TAKE_ID = "take-with-a-bad-reply"
TIER = "Contender"
# The end of the take's transcript. A log line that holds TRANSCRIPT_MARKER has leaked it.
EXCERPT = "Taking that away teaches compliance, not confidence."
TRANSCRIPT_MARKER = "compliance"

REQUEST = coach.AdviceRequest.model_validate(
    {
        "session_id": TAKE_ID,
        "summary": {
            "duration_seconds": 42.882,
            "words_per_minute": 159.5,
            "filler_count": 2,
            "restart_count": 1,
            "mid_sentence_pause_count": 0,
            "long_pause_count": 0,
            "target_wpm": [140, 160],
            "transcript_excerpt": EXCERPT,
        },
        "tier": TIER,
        "shown_ids": [],
    }
)
OFFERED = [
    entry.id
    for entry in candidates(
        LIBRARY, weakest_skills(REQUEST.summary.report_summary()), TIER, [], session_id=TAKE_ID
    )
]
LIBRARY_TIP_IDS = OFFERED[: coach.LIBRARY_TIP_COUNT]


def tips_json(*texts: str) -> str:
    """A reply text holding one tip per text, drawn on the first candidates in turn."""
    return json.dumps(
        {"tips": [{"entry_id": entry_id, "text": text} for entry_id, text in zip(OFFERED, texts)]}
    )


def message_json(content: object) -> dict[str, Any]:
    """A Messages API answer as JSON, holding `content` as it stands."""
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": coach.MODEL,
        "content": content,
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 2400, "output_tokens": 180},
    }


Handler = Callable[[httpx2.Request], Awaitable[httpx2.Response]]


def sdk_client(handler: Handler) -> anthropic.AsyncAnthropic:
    """The real SDK client, set up as client_for_key() sets it up, answered by `handler`."""
    return anthropic.AsyncAnthropic(
        api_key="sk-ant-test-0000-not-a-real-key",
        base_url="https://api.anthropic.test",
        timeout=coach.TIMEOUT_SECONDS,
        max_retries=coach.MAX_RETRIES,
        http_client=anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler)),
    )


def answering(status: int, content_type: str, body: str) -> Handler:
    """A handler that answers every request with this status, content type and body."""

    async def handle(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(status, headers={"content-type": content_type}, text=body)

    return handle


def advise(client: Any) -> coach.Advice:
    """coach.advise() for the take, asking `client`."""
    return asyncio.run(coach.advise(REQUEST, LIBRARY, client))


def is_library_advice(advice: coach.Advice) -> bool:
    """True when the notes are the first candidates, word for word."""
    return advice.source == "library" and [tip.entry_id for tip in advice.tips] == LIBRARY_TIP_IDS


# --- answers the SDK cannot read as a message ----------------------------------------------------

GOOD_TIPS = tips_json("You restarted once. Pause instead of repeating.", "Keep your pace.")
ANSWERS = {
    "an HTML page": ("text/html", f"<html><body>{EXCERPT}</body></html>"),
    "broken JSON": ("application/json", '{"content": [' + EXCERPT),
    "an empty body": ("application/json", ""),
    "a JSON list": ("application/json", json.dumps([EXCERPT])),
    "a message without content": ("application/json", json.dumps(message_json(None))),
    "a text block without text": (
        "application/json",
        json.dumps(message_json([{"type": "text", "text": None}])),
    ),
}


@pytest.mark.parametrize(("content_type", "body"), ANSWERS.values(), ids=list(ANSWERS))
def test_an_answer_that_is_not_a_usable_message_falls_back(
    content_type: str, body: str, caplog: pytest.LogCaptureFixture
) -> None:
    # Everything the coach logs. The SDK's own debug log, which holds the request and so the
    # prompt, is written only when ANTHROPIC_LOG=debug turns it on.
    caplog.set_level(logging.DEBUG, logger=coach.logger.name)

    advice = advise(sdk_client(answering(200, content_type, body)))

    assert is_library_advice(advice)
    warnings = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert len(warnings) == 1
    assert TRANSCRIPT_MARKER not in caplog.text


def test_a_good_answer_through_the_real_sdk_is_used() -> None:
    body = json.dumps(message_json([{"type": "text", "text": GOOD_TIPS}]))

    advice = advise(sdk_client(answering(200, "application/json", body)))

    assert advice.source == "ai"
    assert [tip.entry_id for tip in advice.tips] == OFFERED[:2]


# --- the deadline --------------------------------------------------------------------------------


def test_a_reply_later_than_the_deadline_falls_back_at_the_deadline(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # The SDK's own timeout limits each network step, and a reply that keeps arriving can outlast
    # it. The deadline bounds the whole call. Here the client keeps its 8 s timeout, the deadline
    # is shortened to 50 ms and the good answer takes 2 s.
    good_answer = json.dumps(message_json([{"type": "text", "text": GOOD_TIPS}]))

    async def answer_late(request: httpx2.Request) -> httpx2.Response:
        await asyncio.sleep(2.0)
        return httpx2.Response(200, headers={"content-type": "application/json"}, text=good_answer)

    client = sdk_client(answer_late)
    monkeypatch.setattr(coach, "TIMEOUT_SECONDS", 0.05)
    caplog.set_level(logging.DEBUG, logger=coach.logger.name)
    started = time.monotonic()
    advice = advise(client)
    waited = time.monotonic() - started

    assert is_library_advice(advice)
    assert waited < 1.0
    assert "no reply within 0.05 s" in caplog.text


# --- tip texts -----------------------------------------------------------------------------------


class FakeMessages:
    """Stands in for client.messages: answers every request with one finished reply."""

    def __init__(self, reply_text: str) -> None:
        self.reply = Message(
            id="msg_test",
            type="message",
            role="assistant",
            model=coach.MODEL,
            content=[TextBlock(type="text", text=reply_text)],
            stop_reason="end_turn",
            stop_sequence=None,
            usage=Usage(input_tokens=2400, output_tokens=180),
        )

    async def create(self, **request: Any) -> Message:
        return self.reply


class FakeAnthropic:
    """Stands in for anthropic.AsyncAnthropic, replying with `reply_text`."""

    def __init__(self, reply_text: str) -> None:
        self.messages = FakeMessages(reply_text)


TEXTS_WITHOUT_WORDS = {
    "a zero-width space": "\u200b",
    "punctuation": "...",
    "an emoji": "\U0001f44d",
}


@pytest.mark.parametrize("text", TEXTS_WITHOUT_WORDS.values(), ids=list(TEXTS_WITHOUT_WORDS))
def test_a_tip_without_a_letter_or_digit_falls_back(text: str) -> None:
    advice = advise(FakeAnthropic(tips_json("You restarted once.", text)))

    assert is_library_advice(advice)


LONG_TEXTS = {
    "4,000 characters without a space": "x" * 4_000,
    "1,000 characters of Chinese": "\u7ec3" * 1_000,
}


@pytest.mark.parametrize("text", LONG_TEXTS.values(), ids=list(LONG_TEXTS))
def test_a_tip_too_long_to_count_in_words_falls_back(text: str) -> None:
    advice = advise(FakeAnthropic(tips_json("You restarted once.", text)))

    assert is_library_advice(advice)


def test_a_tip_up_to_the_character_limit_is_kept_and_one_more_falls_back() -> None:
    def tip_of(length: int) -> str:
        """A tip of four words, `length` characters long."""
        return "a" * (length - 6) + " b c d"

    at_limit = advise(FakeAnthropic(tips_json(tip_of(coach.MAX_TIP_CHARACTERS), "Slow down.")))
    over = advise(FakeAnthropic(tips_json(tip_of(coach.MAX_TIP_CHARACTERS + 1), "Slow down.")))

    assert at_limit.source == "ai"
    assert at_limit.tips[0].text == tip_of(coach.MAX_TIP_CHARACTERS)
    assert is_library_advice(over)


def test_the_character_limit_leaves_room_for_60_words_of_the_library_densest_advice() -> None:
    # The library's advice is the text the tips rewrite. Its densest entry, in characters a word,
    # stretched to 60 words must still fit under the limit.
    densest = max(len(entry.advice) / len(entry.advice.split()) for entry in LIBRARY)

    assert densest * coach.MAX_TIP_WORDS < coach.MAX_TIP_CHARACTERS
