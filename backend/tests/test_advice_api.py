"""POST /api/advice (backend/advice/coach.py, PLAN T40): coach notes for one take.

The Results screen sends the take's numbers with a transcript excerpt of at most 1,500
characters, the speaker's tier and the ids of the advice already shown. candidates()
(select.py) picks the library entries the notes may draw on, and Claude Haiku
(claude-haiku-5-5, low effort, a JSON schema for its reply) writes 2-3 tips from them. A reply is
used only when every tip draws on one of those candidates, no entry is drawn on twice and each
text runs 1 to 60 words. Without an API key, after 8 s, on an API error, a refusal or a broken
reply, the first candidates are shown word for word instead. Either way each tip carries its
entry's drill and citation from the library, never from the model, and the answer is
{headline: null, tips: [...], source: "ai" | "library"}: these requests send no moments, so there
is no headline and every tip's moment_ids is empty (test_advice_moments_api.py covers moments).

The Anthropic client is a fake. Most tests hand it to the route through the advice_client
dependency; the ones about the key put it behind the SDK's constructor. No test opens a socket
(pytest-socket blocks the network anyway). Expected tips are worked out from the real library
with candidates(), so the tests hold whatever the owner edits in library.json.
"""

import asyncio
import json
import logging
import re
from collections.abc import Callable, Iterator
from typing import Any

import anthropic
import httpx2
import pytest
from anthropic.types import Message, RefusalStopDetails, TextBlock, ThinkingBlock, Usage
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend import app as app_module
from backend.advice import AdviceEntry, Source, citation, coach, load_library
from backend.advice.select import ReportSummary, candidates, weakest_skills

# The take the advice is for (its frontend session id) and the speaker's rank tier.
TAKE_ID = "8b1f6c2e-take-one"
TIER = "Contender"

# The owner's 2026-10-11 uniforms take as app.delivery reports it (backend/tests/fixtures). It
# restarted once and ran at the top of the 140-160 band, so its notes cover restarts and pace.
UNIFORMS_NUMBERS: ReportSummary = {
    "duration_seconds": 42.882,
    "words_per_minute": 159.5,
    "filler_count": 2,
    "restart_count": 1,
    "mid_sentence_pause_count": 0,
    "long_pause_count": 0,
    "target_wpm": [140, 160],
}
# The end of that take's transcript, restart included. A log line that holds TRANSCRIPT_MARKER
# has leaked the transcript.
EXCERPT = (
    "Consider what we lose. Choosing how to present yourself is one of the few decisions a "
    "day— uh, the few decisions a student makes every day. Taking that away teaches "
    "compliance, not confidence. The proposal fails on its own terms."
)
TRANSCRIPT_MARKER = "few decisions"

# A made-up key: a test that finds it in a log has found a leak.
TEST_KEY = "sk-ant-test-0000-not-a-real-key"

LIBRARY = {entry.id: entry for entry in load_library()}
MESSAGES_URL = "https://api.anthropic.com/v1/messages"

# JSON schema keywords that structured outputs do not support (the SDK's own schema helper,
# transform_schema, moves them into descriptions for that reason), so the schema leaves the 2-3
# tips and the 60 words to the server's own checks. minItems is supported at 0 or 1 only.
UNSUPPORTED_SCHEMA_KEYWORDS = {
    "maxItems", "minLength", "maxLength", "minimum", "maximum", "multipleOf", "pattern",
}


# --- the request ---------------------------------------------------------------------------------


def summary_with(**changes: object) -> dict[str, Any]:
    """The uniforms take's summary as the Results screen sends it, changed by `changes`."""
    return {**UNIFORMS_NUMBERS, "transcript_excerpt": EXCERPT, **changes}


def advice_body(**changes: object) -> dict[str, Any]:
    """The JSON body the Results screen sends for the uniforms take, changed by `changes`."""
    return {
        "session_id": TAKE_ID,
        "summary": summary_with(),
        "tier": TIER,
        "shown_ids": [],
        **changes,
    }


def offered_ids(shown_ids: list[str] | None = None) -> list[str]:
    """The ids of the entries the uniforms take's notes may draw on, best first."""
    offered = candidates(
        load_library(),
        weakest_skills(UNIFORMS_NUMBERS),
        TIER,
        shown_ids or [],
        session_id=TAKE_ID,
    )
    return [entry.id for entry in offered]


# --- the answer ----------------------------------------------------------------------------------


def cited(entry_id: str, text: str) -> dict[str, Any]:
    """A tip as the API sends it: `text` with the drill and citation of the entry it draws on."""
    entry = LIBRARY[entry_id]
    return {
        "entry_id": entry_id,
        "text": text,
        "drill": entry.drill,
        "citation": {"label": citation(entry), "url": entry.source.url, "type": entry.source.type},
        "moment_ids": [],
    }


def library_advice(shown_ids: list[str] | None = None) -> dict[str, Any]:
    """The answer without the model: the first three candidates, their advice word for word."""
    first_three = offered_ids(shown_ids)[:3]
    return {
        "headline": None,
        "tips": [cited(entry_id, LIBRARY[entry_id].advice) for entry_id in first_three],
        "source": "library",
    }


# --- the fake model ------------------------------------------------------------------------------


def reply(text: str, stop_reason: str = "end_turn", **fields: Any) -> Message:
    """A Messages API reply holding `text`, as Claude Haiku 5.5 sends one.

    Thinking is on by default, so a thinking block (its text left out) comes before the text.
    """
    return Message(
        id="msg_test",
        type="message",
        role="assistant",
        model="claude-haiku-5-5",
        content=[
            ThinkingBlock(type="thinking", thinking="", signature="test-signature"),
            TextBlock(type="text", text=text),
        ],
        stop_reason=stop_reason,
        stop_sequence=None,
        usage=Usage(input_tokens=2400, output_tokens=180),
        **fields,
    )


def tips_json(*tips: tuple[str, str]) -> str:
    """(entry_id, text) pairs in the JSON shape the schema asks for."""
    return json.dumps({"tips": [{"entry_id": entry_id, "text": text} for entry_id, text in tips]})


def tips_reply(*tips: tuple[str, str]) -> Message:
    """A finished reply holding these (entry_id, text) tips."""
    return reply(tips_json(*tips))


def good_reply() -> Message:
    """A reply that keeps every rule: two short tips on the first two candidates."""
    first, second = offered_ids()[:2]
    return tips_reply(
        (first, "You restarted once. Pause before the clause instead of saying it twice."),
        (second, "You ran at the top of your band. Let the key lines land."),
    )


def words(count: int) -> str:
    """A tip text of exactly `count` words."""
    return " ".join(["breathe"] * count)


def status_error(
    error_class: type[anthropic.APIStatusError], status: int, error_type: str
) -> anthropic.APIStatusError:
    """The error the SDK raises when the API answers `status`."""
    body = {"type": "error", "error": {"type": error_type, "message": "test"}}
    response = httpx2.Response(status, request=httpx2.Request("POST", MESSAGES_URL), json=body)
    return error_class("test", response=response, body=body)


def timeout_error() -> anthropic.APITimeoutError:
    """The error the SDK raises when the API has not answered within the client's timeout."""
    return anthropic.APITimeoutError(request=httpx2.Request("POST", MESSAGES_URL))


def refusal() -> Message:
    """A reply the model's safety classifiers stopped: HTTP 200 with stop_reason "refusal"."""
    details = RefusalStopDetails(type="refusal", category="general_harms", explanation=None)
    first, second = offered_ids()[:2]
    return reply(tips_json((first, "Fine."), (second, "Fine.")), "refusal", stop_details=details)


class FakeMessages:
    """Stands in for client.messages: answers create() with a scripted reply or error."""

    def __init__(self, outcome: Message | Exception) -> None:
        self.outcome = outcome
        self.requests: list[dict[str, Any]] = []

    async def create(self, **request: Any) -> Message:
        self.requests.append(request)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class FakeAnthropic:
    """Stands in for anthropic.AsyncAnthropic and records every request it is sent."""

    def __init__(self, outcome: Message | Exception) -> None:
        self.messages = FakeMessages(outcome)


def builds(fake: FakeAnthropic, calls: list[dict[str, Any]]) -> Callable[..., FakeAnthropic]:
    """A stand-in for the AsyncAnthropic constructor: records its options and returns `fake`."""

    def build(**options: Any) -> FakeAnthropic:
        calls.append(options)
        return fake

    return build


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The app with no API key in the environment and no client built yet, reset afterwards."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    coach.client_for_key.cache_clear()
    yield TestClient(app_module.app)
    app_module.app.dependency_overrides.clear()
    coach.client_for_key.cache_clear()


def install_model(outcome: Message | Exception) -> FakeAnthropic:
    """Hand the route a fake client, through its advice_client dependency."""
    fake = FakeAnthropic(outcome)
    app_module.app.dependency_overrides[app_module.advice_client] = lambda: fake
    return fake


def ask(client: TestClient, **changes: object) -> dict[str, Any]:
    """POST the uniforms take's request, changed by `changes`, and return the 200 answer."""
    response = client.post("/api/advice", json=advice_body(**changes))
    assert response.status_code == 200, response.text
    return response.json()


def prompt_of(fake: FakeAnthropic) -> str:
    """The user turn of the one request the fake was sent."""
    [request] = fake.messages.requests
    [message] = request["messages"]
    return message["content"]


# --- tips the model writes -----------------------------------------------------------------------


def test_the_model_tips_are_shown_with_their_entry_drill_and_citation(client: TestClient) -> None:
    first, second = offered_ids()[:2]
    install_model(
        tips_reply(
            (first, "You restarted once. Pause before the clause instead of saying it twice."),
            (second, "You ran at the top of your band. Let the key lines land."),
        )
    )

    body = ask(client)

    assert body == {
        "headline": None,
        "tips": [
            cited(first, "You restarted once. Pause before the clause instead of saying it twice."),
            cited(second, "You ran at the top of your band. Let the key lines land."),
        ],
        "source": "ai",
    }


def test_three_tips_are_kept(client: TestClient) -> None:
    first_three = offered_ids()[:3]
    install_model(tips_reply(*[(entry_id, "You can fix this.") for entry_id in first_three]))

    body = ask(client)

    assert body["source"] == "ai"
    assert [tip["entry_id"] for tip in body["tips"]] == first_three


def test_the_tips_may_draw_on_any_candidate_in_any_order(client: TestClient) -> None:
    offered = offered_ids()
    install_model(tips_reply((offered[-1], "You can fix this."), (offered[0], "And this.")))

    body = ask(client)

    assert body["source"] == "ai"
    assert [tip["entry_id"] for tip in body["tips"]] == [offered[-1], offered[0]]


def test_a_tip_of_60_words_is_kept_without_its_surrounding_spaces(client: TestClient) -> None:
    first, second = offered_ids()[:2]
    install_model(tips_reply((first, f"  {words(60)}\n"), (second, "Slow down.")))

    body = ask(client)

    assert body["source"] == "ai"
    assert [tip["text"] for tip in body["tips"]] == [words(60), "Slow down."]


# --- what the model is asked ---------------------------------------------------------------------


def test_the_model_is_claude_haiku_at_low_effort_with_the_tips_schema(client: TestClient) -> None:
    fake = install_model(good_reply())

    ask(client)

    [request] = fake.messages.requests
    assert request["model"] == "claude-haiku-5-5"
    assert request["output_config"] == {
        "effort": "low",
        "format": {"type": "json_schema", "schema": coach.TIPS_SCHEMA},
    }
    # Claude Haiku 5.5 refuses sampling settings and a prefilled reply: the request has neither.
    assert set(request) == {"model", "max_tokens", "system", "messages", "output_config"}
    assert [message["role"] for message in request["messages"]] == ["user"]
    # Room for the thinking Haiku 5.5 does by default, not only the ~300 tokens of the tips.
    assert request["max_tokens"] >= 1024


def test_the_schema_asks_for_tips_of_an_entry_id_and_a_text_and_nothing_more() -> None:
    schema = coach.TIPS_SCHEMA
    tips = schema["properties"]["tips"]
    tip = tips["items"]

    assert (schema["type"], schema["required"], schema["additionalProperties"]) == (
        "object", ["tips"], False,
    )
    assert set(schema["properties"]) == {"tips"}
    assert tips["type"] == "array"
    assert (tip["type"], tip["required"], tip["additionalProperties"]) == (
        "object", ["entry_id", "text"], False,
    )
    assert {name: field["type"] for name, field in tip["properties"].items()} == {
        "entry_id": "string",
        "text": "string",
    }


def test_the_schema_uses_only_what_structured_outputs_accept() -> None:
    def keywords(node: object) -> list[tuple[str, object]]:
        if isinstance(node, dict):
            found = list(node.items())
            for value in node.values():
                found += keywords(value)
            return found
        if isinstance(node, list):
            return [pair for item in node for pair in keywords(item)]
        return []

    used = keywords(coach.TIPS_SCHEMA)

    assert not {key for key, _ in used} & UNSUPPORTED_SCHEMA_KEYWORDS
    assert all(value in (0, 1) for key, value in used if key == "minItems")


def test_the_system_prompt_holds_the_coaching_rules(client: TestClient) -> None:
    fake = install_model(good_reply())

    ask(client)

    [request] = fake.messages.requests
    assert request["system"] == coach.SYSTEM_PROMPT
    rules = coach.SYSTEM_PROMPT.lower()
    assert '"you"' in rules  # the speaker is addressed as "you"
    assert "only" in rules and "facts" in rules  # only the given entries and numbers
    assert "source" in rules  # no sources in the text: the app cites them
    assert "60 words" in rules


def test_the_prompt_holds_the_excerpt_and_every_candidate_entry(client: TestClient) -> None:
    fake = install_model(good_reply())

    ask(client)

    prompt = prompt_of(fake)
    assert EXCERPT in prompt
    assert EXCERPT not in coach.SYSTEM_PROMPT
    for entry_id in offered_ids():
        assert entry_id in prompt
        assert LIBRARY[entry_id].advice in prompt


def test_the_prompt_holds_the_take_numbers(client: TestClient) -> None:
    # Numbers chosen to stand out. One could also appear in an entry's advice, which would let
    # this test pass for the wrong reason, never fail for one.
    numbers = {
        "duration_seconds": 83.0,
        "words_per_minute": 171.0,
        "filler_count": 23,
        "restart_count": 19,
        "mid_sentence_pause_count": 17,
        "long_pause_count": 14,
        "target_wpm": [133, 157],
    }
    fake = install_model(reply("{}"))

    ask(client, summary=summary_with(**numbers))

    prompt = prompt_of(fake)
    for number in ("83", "171", "23", "19", "17", "14", "133", "157"):
        assert re.search(rf"\b{number}\b", prompt), number


def test_an_excerpt_of_1500_characters_reaches_the_model_whole(client: TestClient) -> None:
    excerpt = ("I kinda ner— I'm kinda nervous. " * 50)[:1500]
    fake = install_model(good_reply())

    ask(client, summary=summary_with(transcript_excerpt=excerpt))

    assert excerpt in prompt_of(fake)


# --- falling back to the library -----------------------------------------------------------------


@pytest.mark.parametrize("key", [None, "", "   "])
def test_without_an_api_key_no_client_is_built_and_the_library_tips_are_shown(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, key: str | None
) -> None:
    def no_client(**options: Any) -> None:
        raise AssertionError("a client was built without an API key")

    if key is not None:
        monkeypatch.setenv("ANTHROPIC_API_KEY", key)
    monkeypatch.setattr(coach, "AsyncAnthropic", no_client)

    assert ask(client) == library_advice()


def test_library_tips_are_the_first_three_candidates_word_for_word(client: TestClient) -> None:
    body = ask(client)

    first_three = offered_ids()[:3]
    assert body["source"] == "library"
    assert [tip["entry_id"] for tip in body["tips"]] == first_three
    assert [tip["text"] for tip in body["tips"]] == [LIBRARY[i].advice for i in first_three]
    assert [tip["drill"] for tip in body["tips"]] == [LIBRARY[i].drill for i in first_three]


def test_an_invented_entry_id_falls_back_to_the_library(client: TestClient) -> None:
    first = offered_ids()[0]
    install_model(tips_reply((first, "You restarted once."), ("restart-999", "Made up.")))

    assert ask(client) == library_advice()


def test_a_library_entry_that_was_not_offered_falls_back(client: TestClient) -> None:
    offered = offered_ids()
    not_offered = next(entry_id for entry_id in LIBRARY if entry_id not in offered)
    install_model(tips_reply((offered[0], "You restarted once."), (not_offered, "Off topic.")))

    assert ask(client) == library_advice()


def test_two_tips_drawn_from_the_same_entry_fall_back(client: TestClient) -> None:
    first = offered_ids()[0]
    install_model(tips_reply((first, "You restarted once."), (first, "Say it once.")))

    assert ask(client) == library_advice()


@pytest.mark.parametrize("count", [0, 1, 4])
def test_fewer_than_two_or_more_than_three_tips_fall_back(client: TestClient, count: int) -> None:
    tips = [(entry_id, "You can fix this.") for entry_id in offered_ids()[:count]]
    install_model(tips_reply(*tips))

    assert ask(client) == library_advice()


@pytest.mark.parametrize("text", ["", "   \n"])
def test_an_empty_tip_falls_back(client: TestClient, text: str) -> None:
    first, second = offered_ids()[:2]
    install_model(tips_reply((first, "You restarted once."), (second, text)))

    assert ask(client) == library_advice()


def test_a_tip_over_60_words_falls_back(client: TestClient) -> None:
    first, second = offered_ids()[:2]
    install_model(tips_reply((first, "You restarted once."), (second, words(61))))

    assert ask(client) == library_advice()


def broken_replies() -> dict[str, str]:
    """Reply texts that break the schema, by what is wrong; each would hold two good tips."""
    first, second = offered_ids()[:2]
    good = json.loads(tips_json((first, "You restarted once."), (second, "Slow down.")))
    with_citation = json.loads(json.dumps(good))
    with_citation["tips"][0]["citation"] = {"label": "Made Up (2020)", "url": "https://x.example"}
    numeric_id = json.loads(json.dumps(good))
    numeric_id["tips"][1]["entry_id"] = 7
    return {
        "prose, not JSON": "You restarted once, so pause before the clause.",
        "cut off": json.dumps(good)[:-3],
        "a bare list": json.dumps(good["tips"]),
        "the wrong key": json.dumps({"advice": good["tips"]}),
        "a key the schema lacks": json.dumps({**good, "note": "extra"}),
        "a citation from the model": json.dumps(with_citation),
        "an id that is not a string": json.dumps(numeric_id),
    }


BROKEN_REPLIES = broken_replies()


@pytest.mark.parametrize("text", list(BROKEN_REPLIES.values()), ids=list(BROKEN_REPLIES))
def test_a_reply_that_breaks_the_schema_falls_back(client: TestClient, text: str) -> None:
    install_model(reply(text))

    assert ask(client) == library_advice()


def test_a_reply_with_no_text_falls_back(client: TestClient) -> None:
    thinking_only = reply("unused").model_copy(
        update={"content": [ThinkingBlock(type="thinking", thinking="", signature="sig")]}
    )
    install_model(thinking_only)

    assert ask(client) == library_advice()


def test_no_reply_within_the_timeout_falls_back(client: TestClient) -> None:
    install_model(timeout_error())

    assert ask(client) == library_advice()


@pytest.mark.parametrize(
    "error",
    [
        status_error(anthropic.BadRequestError, 400, "invalid_request_error"),
        status_error(anthropic.AuthenticationError, 401, "authentication_error"),
        status_error(anthropic.RateLimitError, 429, "rate_limit_error"),
        status_error(anthropic.InternalServerError, 500, "api_error"),
        status_error(anthropic.OverloadedError, 529, "overloaded_error"),
        anthropic.APIConnectionError(request=httpx2.Request("POST", MESSAGES_URL)),
    ],
    ids=["400", "401", "429", "500", "529", "connection"],
)
def test_an_api_error_falls_back(client: TestClient, error: Exception) -> None:
    install_model(error)

    assert ask(client) == library_advice()


def test_a_refusal_falls_back(client: TestClient) -> None:
    install_model(refusal())

    assert ask(client) == library_advice()


def test_a_reply_cut_off_at_max_tokens_falls_back(client: TestClient) -> None:
    first, second = offered_ids()[:2]
    install_model(reply(tips_json((first, "You restarted."), (second, "Slow.")), "max_tokens"))

    assert ask(client) == library_advice()


# --- citations -----------------------------------------------------------------------------------


def test_every_citation_equals_its_library_entry(client: TestClient) -> None:
    install_model(good_reply())
    model_tips = ask(client)["tips"]
    app_module.app.dependency_overrides.clear()
    library_tips = ask(client)["tips"]

    assert model_tips and library_tips
    for tip in model_tips + library_tips:
        entry = LIBRARY[tip["entry_id"]]
        assert tip["citation"] == {
            "label": citation(entry),
            "url": entry.source.url,
            "type": entry.source.type,
        }
        assert tip["drill"] == entry.drill


def test_a_source_named_in_a_tip_does_not_change_its_citation(client: TestClient) -> None:
    first, second = offered_ids()[:2]
    install_model(
        tips_reply((first, "As Smith (2020) shows, pause."), (second, "See www.example.com."))
    )

    body = ask(client)

    assert body["source"] == "ai"
    assert [tip["citation"] for tip in body["tips"]] == [
        cited(first, "")["citation"], cited(second, "")["citation"],
    ]


# --- advice already shown ------------------------------------------------------------------------


def test_shown_entries_are_not_offered_to_the_model(client: TestClient) -> None:
    shown = offered_ids()[:5]
    fresh = offered_ids(shown)
    fake = install_model(tips_reply((fresh[0], "You restarted once."), (fresh[1], "Slow down.")))

    body = ask(client, shown_ids=shown)

    prompt = prompt_of(fake)
    assert [entry_id for entry_id in shown if entry_id in prompt] == []
    assert body["source"] == "ai"
    assert [tip["entry_id"] for tip in body["tips"]] == fresh[:2]


def test_shown_entries_are_not_among_the_library_tips(client: TestClient) -> None:
    shown = offered_ids()[:5]

    body = ask(client, shown_ids=shown)

    assert body == library_advice(shown)
    assert not {tip["entry_id"] for tip in body["tips"]} & set(shown)


def test_a_tip_drawn_from_a_shown_entry_falls_back(client: TestClient) -> None:
    shown = offered_ids()[:5]
    fresh = offered_ids(shown)
    install_model(tips_reply((shown[0], "Again."), (fresh[0], "Something new.")))

    assert ask(client, shown_ids=shown) == library_advice(shown)


# --- the request ---------------------------------------------------------------------------------


def test_shown_ids_may_be_left_out_on_a_first_take(client: TestClient) -> None:
    body = advice_body()
    del body["shown_ids"]

    response = client.post("/api/advice", json=body)

    assert response.status_code == 200
    assert response.json() == library_advice()


def test_an_excerpt_over_1500_characters_is_refused(client: TestClient) -> None:
    fake = install_model(good_reply())

    response = client.post(
        "/api/advice", json=advice_body(summary=summary_with(transcript_excerpt="a" * 1501))
    )

    assert response.status_code == 422
    assert fake.messages.requests == []


def test_2000_shown_ids_are_accepted_and_2001_refused(client: TestClient) -> None:
    ids = [f"retired-{number:04d}" for number in range(2001)]

    accepted = client.post("/api/advice", json=advice_body(shown_ids=ids[:2000]))
    refused = client.post("/api/advice", json=advice_body(shown_ids=ids))

    assert accepted.status_code == 200
    assert refused.status_code == 422


@pytest.mark.parametrize("tier", [3, None, ["Elite"], {"name": "Elite"}])
def test_a_tier_that_is_not_a_string_is_refused(client: TestClient, tier: object) -> None:
    response = client.post("/api/advice", json=advice_body(tier=tier))

    assert response.status_code == 422


@pytest.mark.parametrize("field", ["session_id", "summary", "tier"])
def test_a_request_without_a_required_field_is_refused(client: TestClient, field: str) -> None:
    body = advice_body()
    del body[field]

    response = client.post("/api/advice", json=body)

    assert response.status_code == 422


@pytest.mark.parametrize(
    "summary",
    [
        summary_with(filler_count=-1),
        summary_with(duration_seconds=-5.0),
        summary_with(restart_count=1.5),
        summary_with(target_wpm=[160, 140]),
        summary_with(target_wpm=[140]),
        {key: value for key, value in summary_with().items() if key != "transcript_excerpt"},
    ],
    ids=[
        "negative count", "negative time", "fractional count", "band upside down",
        "band of one number", "no excerpt",
    ],
)
def test_a_summary_with_impossible_numbers_is_refused(
    client: TestClient, summary: dict[str, Any]
) -> None:
    response = client.post("/api/advice", json=advice_body(summary=summary))

    assert response.status_code == 422


@pytest.mark.parametrize(
    "summary",
    [summary_with(words_per_minute=float("nan")), summary_with(duration_seconds=float("inf"))],
    ids=["NaN pace", "endless take"],
)
def test_a_summary_with_a_number_that_is_not_finite_is_refused(summary: dict[str, Any]) -> None:
    # Checked on the model: JSON.stringify cannot send NaN or Infinity, but Python's JSON parser
    # reads them, and FastAPI's 422 answer cannot hold them.
    with pytest.raises(ValidationError):
        coach.TakeSummary.model_validate(summary)


@pytest.mark.parametrize("session_id", ["", "x" * 101])
def test_a_session_id_that_is_empty_or_over_100_characters_is_refused(
    client: TestClient, session_id: str
) -> None:
    response = client.post("/api/advice", json=advice_body(session_id=session_id))

    assert response.status_code == 422


def test_advice_is_never_stored_by_the_browser(client: TestClient) -> None:
    response = client.post("/api/advice", json=advice_body())

    assert response.headers["cache-control"] == "no-store"


# --- the client and the key ----------------------------------------------------------------------


def test_the_client_uses_the_environment_key_an_8_second_timeout_and_no_retries(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", TEST_KEY)

    built = app_module.advice_client()

    assert isinstance(built, anthropic.AsyncAnthropic)
    assert built.api_key == TEST_KEY
    assert built.timeout == 8.0
    assert built.max_retries == 0


def test_the_route_asks_one_client_built_from_the_environment_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", TEST_KEY)
    fake = FakeAnthropic(good_reply())
    built_with: list[dict[str, Any]] = []
    monkeypatch.setattr(coach, "AsyncAnthropic", builds(fake, built_with))

    first = ask(client)
    second = ask(client)

    assert first["source"] == second["source"] == "ai"
    assert built_with == [{"api_key": TEST_KEY, "timeout": 8.0, "max_retries": 0}]
    assert len(fake.messages.requests) == 2


def test_fallbacks_are_logged_without_the_key_or_the_transcript(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", TEST_KEY)
    # A reply that quotes the transcript and invents an id: logging it would leak the transcript.
    echo = tips_reply((offered_ids()[0], EXCERPT), ("made-up-id", EXCERPT))
    outcomes = [
        timeout_error(),
        status_error(anthropic.OverloadedError, 529, "overloaded_error"),
        refusal(),
        echo,
    ]
    caplog.set_level(logging.DEBUG)

    for outcome in outcomes:
        coach.client_for_key.cache_clear()
        monkeypatch.setattr(coach, "AsyncAnthropic", builds(FakeAnthropic(outcome), []))
        assert ask(client)["source"] == "library"

    warnings = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert len(warnings) == len(outcomes)
    assert TEST_KEY not in caplog.text
    assert TRANSCRIPT_MARKER not in caplog.text


# --- small libraries -----------------------------------------------------------------------------


def restart_entry(entry_id: str) -> AdviceEntry:
    """A made-up beginner entry on restarts, the uniforms take's weakest skill."""
    source = Source(
        author="Jordan Lee",
        credentials="",
        title="Pausing on Purpose",
        publisher="Speaking Coaches Quarterly",
        year=2019,
        url="https://example.org/pausing-on-purpose",
        type="coach",
    )
    return AdviceEntry(
        id=entry_id,
        advice="Stop, breathe, and pick up the sentence where it broke.",
        quote="",
        drill="Read a paragraph aloud and pause instead of repeating.",
        targets=("restart",),
        level="beginner",
        source=source,
    )


def advise(library: list[AdviceEntry], fake: FakeAnthropic) -> coach.Advice:
    """coach.advise() for the uniforms take, run against `library`."""
    request = coach.AdviceRequest.model_validate(advice_body())
    return asyncio.run(coach.advise(request, library, fake))


def test_with_one_candidate_the_model_is_not_asked() -> None:
    fake = FakeAnthropic(tips_reply(("restart-only", "You restarted."), ("other", "Other.")))

    advice = advise([restart_entry("restart-only")], fake)

    assert advice.source == "library"
    assert [tip.entry_id for tip in advice.tips] == ["restart-only"]
    assert fake.messages.requests == []


def test_with_no_candidates_there_are_no_tips() -> None:
    fake = FakeAnthropic(good_reply())

    advice = advise([], fake)

    assert advice.model_dump() == {"headline": None, "tips": [], "source": "library"}
    assert fake.messages.requests == []


def test_two_candidates_are_enough_to_ask_the_model() -> None:
    fake = FakeAnthropic(tips_reply(("restart-a", "You restarted."), ("restart-b", "Breathe.")))

    advice = advise([restart_entry("restart-a"), restart_entry("restart-b")], fake)

    assert advice.source == "ai"
    assert [tip.text for tip in advice.tips] == ["You restarted.", "Breathe."]
    assert [tip.drill for tip in advice.tips] == [restart_entry("x").drill] * 2
