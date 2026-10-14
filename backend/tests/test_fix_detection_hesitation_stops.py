"""A full stop on a hesitation ('students, um. This plan') ends the sentence, just as one on a
word does ('students. Um, this plan'). find_repeats skips um/uh/hmm/mhm, so their stops must not
be skipped with them: a new sentence that opens like the last one is not a restart."""

import pytest

from backend import metrics
from backend.providers.base import Word


def words_from(spec: str, gap: float = 0.1, length: float = 0.3) -> list[Word]:
    """Build evenly spaced words from a sentence so tests read like speech."""
    words: list[Word] = []
    at = 0.0
    for text in spec.split():
        words.append(Word(text=text, start=at, end=at + length))
        at += length + gap
    return words


@pytest.mark.parametrize(
    "speech",
    [
        "This plan helps students, um. This plan helps teachers.",
        "It hurts the poor, uh. It hurts the elderly.",
        "I would be sad, mhm. I would be happy too.",
        "This plan helps students um. This plan helps teachers.",
        "This plan helps students, um? This plan helps teachers.",
    ],
)
def test_a_new_sentence_after_a_hesitation_that_ends_the_last_one_is_not_a_restart(
    speech: str,
) -> None:
    assert metrics.find_repeats(words_from(speech)) == []


def test_it_reads_the_same_as_the_full_stop_on_the_word_before_the_hesitation() -> None:
    on_the_hesitation = words_from("This plan helps students, um. This plan helps teachers.")
    on_the_word = words_from("This plan helps students. Um, this plan helps teachers.")

    assert metrics.find_repeats(on_the_hesitation) == metrics.find_repeats(on_the_word) == []


@pytest.mark.parametrize("stop", ["um.", "Uh.", "Hmm!", "Mhm.", "mm-hmm.", "uh-huh?"])
def test_every_hesitation_spelling_and_sentence_end_counts(stop: str) -> None:
    words = words_from(f"It hurts the poor, {stop} It hurts the elderly.")

    assert metrics.find_repeats(words) == []


@pytest.mark.parametrize(
    "speech",
    [
        "It hurts the poor, um. Uh, it hurts the elderly.",
        "It hurts the poor, uh, um. It hurts the elderly.",
        "It hurts the poor, um. Really, uh, it hurts the elderly.",
    ],
)
def test_a_stop_on_any_hesitation_between_the_copies_is_not_a_restart(speech: str) -> None:
    assert metrics.find_repeats(words_from(speech)) == []


def test_a_hesitation_without_a_full_stop_still_marks_a_restart() -> None:
    words = words_from("It hurts the poor, uh, it hurts the elderly.")

    assert metrics.find_repeats(words) == [{"text": "It hurts the", "at": 0.0}]


def test_a_cut_off_hesitation_ends_no_sentence_so_both_restarts_still_count() -> None:
    words = words_from("the few decisions a day, uh— the few decisions a student")
    assert metrics.find_repeats(words) == [{"text": "the few decisions a", "at": 0.0}]

    words = words_from("I kinda ner— uh— I'm kinda nervous")
    assert metrics.find_repeats(words) == [{"text": "I kinda ner", "at": 0.0}]
