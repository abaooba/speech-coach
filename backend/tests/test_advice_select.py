"""Advice selection (backend/advice/select.py, PLAN T39): which skills a take is weakest in, and
which library entries its advice may draw on.

weakest_skills() ranks every measured skill by how far the take is from its target. candidates()
offers entries for the two weakest at the speaker's level, leaves out what the speaker has been
shown while anything new is left, and orders them by a shuffle seeded with the take's id. Most
tests use a small made-up library, so they hold whatever the owner edits in library.json; the
last ones run the real library.
"""

import os
import subprocess
import sys
from itertools import combinations
from pathlib import Path
from typing import cast

import pytest

from backend.advice import AdviceEntry, Source, load_library
from backend.advice.select import (
    DEFAULT_CANDIDATE_LIMIT,
    MEASURED_SKILLS,
    TIERS,
    ReportSummary,
    candidates,
    distances_from_target,
    level_for,
    weakest_skills,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

# The id of the take the advice is for: the frontend's session id.
TAKE_ID = "8b1f6c2e-take-one"

# The owner's two 2026-10-11 takes (backend/tests/fixtures) as app.delivery reports them. In the
# church take the owner froze for 5.19 s after "sad." and restarted "I kinda ner— I'm kinda
# nervous"; the uniforms take restarted "decisions a day— uh, the few decisions a student makes"
# and ran at the top of the 140-160 band.
CHURCH_TAKE: ReportSummary = {
    "duration_seconds": 61.764,
    "words_per_minute": 142.8,
    "filler_count": 3,
    "restart_count": 1,
    "mid_sentence_pause_count": 0,
    "long_pause_count": 1,
}
UNIFORMS_TAKE: ReportSummary = {
    "duration_seconds": 42.882,
    "words_per_minute": 159.5,
    "filler_count": 2,
    "restart_count": 1,
    "mid_sentence_pause_count": 0,
    "long_pause_count": 0,
}

SOURCE = Source(
    author="Jordan Lee",
    credentials="",
    title="Pausing on Purpose",
    publisher="Debate Coaches Quarterly",
    year=2019,
    url="https://example.org/pausing-on-purpose",
    type="coach",
)


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


def entry(entry_id: str, *targets: str, level: str = "beginner") -> AdviceEntry:
    """A made-up library entry for `targets` at `level`."""
    return AdviceEntry(
        id=entry_id,
        advice="Stay silent where the filler would go.",
        quote="",
        drill="",
        targets=targets,
        level=level,
        source=SOURCE,
    )


# Fillers and restarts have advice at both levels, long pauses only beginner advice and a fast
# pace only advanced, and one entry helps with fillers and restarts alike.
LIBRARY = [
    entry("filler-b1", "filler"),
    entry("filler-b2", "filler"),
    entry("filler-b3", "filler"),
    entry("filler-a1", "filler", level="advanced"),
    entry("filler-a2", "filler", level="advanced"),
    entry("restart-b1", "restart"),
    entry("restart-b2", "restart"),
    entry("restart-a1", "restart", level="advanced"),
    entry("both-b1", "filler", "restart"),
    entry("long-b1", "long_pause"),
    entry("long-b2", "long_pause"),
    entry("pace-a1", "pace_fast", level="advanced"),
    entry("general-b1", "general"),
]
# Every filler entry in LIBRARY, in an order a speaker might have been shown them, oldest first.
ALL_FILLERS_SHOWN = ["filler-a2", "both-b1", "filler-b3", "filler-a1", "filler-b1", "filler-b2"]


def ids(entries: list[AdviceEntry]) -> list[str]:
    return [item.id for item in entries]


def offered(
    weak_tags: list[str],
    tier: str | None = "Novice",
    shown: list[str] | None = None,
    limit: int = DEFAULT_CANDIDATE_LIMIT,
) -> list[str]:
    """The ids candidates() offers from LIBRARY for the take TAKE_ID."""
    picked = candidates(LIBRARY, weak_tags, tier, shown or [], limit, session_id=TAKE_ID)
    return ids(picked)


# --- the summary the frontend sends ---------------------------------------------------------


def test_the_summary_holds_six_numbers_and_an_optional_pace_band() -> None:
    assert ReportSummary.__required_keys__ == {
        "duration_seconds",
        "words_per_minute",
        "filler_count",
        "restart_count",
        "mid_sentence_pause_count",
        "long_pause_count",
    }
    assert ReportSummary.__optional_keys__ == {"target_wpm"}


# --- how far each skill is from target ------------------------------------------------------


def test_the_measured_skills_are_library_tags_in_plan_order() -> None:
    library_tags = {tag for item in load_library() for tag in item.targets}

    assert MEASURED_SKILLS == (
        "restart", "filler", "mid_pause", "long_pause", "pace_fast", "pace_slow",
    )
    assert set(MEASURED_SKILLS) <= library_tags


@pytest.mark.parametrize(
    ("field", "count", "skill", "distance"),
    [
        ("filler_count", 6, "filler", 1.0),
        ("filler_count", 3, "filler", 0.0),
        ("filler_count", 0, "filler", -1.0),
        ("restart_count", 2, "restart", 1.0),
        ("restart_count", 1, "restart", 0.0),
        ("mid_sentence_pause_count", 3, "mid_pause", 2.0),
        ("mid_sentence_pause_count", 0, "mid_pause", -1.0),
    ],
)
def test_a_rate_reads_as_its_share_of_the_target_minus_one(
    field: str, count: int, skill: str, distance: float
) -> None:
    # Targets: under 3 fillers, 1 restart and 1 mid-sentence pause a minute.
    assert distances_from_target(take(**{field: count}))[skill] == distance


def test_rates_are_per_minute_of_speaking_time() -> None:
    two_minutes = take(duration_seconds=120.0, filler_count=6, restart_count=3)

    distances = distances_from_target(two_minutes)

    assert (distances["filler"], distances["restart"]) == (0.0, 0.5)


@pytest.mark.parametrize(("count", "distance"), [(0, -1.0), (1, 1.0), (3, 3.0)])
def test_each_long_pause_is_a_full_step_past_a_target_of_none(
    count: int, distance: float
) -> None:
    assert distances_from_target(take(long_pause_count=count))["long_pause"] == distance


@pytest.mark.parametrize(
    ("wpm", "fast", "slow"),
    [
        (180.0, 1.0, -2.0),
        (160.0, 0.0, -1.0),
        (150.0, -0.5, -0.5),
        (130.0, -1.5, 0.5),
    ],
)
def test_pace_reads_in_band_widths_past_the_edge_of_the_band(
    wpm: float, fast: float, slow: float
) -> None:
    distances = distances_from_target(take(words_per_minute=wpm))

    assert (distances["pace_fast"], distances["pace_slow"]) == (fast, slow)


def test_a_pace_band_sent_with_the_take_replaces_the_default() -> None:
    distances = distances_from_target(take(words_per_minute=150.0, target_wpm=[120, 140]))

    assert (distances["pace_fast"], distances["pace_slow"]) == (0.5, -1.5)


@pytest.mark.parametrize("band", [None, [], [150], [160, 140], [150, 150], ["fast", "slow"]])
def test_a_missing_or_malformed_band_reads_as_140_to_160(band: object) -> None:
    distances = distances_from_target(take(words_per_minute=170.0, target_wpm=band))

    assert (distances["pace_fast"], distances["pace_slow"]) == (0.5, -1.5)


def test_a_take_with_no_speaking_time_reads_every_rate_as_none() -> None:
    silent = take(
        duration_seconds=0.0, filler_count=4, restart_count=2, mid_sentence_pause_count=1
    )

    distances = distances_from_target(silent)

    assert (distances["filler"], distances["restart"], distances["mid_pause"]) == (
        -1.0, -1.0, -1.0,
    )


# --- the weakest skills -----------------------------------------------------------------------


def test_every_measured_skill_is_ranked_once() -> None:
    assert sorted(weakest_skills(take())) == sorted(MEASURED_SKILLS)


def test_the_skill_farthest_past_its_target_ranks_first() -> None:
    # Two minutes: 9 fillers a minute (2.0), one long pause (1.0), 1.5 restarts a minute (0.5),
    # 165 wpm (0.25 fast), 0.5 mid-sentence pauses a minute (-0.5) and 25 wpm over the slow edge.
    struggling = take(
        duration_seconds=120.0,
        words_per_minute=165.0,
        filler_count=18,
        restart_count=3,
        mid_sentence_pause_count=1,
        long_pause_count=1,
    )

    assert weakest_skills(struggling) == [
        "filler", "long_pause", "restart", "pace_fast", "mid_pause", "pace_slow",
    ]


def test_one_long_pause_outranks_fillers_a_little_over_their_target() -> None:
    assert weakest_skills(take(filler_count=4, long_pause_count=1))[:2] == ["long_pause", "filler"]


def test_fillers_far_over_their_target_outrank_one_long_pause() -> None:
    assert weakest_skills(take(filler_count=12, long_pause_count=1))[:2] == ["filler", "long_pause"]


def test_a_clean_take_ranks_the_skills_nearest_their_targets_first() -> None:
    # 158 wpm is a tenth of the band from its top; 2 fillers a minute use two thirds of the 3.
    clean = take(words_per_minute=158.0, filler_count=2)

    assert weakest_skills(clean) == [
        "pace_fast", "filler", "restart", "mid_pause", "long_pause", "pace_slow",
    ]


def test_ties_keep_the_order_of_the_measured_skills() -> None:
    # 150 wpm sits mid-band (-0.5 each way); every count is zero (-1.0). From the middle up the
    # take counts as nearer the fast edge, so pace_slow, the far edge, goes last.
    assert weakest_skills(take()) == [
        "pace_fast", "restart", "filler", "mid_pause", "long_pause", "pace_slow",
    ]


def test_the_church_take_is_weakest_in_its_long_pause_then_restarts_and_fillers() -> None:
    ranked = weakest_skills(CHURCH_TAKE)

    # One restart and three fillers in 61.8 s are each just under their targets.
    assert ranked[0] == "long_pause"
    assert set(ranked[1:3]) == {"restart", "filler"}


def test_the_uniforms_take_is_weakest_in_restarts_then_its_pace() -> None:
    # 1.4 restarts a minute is over the target of 1; 159.5 wpm is at the top of the band.
    assert weakest_skills(UNIFORMS_TAKE)[:2] == ["restart", "pace_fast"]


# --- the level a tier reads -------------------------------------------------------------------


def test_the_tiers_run_from_novice_to_flawless() -> None:
    assert TIERS == ("Novice", "Contender", "Varsity", "Elite", "Champion", "Master", "Flawless")


@pytest.mark.parametrize("tier", ["Novice", "Contender", "Varsity"])
def test_tiers_below_elite_get_beginner_advice(tier: str) -> None:
    assert level_for(tier) == "beginner"
    assert sorted(offered(["filler", "restart"], tier)) == [
        "both-b1", "filler-b1", "filler-b2", "filler-b3", "restart-b1", "restart-b2",
    ]


@pytest.mark.parametrize("tier", ["Elite", "Champion", "Master", "Flawless"])
def test_elite_and_up_get_advanced_advice(tier: str) -> None:
    assert level_for(tier) == "advanced"
    assert sorted(offered(["filler", "restart"], tier)) == ["filler-a1", "filler-a2", "restart-a1"]


@pytest.mark.parametrize("tier", [None, "", "Grandmaster", "Gold"])
def test_a_missing_or_unknown_tier_reads_as_novice(tier: str | None) -> None:
    assert level_for(tier) == "beginner"
    assert offered(["filler"], tier) == offered(["filler"], "Novice")


@pytest.mark.parametrize(
    ("tier", "level"),
    [
        ("elite", "advanced"),
        (" CHAMPION ", "advanced"),
        ("flawless\n", "advanced"),
        ("varsity", "beginner"),
    ],
)
def test_tier_names_match_ignoring_case_and_surrounding_spaces(tier: str, level: str) -> None:
    assert level_for(tier) == level


def test_with_no_advice_at_the_speaker_level_the_other_level_is_offered() -> None:
    assert sorted(offered(["long_pause"], "Elite")) == ["long-b1", "long-b2"]
    assert offered(["pace_fast"], "Novice") == ["pace-a1"]


# --- what the speaker has been shown --------------------------------------------------------


def test_entries_already_shown_are_left_out() -> None:
    assert sorted(offered(["filler"], shown=["filler-b1", "filler-b3"])) == [
        "both-b1", "filler-b2",
    ]


def test_new_advice_at_the_other_level_comes_before_any_repeat() -> None:
    every_beginner_filler = ["filler-b1", "filler-b2", "filler-b3", "both-b1"]

    assert sorted(offered(["filler"], shown=every_beginner_filler)) == ["filler-a1", "filler-a2"]


def test_when_a_skill_runs_out_the_least_recently_shown_come_back_first() -> None:
    assert offered(["filler"], shown=ALL_FILLERS_SHOWN) == ALL_FILLERS_SHOWN


def test_an_entry_shown_twice_counts_from_its_latest_showing() -> None:
    shown = [
        "filler-b1", "filler-b2", "filler-b3", "both-b1", "filler-a1", "filler-a2", "filler-b1",
    ]

    assert offered(["filler"], shown=shown) == [
        "filler-b2", "filler-b3", "both-b1", "filler-a1", "filler-a2", "filler-b1",
    ]


def test_ids_no_longer_in_the_library_are_ignored() -> None:
    assert offered(["filler"], shown=["filler-999", *ALL_FILLERS_SHOWN]) == ALL_FILLERS_SHOWN


def test_a_skill_that_ran_out_repeats_while_the_other_still_offers_new_advice() -> None:
    shown = [*ALL_FILLERS_SHOWN, "long-b1"]

    assert offered(["filler", "long_pause"], shown=shown) == [
        "filler-a2", "long-b2", "both-b1", "filler-b3", "filler-a1", "filler-b1", "filler-b2",
    ]


# --- which skills, and in what order --------------------------------------------------------


def test_only_entries_for_the_two_weakest_skills_are_offered() -> None:
    assert sorted(offered(["filler", "restart", "long_pause", "pace_fast"])) == [
        "both-b1", "filler-b1", "filler-b2", "filler-b3", "restart-b1", "restart-b2",
    ]


def test_a_weak_skill_listed_twice_counts_once() -> None:
    assert sorted(offered(["filler", "filler", "long_pause", "restart"])) == [
        "both-b1", "filler-b1", "filler-b2", "filler-b3", "long-b1", "long-b2",
    ]


def test_the_two_skills_take_turns_the_weaker_first() -> None:
    fillers = offered(["filler"])
    long_pauses = offered(["long_pause"])

    assert offered(["filler", "long_pause"]) == [
        fillers[0], long_pauses[0], fillers[1], long_pauses[1], fillers[2], fillers[3],
    ]


def test_an_entry_for_both_weak_skills_is_offered_once() -> None:
    both = offered(["filler", "restart"])

    assert both.count("both-b1") == 1
    assert len(both) == len(set(both))


def test_no_weak_skills_means_no_candidates() -> None:
    assert offered([]) == []


# --- a stable order for each take -----------------------------------------------------------


def test_the_same_take_always_gets_the_same_candidates() -> None:
    library = load_library()

    first = candidates(library, ["filler", "restart"], "Varsity", [], session_id=TAKE_ID)
    again = candidates(library, ["filler", "restart"], "Varsity", [], session_id=TAKE_ID)

    assert ids(first) == ids(again)


def test_the_order_does_not_follow_the_library_order() -> None:
    library = load_library()

    forward = candidates(library, ["filler", "restart"], "Elite", [], session_id=TAKE_ID)
    backward = candidates(library[::-1], ["filler", "restart"], "Elite", [], session_id=TAKE_ID)

    assert ids(forward) == ids(backward)


def test_each_take_gets_its_own_order_of_the_same_entries() -> None:
    library = load_library()

    one = ids(candidates(library, ["filler"], "Novice", [], limit=500, session_id="take-1"))
    two = ids(candidates(library, ["filler"], "Novice", [], limit=500, session_id="take-2"))

    assert sorted(one) == sorted(two)
    assert one != two


def test_the_order_is_the_same_in_every_python_process() -> None:
    # Python salts str hashes per process (PYTHONHASHSEED), so an order seeded with hash() or
    # read off a set would change between these runs.
    script = (
        "from backend.advice import load_library\n"
        "from backend.advice.select import candidates\n"
        "picked = candidates(load_library(), ['restart', 'mid_pause'], 'Varsity', [],"
        f" session_id={TAKE_ID!r})\n"
        "print(' '.join(item.id for item in picked))\n"
    )
    expected = ids(
        candidates(load_library(), ["restart", "mid_pause"], "Varsity", [], session_id=TAKE_ID)
    )

    for seed in ("1", "2"):
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            check=True,
            cwd=REPO_ROOT,
            env={**os.environ, "PYTHONHASHSEED": seed},
        )
        assert result.stdout.split() == expected


# --- how many -------------------------------------------------------------------------------


def test_at_most_25_candidates_by_default() -> None:
    picked = candidates(load_library(), ["filler", "restart"], "Novice", [], session_id=TAKE_ID)

    assert DEFAULT_CANDIDATE_LIMIT == 25
    assert len(picked) == 25


def test_a_limit_keeps_the_top_of_the_list() -> None:
    assert offered(["filler", "restart"], limit=3) == offered(["filler", "restart"])[:3]


def test_a_limit_above_what_is_left_offers_everything_left() -> None:
    assert sorted(offered(["long_pause"], limit=25)) == ["long-b1", "long-b2"]


def test_a_limit_of_zero_offers_nothing() -> None:
    assert offered(["filler"], limit=0) == []


def test_a_negative_limit_is_refused() -> None:
    with pytest.raises(ValueError):
        offered(["filler"], limit=-1)


# --- the real library -----------------------------------------------------------------------


@pytest.mark.parametrize("tier", TIERS)
def test_every_pair_of_skills_gets_25_entries_at_the_tier_level(tier: str) -> None:
    library = load_library()
    wrong: dict[tuple[str, ...], list[str]] = {}
    for pair in combinations(MEASURED_SKILLS, 2):
        picked = candidates(library, list(pair), tier, [], session_id=TAKE_ID)
        off_target = [
            item.id
            for item in picked
            if item.level != level_for(tier) or not set(pair) & set(item.targets)
        ]
        if len(set(ids(picked))) != DEFAULT_CANDIDATE_LIMIT or off_target:
            wrong[pair] = off_target

    assert wrong == {}


def test_advice_for_the_church_take_opens_on_its_long_pause() -> None:
    picked = candidates(
        load_library(), weakest_skills(CHURCH_TAKE), "Contender", [], session_id=TAKE_ID
    )

    assert "long_pause" in picked[0].targets
    assert picked[0].level == "beginner"
