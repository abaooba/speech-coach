"""Restart tests: a phrase said again after a few abandoned words counts as a repeat."""

import json
from pathlib import Path

from backend import metrics
from backend.providers.assemblyai import to_word
from backend.providers.base import Word

FIXTURES = Path(__file__).parent / "fixtures"

# Recorded on 2026-10-11 (uniforms take): 'the few decisions a' is restarted after 'day'.
UNIFORMS_RESTART = "one of the few decisions a day, uh, the few decisions a student makes every day"


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


def test_restart_from_the_2026_10_11_take_is_one_repeat_of_the_longest_phrase() -> None:
    words = words_from(UNIFORMS_RESTART)

    assert metrics.find_repeats(words) == [{"text": "the few decisions a", "at": words[2].start}]


def test_the_real_2026_10_11_uniforms_take_has_exactly_its_one_restart() -> None:
    assert metrics.find_repeats(load_uniforms_take()) == [
        {"text": "the few decisions a", "at": 33.41}
    ]


def test_a_cut_off_mark_on_the_abandoned_word_is_enough_without_a_hesitation() -> None:
    for cut in ("day—", "day–", "day-"):
        words = words_from(f"one of the few decisions a {cut} the few decisions a student")

        assert metrics.find_repeats(words) == [
            {"text": "the few decisions a", "at": words[2].start}
        ], cut


def test_restart_counts_after_two_abandoned_words() -> None:
    words = words_from("the few decisions a single day, uh, the few decisions a student makes")

    assert metrics.find_repeats(words) == [{"text": "the few decisions a", "at": 0.0}]


def test_restart_after_three_abandoned_words_is_not_a_repeat() -> None:
    words = words_from("the few decisions a long hard day, uh, the few decisions a student makes")

    assert metrics.find_repeats(words) == []


def test_hesitations_between_the_copies_do_not_count_as_abandoned_words() -> None:
    words = words_from("the few decisions a long, um, day, uh, hmm, the few decisions a student")

    assert metrics.find_repeats(words) == [{"text": "the few decisions a", "at": 0.0}]


def test_a_single_word_said_again_after_other_words_is_not_a_repeat() -> None:
    assert metrics.find_repeats(words_from("the day the end")) == []
    assert metrics.find_repeats(words_from("the day, uh, the end")) == []


def test_immediate_repeats_still_count_alongside_restarts() -> None:
    assert metrics.find_repeats(words_from("I went I went to")) == [{"text": "I went", "at": 0.0}]
    assert metrics.find_repeats(words_from("I I I think")) == [
        {"text": "I", "at": 0.0},
        {"text": "I", "at": 0.4},
    ]


def test_two_word_restart_needs_a_hesitation_or_cut_off_between_the_copies() -> None:
    assert metrics.find_repeats(words_from("I play tennis, I play piano")) == []
    assert metrics.find_repeats(words_from("I play tennis, uh, I play piano")) == [
        {"text": "I play", "at": 0.0}
    ]
    assert metrics.find_repeats(words_from("I play ten— I play piano")) == [
        {"text": "I play", "at": 0.0}
    ]


def test_parallel_phrasing_without_a_hesitation_or_cut_off_is_not_a_restart() -> None:
    for speech in (
        "we need to protect, we need to defend our schools",
        "it is not fair, it is not just",
        "We need to protect students, we need to protect teachers.",
        "It hurts the poor, it hurts the elderly, it hurts the young.",
        "the United States and the United States",
    ):
        assert metrics.find_repeats(words_from(speech)) == [], speech


def test_a_new_sentence_that_opens_like_the_last_one_is_not_a_restart() -> None:
    for speech in (
        "This plan helps students. Um, this plan helps teachers.",
        "the end of the day. Uh, the end of the war.",
        "the end of the day! Uh, the end of the war.",
        "is the plan fair? Uh, is the plan legal?",
    ):
        assert metrics.find_repeats(words_from(speech)) == [], speech


def test_a_stutter_inside_the_abandoned_words_is_folded_into_the_restart() -> None:
    words = words_from("the few decisions a day day, uh, the few decisions a student")

    assert metrics.find_repeats(words) == [{"text": "the few decisions a", "at": 0.0}]


def test_second_copy_of_a_restart_can_itself_be_repeated() -> None:
    words = words_from("the few decisions a day— the few decisions a the few decisions a student")

    assert metrics.find_repeats(words) == [
        {"text": "the few decisions a", "at": 0.0},
        {"text": "the few decisions a", "at": words[5].start},
    ]
