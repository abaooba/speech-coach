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


# --- find_repeats -----------------------------------------------------------


def test_find_repeats_on_clip_finds_the_and_i_restart() -> None:
    assert metrics.find_repeats(load_clip()) == [{"text": "and I", "at": 16.515}]


def test_find_repeats_skips_um_uh_hmm_between_the_copies() -> None:
    assert metrics.find_repeats(words_from("and I, uh, and I")) == [{"text": "and I", "at": 0.0}]
    assert metrics.find_repeats(words_from("so hmm, um, so"))[0]["text"] == "so"


def test_find_repeats_does_not_skip_like_or_so_between_the_copies() -> None:
    assert metrics.find_repeats(words_from("I, like, I")) == []
    assert metrics.find_repeats(words_from("I, so, I")) == []


def test_find_repeats_ignores_phrases_repeated_later_in_the_sentence() -> None:
    assert metrics.find_repeats(words_from("I play tennis, I play piano")) == []


def test_find_repeats_counts_each_extra_copy_of_a_stuttered_word() -> None:
    assert metrics.find_repeats(words_from("the the end")) == [{"text": "the", "at": 0.0}]
    assert metrics.find_repeats(words_from("I I I think")) == [
        {"text": "I", "at": 0.0},
        {"text": "I", "at": 0.4},
    ]


def test_find_repeats_is_empty_for_no_words_or_one_word() -> None:
    assert metrics.find_repeats([]) == []
    assert metrics.find_repeats(words_from("hello")) == []


# --- pace_windows -----------------------------------------------------------


def test_pace_windows_on_clip_splits_into_10_s_windows_from_the_first_word() -> None:
    assert metrics.pace_windows(load_clip()) == [
        {"start": 0.0, "end": 10.0, "wpm": 108.0},  # 18 words
        {"start": 10.0, "end": 20.0, "wpm": 84.0},  # 14 words
        {"start": 20.0, "end": 30.908, "wpm": 88.0},  # 16 words over the 10.908 s tail
    ]


def test_pace_windows_keeps_a_tail_of_at_least_half_a_window() -> None:
    words = [
        Word(text="a", start=0.0, end=0.5),
        Word(text="b", start=5.0, end=5.5),
        Word(text="c", start=10.0, end=10.5),
        Word(text="d", start=14.5, end=15.0),
    ]

    assert metrics.pace_windows(words) == [
        {"start": 0.0, "end": 10.0, "wpm": 12.0},
        {"start": 10.0, "end": 15.0, "wpm": 24.0},
    ]


def test_pace_windows_folds_a_short_tail_into_the_last_window() -> None:
    words = [
        Word(text="a", start=0.0, end=0.5),
        Word(text="b", start=9.0, end=9.5),
        Word(text="c", start=10.5, end=11.0),
    ]

    assert metrics.pace_windows(words) == [{"start": 0.0, "end": 11.0, "wpm": 16.4}]


def test_pace_windows_measures_from_the_first_spoken_word() -> None:
    words = words_from("one two three", start=20.0)  # 1.1 s of speech after 20 s of silence

    assert metrics.pace_windows(words) == [{"start": 0.0, "end": 1.1, "wpm": 163.6}]


def test_pace_windows_honours_a_custom_window_size() -> None:
    words = [Word(text=str(i), start=float(i), end=i + 0.5) for i in range(12)]  # 11.5 s

    assert [w["start"] for w in metrics.pace_windows(words, window=4.0)] == [0.0, 4.0, 8.0]
    assert metrics.pace_windows(words, window=4.0)[-1] == {"start": 8.0, "end": 11.5, "wpm": 68.6}


def test_pace_windows_is_empty_for_no_words_and_single_for_one_word() -> None:
    assert metrics.pace_windows([]) == []
    assert metrics.pace_windows([Word(text="hi", start=2.0, end=2.5)]) == [
        {"start": 0.0, "end": 0.5, "wpm": 120.0}
    ]


# --- analyze ----------------------------------------------------------------


def test_analyze_on_clip_meets_the_acceptance_line() -> None:
    result = metrics.analyze(load_clip())

    assert result["fillers"]["um"] == 6
    assert result["fillers"]["uh"] == 3
    assert len(result["pauses"]) == 3
    assert all(length >= 1.5 for _, length in result["pauses"])
    assert result["duration"] == 30.908
    assert result["word_count"] == 48
    assert result["words_per_minute"] == 93.2
    assert result["repeats"] == [{"text": "and I", "at": 16.515}]
    assert len(result["pace_windows"]) == 3


def test_analyze_returns_exactly_the_contract_keys_and_is_json_serializable() -> None:
    result = metrics.analyze(load_clip())

    assert list(result) == [
        "words_per_minute",
        "duration",
        "word_count",
        "pauses",
        "fillers",
        "repeats",
        "pace_windows",
    ]
    assert json.loads(json.dumps(result))["pauses"][0] == [14.567, 1.531]


def test_analyze_empty_list_returns_zeros_and_empty_lists() -> None:
    assert metrics.analyze([]) == {
        "words_per_minute": 0.0,
        "duration": 0.0,
        "word_count": 0,
        "pauses": [],
        "fillers": dict.fromkeys(FILLER_KEYS, 0),
        "repeats": [],
        "pace_windows": [],
    }


def test_analyze_single_word() -> None:
    result = metrics.analyze([Word(text="Hello", start=2.0, end=2.5)])

    assert result["duration"] == 0.5
    assert result["word_count"] == 1
    assert result["words_per_minute"] == 120.0
    assert result["pauses"] == []
    assert result["repeats"] == []
    assert result["pace_windows"] == [{"start": 0.0, "end": 0.5, "wpm": 120.0}]


def test_analyze_pause_at_start_is_neither_a_pause_nor_part_of_the_duration() -> None:
    result = metrics.analyze(words_from("Hello there", start=4.0))  # 4 s of silence first

    assert result["duration"] == 0.7
    assert result["pauses"] == []
    assert result["words_per_minute"] == 171.4
    assert result["pace_windows"] == [{"start": 0.0, "end": 0.7, "wpm": 171.4}]
