"""Restart tests: a phrase said, a few words abandoned, then the phrase said again."""

from backend import metrics
from backend.providers.base import Word

WORD_STEP_SECONDS = 0.5


def timed_words(sentence: str) -> list[Word]:
    """One word every half second, each 0.4 s long, so word n starts at n * 0.5 s."""
    return [
        Word(text=text, start=index * WORD_STEP_SECONDS, end=index * WORD_STEP_SECONDS + 0.4)
        for index, text in enumerate(sentence.split())
    ]


def test_restart_recorded_on_2026_10_11_is_found_as_the_longest_phrase() -> None:
    words = timed_words(
        "one of the few decisions a day, uh, the few decisions a student makes every day"
    )

    # 'the few decisions' also restarts (after 'a day'); the longer phrase wins.
    assert metrics.find_repeats(words) == [{"text": "the few decisions a", "at": 1.0}]


def test_restart_after_exactly_two_abandoned_words_is_found() -> None:
    words = timed_words("the few decisions a day each, uh, the few decisions a student makes")

    assert metrics.find_repeats(words) == [{"text": "the few decisions a", "at": 0.0}]


def test_restart_after_three_abandoned_words_is_not_found() -> None:
    words = timed_words("the few decisions a day each week, uh, the few decisions a student makes")

    assert metrics.find_repeats(words) == []


def test_single_word_said_again_after_another_word_is_not_a_restart() -> None:
    assert metrics.find_repeats(timed_words("the day the end")) == []
    assert metrics.find_repeats(timed_words("the, uh, day the end")) == []


def test_parallel_phrasing_without_a_hesitation_is_not_a_restart() -> None:
    assert metrics.find_repeats(timed_words("we need to act, we need to listen")) == []


def test_immediate_repeat_of_a_phrase_is_still_found() -> None:
    assert metrics.find_repeats(timed_words("I went I went to")) == [{"text": "I went", "at": 0.0}]


def test_immediate_repeat_of_a_single_word_is_still_found() -> None:
    assert metrics.find_repeats(timed_words("the the end")) == [{"text": "the", "at": 0.0}]
