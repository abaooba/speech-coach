"""Coach notes never draw on advice written for debate (backend/advice/select.py).

Speech Coach is for non-native speakers and anyone who wants to speak more fluidly and sound
more articulate; it is not a debate tool (the owner's rule, 2026-10-14). is_debate_specific()
reads every text of a library entry against a documented word list, DEBATE_WORDS, and
candidates() leaves such entries out under every rule, so neither the model's notes nor the
library's own words can draw on one, whatever the speaker has been shown. library.json keeps
them (the frontend's Path cites it word for word), so these tests read the real library.
"""

import asyncio
import dataclasses
import re
from collections import Counter
from collections.abc import Iterator
from itertools import permutations
from typing import Any

import anthropic
import httpx2
import pytest
from anthropic.types import Message, TextBlock, Usage
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.advice import AdviceEntry, coach, load_library
from backend.advice.budget import AICallBudget
from backend.advice.select import (
    DEFAULT_TARGET_WPM,
    MEASURED_SKILLS,
    TIERS,
    candidates,
    is_debate_specific,
    mentions_debate,
    weakest_skills,
)

LIBRARY = load_library()
BY_ID = {entry.id: entry for entry in LIBRARY}
DEBATE_IDS = [entry.id for entry in LIBRARY if is_debate_specific(entry)]
OTHER_IDS = [entry.id for entry in LIBRARY if not is_debate_specific(entry)]

TAKE_ID = "take-for-everyday-speech"
EVERYDAY_EXCERPT = "Last weekend I visited my grandmother and we cooked her favourite soup."
# Every tier a request may name, and one it may not (read as Novice).
TIER_NAMES = (*TIERS, "Grandmaster")
# Each skill is made the take's weakest against the default band and a passage's own band.
BANDS = {"the default band": None, "a slow band": (100.0, 120.0), "a fast band": (170.0, 190.0)}
COUNT_FIELDS = {
    "restart": "restart_count",
    "filler": "filler_count",
    "mid_pause": "mid_sentence_pause_count",
    "long_pause": "long_pause_count",
}
# What a speaker may have been shown, oldest first. With every other entry shown, the debate
# entries are the only new ones (rules 1 and 2 of candidates() would offer them); shown before
# this rule existed, they are the least recently shown, which rule 3 would bring back first.
SHOWN = {
    "nothing shown": [],
    "every other entry shown": OTHER_IDS,
    "every entry shown, debate ones longest ago": DEBATE_IDS + OTHER_IDS,
}
# As test_advice_library.py asks of the whole library: a speaker stuck on one skill is shown 2-3
# new tips a take, so each measured skill needs enough entries to last many takes.
MIN_ENTRIES_PER_MEASURED_TAG = 50

# Real entries written for debate, each with the words that give it away.
DEBATE_ENTRIES = {
    "pace-076": "advice: 'In debate, a slow speaker usually has a preparation problem'",
    "pace-036": "advice: 'Judges often complain about debaters', 'lay judges'",
    "filler-047": "advice: 'In cross-examination or Q&A'",
    "restart-023": "advice: 'Some judges keep a tally', a contest's judges",
    "long-074": "advice: 'expect more blocks in front of judges'",
    "pause-062": "advice: 'Recitation judges reward pauses'",
    "pace-069": "advice: 'such as parents or adult judges'",
    "pace-094": "advice: 'notice how fast your audience or judge talks'",
    "pace-077": "advice: 'far too fast for judges'; title: 'Parliamentary Debate guide'",
    "long-025": "drill: 'Have a partner ask tough cross-ex or Q&A questions'",
    "long-037": "drill: 'Ten minutes before your round'",
    "general-007": "drill: 'Ask a practice judge'; publisher: the NSDA",
    "restart-024": "title: 'LD Rebuttals as Speeches'",
    "restart-062": "title: 'Congressional Debate Practice Drills'",
    "filler-023": "publisher: 'National Speech & Debate Association'",
    "pause-063": "publisher: 'National Forensic League archive'",
    "filler-080": "credentials: 'NSDA Policy and Lincoln-Douglas debater'",
    "restart-060": "credentials: 'Director of Debate'; url: uvm.edu/~debate",
}
# Real entries for everyday speaking, some of them using "judge" or "round" in its everyday sense.
EVERYDAY_ENTRIES = {
    "filler-001": "stay silent where the filler would go (Toastmasters)",
    "pause-026": "'Listeners judge how fluent you sound'",
    "pace-043": "'Judge your rate against the setting you are in'",
    "pace-091": "'Listeners judge competence and warmth differently'",
    "pause-050": "'listeners work harder and judge the speaker more harshly'",
    "general-001": "'Judge your progress against that'",
    "long-038": "'judges rated those speakers higher', a study's raters",
    "general-032": "'independent judges agreed', a study's raters",
    "filler-069": "drill: 'In the next round', of a practice talk",
    "general-013": "'Vary your wording between rounds' of the 4/3/2 drill",
    "long-060": "drill: 'spreading these recall rounds across several days'",
    "filler-042": "publisher: '16th International Congress of Phonetic Sciences'",
    "filler-054": "'how you're judged', 'rated ... more negatively'",
}


def texts_of(entry: AdviceEntry) -> list[str]:
    """Every text of an entry: its advice, quote and drill and each text of its source."""
    source = entry.source
    return [
        entry.advice,
        entry.quote,
        entry.drill,
        source.author,
        source.credentials,
        source.title,
        source.publisher,
        source.url,
    ]


def take_weakest_in(skill: str, band: tuple[float, float] | None) -> dict[str, Any]:
    """A 2-minute take whose weakest skill is `skill`, its pace judged against `band`.

    The take sits in the middle of its band with no slips, then misses one target by far: its
    pace two band widths past an edge, or 12 of one count in 2 minutes.
    """
    low, high = band or DEFAULT_TARGET_WPM
    summary: dict[str, Any] = {
        "duration_seconds": 120.0,
        "words_per_minute": (low + high) / 2,
        "filler_count": 0,
        "restart_count": 0,
        "mid_sentence_pause_count": 0,
        "long_pause_count": 0,
        "transcript_excerpt": EVERYDAY_EXCERPT,
    }
    if band is not None:
        summary["target_wpm"] = list(band)
    if skill == "pace_fast":
        summary["words_per_minute"] = high + 2 * (high - low)
    elif skill == "pace_slow":
        summary["words_per_minute"] = low - 2 * (high - low)
    else:
        summary[COUNT_FIELDS[skill]] = 12
    return summary


def request_for(summary: dict[str, Any], tier: str, shown_ids: list[str]) -> coach.AdviceRequest:
    """The request the Results screen sends for a take with this summary."""
    return coach.AdviceRequest.model_validate(
        {"session_id": TAKE_ID, "summary": summary, "tier": tier, "shown_ids": shown_ids}
    )


class RecordingMessages:
    """Stands in for client.messages: records each request, then fails as if the API were down."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    async def create(self, **request: Any) -> None:
        self.requests.append(request)
        raise anthropic.APIConnectionError(
            request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
        )


class RecordingClient:
    """Stands in for anthropic.AsyncAnthropic and records what the notes ask the model."""

    def __init__(self) -> None:
        self.messages = RecordingMessages()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The app with no API key, so no model is ever asked unless a test hands one in."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    coach.client_for_key.cache_clear()
    yield TestClient(app_module.app)
    app_module.app.dependency_overrides.pop(app_module.advice_client, None)
    app_module.app.dependency_overrides.pop(app_module.advice_call_budget, None)
    coach.client_for_key.cache_clear()


# --- the word list -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Debate teaches you to think on your feet.",
        "Every debater stumbles at first.",
        "She qualified for NSDA nationals.",
        "the National Speech & Debate Association",
        "He coaches the school's forensics team.",
        "Public Forum is spoken to a lay audience.",
        "A Lincoln-Douglas round runs 45 minutes.",
        "Open your Congress speech with a hook.",
        "Save your best point for the rebuttal.",
        "Read the first constructive speech slowly.",
        "Prepare for cross-examination.",
        "Ask a partner tough cross-ex questions.",
        "Slow down in cross-exam.",
        "Know the resolution by heart.",
        "I affirm.",
        "We negate.",
        "Answer your opponent's case first.",
        "The judge's ballot decides the round.",
        "Lay judges like a moderate pace.",
        "Speak clearly in front of judges.",
        "Ten minutes before your round, write down your worries.",
    ],
)
def test_the_word_list_covers_each_mark_of_debate(text: str) -> None:
    assert mentions_debate(text)


@pytest.mark.parametrize(
    "text",
    [
        "Judge your progress by the week, not the day.",
        "Listeners judge how fluent you sound by your pauses.",
        "Independent judges rated the recordings for fluency.",
        "In the next round of the drill, speak a little faster.",
        "Vary your wording between rounds.",
        "Ask a friend for constructive feedback.",
        "16th International Congress of Phonetic Sciences",
        "Listeners rated the answers more negatively.",
        "Tell the story of your weekend to a friend.",
    ],
)
def test_everyday_uses_of_the_same_words_are_not_debate(text: str) -> None:
    assert not mentions_debate(text)


# --- the library ---------------------------------------------------------------------------------


@pytest.mark.parametrize("entry_id", DEBATE_ENTRIES, ids=list(DEBATE_ENTRIES))
def test_known_debate_entries_are_debate_specific(entry_id: str) -> None:
    assert is_debate_specific(BY_ID[entry_id])


@pytest.mark.parametrize("entry_id", EVERYDAY_ENTRIES, ids=list(EVERYDAY_ENTRIES))
def test_everyday_entries_are_not_debate_specific(entry_id: str) -> None:
    assert not is_debate_specific(BY_ID[entry_id])


@pytest.mark.parametrize(
    "changes",
    [
        {"advice": "Practise your rebuttal until it flows."},
        {"quote": "Every debater stumbles."},
        {"drill": "Ask a practice judge for time signals."},
    ],
    ids=["advice", "quote", "drill"],
)
def test_the_advice_quote_and_drill_are_read(changes: dict[str, str]) -> None:
    everyday = BY_ID["filler-001"]

    assert is_debate_specific(dataclasses.replace(everyday, **changes))


@pytest.mark.parametrize(
    "changes",
    [
        {"author": "Ethos Debate staff"},
        {"credentials": "Lincoln-Douglas coach"},
        {"title": "Public Forum Delivery Guide"},
        {"publisher": "National Speech & Debate Association"},
        {"url": "https://www.uvm.edu/%7Edebate/NFL/rostrumlib/delivery.pdf"},
        {"url": "https://www.speechanddebate.org/wp-content/uploads/Starter-Kit.pdf"},
    ],
    ids=["author", "credentials", "title", "publisher", "escaped url", "nsda url"],
)
def test_every_text_of_the_source_is_read(changes: dict[str, str]) -> None:
    everyday = BY_ID["filler-001"]

    assert is_debate_specific(
        dataclasses.replace(everyday, source=dataclasses.replace(everyday.source, **changes))
    )


def test_every_entry_naming_debate_or_forensics_in_any_form_is_debate_specific() -> None:
    # Read as plain text, so a name run together in a web address counts too.
    names_debate = re.compile(r"debat|forensic|nsda", re.IGNORECASE)

    missed = [
        entry.id
        for entry in LIBRARY
        if any(names_debate.search(text) for text in texts_of(entry))
        and not is_debate_specific(entry)
    ]

    assert missed == []


def test_each_measured_skill_keeps_enough_advice_once_debate_is_left_out() -> None:
    per_tag = Counter(
        tag for entry in LIBRARY if not is_debate_specific(entry) for tag in entry.targets
    )

    short = {
        tag: per_tag[tag]
        for tag in MEASURED_SKILLS
        if per_tag[tag] < MIN_ENTRIES_PER_MEASURED_TAG
    }

    assert short == {}


# --- selection -----------------------------------------------------------------------------------


@pytest.mark.parametrize("shown", SHOWN.values(), ids=list(SHOWN))
def test_no_candidate_list_holds_an_entry_written_for_debate(shown: list[str]) -> None:
    wrong: dict[tuple[str, str, str], list[str]] = {}
    for first, second in permutations(MEASURED_SKILLS, 2):
        for tier in TIER_NAMES:
            picked = candidates(
                LIBRARY, [first, second], tier, shown, len(LIBRARY), session_id=TAKE_ID
            )
            debate = [entry.id for entry in picked if is_debate_specific(entry)]
            # An empty list would pass for the wrong reason.
            if debate or not picked:
                wrong[(first, second, tier)] = debate

    assert wrong == {}


@pytest.mark.parametrize("band", BANDS.values(), ids=list(BANDS))
@pytest.mark.parametrize("skill", MEASURED_SKILLS)
def test_no_library_tips_draw_on_an_entry_written_for_debate(
    skill: str, band: tuple[float, float] | None
) -> None:
    summary = take_weakest_in(skill, band)
    wrong: dict[tuple[str, str], list[str]] = {}
    for tier in TIER_NAMES:
        for state, shown in SHOWN.items():
            advice = asyncio.run(coach.advise(request_for(summary, tier, shown), LIBRARY, None))
            tips = [tip.entry_id for tip in advice.tips]
            if len(tips) != coach.LIBRARY_TIP_COUNT or any(
                is_debate_specific(BY_ID[entry_id]) for entry_id in tips
            ):
                wrong[(tier, state)] = tips

    numbers = request_for(summary, "Novice", []).summary.report_summary()
    assert weakest_skills(numbers)[0] == skill
    assert wrong == {}


@pytest.mark.parametrize("band", BANDS.values(), ids=list(BANDS))
@pytest.mark.parametrize("skill", MEASURED_SKILLS)
def test_the_model_is_offered_no_entry_written_for_debate(
    skill: str, band: tuple[float, float] | None
) -> None:
    summary = take_weakest_in(skill, band)
    wrong: dict[str, list[str]] = {}
    for tier in TIER_NAMES:
        fake = RecordingClient()
        asyncio.run(
            coach.advise(request_for(summary, tier, []), LIBRARY, fake, AICallBudget())
        )
        [request] = fake.messages.requests
        prompt = request["messages"][0]["content"]
        offered = re.findall(r'<entry id="([^"]+)">', prompt)
        debate = [entry_id for entry_id in offered if is_debate_specific(BY_ID[entry_id])]
        if debate or not offered or mentions_debate(prompt):
            wrong[tier] = debate

    assert wrong == {}


class ReplyingMessages:
    """Stands in for client.messages: answers every request with the same finished reply."""

    def __init__(self, text: str) -> None:
        self.text = text

    async def create(self, **request: Any) -> Message:
        return Message(
            id="msg_test",
            type="message",
            role="assistant",
            model=coach.MODEL,
            content=[TextBlock(type="text", text=self.text)],
            stop_reason="end_turn",
            stop_sequence=None,
            usage=Usage(input_tokens=2000, output_tokens=60),
        )


class ReplyingClient:
    """Stands in for anthropic.AsyncAnthropic: a model that always gives the same reply."""

    def __init__(self, text: str) -> None:
        self.messages = ReplyingMessages(text)


def test_a_reply_drawing_on_debate_entries_is_refused_for_the_library_tips() -> None:
    # A take that runs fast, from a Novice who has been shown every other entry: the two named
    # are beginner advice on a fast pace and the only new ones, so nothing but the rule keeps
    # them from the model.
    summary = take_weakest_in("pace_fast", None)
    debate_pace = ["pace-036", "pace-077"]
    reply = (
        '{"tips": ['
        f'{{"entry_id": "{debate_pace[0]}", "text": "You ran fast. Let each sentence land."}}, '
        f'{{"entry_id": "{debate_pace[1]}", "text": "Find a tempo listeners can follow."}}'
        "]}"
    )

    advice = asyncio.run(
        coach.advise(
            request_for(summary, "Novice", OTHER_IDS),
            LIBRARY,
            ReplyingClient(reply),
            AICallBudget(),
        )
    )

    assert [(BY_ID[entry_id].level, BY_ID[entry_id].targets) for entry_id in debate_pace] == [
        ("beginner", ("pace_fast",)),
        ("beginner", ("pace_fast",)),
    ]
    assert advice.source == "library"
    assert [tip.entry_id for tip in advice.tips if is_debate_specific(BY_ID[tip.entry_id])] == []


def test_the_api_gives_no_debate_entry_when_only_debate_entries_are_new(
    client: TestClient,
) -> None:
    body = {
        "session_id": TAKE_ID,
        "summary": take_weakest_in("filler", None),
        "tier": "Novice",
        "shown_ids": OTHER_IDS,
    }

    response = client.post("/api/advice", json=body)

    assert response.status_code == 200, response.text
    tips = [tip["entry_id"] for tip in response.json()["tips"]]
    assert response.json()["source"] == "library"
    assert len(tips) == coach.LIBRARY_TIP_COUNT
    assert [entry_id for entry_id in tips if is_debate_specific(BY_ID[entry_id])] == []
