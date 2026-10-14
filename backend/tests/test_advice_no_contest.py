"""Coach notes leave out advice written for speech contests, as they leave out debate advice.

Speech Coach is for non-native speakers and anyone who wants to speak more fluidly (the owner's
rule, 2026-10-14). Advice framed around contest events (extemp, "in competition", contest
speeches and prep time) pulls toward competitive speaking just as debate advice does, so
is_debate_specific() flags it too. General fluency advice from the same sources still passes.
"""

import pytest

from backend.advice import load_library, select

ENTRIES = {entry.id: entry for entry in load_library()}

CONTEST_ENTRY_IDS = [
    "restart-022",  # "In competition, a short fluency break costs less than ..."
    "long-027",  # "If you lose your place in an extemp speech, ..."
    "long-031",  # "For contest speeches, learn the text well enough ..."
    "long-043",  # "In extemp prep, run through elements of your speech ..."
    "long-076",  # "Extemp Drill List"
    "pace-028",  # 'Strategy: "Interping" Extemp'
    "general-021",  # "In extemp, spend about half of your prep time ..."
    "general-022",  # "Work your way down to contest prep time."
    "general-029",  # "Extemp Drill List"
]

# Everyday advice that must keep passing: a random-word talk drill, and entries whose words
# merely look close ("context", "content").
EVERYDAY_ENTRY_IDS = ["filler-081"]


@pytest.mark.parametrize("entry_id", CONTEST_ENTRY_IDS)
def test_contest_advice_is_left_out(entry_id: str) -> None:
    assert select.is_debate_specific(ENTRIES[entry_id]), entry_id


@pytest.mark.parametrize("entry_id", EVERYDAY_ENTRY_IDS)
def test_everyday_advice_still_passes(entry_id: str) -> None:
    assert not select.is_debate_specific(ENTRIES[entry_id]), entry_id


@pytest.mark.parametrize("text", ["In context, slow down.", "Keep the content simple."])
def test_words_that_only_look_like_contest_pass(text: str) -> None:
    assert not select.mentions_debate(text)
