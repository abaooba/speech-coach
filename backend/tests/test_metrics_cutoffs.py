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
    assert metrics.find_repeats(words_from("decisions about— decision about schools")) == [
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


# --- a restart must say the phrase's opening words again --------------------------


def test_a_dash_aside_sharing_only_one_word_with_what_follows_is_not_a_restart() -> None:
    assert metrics.find_repeats(words_from("I think the policy— and I mean this— works")) == []
    assert (
        metrics.find_repeats(words_from("the cost of the plan— and the benefits outweigh it")) == []
    )


def test_a_suspended_hyphen_before_a_repeated_article_is_not_a_restart() -> None:
    assert metrics.find_repeats(words_from("in the short- and the long-term")) == []
    assert metrics.find_repeats(words_from("for the pro- and the anti-war side")) == []


def test_a_one_letter_fragment_does_not_finish_into_any_word() -> None:
    assert metrics.find_repeats(words_from("it was a— and then we left")) == []
    assert metrics.find_repeats(words_from("I— in the end")) == []


def test_the_restart_may_put_one_word_between_the_repeated_words() -> None:
    assert metrics.find_repeats(words_from("students decide— the student decides")) == [
        {"text": "students decide", "at": 0.0}
    ]


# --- the restart starts where the speaker actually began again --------------------


def test_the_restarted_phrase_starts_at_the_closest_matching_word() -> None:
    words = words_from("So I think I kinda ner— I'm kinda nervous")

    assert metrics.find_repeats(words) == [{"text": "I kinda ner", "at": words[3].start}]


def test_a_common_word_earlier_in_the_sentence_does_not_stretch_the_restart() -> None:
    words = words_from("to be honest we need to sto— to stop this")
    assert metrics.find_repeats(words) == [{"text": "to sto", "at": words[5].start}]

    words = words_from("a dog and a ca— a cat")
    assert metrics.find_repeats(words) == [{"text": "a ca", "at": words[3].start}]

    words = words_from("the cat the cat sat on the ma— the mat")
    assert metrics.find_repeats(words) == [
        {"text": "the cat", "at": 0.0},
        {"text": "the ma", "at": words[6].start},
    ]


def test_an_earlier_start_wins_when_more_of_its_words_are_said_again() -> None:
    words = words_from("I'm sure I ner— I am sure I'm nervous")

    assert metrics.find_repeats(words) == [{"text": "I'm sure I ner", "at": 0.0}]


def test_a_later_start_wins_when_it_lines_up_better() -> None:
    words = words_from("I kinda think I kinda ner— I'm kinda nervous")

    assert metrics.find_repeats(words) == [{"text": "I kinda ner", "at": words[3].start}]


def test_one_shared_word_is_not_enough_to_restart_a_longer_phrase() -> None:
    assert metrics.find_repeats(words_from("decisions about— decision making matters")) == []


def test_stutters_before_a_cut_off_still_count_one_repeat_per_extra_copy() -> None:
    words = words_from("I said I I I— I think")

    assert metrics.find_repeats(words) == [
        {"text": "I", "at": words[2].start},
        {"text": "I", "at": words[3].start},
        {"text": "I", "at": words[4].start},
    ]
