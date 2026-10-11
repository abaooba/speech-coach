"""Cut-off restart tests: a word ending in a dash ('ner—') followed by a restart is one repeat,
and a whole clause read again (up to eight words) is one repeat."""

import json
from pathlib import Path

from backend import metrics
from backend.providers.assemblyai import to_word
from backend.providers.base import Word

FIXTURES = Path(__file__).parent / "fixtures"

# The owner's two 2026-10-11 stutters: a word cut off, then the sentence started again.
NERVOUS_RESTART = "I kinda ner— I'm kinda nervous"
UNIFORMS_RESTART = "decisions a day— uh, the few decisions a student makes"


def words_from(spec: str, gap: float = 0.1, length: float = 0.3) -> list[Word]:
    """Build evenly spaced words from a sentence so tests read like speech."""
    words: list[Word] = []
    at = 0.0
    for text in spec.split():
        words.append(Word(text=text, start=at, end=at + length))
        at += length + gap
    return words


def load_take(name: str) -> list[Word]:
    """One of the owner's real 2026-10-11 takes, as AssemblyAI returned it."""
    raw = json.loads((FIXTURES / name).read_text())
    return [to_word(word) for word in raw["words"]]


# --- the real nervous take fixture --------------------------------------------


def test_nervous_take_fixture_keeps_only_the_transcript_fields() -> None:
    raw = json.loads((FIXTURES / "take_2026_10_11_nervous.json").read_text())

    assert set(raw) == {"source", "status", "text", "words"}
    assert raw["status"] == "completed"


def test_assemblyai_writes_the_em_dash_into_the_cut_off_word() -> None:
    raw = json.loads((FIXTURES / "take_2026_10_11_nervous.json").read_text())

    cut_off = [word["text"] for word in raw["words"] if word["text"].endswith("—")]

    assert cut_off == ["ner—"]


# --- the two 2026-10-11 sentences ----------------------------------------------


def test_nervous_cut_off_and_restart_is_exactly_one_repeat() -> None:
    words = words_from(NERVOUS_RESTART)

    assert metrics.find_repeats(words) == [{"text": "I kinda ner", "at": 0.0}]


def test_uniforms_cut_off_and_restart_is_exactly_one_repeat() -> None:
    words = words_from(UNIFORMS_RESTART)

    assert metrics.find_repeats(words) == [{"text": "decisions a day", "at": 0.0}]


def test_the_full_real_nervous_take_has_only_its_one_restart() -> None:
    assert metrics.find_repeats(load_take("take_2026_10_11_nervous.json")) == [
        {"text": "I kinda ner", "at": 27.379}
    ]


def test_the_full_real_uniforms_take_has_only_its_one_restart() -> None:
    assert metrics.find_repeats(load_take("take_2026_10_11_uniforms.json")) == [
        {"text": "the few decisions a", "at": 33.41}
    ]


# --- what a cut-off restart is ---------------------------------------------------


def test_every_cut_off_mark_counts() -> None:
    for cut in ("ner—", "ner–", "ner-"):
        words = words_from(f"I kinda {cut} I'm kinda nervous")

        assert metrics.find_repeats(words) == [{"text": "I kinda ner", "at": 0.0}], cut


def test_a_word_starting_with_the_cut_off_fragment_is_a_restart() -> None:
    words = words_from("we must pro— protect our schools")

    assert metrics.find_repeats(words) == [{"text": "pro", "at": words[2].start}]


def test_the_restart_may_begin_with_the_same_stem_as_the_cut_phrase() -> None:
    assert metrics.find_repeats(words_from("I'm going to— I am going home")) == [
        {"text": "I'm going to", "at": 0.0}
    ]
    assert metrics.find_repeats(words_from("I’m going to— I am going home")) == [
        {"text": "I’m going to", "at": 0.0}
    ]
    assert metrics.find_repeats(words_from("decisions about— decision making matters")) == [
        {"text": "decisions about", "at": 0.0}
    ]


def test_hesitations_after_the_cut_do_not_use_up_the_lookahead() -> None:
    words = words_from("I kinda ner— um, uh, hmm, I'm kinda nervous")

    assert metrics.find_repeats(words) == [{"text": "I kinda ner", "at": 0.0}]


def test_a_restart_more_than_four_words_after_the_cut_is_not_counted() -> None:
    words = words_from("I kinda ner— you know, really, honestly, I'm kinda nervous")

    assert metrics.find_repeats(words) == []


def test_a_dash_with_no_restart_after_it_is_not_a_repeat() -> None:
    assert metrics.find_repeats(words_from("the plan— which costs nothing— fails")) == []


def test_a_cut_off_restart_never_reaches_back_across_a_sentence_end() -> None:
    assert metrics.find_repeats(words_from("I agree. The plan— I think it works")) == []


def test_a_hyphen_inside_a_word_is_not_a_cut_off() -> None:
    assert metrics.find_repeats(words_from("well-known fact")) == []
    assert metrics.find_repeats(words_from("a well-known fact is well known")) == []


def test_one_word_said_again_later_without_a_cut_off_is_still_not_a_repeat() -> None:
    assert metrics.find_repeats(words_from("the day the end")) == []


# --- longer re-reads -------------------------------------------------------------


def test_an_eight_word_clause_read_twice_is_one_repeat() -> None:
    clause = "the few decisions a student makes every day"
    words = words_from(f"{clause} {clause} matter")

    assert metrics.find_repeats(words) == [{"text": clause, "at": 0.0}]


def test_an_eight_word_clause_restarted_after_a_hesitation_is_one_repeat() -> None:
    clause = "the few decisions a student makes every day"
    words = words_from(f"{clause} at, uh, {clause} at school")

    assert metrics.find_repeats(words) == [{"text": clause, "at": 0.0}]

