"""Metrics tests: the recorded AssemblyAI clip plus hand-made word lists for edge cases."""

import json
from pathlib import Path

import pytest

from backend import metrics
from backend.providers.base import Word

FIXTURES = Path(__file__).parent / "fixtures"
FILLER_KEYS = ["um", "uh", "hmm", "like", "you know", "so", "basically", "actually"]


def load_clip() -> list[Word]:
    """The 32 s test clip: 48 words, times already in seconds."""
    raw = json.loads((FIXTURES / "test_clip_assemblyai.json").read_text())
    return [Word(text=w["text"], start=w["start"], end=w["end"]) for w in raw["words"]]


def words_from(spec: str, gap: float = 0.1, length: float = 0.3, start: float = 0.0) -> list[Word]:
    """Build evenly spaced words from a sentence so tests read like speech."""
    words: list[Word] = []
    at = start
    for text in spec.split():
        words.append(Word(text=text, start=at, end=at + length))
        at += length + gap
    return words


# --- words_per_minute -------------------------------------------------------


def test_words_per_minute_counts_every_word_from_first_start_to_last_end() -> None:
    clip = load_clip()  # 48 words, 1.287 s to 32.195 s

    assert metrics.words_per_minute(clip) == pytest.approx(48 / 30.908 * 60, abs=0.1)


def test_words_per_minute_is_zero_for_no_words() -> None:
    assert metrics.words_per_minute([]) == 0.0


def test_words_per_minute_for_a_single_word_uses_only_that_word() -> None:
    assert metrics.words_per_minute([Word(text="hi", start=2.0, end=2.5)]) == 120.0


def test_words_per_minute_is_zero_when_the_only_word_has_no_length() -> None:
    assert metrics.words_per_minute([Word(text="hi", start=2.0, end=2.0)]) == 0.0


# --- find_pauses ------------------------------------------------------------


def test_find_pauses_on_clip_finds_exactly_three_gaps_over_1_5_s() -> None:
    pauses = metrics.find_pauses(load_clip())

    assert pauses == [(14.567, 1.531), (16.853, 2.474), (20.517, 2.185)]


def test_find_pauses_reports_the_end_of_the_word_before_the_gap() -> None:
    words = [Word(text="Hello", start=1.0, end=1.4), Word(text="there", start=3.4, end=3.8)]

    assert metrics.find_pauses(words) == [(1.4, 2.0)]


def test_find_pauses_ignores_leading_silence() -> None:
    words = words_from("hello there", start=3.0)

    assert metrics.find_pauses(words) == []


def test_find_pauses_counts_a_gap_exactly_at_the_threshold() -> None:
    words = [Word(text="a", start=1.287, end=1.497), Word(text="b", start=2.997, end=3.2)]

    assert metrics.find_pauses(words) == [(1.497, 1.5)]


def test_find_pauses_honours_a_custom_min_gap() -> None:
    words = [
        Word(text="one", start=0.0, end=0.3),
        Word(text="two", start=1.1, end=1.4),  # 0.8 s gap
        Word(text="three", start=2.6, end=2.9),  # 1.2 s gap
    ]

    assert metrics.find_pauses(words, min_gap=1.0) == [(1.4, 1.2)]
    assert metrics.find_pauses(words, min_gap=0.5) == [(0.3, 0.8), (1.4, 1.2)]


def test_find_pauses_is_empty_for_no_words_or_one_word() -> None:
    assert metrics.find_pauses([]) == []
    assert metrics.find_pauses([Word(text="hi", start=0.0, end=0.4)]) == []


# --- count_fillers ----------------------------------------------------------


def test_count_fillers_on_clip_matches_the_hand_count() -> None:
    assert metrics.count_fillers(load_clip()) == {
        "um": 6,
        "uh": 3,
        "hmm": 0,
        "like": 1,
        "you know": 0,
        "so": 2,
        "basically": 1,
        "actually": 0,
    }


def test_count_fillers_ignores_case_and_punctuation() -> None:
    counts = metrics.count_fillers(words_from("Um, UH. hmm! Actually,"))

    assert (counts["um"], counts["uh"], counts["hmm"], counts["actually"]) == (1, 1, 1, 1)


def test_count_fillers_counts_you_know_as_one_phrase() -> None:
    counts = metrics.count_fillers(words_from("I, you know, think you know. You can know"))

    assert counts["you know"] == 2
    assert sum(counts.values()) == 2  # a lone 'you' or 'know' is not a filler


def test_count_fillers_does_not_match_words_that_merely_contain_a_filler() -> None:
    counts = metrics.count_fillers(words_from("umbrella likes sofa"))

    assert sum(counts.values()) == 0


def test_count_fillers_always_returns_all_eight_keys() -> None:
    assert list(metrics.count_fillers([])) == FILLER_KEYS
    assert all(count == 0 for count in metrics.count_fillers([]).values())
