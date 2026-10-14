"""The advice library holds no two entries that tell a speaker opposite things.

When newer or stronger evidence contradicts an entry, the contradicted entry is removed (the
owner's rule, 2026-10-14: remove contradictions rather than caveat them). Each id below is gone
for the reason given, and must not come back.
"""

import pytest

from backend.advice import load_library

REMOVED_FOR_CONTRADICTION = {
    # Fillers helped listeners recall a story (Fraundorf & Watson 2011); two follow-ups could not
    # repeat it (filler-127, Muhlack et al. 2021).
    "filler-025": "filler-127",
    # Fewer fillers in formal settings (Clark & Fox Tree 2002); more filled pauses in a formal
    # message than a casual one, in three languages (filler-139, Böttcher & Zellers 2024).
    "filler-059": "filler-139",
    # Fillers come before hard-to-find words (a podcast interview); in a study they marked planning
    # the next idea and were not tied to rarer words (filler-134, Fraundorf & Watson 2014).
    "filler-077": "filler-134",
    # Work on filler sounds before filler words (Laske et al. 2024); in a hiring study overused
    # "like" cost more than "uh" (filler-132, Russell et al. 2008).
    "filler-095": "filler-132",
}

IDS = {entry.id for entry in load_library()}


@pytest.mark.parametrize("removed", sorted(REMOVED_FOR_CONTRADICTION))
def test_a_contradicted_entry_stays_out(removed: str) -> None:
    assert removed not in IDS


@pytest.mark.parametrize("kept", sorted(set(REMOVED_FOR_CONTRADICTION.values())))
def test_the_entry_that_contradicted_it_stays(kept: str) -> None:
    assert kept in IDS
