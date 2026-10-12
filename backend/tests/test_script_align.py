"""Script alignment tests: a take read from a script is lined up word by word against it to find
restarts (going back to script words already read), skipped script words and misread ones."""

import json
import time
from pathlib import Path

from backend.metrics import find_repeats
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


# --- cut-offs, pasted scripts, stutters, doubled script words, script fillers ---

# A clean script for the owner's real nervous take: its own transcript as the speaker meant
# it, without the abandoned 'I kinda ner—' and without the hesitations.
NERVOUS_SCRIPT = (
    "The best part of my day was waking up and not feeling too tired to go to church. "
    "Afterwards, I was also able to do some residual work on the app that I'm making for the "
    "Congressional App Challenge. It felt very rewarding to be able to put it on my home "
    "screen and actually be able to test it out for the first time. I'm kinda nervous though "
    "for judging because, I put a lot of effort into this and if I didn't win, I would be "
    "sad. I didn't eat breakfast today, but that's okay because I'm going to church, so I "
    "needed to fast anyway. Church isn't gonna take too long, so I'll be back home in time. "
    "To watch football, and that'll make me happy. I like watching football because of "
    "fantasy football, and my team winning makes me happy."
)

# Copied from frontend/passages.js (GETTYSBURG_OPENING and LIBERTY_OR_DEATH): each has one
# word written twice in a row.
GETTYSBURG_LINE = "gave their lives that that nation might live."
LIBERTY_LINE = "Gentlemen may cry, Peace, Peace, but there is no peace."


def no_slips(report: ScriptReport) -> bool:
    """Whether the report has no skipped and no misread script words."""
    return report.skipped == [] and report.misread == []


def test_a_cut_off_word_finished_right_after_is_one_restart() -> None:
    words = words_from("the evidence sa— says otherwise")

    report = align(words, "the evidence says otherwise")

    assert report == ScriptReport(
        restarts=[{"text": "sa", "at": words[2].start}], skipped=[], misread=[]
    )
    assert report.restarts == find_repeats(words)


def test_a_cut_off_phrase_said_again_keeps_its_fragment_in_the_restart() -> None:
    words = words_from("the evi— the evidence says otherwise")

    report = align(words, "the evidence says otherwise")

    assert report == ScriptReport(restarts=[{"text": "the evi", "at": 0.0}], skipped=[], misread=[])
    assert report.restarts == find_repeats(words)


def test_a_cut_off_restart_keeps_the_words_before_the_fragment() -> None:
    words = words_from("honestly I kinda ner— I am kinda nervous about this")

    report = align(words, "honestly I am kinda nervous about this")

    assert report == ScriptReport(
        restarts=[{"text": "I kinda ner", "at": words[1].start}], skipped=[], misread=[]
    )


def test_a_restart_keeps_its_misread_first_attempt() -> None:
    words = words_from("one of the few decision — the few decisions a student")

    report = align(words, "one of the few decisions a student")

    assert report == ScriptReport(
        restarts=[{"text": "the few decision", "at": words[2].start}], skipped=[], misread=[]
    )


def test_the_real_nervous_take_against_a_clean_script_reports_its_one_restart() -> None:
    raw = json.loads((FIXTURES / "take_2026_10_11_nervous.json").read_text())
    words = [to_word(word) for word in raw["words"]]

    report = align(words, NERVOUS_SCRIPT)

    assert report == ScriptReport(
        restarts=[{"text": "I kinda ner", "at": 27.379}], skipped=[], misread=[]
    )
    assert report.restarts == find_repeats(words)


def test_a_pasted_script_with_curly_apostrophes_reads_cleanly() -> None:
    report = align(words_from("We don't lose it's value"), "We don’t lose it’s value")

    assert report == ScriptReport(restarts=[], skipped=[], misread=[])


def test_script_words_joined_by_a_dash_read_cleanly_as_two_spoken_words() -> None:
    cases = [
        (
            "Uniforms do not stop bullying the evidence says otherwise",
            "Uniforms do not stop bullying—the evidence says otherwise.",
        ),
        ("one of the few decisions a student makes", "one of the few decisions–a student makes"),
        ("one of the few decisions a student makes", "one of the few decisions--a student makes"),
        ("a well known fact", "a well-known fact"),
        ("a well-known fact", "a well known fact"),
        ("a well-known fact", "a well-known fact"),
    ]
    for spoken, script in cases:
        assert align(words_from(spoken), script) == ScriptReport(
            restarts=[], skipped=[], misread=[]
        ), (spoken, script)


def test_a_skipped_half_of_a_dash_joined_word_keeps_the_script_index_of_the_whole() -> None:
    words = words_from("stop bullying evidence says")

    report = align(words, "stop bullying—the evidence says")

    assert report == ScriptReport(
        restarts=[], skipped=[ScriptSlip(word="the", index=1, at=words[1].end)], misread=[]
    )


def test_a_hyphenated_hesitation_in_speech_is_still_a_filler() -> None:
    report = align(words_from("a mm-hmm student uh-huh makes"), "a student makes")

    assert report == ScriptReport(restarts=[], skipped=[], misread=[])


def test_a_word_said_three_times_is_two_restarts_like_find_repeats() -> None:
    for spoken in (
        "one of the the the few decisions a student",
        "one of the few few few decisions a student",
        "one of the few decisions a a a student",
    ):
        words = words_from(spoken)

        report = align(words, "one of the few decisions a student")

        assert len(report.restarts) == 2, spoken
        assert report.restarts == find_repeats(words), spoken
        assert no_slips(report), spoken


def test_going_back_over_a_doubled_script_word_is_one_restart() -> None:
    words = words_from("gave their lives that that nation uh that nation might live.")

    report = align(words, GETTYSBURG_LINE)

    assert report == ScriptReport(
        restarts=[{"text": "that nation", "at": words[4].start}], skipped=[], misread=[]
    )


def test_going_back_to_the_second_of_two_doubled_script_words_is_one_restart() -> None:
    words = words_from("Gentlemen may cry, Peace, Peace, but there Peace, but there is no peace.")

    report = align(words, LIBERTY_LINE)

    assert report == ScriptReport(
        restarts=[{"text": "Peace but there", "at": words[4].start}], skipped=[], misread=[]
    )


def test_going_back_further_over_a_doubled_script_word_is_one_restart() -> None:
    for back in (1, 2, 3, 4):
        script_words = GETTYSBURG_LINE.split()
        stop = script_words.index("nation") + 2
        spoken = script_words[:stop] + script_words[stop - back - 1 :]

        report = align(words_from(" ".join(spoken)), GETTYSBURG_LINE)

        assert len(report.restarts) == 1, spoken
        assert no_slips(report), spoken


def test_a_restart_keeps_script_words_that_are_also_fillers() -> None:
    cases = [
        (
            "Is life so dear, or Is life so dear, or peace so sweet",
            "Is life so dear, or peace so sweet",
            "Is life so dear or",
        ),
        (
            "so skilled stewards so skilled stewards sweep stale stalls",
            "so skilled stewards sweep stale stalls",
            "so skilled stewards",
        ),
        (
            "The war is actually The war is actually begun.",
            "The war is actually begun.",
            "The war is actually",
        ),
    ]
    for spoken, script, restarted in cases:
        report = align(words_from(spoken), script)

        assert report == ScriptReport(
            restarts=[{"text": restarted, "at": 0.0}], skipped=[], misread=[]
        ), spoken


def test_a_script_word_said_twice_that_is_also_a_filler_is_a_restart() -> None:
    words = words_from("any nation so so conceived")

    report = align(words, "any nation so conceived")

    assert report == ScriptReport(
        restarts=[{"text": "so", "at": words[2].start}], skipped=[], misread=[]
    )


def test_an_added_word_matching_the_script_word_after_next_is_not_a_restart() -> None:
    for spoken, script in (
        ("forth on this a continent, a new nation", "forth on this continent, a new nation"),
        ("past stone and stairs, and steady", "past stone stairs, and steady"),
        ("a backpack, or a the phone. The real", "a backpack, or a phone. The real"),
    ):
        report = align(words_from(spoken), script)

        assert report.restarts == [], spoken
        assert no_slips(report), spoken
