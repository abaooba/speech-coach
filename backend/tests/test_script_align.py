"""Script alignment tests: a take read from a script is lined up word by word against it to find
restarts (going back to script words already read), skipped script words and misread ones."""

import json
import time
from pathlib import Path

from backend.providers.assemblyai import to_word
from backend.providers.base import Word
from backend.script_align import ScriptReport, ScriptSlip, align

FIXTURES = Path(__file__).parent / "fixtures"

# The "Rebuttal: school uniforms" passage, copied from frontend/passages.js (REBUTTAL_UNIFORMS).
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

# The owner's 2026-10-11 stutter: the start of the clause read wrong, then read again.
RESTARTED_CLAUSE = "the few decisions a day — the few decisions a student makes every day"


def words_from(spec: str, gap: float = 0.1, length: float = 0.3) -> list[Word]:
    """Build evenly spaced words from a sentence so tests read like speech."""
    words: list[Word] = []
    at = 0.0
    for text in spec.split():
        words.append(Word(text=text, start=at, end=at + length))
        at += length + gap
    return words


def load_uniforms_take() -> list[Word]:
    """The owner's real 2026-10-11 uniforms take, as AssemblyAI returned it ('day— uh,')."""
    raw = json.loads((FIXTURES / "take_2026_10_11_uniforms.json").read_text())
    return [to_word(word) for word in raw["words"]]


def spoken_index(words: list[Word], text: str, occurrence: int = 1) -> int:
    """Position in `words` of the n-th word whose text is exactly `text`."""
    positions = [i for i, word in enumerate(words) if word.text == text]
    return positions[occurrence - 1]


# --- clean and empty -------------------------------------------------------------


def test_a_clean_read_of_the_passage_has_no_restarts_skips_or_misreads() -> None:
    report = align(words_from(UNIFORMS_PASSAGE), UNIFORMS_PASSAGE)

    assert report == ScriptReport(restarts=[], skipped=[], misread=[])


def test_an_empty_script_reports_nothing() -> None:
    for script in ("", "   \n "):
        assert align(words_from("one of the few decisions"), script) == ScriptReport(
            restarts=[], skipped=[], misread=[]
        )


def test_no_words_against_a_script_skips_every_script_word() -> None:
    report = align([], "Consider what we lose.")

    assert report.restarts == []
    assert report.misread == []
    assert report.skipped == [
        ScriptSlip(word="Consider", index=0, at=0.0),
        ScriptSlip(word="what", index=1, at=0.0),
        ScriptSlip(word="we", index=2, at=0.0),
        ScriptSlip(word="lose", index=3, at=0.0),
    ]


# --- restarts --------------------------------------------------------------------


def test_restarting_the_clause_is_one_restart_and_not_a_skip_or_misread_for_day() -> None:
    spoken = UNIFORMS_PASSAGE.replace(
        "the few decisions a student makes every day", RESTARTED_CLAUSE
    )
    words = words_from(spoken)
    first_copy = spoken_index(words, "day") - 4

    report = align(words, UNIFORMS_PASSAGE)

    assert words[first_copy].text == "the"
    assert report == ScriptReport(
        restarts=[{"text": "the few decisions a", "at": words[first_copy].start}],
        skipped=[],
        misread=[],
    )


def test_restarting_against_just_that_sentence_is_one_restart() -> None:
    script = "the few decisions a student makes every day"

    report = align(words_from(RESTARTED_CLAUSE), script)

    assert report == ScriptReport(
        restarts=[{"text": "the few decisions a", "at": 0.0}], skipped=[], misread=[]
    )


def test_a_word_said_twice_is_one_restart() -> None:
    words = words_from("one of the few decisions a a student makes")

    report = align(words, "one of the few decisions a student makes")

    assert report == ScriptReport(
        restarts=[{"text": "a", "at": words[5].start}], skipped=[], misread=[]
    )


def test_a_restart_whose_reread_has_a_misread_is_still_one_restart() -> None:
    words = words_from("one of the few decisions a student uh the few decision a student makes")

    report = align(words, "one of the few decisions a student makes")

    assert report == ScriptReport(
        restarts=[{"text": "the few decisions a student", "at": words[2].start}],
        skipped=[],
        misread=[],
    )


def test_a_phrase_started_three_times_is_two_restarts() -> None:
    words = words_from("the few — the few — the few decisions a student")

    report = align(words, "the few decisions a student")

    assert report.restarts == [
        {"text": "the few", "at": words[0].start},
        {"text": "the few", "at": words[3].start},
    ]


def test_an_added_word_that_is_not_in_the_script_is_not_a_restart() -> None:
    report = align(
        words_from("one of the few decisions that a student makes"),
        "one of the few decisions a student makes",
    )

    assert report == ScriptReport(restarts=[], skipped=[], misread=[])


# --- skips and misreads -----------------------------------------------------------


def test_skipping_a_line_reports_each_of_its_words_where_it_was_expected() -> None:
    words = words_from(UNIFORMS_PASSAGE.replace(" Consider what we lose.", ""))
    before_gap = spoken_index(words, "replacement.")

    report = align(words, UNIFORMS_PASSAGE)

    expected_at = words[before_gap].end
    assert report.restarts == []
    assert report.misread == []
    assert report.skipped == [
        ScriptSlip(word="Consider", index=75, at=expected_at),
        ScriptSlip(word="what", index=76, at=expected_at),
        ScriptSlip(word="we", index=77, at=expected_at),
        ScriptSlip(word="lose", index=78, at=expected_at),
    ]


def test_skipping_the_opening_word_expects_it_when_the_take_starts() -> None:
    words = words_from("opponents claim that uniforms erase bullying", gap=0.1)
    shifted = [Word(text=w.text, start=w.start + 2.0, end=w.end + 2.0) for w in words]

    report = align(shifted, "My opponents claim that uniforms erase bullying")

    assert report.skipped == [ScriptSlip(word="My", index=0, at=2.0)]


def test_one_wrong_word_is_one_misread_with_the_word_said() -> None:
    spoken = UNIFORMS_PASSAGE.replace("which makes the uniform", "which make the uniform")
    words = words_from(spoken)
    said = spoken_index(words, "make")

    report = align(words, UNIFORMS_PASSAGE)

    assert report == ScriptReport(
        restarts=[],
        skipped=[],
        misread=[ScriptSlip(word="makes", index=66, at=words[said].start, said="make")],
    )


# --- fillers ----------------------------------------------------------------------


def test_fillers_in_speech_are_ignored() -> None:
    spoken = (
        "Um, Choosing how to uh present yourself is, like, one of the, you know, few"
        " decisions Mhm. a student mm-hmm makes every hmm day."
    )

    report = align(
        words_from(spoken),
        "Choosing how to present yourself is one of the few decisions a student makes every day.",
    )

    assert report == ScriptReport(restarts=[], skipped=[], misread=[])


def test_a_filler_word_that_is_in_the_script_is_read_not_skipped() -> None:
    script = "so skilled stewards sweep stale stalls first, so stay steady"

    assert align(words_from(script), script) == ScriptReport(restarts=[], skipped=[], misread=[])


# --- the real 2026-10-11 uniforms take --------------------------------------------


def test_the_real_uniforms_take_reports_its_day_restart_and_its_one_misread() -> None:
    report = align(load_uniforms_take(), UNIFORMS_PASSAGE)

    assert report == ScriptReport(
        restarts=[{"text": "the few decisions a", "at": 33.41}],
        skipped=[],
        misread=[ScriptSlip(word="makes", index=66, at=26.492, said="make")],
    )


# --- speed ------------------------------------------------------------------------


def test_a_three_minute_take_against_a_600_word_script_aligns_quickly() -> None:
    script_words = (UNIFORMS_PASSAGE.split() * 6)[:600]
    spoken_words = list(script_words)
    del spoken_words[100:110]
    spoken_words[300:300] = ["um", "the", "few", "decisions", "uh"]
    spoken_words[450] = "something"
    spoken_words += ["extra"] * (600 - len(spoken_words))

    started = time.perf_counter()
    report = align(words_from(" ".join(spoken_words)), " ".join(script_words))
    elapsed = time.perf_counter() - started

    assert len(report.skipped) >= 10
    assert elapsed < 1.0
