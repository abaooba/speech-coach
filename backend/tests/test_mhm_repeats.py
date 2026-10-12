"""mhm in repeats: since T31 'mhm' (and 'mhmm', 'mm-hmm', 'mm-hm', 'uh-huh') counts as a filler,
so between two copies of a phrase it is skipped like um/uh/hmm, and it is a sign the speaker
gave up on the words before it, the same as um/uh/hmm. The script alignment leaves it out of a
restart's text the same way."""

import pytest

from backend import metrics, script_align
from backend.providers.base import Word

MHM_SPELLINGS = ("mhm", "Mhm,", "mhmm", "mm-hmm", "Mm-hmm,", "mm-hm", "uh-huh,")


def words_from(spec: str, gap: float = 0.1, length: float = 0.3) -> list[Word]:
    """Build evenly spaced words from a sentence so tests read like speech."""
    words: list[Word] = []
    at = 0.0
    for text in spec.split():
        words.append(Word(text=text, start=at, end=at + length))
        at += length + gap
    return words


@pytest.mark.parametrize("token", ["um", "uh", "hmm", "mhm", "mhmm", "mm-hmm", "mm-hm", "uh-huh"])
def test_every_hesitation_and_every_mhm_spelling_is_skipped_in_repeats(token: str) -> None:
    assert metrics.is_repeat_skip(token)


@pytest.mark.parametrize("token", ["like", "so", "you", "know", "huh", "the", ""])
def test_other_words_are_not_skipped_in_repeats(token: str) -> None:
    assert not metrics.is_repeat_skip(token)


def test_mhm_is_in_the_skip_set_beside_um_uh_hmm() -> None:
    assert metrics.REPEAT_SKIP_WORDS == ("um", "uh", "hmm", "mhm")


@pytest.mark.parametrize("mhm", MHM_SPELLINGS)
def test_mhm_between_two_copies_is_skipped_like_um(mhm: str) -> None:
    repeats = metrics.find_repeats(words_from(f"and I, {mhm} and I think so"))

    assert repeats == [{"text": "and I", "at": 0.0}]


@pytest.mark.parametrize("mhm", MHM_SPELLINGS)
def test_mhm_after_abandoned_words_is_a_sign_the_speaker_gave_up(mhm: str) -> None:
    words = words_from(f"the few decisions a day, {mhm} the few decisions a student makes")

    assert metrics.find_repeats(words) == [{"text": "the few decisions a", "at": 0.0}]


def test_without_a_hesitation_the_same_words_are_parallel_phrasing() -> None:
    words = words_from("the few decisions a day, the few decisions a student makes")

    assert metrics.find_repeats(words) == []


def test_mhm_does_not_use_up_the_cut_off_lookahead() -> None:
    words = words_from("I kinda ner— mhm, like, you know, I'm kinda nervous")

    assert metrics.find_repeats(words) == [{"text": "I kinda ner", "at": 0.0}]


def test_a_script_restart_leaves_mhm_out_of_its_phrase() -> None:
    script = "the few decisions a student makes every day"
    words = words_from("the few mhm decisions a day the few decisions a student makes every day")

    report = script_align.align(words, script)

    assert [restart["text"] for restart in report.restarts] == ["the few decisions a"]
