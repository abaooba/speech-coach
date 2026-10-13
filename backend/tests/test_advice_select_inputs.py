"""Advice selection (backend/advice/select.py, PLAN T39): what the functions accept.

The request for advice (T40) brings the take's numbers and the speaker's tier as JSON. A band
that is not two usable numbers reads as 140-160 and a tier that is not a tier name reads as
Novice, rather than raising, and the summary can be passed by the PLAN's name, report_summary.
"""

import json
from typing import cast

import pytest

from backend.advice import AdviceEntry, Source
from backend.advice.select import (
    ReportSummary,
    candidates,
    distances_from_target,
    level_for,
    weakest_skills,
)

SOURCE = Source(
    author="",
    credentials="",
    title="Speaking Without Fillers",
    publisher="Debate League Handbook",
    year=None,
    url="https://example.org/speaking-without-fillers",
    type="organization",
)

# Filler advice at both levels, so the level a tier reads decides what is offered.
LIBRARY = [
    AdviceEntry(
        id=entry_id,
        advice="Stay silent where the filler would go.",
        quote="",
        drill="",
        targets=("filler",),
        level=level,
        source=SOURCE,
    )
    for entry_id, level in (
        ("filler-b1", "beginner"),
        ("filler-b2", "beginner"),
        ("filler-a1", "advanced"),
    )
]


def take(**numbers: object) -> ReportSummary:
    """A one-minute take at 150 wpm with no slips, changed by `numbers`."""
    summary = {
        "duration_seconds": 60.0,
        "words_per_minute": 150.0,
        "filler_count": 0,
        "restart_count": 0,
        "mid_sentence_pause_count": 0,
        "long_pause_count": 0,
        **numbers,
    }
    return cast(ReportSummary, summary)


def test_the_summary_can_be_passed_by_its_plan_name() -> None:
    summary = take(filler_count=6, words_per_minute=170.0)

    assert weakest_skills(report_summary=summary) == weakest_skills(summary)
    assert distances_from_target(report_summary=summary) == distances_from_target(summary)


@pytest.mark.parametrize(
    "band",
    [
        # Valid JSON: Python's parser reads integers of up to 4,300 digits.
        json.loads("[140, " + "1" * 400 + "]"),
        [-(10**400), 160],
    ],
)
def test_a_band_with_an_integer_too_large_for_a_float_reads_as_140_to_160(band: object) -> None:
    distances = distances_from_target(take(words_per_minute=170.0, target_wpm=band))

    assert (distances["pace_fast"], distances["pace_slow"]) == (0.5, -1.5)
    assert weakest_skills(take(words_per_minute=170.0, target_wpm=band))[0] == "pace_fast"


@pytest.mark.parametrize("tier", [3, 2.5, True, ["Elite"], {"name": "Elite"}])
def test_a_tier_that_is_not_a_string_reads_as_novice(tier: object) -> None:
    novice = candidates(LIBRARY, ["filler"], "Novice", [], session_id="take")

    assert level_for(cast(str, tier)) == "beginner"
    assert candidates(LIBRARY, ["filler"], cast(str, tier), [], session_id="take") == novice
