"""The research library: speaking advice, each piece tied to the source it was drawn from.

library.json is research data, kept exactly as collected and corrected only by hand.
load_library() reads it once into frozen dataclasses, and citation() writes the short label a
tip is shown with: "Author, Title (Year)".
"""

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

LIBRARY_PATH = Path(__file__).resolve().parent / "library.json"
# Shown in place of the year for an undated source, as reference lists do ("no date").
NO_DATE = "n.d."


@dataclass(frozen=True, slots=True)
class Source:
    """Where a piece of advice comes from.

    `author` is empty when no person is named (an organization's guide, for example) and
    `year` is None when the source is undated. `type` is peer_reviewed, book, coach or
    organization. `credentials` may be empty.
    """

    author: str
    credentials: str
    title: str
    publisher: str
    year: int | None
    url: str
    type: str


@dataclass(frozen=True, slots=True)
class AdviceEntry:
    """One piece of advice and the source it is drawn from.

    `quote` holds the source's own words and `drill` a practice exercise; either may be empty.
    `targets` are the skills it helps with: restart, filler, mid_pause, long_pause, pace_fast,
    pace_slow or general. `level` is beginner or advanced.
    """

    id: str
    advice: str
    quote: str
    drill: str
    targets: tuple[str, ...]
    level: str
    source: Source


def load_library() -> list[AdviceEntry]:
    """Every entry in library.json, in file order.

    The file is read once per process. Each call returns a new list of the same frozen
    entries, so a caller may sort or filter its list without changing anyone else's.
    """
    return list(_entries_from_file())


@cache
def _entries_from_file() -> tuple[AdviceEntry, ...]:
    raw_entries = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    return tuple(_entry_from_json(raw) for raw in raw_entries)


def _entry_from_json(raw: dict[str, Any]) -> AdviceEntry:
    source = raw["source"]
    return AdviceEntry(
        id=raw["id"],
        advice=raw["advice"],
        quote=raw["quote"],
        drill=raw["drill"],
        targets=tuple(raw["targets"]),
        level=raw["level"],
        source=Source(
            author=source["author"],
            credentials=source["credentials"],
            title=source["title"],
            publisher=source["publisher"],
            year=source["year"],
            url=source["url"],
            type=source["type"],
        ),
    )


def citation(entry: AdviceEntry) -> str:
    """The label a tip's source is shown with: "Author, Title (Year)".

    With no author, the publisher is credited in the author's place; with no title, the
    publisher stands in for the title. An undated source gets "n.d.". A part that is still
    empty is left out with its comma: "Title (n.d.)".
    """
    source = entry.source
    if source.author:
        credited, work = source.author, source.title or source.publisher
    else:
        credited, work = source.publisher, source.title
    name = ", ".join(part for part in (credited, work) if part)
    year = NO_DATE if source.year is None else str(source.year)
    return f"{name} ({year})"
