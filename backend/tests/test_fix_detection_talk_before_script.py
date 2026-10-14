"""Talk before the reading starts is not a first attempt at the script, even when it says the
script's first word: 'my' in 'Hi, my name is Ares' before a script that opens 'My opponents
claim'. Before any word has read the script, a word saying its first word starts the reading
only when the next word says it again ('We, we, uh, we affirm') or goes on with the script
('My, um, my opponents', 'the evi— the evidence')."""

import pytest

from backend.metrics import find_repeats
from backend.providers.base import Word
from backend.script_align import ScriptReport, align, analyze_reading

# Copied from frontend/passages.js (REBUTTAL_UNIFORMS).
UNIFORMS_PASSAGE = (
    "My opponents claim that uniforms erase bullying, but the evidence says otherwise. "
    "Students who want to single someone out will find a reason, whether it is shoes, "
    "a backpack, or a phone. The real problem is school culture, and a dress code does "
    "not change culture. Second, they argue that uniforms save families money. In "
    "practice, parents still buy everyday clothes for evenings and weekends, which makes "
    "the uniform an added cost, not a replacement. Consider what we lose. "
    "Choosing how to present yourself is one of the few decisions a student makes every "
    "day. Taking that away teaches compliance, not confidence. The proposal fails on "
    "its own terms."
)

# Copied from frontend/passages.js (LIBERTY_OR_DEATH).
LIBERTY_OR_DEATH = (
    "The war is inevitable, and let it come. It is in vain, sir, to extenuate the matter. "
    "Gentlemen may cry, Peace, Peace, but there is no peace. The war is actually begun. "
    "The next gale that sweeps from the north will bring to our ears the clash of "
    "resounding arms. Our brethren are already in the field. Why stand we here idle? "
    "What is it that gentlemen wish? What would they have? Is life so dear, or peace so "
    "sweet, as to be purchased at the price of chains and slavery? Forbid it, Almighty "
    "God. I know not what course others may take; but as for me, give me liberty or "
    "give me death."
)

# Copied from frontend/passages.js (the "Cold read: later school start" passage).
SCHOOL_START_COLD_READ = (
    "We affirm that high schools should start later in the morning. Our first contention is "
    "health. During adolescence, the body's internal clock shifts later, and many teenagers "
    "lie awake until late at night. When the first bell rings at dawn, students arrive "
    "exhausted, and exhausted students have trouble focusing, remembering, and managing their "
    "emotions. Our second contention is safety. A driver who has not slept enough reacts more "
    "slowly, and many students drive themselves to school in the dark. A later start puts "
    "them on the road when they are alert and the sky is bright. Our third contention is "
    "fairness. Students with long bus rides, jobs after school, or younger siblings to care "
    "for lose the most sleep under early schedules. The current system quietly punishes the "
    "students who already carry the most. The negative will say that a later bell disrupts "
    "sports and family routines. Those costs are real, but schedules can adapt, and a "
    "teenager's biology will not. When we weigh convenience against health, safety, and "
    "fairness, the ballot belongs to the affirmative."
)

# A pasted opening that starts with 'I'.
I_STAND_SCRIPT = (
    "I stand in firm opposition to the resolution, because it asks schools to do what "
    "families do better."
)

# The owner's 2026-10-11 nervous sentence as a pasted script.
NERVOUS_SCRIPT = (
    "I'm kinda nervous though for judging because, I put a lot of effort into this and if I "
    "didn't win, I would be sad."
)

# A pasted script whose first word is also a filler.
SO_SCRIPT = "So the plan fails on its own terms, and the evidence says otherwise."

CLEAN = ScriptReport(restarts=[], skipped=[], misread=[])


def words_from(spec: str, gap: float = 0.1, length: float = 0.3) -> list[Word]:
    """Build evenly spaced words from a sentence so tests read like speech."""
    words: list[Word] = []
    at = 0.0
    for text in spec.split():
        words.append(Word(text=text, start=at, end=at + length))
        at += length + gap
    return words


TALK_THEN_PERFECT_READ = [
    pytest.param("Hi, my name is Ares and this is my rebuttal.", UNIFORMS_PASSAGE, id="my"),
    pytest.param("Okay, I am ready.", I_STAND_SCRIPT, id="I"),
    pytest.param("Okay, we're recording now.", SCHOOL_START_COLD_READ, id="we're-for-we"),
    pytest.param("Okay, this is the Patrick Henry one.", LIBERTY_OR_DEATH, id="the"),
    pytest.param("Okay, so, let me start.", SO_SCRIPT, id="so-a-filler"),
]


@pytest.mark.parametrize(("talk", "script"), TALK_THEN_PERFECT_READ)
def test_talk_that_says_the_first_script_word_before_a_perfect_read_is_no_restart(
    talk: str, script: str
) -> None:
    words = words_from(f"{talk} {script}")

    assert align(words, script) == CLEAN


@pytest.mark.parametrize(("talk", "script"), TALK_THEN_PERFECT_READ)
def test_the_take_with_talk_before_a_perfect_read_has_no_repeats(talk: str, script: str) -> None:
    words = words_from(f"{talk} {script}")

    result = analyze_reading(words, script)

    assert result["script"] == {"restarts": [], "skipped": [], "misread": []}
    assert result["repeats"] == []


def test_talk_before_a_cut_off_restart_leaves_exactly_its_one_restart_as_free_talk_does() -> None:
    words = words_from(f"So I think I kinda ner— {NERVOUS_SCRIPT}")
    restart = {"text": "I kinda ner", "at": words[3].start}

    report = align(words, NERVOUS_SCRIPT)

    assert report == ScriptReport(restarts=[restart], skipped=[], misread=[])
    assert report.restarts == find_repeats(words)
    assert analyze_reading(words, NERVOUS_SCRIPT)["repeats"] == [restart]


def test_a_first_attempt_at_the_opening_word_is_still_a_restart() -> None:
    words = words_from(f"My, um, {UNIFORMS_PASSAGE}")

    report = align(words, UNIFORMS_PASSAGE)

    assert report == ScriptReport(restarts=[{"text": "My", "at": 0.0}], skipped=[], misread=[])


def test_a_cut_off_first_attempt_keeps_its_fragment_with_or_without_talk_before_it() -> None:
    script = "the evidence says otherwise"

    words = words_from("the evi— the evidence says otherwise")
    assert align(words, script).restarts == [{"text": "the evi", "at": 0.0}]

    words = words_from("Okay, so, the evi— the evidence says otherwise")
    assert align(words, script).restarts == [{"text": "the evi", "at": words[2].start}]


def test_an_opening_word_said_three_times_is_two_restarts_like_find_repeats() -> None:
    script = "We affirm that high schools should start later in the morning."
    words = words_from(f"We, we, uh, {script}")

    report = align(words, script)

    assert report.restarts == [{"text": "We", "at": 0.0}, {"text": "we", "at": words[1].start}]
    assert report.restarts == find_repeats(words)


def test_a_cut_off_opening_word_then_said_twice_is_two_restarts_like_find_repeats() -> None:
    script = "Cities should make public transit free to ride."
    words = words_from(f"Cit— Cities, uh, {script}")

    report = align(words, script)

    assert report.restarts == [{"text": "Cit", "at": 0.0}, {"text": "Cities", "at": words[1].start}]
    assert report.restarts == find_repeats(words)


def test_a_false_start_on_the_opening_words_is_still_a_restart() -> None:
    words = words_from(f"I stand— okay, sorry. {I_STAND_SCRIPT}")

    report = align(words, I_STAND_SCRIPT)

    assert report == ScriptReport(restarts=[{"text": "I stand", "at": 0.0}], skipped=[], misread=[])
