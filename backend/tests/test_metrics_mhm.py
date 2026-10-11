"""Agreement sounds count as fillers: 'Mhm.', 'mm-hmm', 'uh-huh' and their spellings all land
on one 'mhm' key, so a take full of them no longer scores as clean."""

import json
from pathlib import Path

from backend import metrics
from backend.providers.assemblyai import to_word
from backend.providers.base import Word

FIXTURES = Path(__file__).parent / "fixtures"


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


def test_mhm_is_a_filler_key() -> None:
    assert "mhm" in metrics.FILLER_WORDS
    assert "mhm" in metrics.FILLER_KEYS
    assert metrics.count_fillers([])["mhm"] == 0


def test_mhm_with_punctuation_counts() -> None:
    counts = metrics.count_fillers(words_from("I would be sad. Mhm. I didn't eat"))

    assert counts["mhm"] == 1
    assert sum(counts.values()) == 1


def test_every_spelling_of_the_agreement_sound_counts_as_mhm() -> None:
    counts = metrics.count_fillers(words_from("mhm Mm-hmm, uh-huh. Mhmm mm-hm Uh-huh!"))

    assert counts["mhm"] == 6
    assert sum(counts.values()) == 6


def test_hmm_keeps_its_own_key_and_huh_is_not_a_filler() -> None:
    counts = metrics.count_fillers(words_from("hmm huh? mm humming"))

    assert counts["hmm"] == 1
    assert counts["mhm"] == 0
    assert sum(counts.values()) == 1


def test_church_take_counts_two_ums_and_one_mhm() -> None:
    fillers = metrics.analyze(load_take("take_2026_10_11_nervous.json"))["fillers"]

    assert isinstance(fillers, dict)
    assert (fillers["um"], fillers["uh"], fillers["hmm"], fillers["mhm"]) == (2, 0, 0, 1)
