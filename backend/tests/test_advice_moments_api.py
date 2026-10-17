"""POST /api/advice with the take's moments: tips that point at real moments (spec Phase 3).

With moments the model is sent MOMENTS_SYSTEM_PROMPT and MOMENT_TIPS_SCHEMA, and its reply is
used only when it keeps every rule the notes always kept and these too: a headline of 1 to 25
words and 200 characters at most, naming a listed moment and quoting it; each tip naming 1 to 3
listed moments, none twice, and its text quoting one of them by its clock time or by one of its
words of 3 letters or more (a word as common as "the" does not count). Any broken rule shows the
library tips instead, with no headline, each tip pointing at the take's moments of the skills
its entry helps with (MOMENT_KIND_TARGETS). The answer always has the keys headline, tips and
source; without moments the headline is null and every tip's moment_ids is empty.

The Anthropic client is a fake; no test opens a socket. Expected tips are worked out from the
real library with candidates(), so the tests hold whatever the owner edits in library.json.
"""

import json
import logging
from collections.abc import Iterator
from typing import Any

import anthropic
import httpx2
import pytest
from anthropic.types import Message, TextBlock, ThinkingBlock, Usage
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.advice import citation, coach, load_library
from backend.advice.budget import AICallBudget
from backend.advice.select import ReportSummary, candidates, weakest_skills

TAKE_ID = "8b1f6c2e-take-one"
TIER = "Contender"
UNIFORMS_NUMBERS: ReportSummary = {
    "duration_seconds": 42.882,
    "words_per_minute": 159.5,
    "filler_count": 2,
    "restart_count": 1,
    "mid_sentence_pause_count": 1,
    "long_pause_count": 1,
    "target_wpm": [140, 160],
}
EXCERPT = (
    "Consider what we lose. Choosing how to present yourself is one of the few decisions a "
    "day— uh, the few decisions a student makes every day. Taking that away teaches "
    "compliance, not confidence."
)
# A log line holding this has leaked a moment's words.
MOMENT_MARKER = "presentable"
LIBRARY = {entry.id: entry for entry in load_library()}
MESSAGES_URL = "https://api.anthropic.com/v1/messages"


def moment(moment_id: str, clock: str, text: str, **fields: object) -> dict[str, Any]:
    kind = moment_id.rsplit("-", 1)[0]
    minutes, seconds = clock.split(":")
    return {
        "id": moment_id,
        "kind": kind,
        "at": int(minutes) * 60 + int(seconds) + 0.3,
        "clock": clock,
        "text": text,
        "before": "",
        "after": "",
        **fields,
    }


# The take's moments, in the order they happened.
MOMENTS = [
    moment("pause-1", "0:04", "", seconds=1.4, before="Consider", after="what we lose"),
    moment("filler-1", "0:21", "uh", before="decisions a day—", after="the few"),
    moment("restart-1", "0:21", "a day— uh, the few", before="one of the few decisions",
           after="decisions a student makes"),
    moment("long-pause-1", "0:30", "", seconds=5.6, before="every day.", after="Taking"),
    moment("unclear-1", "0:38", MOMENT_MARKER, before="teaches", after="not", hint=True),
]
KNOWN_IDS = [entry["id"] for entry in MOMENTS]


def advice_body(**changes: object) -> dict[str, Any]:
    return {
        "session_id": TAKE_ID,
        "summary": {**UNIFORMS_NUMBERS, "transcript_excerpt": EXCERPT},
        "tier": TIER,
        "shown_ids": [],
        "moments": MOMENTS,
        **changes,
    }


def offered_ids() -> list[str]:
    offered = candidates(
        list(LIBRARY.values()), weakest_skills(UNIFORMS_NUMBERS), TIER, [], session_id=TAKE_ID
    )
    return [entry.id for entry in offered]


def library_moment_ids(entry_id: str, moments: list[dict[str, Any]]) -> list[str]:
    """The take's moments of the skills an entry helps with, in take order, at most three."""
    targets = LIBRARY[entry_id].targets
    return [
        entry["id"]
        for entry in moments
        if coach.MOMENT_KIND_TARGETS.get(entry["kind"]) in targets
    ][:3]


def cited(entry_id: str, text: str, moment_ids: list[str]) -> dict[str, Any]:
    entry = LIBRARY[entry_id]
    return {
        "entry_id": entry_id,
        "text": text,
        "drill": entry.drill,
        "citation": {"label": citation(entry), "url": entry.source.url, "type": entry.source.type},
        "moment_ids": moment_ids,
    }


def library_advice(moments: list[dict[str, Any]] | None = MOMENTS) -> dict[str, Any]:
    first_three = offered_ids()[:3]
    return {
        "headline": None,
        "tips": [
            cited(entry_id, LIBRARY[entry_id].advice, library_moment_ids(entry_id, moments or []))
            for entry_id in first_three
        ],
        "source": "library",
    }


# --- the fake model ------------------------------------------------------------------------------


def reply(text: str, stop_reason: str = "end_turn") -> Message:
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
    )


HEADLINE = {"text": 'At 0:21 you said "the few" twice: pause instead next take.', "moment_id":
            "restart-1"}
FIRST_TIP = 'At 0:21 you restarted on "the few". Stop, breathe and go on from where it broke.'
SECOND_TIP = "Your 5-second stop at 0:30 broke the flow. Breathe at the period and keep going."


def moment_reply(
    headline: object = None, tips: list[tuple[str, str, list[str]]] | None = None
) -> Message:
    """A reply in the moments schema: the headline, then (entry_id, text, moment_ids) tips."""
    first, second = offered_ids()[:2]
    if tips is None:
        tips = [(first, FIRST_TIP, ["restart-1"]), (second, SECOND_TIP, ["long-pause-1"])]
    body = {
        "headline": HEADLINE if headline is None else headline,
        "tips": [
            {"entry_id": entry_id, "text": text, "moment_ids": ids} for entry_id, text, ids in tips
        ],
    }
    return reply(json.dumps(body))


def with_tip(text: str, moment_ids: list[str]) -> Message:
    """The good reply with its first tip replaced."""
    first, second = offered_ids()[:2]
    return moment_reply(tips=[(first, text, moment_ids), (second, SECOND_TIP, ["long-pause-1"])])


class FakeMessages:
    def __init__(self, outcome: Message | Exception) -> None:
        self.outcome = outcome
        self.requests: list[dict[str, Any]] = []

    async def create(self, **request: Any) -> Message:
        self.requests.append(request)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class FakeAnthropic:
    def __init__(self, outcome: Message | Exception) -> None:
        self.messages = FakeMessages(outcome)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    coach.client_for_key.cache_clear()
    app_module.app.dependency_overrides[app_module.advice_call_budget] = lambda: AICallBudget()
    yield TestClient(app_module.app)
    app_module.app.dependency_overrides.clear()
    coach.client_for_key.cache_clear()


def install_model(outcome: Message | Exception) -> FakeAnthropic:
    fake = FakeAnthropic(outcome)
    app_module.app.dependency_overrides[app_module.advice_client] = lambda: fake
    return fake


def ask(client: TestClient, **changes: object) -> dict[str, Any]:
    response = client.post("/api/advice", json=advice_body(**changes))
    assert response.status_code == 200, response.text
    return response.json()


# --- the happy path ------------------------------------------------------------------------------


def test_tips_that_quote_their_moments_are_shown_with_the_headline(client: TestClient) -> None:
    first, second = offered_ids()[:2]
    install_model(moment_reply())

    body = ask(client)

    assert body == {
        "headline": HEADLINE,
        "tips": [
            cited(first, FIRST_TIP, ["restart-1"]),
            cited(second, SECOND_TIP, ["long-pause-1"]),
        ],
        "source": "ai",
    }


def test_with_moments_the_model_gets_the_moments_prompt_schema_and_block(
    client: TestClient,
) -> None:
    fake = install_model(moment_reply())

    ask(client)

    [request] = fake.messages.requests
    assert request["system"] == coach.MOMENTS_SYSTEM_PROMPT
    assert request["output_config"] == {
        "effort": "low",
        "format": {"type": "json_schema", "schema": coach.MOMENT_TIPS_SCHEMA},
    }
    assert set(request) == {"model", "max_tokens", "system", "messages", "output_config"}
    prompt = request["messages"][0]["content"]
    assert prompt.count("<moments>") == 1
    for moment_id in KNOWN_IDS:
        assert f"[{moment_id}]" in prompt


@pytest.mark.parametrize(
    ("text", "moment_ids"),
    [
        ("At 0:21 the line broke. Stop, breathe and go on from there.", ["restart-1"]),
        ('You said "THE FEW" twice. Stop, breathe and go on.', ["restart-1"]),
        ("You said Few, then few again. Stop and breathe.", ["restart-1"]),
        ("Twice you broke a line: at 0:21, and once more. Breathe.", ["filler-1", "restart-1"]),
        ("The word presentable may not have come through clearly.", ["unclear-1"]),
        ("At 0:04 you stopped mid-line. Breathe at the period.", ["pause-1", "long-pause-1"]),
    ],
    ids=[
        "the clock alone", "a quoted word in capitals", "a word with punctuation",
        "the clock of one of two moments", "the words of a hint", "one of two pauses by clock",
    ],
)
def test_a_tip_may_quote_a_cited_moment_by_its_clock_or_a_word(
    client: TestClient, text: str, moment_ids: list[str]
) -> None:
    install_model(with_tip(text, moment_ids))

    body = ask(client)

    assert body["source"] == "ai"
    assert body["tips"][0]["moment_ids"] == moment_ids
    assert body["tips"][0]["text"] == text


@pytest.mark.parametrize(
    ("text", "moment_ids"),
    [
        ('That "uh" broke the line. Pause silently instead.', ["filler-1"]),
        ("You said UH, then went on. Pause silently instead.", ["filler-1"]),
    ],
    ids=["a quoted filler", "a filler in capitals with punctuation"],
)
def test_a_tip_may_quote_a_short_moment_by_its_whole_text(
    client: TestClient, text: str, moment_ids: list[str]
) -> None:
    install_model(with_tip(text, moment_ids))

    body = ask(client)

    assert body["source"] == "ai"
    assert body["tips"][0]["text"] == text


def test_a_short_restart_is_quoted_by_its_whole_text_in_order() -> None:
    i_i = coach.Moment.model_validate(moment("restart-2", "0:09", "I I"))
    and_the = coach.Moment.model_validate(moment("restart-3", "0:14", "and the, and the"))

    assert coach.quotes_moment('You said "I I" before the verb.', i_i)
    assert coach.quotes_moment('You said "and the and the" there.', and_the)
    assert not coach.quotes_moment("I think you can breathe first.", i_i)
    assert not coach.quotes_moment("Breathe and the line lands.", and_the)


def test_a_headline_may_quote_a_filler_by_its_word() -> None:
    um = coach.Moment.model_validate(moment("filler-2", "0:15", "um"))

    assert coach.quotes_moment('Your "um" broke the line: pause silently next take.', um)


def test_a_headline_quoting_um_is_kept(client: TestClient) -> None:
    moments = [*MOMENTS, moment("filler-2", "0:15", "um", before="So", after="we")]
    headline = {"text": 'Your "um" broke the line: pause silently next take.', "moment_id": "filler-2"}
    install_model(moment_reply(headline))

    body = ask(client, moments=moments)

    assert body["source"] == "ai"
    assert body["headline"] == headline


@pytest.mark.parametrize(
    ("text", "moment_text"),
    [
        ("Take an umbrella of calm into the line.", "um"),
        ("Hum the line first, then say it.", "um"),
        ("Say the line once, then breathe.", "the"),
        ("You said and, then the rest.", "and the, and the"),
    ],
    ids=[
        "um inside umbrella", "um inside hum", "a lone common word",
        "the words of a short restart out of order",
    ],
)
def test_a_short_text_counts_only_as_whole_words_in_order(text: str, moment_text: str) -> None:
    short = coach.Moment.model_validate(moment("filler-3", "0:44", moment_text))

    assert not coach.quotes_moment(text, short)


def test_the_headline_and_tip_texts_are_trimmed(client: TestClient) -> None:
    headline = {"text": f"  {HEADLINE['text']}\n", "moment_id": "restart-1"}
    first, second = offered_ids()[:2]
    install_model(
        moment_reply(
            headline,
            [(first, f" {FIRST_TIP} ", ["restart-1"]), (second, SECOND_TIP, ["long-pause-1"])],
        )
    )

    body = ask(client)

    assert body["headline"] == HEADLINE
    assert body["tips"][0]["text"] == FIRST_TIP


# --- replies that break a moment rule ------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "moment_ids"),
    [
        (FIRST_TIP, ["restart-7"]),
        (FIRST_TIP, ["restart-1", "debate-1"]),
        (FIRST_TIP, []),
        (FIRST_TIP, ["restart-1", "filler-1", "pause-1", "long-pause-1"]),
        (FIRST_TIP, ["restart-1", "restart-1"]),
    ],
    ids=["an invented id", "one known and one invented", "no moment", "four moments", "one twice"],
)
def test_a_tip_that_names_its_moments_wrongly_falls_back(
    client: TestClient, text: str, moment_ids: list[str]
) -> None:
    install_model(with_tip(text, moment_ids))

    assert ask(client) == library_advice()


@pytest.mark.parametrize(
    ("text", "moment_ids"),
    [
        ("Stop, breathe and go on from where the sentence broke.", ["restart-1"]),
        ("At 0:30 you stopped. Breathe and go on.", ["restart-1"]),
        ("You said presentable softly. Breathe and go on.", ["restart-1"]),
        ("At 10:21 the line broke. Breathe and go on.", ["restart-1"]),
        ("At 0:211 the line broke. Breathe and go on.", ["restart-1"]),
        ("You said the same thing again. Breathe and go on.", ["restart-1"]),
        ("You said um there. Breathe and go on.", ["filler-1"]),
        ("You were fewer than you think. Breathe and go on.", ["restart-1"]),
    ],
    ids=[
        "quotes nothing", "another moment's clock", "another moment's word",
        "a clock that only ends with the moment's", "a clock that only starts with it",
        "only a common word", "another short filler", "a word that only starts with one",
    ],
)
def test_a_tip_that_does_not_quote_a_moment_it_names_falls_back(
    client: TestClient, text: str, moment_ids: list[str]
) -> None:
    install_model(with_tip(text, moment_ids))

    assert ask(client) == library_advice()


@pytest.mark.parametrize(
    "headline",
    [
        {"text": "", "moment_id": "restart-1"},
        {"text": "  \n", "moment_id": "restart-1"},
        {"text": "At 0:21 " + "breathe " * 24, "moment_id": "restart-1"},
        {"text": "At 0:21 " + "b" * 193, "moment_id": "restart-1"},
        {"text": HEADLINE["text"], "moment_id": "restart-9"},
        {"text": HEADLINE["text"], "moment_id": "long-pause-1"},
        {"text": "Slow down and breathe next take.", "moment_id": "restart-1"},
        {"text": "...", "moment_id": "pause-1"},
    ],
    ids=[
        "empty", "blank", "26 words", "201 characters", "an invented moment",
        "quoting another moment", "quoting no moment", "no letter or digit",
    ],
)
def test_a_bad_headline_falls_back(client: TestClient, headline: dict[str, str]) -> None:
    install_model(moment_reply(headline))

    assert ask(client) == library_advice()


def test_a_headline_of_25_words_and_200_characters_is_kept(client: TestClient) -> None:
    text = "At 0:21 " + " ".join(["breathe"] * 23)
    text = text + "x" * (200 - len(text))
    install_model(moment_reply({"text": text, "moment_id": "restart-1"}))

    body = ask(client)

    assert (len(text.split()), len(text)) == (25, 200)
    assert body["headline"] == {"text": text, "moment_id": "restart-1"}


@pytest.mark.parametrize(
    "body",
    [
        {"tips": [{"entry_id": "x", "text": "At 0:21."}]},
        {"headline": None, "tips": []},
        {"headline": {"text": "At 0:21.", "moment_id": "restart-1", "extra": 1}, "tips": []},
        {"headline": {"text": "At 0:21.", "moment_id": "restart-1"},
         "tips": [{"entry_id": "x", "text": "At 0:21."}]},
        {"headline": {"text": "At 0:21.", "moment_id": "restart-1"},
         "tips": [{"entry_id": "x", "text": "At 0:21.", "moment_ids": "restart-1"}]},
        {"headline": {"text": "At 0:21.", "moment_id": 3}, "tips": []},
    ],
    ids=[
        "the old shape", "a null headline", "a key the headline lacks", "no moment ids",
        "moment ids not a list", "a moment id not a string",
    ],
)
def test_a_reply_that_breaks_the_moments_schema_falls_back(
    client: TestClient, body: dict[str, Any]
) -> None:
    install_model(reply(json.dumps(body)))

    assert ask(client) == library_advice()


def test_the_old_rules_still_hold_with_moments(client: TestClient) -> None:
    first = offered_ids()[0]
    install_model(
        moment_reply(tips=[(first, FIRST_TIP, ["restart-1"]), (first, SECOND_TIP, ["pause-1"])])
    )

    assert ask(client) == library_advice()


# --- the library tips with moments ---------------------------------------------------------------


def test_the_kinds_map_to_library_skills_the_library_has() -> None:
    library_targets = {target for entry in LIBRARY.values() for target in entry.targets}

    assert coach.MOMENT_KIND_TARGETS == {
        "restart": "restart",
        "filler": "filler",
        "pause": "mid_pause",
        "long-pause": "long_pause",
    }
    assert set(coach.MOMENT_KIND_TARGETS.values()) <= library_targets


def test_without_a_key_the_library_tips_point_at_the_moments_of_their_skills(
    client: TestClient,
) -> None:
    body = ask(client)

    assert body == library_advice()
    # This take is coached on its long pause first: its best entry points at that pause.
    assert LIBRARY[body["tips"][0]["entry_id"]].targets == ("long_pause",)
    assert body["tips"][0]["moment_ids"] == ["long-pause-1"]
    assert body["headline"] is None


def test_a_library_tip_points_at_three_moments_at_most_in_take_order(client: TestClient) -> None:
    restarts = [
        moment(f"restart-{number}", f"0:{10 + number}", f"word{number} again")
        for number in range(1, 6)
    ]

    body = ask(client, moments=restarts)

    on_restarts = [tip for tip in body["tips"] if "restart" in LIBRARY[tip["entry_id"]].targets]
    assert on_restarts
    for tip in on_restarts:
        assert tip["moment_ids"] == ["restart-1", "restart-2", "restart-3"]


def test_misreads_skips_stumbles_and_unclear_words_map_to_no_library_skill(
    client: TestClient,
) -> None:
    guesses = [
        moment("misread-1", "0:05", "fourty", expected="forty"),
        moment("skip-1", "0:08", "every"),
        moment("stumble-1", "0:12", "decisions", hint=True),
        moment("unclear-1", "0:15", "compliance", hint=True),
    ]

    body = ask(client, moments=guesses)

    assert [tip["moment_ids"] for tip in body["tips"]] == [[], [], []]


@pytest.mark.parametrize(
    "outcome",
    [
        anthropic.APITimeoutError(request=httpx2.Request("POST", MESSAGES_URL)),
        TimeoutError(),
        anthropic.APIConnectionError(request=httpx2.Request("POST", MESSAGES_URL)),
        reply("{}", "max_tokens"),
    ],
    ids=["SDK timeout", "deadline", "connection", "cut off"],
)
def test_a_failed_call_with_moments_shows_the_library_tips_with_their_moments(
    client: TestClient, outcome: Message | Exception
) -> None:
    install_model(outcome)

    assert ask(client) == library_advice()


def test_a_spent_budget_with_moments_shows_the_library_tips_with_their_moments(
    client: TestClient,
) -> None:
    spent = AICallBudget(calls_per_window=0)
    app_module.app.dependency_overrides[app_module.advice_call_budget] = lambda: spent
    fake = install_model(moment_reply())

    assert ask(client) == library_advice()
    assert fake.messages.requests == []


def test_citations_equal_the_library_with_moments_from_the_model_or_the_library(
    client: TestClient,
) -> None:
    install_model(moment_reply())
    model_tips = ask(client)["tips"]
    app_module.app.dependency_overrides.pop(app_module.advice_client)
    library_tips = ask(client)["tips"]

    assert model_tips and library_tips
    for tip in model_tips + library_tips:
        entry = LIBRARY[tip["entry_id"]]
        assert tip["citation"] == {
            "label": citation(entry), "url": entry.source.url, "type": entry.source.type,
        }
        assert tip["drill"] == entry.drill


def test_fallbacks_with_moments_log_the_reason_but_never_a_moment(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    quoting_an_unknown = moment_reply({"text": f"At 0:38 {MOMENT_MARKER}.", "moment_id": "x-1"})
    for outcome in (quoting_an_unknown, with_tip(f"You said {MOMENT_MARKER}.", ["restart-1"])):
        install_model(outcome)
        assert ask(client)["source"] == "library"

    warnings = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert len(warnings) == 2
    assert MOMENT_MARKER not in caplog.text
    assert "a.day" not in caplog.text and "the few" not in caplog.text


# --- requests without moments --------------------------------------------------------------------


def old_reply() -> Message:
    first, second = offered_ids()[:2]
    tips = [{"entry_id": first, "text": "Pause."}, {"entry_id": second, "text": "Slow down."}]
    return reply(json.dumps({"tips": tips}))


@pytest.mark.parametrize("moments", [None, []], ids=["none sent", "an empty list"])
def test_without_moments_the_model_gets_the_old_prompt_and_the_answer_has_the_new_keys(
    client: TestClient, moments: list[Any] | None
) -> None:
    first, second = offered_ids()[:2]
    fake = install_model(old_reply())
    body = advice_body(moments=moments)
    if moments is None:
        del body["moments"]

    response = client.post("/api/advice", json=body)

    assert response.status_code == 200
    assert response.json() == {
        "headline": None,
        "tips": [cited(first, "Pause.", []), cited(second, "Slow down.", [])],
        "source": "ai",
    }
    [request] = fake.messages.requests
    assert request["system"] == coach.SYSTEM_PROMPT
    assert request["output_config"]["format"]["schema"] == coach.TIPS_SCHEMA
    assert "<moments>" not in request["messages"][0]["content"]


def test_without_moments_the_library_tips_have_the_new_keys(client: TestClient) -> None:
    body = advice_body()
    del body["moments"]

    response = client.post("/api/advice", json=body)

    assert response.json() == library_advice(None)
    assert all(tip["moment_ids"] == [] for tip in response.json()["tips"])


def test_without_moments_a_reply_in_the_moments_shape_falls_back(client: TestClient) -> None:
    install_model(moment_reply())

    assert ask(client, moments=[]) == library_advice([])
