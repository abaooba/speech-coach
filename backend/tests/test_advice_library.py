"""The research library in backend/advice/library.json, and how a tip cites its source.

The library is research data that the owner fixes by hand, so each rule below lists the ids of
the entries that break it. load_library() gives the entries as frozen dataclasses, read from
the file once; citation() writes the label shown with a tip: "Author, Title (Year)".
"""

import dataclasses
import json
import re
from collections import Counter
from pathlib import Path

import pytest

from backend.advice import AdviceEntry, Source, citation, load_library

LIBRARY_JSON = Path(__file__).resolve().parents[1] / "advice" / "library.json"

REQUIRED_ENTRY_KEYS = {"id", "advice", "quote", "drill", "targets", "level", "source"}
REQUIRED_SOURCE_KEYS = {"author", "credentials", "title", "publisher", "year", "url", "type"}
# The skills the app measures in a take. "general" advice is about speaking as a whole.
MEASURED_TAGS = {"restart", "filler", "mid_pause", "long_pause", "pace_fast", "pace_slow"}
TARGET_TAGS = MEASURED_TAGS | {"general"}
LEVELS = {"beginner", "advanced"}
SOURCE_TYPES = {"peer_reviewed", "book", "coach", "organization"}
WEB_URL = re.compile(r"^https?://")
MAX_QUOTE_WORDS = 25
MAX_ADVICE_WORDS = 70
# A speaker stuck on one skill is shown 2-3 new tips a take, so each measured skill needs
# enough entries to last many takes before a tip comes back.
MIN_ENTRIES_PER_MEASURED_TAG = 50
# Something that names the source, then the year or "n.d.": no empty name, no stray comma.
CITATION_SHAPE = re.compile(r"[^\s,].*[^\s,] \((?:\d+|n\.d\.)\)")

# A made-up source for the citation tests, so they hold whatever the owner edits in the library.
SAMPLE_SOURCE = Source(
    author="Jordan Lee",
    credentials="",
    title="Pausing on Purpose",
    publisher="Debate Coaches Quarterly",
    year=2019,
    url="https://example.org/pausing-on-purpose",
    type="coach",
)


def raw_entries() -> list[dict]:
    """library.json as plain JSON: what the file holds before any loading."""
    return json.loads(LIBRARY_JSON.read_text(encoding="utf-8"))


def word_count(text: str) -> int:
    """Words as a word processor counts them, split on spaces: 'hard-to-predict' is one word."""
    return len(text.split())


def entry_citing(source: Source) -> AdviceEntry:
    """A made-up library entry drawn from `source`."""
    return AdviceEntry(
        id="filler-900",
        advice="Stay silent where the filler would go.",
        quote="",
        drill="",
        targets=("filler",),
        level="beginner",
        source=source,
    )


def test_every_entry_and_its_source_have_the_required_keys() -> None:
    missing: dict[str, list[str]] = {}
    for position, entry in enumerate(raw_entries()):
        source = entry.get("source") or {}
        gaps = sorted(REQUIRED_ENTRY_KEYS - entry.keys())
        gaps += [f"source.{key}" for key in sorted(REQUIRED_SOURCE_KEYS - source.keys())]
        if gaps:
            missing[entry.get("id", f"entry #{position}")] = gaps

    assert missing == {}


def test_entry_ids_are_unique() -> None:
    counts = Counter(entry.id for entry in load_library())

    assert [entry_id for entry_id, count in counts.items() if count > 1] == []


def test_targets_are_known_skill_tags() -> None:
    unknown = {
        entry.id: sorted(set(entry.targets) - TARGET_TAGS)
        for entry in load_library()
        if not set(entry.targets) <= TARGET_TAGS
    }

    assert unknown == {}


def test_level_is_beginner_or_advanced() -> None:
    assert [entry.id for entry in load_library() if entry.level not in LEVELS] == []


def test_source_type_is_a_known_kind() -> None:
    assert [entry.id for entry in load_library() if entry.source.type not in SOURCE_TYPES] == []


def test_source_url_is_a_web_address() -> None:
    assert [entry.id for entry in load_library() if not WEB_URL.match(entry.source.url)] == []


def test_quotes_are_at_most_25_words() -> None:
    too_long = [entry.id for entry in load_library() if word_count(entry.quote) > MAX_QUOTE_WORDS]

    assert too_long == []


def test_advice_is_at_most_70_words() -> None:
    too_long = [entry.id for entry in load_library() if word_count(entry.advice) > MAX_ADVICE_WORDS]

    assert too_long == []


def test_year_is_a_whole_number_or_null() -> None:
    # `type(...) is int` rather than isinstance, because in Python True is an int too.
    not_a_year = [
        entry.id
        for entry in load_library()
        if entry.source.year is not None and type(entry.source.year) is not int
    ]

    assert not_a_year == []


def test_each_measured_tag_has_at_least_50_entries() -> None:
    per_tag = Counter(tag for entry in load_library() for tag in entry.targets)
    short = {
        tag: per_tag[tag]
        for tag in sorted(MEASURED_TAGS)
        if per_tag[tag] < MIN_ENTRIES_PER_MEASURED_TAG
    }

    assert short == {}


def test_citation_reads_author_title_year() -> None:
    assert citation(entry_citing(SAMPLE_SOURCE)) == "Jordan Lee, Pausing on Purpose (2019)"


def test_citation_credits_the_publisher_when_there_is_no_author() -> None:
    no_author = dataclasses.replace(SAMPLE_SOURCE, author="")

    assert citation(entry_citing(no_author)) == (
        "Debate Coaches Quarterly, Pausing on Purpose (2019)"
    )


def test_citation_says_n_d_when_the_year_is_unknown() -> None:
    undated = dataclasses.replace(SAMPLE_SOURCE, year=None)

    assert citation(entry_citing(undated)) == "Jordan Lee, Pausing on Purpose (n.d.)"


def test_citation_with_no_author_and_no_publisher_is_the_title_and_year() -> None:
    title_only = dataclasses.replace(SAMPLE_SOURCE, author="", publisher="", year=None)

    assert citation(entry_citing(title_only)) == "Pausing on Purpose (n.d.)"


def test_citation_with_no_title_names_the_publisher_in_its_place() -> None:
    untitled = dataclasses.replace(SAMPLE_SOURCE, title="")

    assert citation(entry_citing(untitled)) == "Jordan Lee, Debate Coaches Quarterly (2019)"


def test_every_library_entry_gets_a_citation_naming_its_source() -> None:
    malformed = {
        entry.id: citation(entry)
        for entry in load_library()
        if not CITATION_SHAPE.fullmatch(citation(entry))
    }

    assert malformed == {}


def test_load_library_returns_every_entry_in_file_order() -> None:
    assert [entry.id for entry in load_library()] == [entry["id"] for entry in raw_entries()]


def test_entries_and_their_sources_are_frozen_with_targets_as_a_tuple() -> None:
    entry = load_library()[0]

    assert isinstance(entry.targets, tuple)
    with pytest.raises(dataclasses.FrozenInstanceError):
        entry.advice = "Say um more."
    with pytest.raises(dataclasses.FrozenInstanceError):
        entry.source.url = "https://example.org"


def test_the_file_is_read_once_and_each_caller_gets_its_own_list() -> None:
    first, second = load_library(), load_library()

    assert first is not second
    assert all(a is b for a, b in zip(first, second, strict=True))
    first.clear()
    assert len(load_library()) == len(second) > 0
