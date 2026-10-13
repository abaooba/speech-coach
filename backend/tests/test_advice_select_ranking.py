"""Advice selection (backend/advice/select.py, PLAN T39): how weakest_skills() ranks a take.

Pace is one skill (PLAN T39: "pace above or below the band") with a library tag for each edge
of the band. A take is nearer one edge, so the far edge's tag ranks last, and the two skills a
take is advised on never tell the speaker to slow down and to speed up at once.
"""

from itertools import product
from typing import cast

from backend.advice import AdviceEntry, Source
from backend.advice.select import SKILLS_ADVISED, ReportSummary, candidates, weakest_skills

PACE_TAGS = {"pace_fast", "pace_slow"}

SOURCE = Source(
    author="Jordan Lee",
    credentials="",
    title="Pace for the Room",
    publisher="Debate Coaches Quarterly",
    year=2021,
    url="https://example.org/pace-for-the-room",
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


def advised(summary: ReportSummary) -> list[str]:
    """The skills a take's advice covers: the first SKILLS_ADVISED of weakest_skills()."""
    return weakest_skills(summary)[:SKILLS_ADVISED]


def entry(entry_id: str, *targets: str) -> AdviceEntry:
    """A made-up beginner entry for `targets`."""
    return AdviceEntry(
        id=entry_id,
        advice="Match your pace to the room.",
        quote="",
        drill="",
        targets=targets,
        level="beginner",
        source=SOURCE,
    )


# Advice to slow down, advice to speed up, and advice on fillers.
LIBRARY = [
    entry("slow-down-1", "pace_fast"),
    entry("slow-down-2", "pace_fast"),
    entry("speed-up-1", "pace_slow"),
    entry("speed-up-2", "pace_slow"),
    entry("filler-1", "filler"),
    entry("filler-2", "filler"),
]

# The owner's 2026-10-11 read of the "Rebuttal: school uniforms" passage (backend/tests/fixtures)
# as app.delivery reports it, with the band frontend/passages.js sets for that passage: Results
# judges the take's pace against 150-170, and that is the band T41 sends with it.
UNIFORMS_TAKE_WITH_ITS_BAND = take(
    duration_seconds=42.882,
    words_per_minute=159.5,
    filler_count=2,
    restart_count=1,
    target_wpm=[150, 170],
)


# --- pace is one skill ------------------------------------------------------------------------


def test_a_clean_take_inside_the_band_is_advised_on_one_pace_edge_only() -> None:
    # 152 wpm is 0.4 of the band below its top edge and 0.6 above its bottom one; one filler in
    # 90 s is two ninths of the target of 3 a minute.
    clean = take(duration_seconds=90.0, words_per_minute=152.0, filler_count=1)

    assert advised(clean) == ["pace_fast", "filler"]


def test_a_take_nearer_the_slow_edge_ranks_pace_fast_last() -> None:
    # 143 wpm is 0.15 of the band above its bottom edge; every count is zero.
    assert weakest_skills(take(words_per_minute=143.0)) == [
        "pace_slow", "restart", "filler", "mid_pause", "long_pause", "pace_fast",
    ]


def test_the_far_edge_of_the_band_always_ranks_last() -> None:
    wrong = []
    for wpm, band in product(range(100, 221), ([140, 160], [150, 170], [120, 140])):
        lo, hi = band
        far_edge = "pace_slow" if wpm >= (lo + hi) / 2 else "pace_fast"
        ranked = weakest_skills(take(words_per_minute=float(wpm), target_wpm=band))
        if ranked[-1] != far_edge:
            wrong.append((wpm, band, ranked))

    assert wrong == []


def test_no_take_is_advised_to_slow_down_and_to_speed_up() -> None:
    wrong = []
    for wpm, fillers, restarts, mid_pauses, long_pauses, seconds in product(
        range(100, 221), range(3), range(2), range(2), range(2), (45.0, 120.0)
    ):
        summary = take(
            duration_seconds=seconds,
            words_per_minute=float(wpm),
            filler_count=fillers,
            restart_count=restarts,
            mid_sentence_pause_count=mid_pauses,
            long_pause_count=long_pauses,
        )
        if PACE_TAGS <= set(advised(summary)):
            wrong.append(summary)

    assert wrong == []


def test_a_clean_take_gets_no_advice_for_the_far_edge_of_its_band() -> None:
    nearer_fast = take(duration_seconds=90.0, words_per_minute=152.0, filler_count=1)
    nearer_slow = take(words_per_minute=143.0, filler_count=1)

    for summary, far_edge_advice in ((nearer_fast, "speed-up"), (nearer_slow, "slow-down")):
        picked = candidates(LIBRARY, weakest_skills(summary), "Varsity", [], session_id="take")
        offered = sorted(item.id for item in picked)

        assert len(offered) == 4
        assert not [entry_id for entry_id in offered if entry_id.startswith(far_edge_advice)]


# --- exact ties --------------------------------------------------------------------------------


def test_rates_exactly_as_far_from_their_targets_tie_whatever_the_float_division_leaves() -> None:
    # One restart and three fillers in 30.012 s are both 60/30.012 times their targets, but the
    # float division leaves the two distances a last digit apart. The long pause (1.0) leads,
    # and the restart wins the tie, as MEASURED_SKILLS lists it first.
    tied = take(duration_seconds=30.012, filler_count=3, restart_count=1, long_pause_count=1)

    assert advised(tied) == ["long_pause", "restart"]


def test_tied_restart_and_filler_rates_keep_their_order_at_any_length() -> None:
    # r restarts and 3r fillers are the same share of their targets at every length.
    wrong = []
    for milliseconds, restarts in product(range(30_000, 180_001, 7), (1, 2)):
        seconds = milliseconds / 1000
        ranked = weakest_skills(
            take(duration_seconds=seconds, restart_count=restarts, filler_count=3 * restarts)
        )
        if ranked.index("restart") + 1 != ranked.index("filler"):
            wrong.append((seconds, restarts))

    assert wrong == []


# --- the real takes, with the band the app sends -----------------------------------------------


def test_the_uniforms_take_against_its_passage_band_is_weakest_in_restarts_then_fillers() -> None:
    # 1.4 restarts a minute is over the target of 1 and 2.8 fillers a minute just under the 3;
    # 159.5 wpm sits mid-band against 150-170.
    assert advised(UNIFORMS_TAKE_WITH_ITS_BAND) == ["restart", "filler"]
