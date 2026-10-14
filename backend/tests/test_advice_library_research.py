"""The research entries added to backend/advice/library.json in one batch (2026-10-14).

Topic researchers found these entries on fillers, pauses, pace, repairs, fluency practice,
perception and anxiety, and an independent verifier checked each one against its source. They
follow the library's first 482 entries; each id's prefix names the entry's first target, and its
number continues from the highest that prefix had before. These tests pin that growth: every id
of the batch is in the library, each entry cites a study, a book or an organization, and none is
advice written for debate, which coach notes never offer (backend/advice/select.py).
"""

from backend.advice import AdviceEntry, load_library
from backend.advice.select import is_debate_specific

# The batch's ids: (prefix, first number, last number), each run without a gap.
RESEARCH_ID_RANGES = (
    ("filler", 106, 148),
    ("restart", 84, 95),
    ("long", 80, 80),
    ("pause", 78, 90),
    ("pace", 114, 134),
    ("general", 33, 96),
)
RESEARCH_IDS = tuple(
    f"{prefix}-{number:03d}"
    for prefix, first, last in RESEARCH_ID_RANGES
    for number in range(first, last + 1)
)
RESEARCH_ENTRY_COUNT = 154
# A study, a book or an organization's report: none of the batch is a coach's own advice.
RESEARCH_SOURCE_TYPES = {"peer_reviewed", "book", "organization"}


def research_entries() -> list[AdviceEntry]:
    """The batch's entries in RESEARCH_IDS order; every id must be in the library."""
    by_id = {entry.id: entry for entry in load_library()}
    missing = [entry_id for entry_id in RESEARCH_IDS if entry_id not in by_id]
    assert missing == [], f"not in library.json: {missing}"
    return [by_id[entry_id] for entry_id in RESEARCH_IDS]


def test_the_batch_names_154_different_ids() -> None:
    assert len(set(RESEARCH_IDS)) == len(RESEARCH_IDS) == RESEARCH_ENTRY_COUNT


def test_every_research_id_is_in_the_library() -> None:
    library_ids = {entry.id for entry in load_library()}

    assert [entry_id for entry_id in RESEARCH_IDS if entry_id not in library_ids] == []


def test_each_research_entry_cites_a_study_a_book_or_an_organization() -> None:
    wrong = {
        entry.id: entry.source.type
        for entry in research_entries()
        if entry.source.type not in RESEARCH_SOURCE_TYPES
    }

    assert wrong == {}


def test_no_research_entry_is_written_for_debate() -> None:
    assert [entry.id for entry in research_entries() if is_debate_specific(entry)] == []
