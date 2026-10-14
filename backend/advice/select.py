"""Which research-library advice a take gets (PLAN T39). Pure functions, no I/O.

weakest_skills() ranks the six skills a take is measured on by how far the take is from each
target. candidates() then picks the library entries for the two weakest: at the speaker's level,
never shown to the speaker before while new ones are left, in an order seeded by the take's id.
Advice written for competitive debate is never picked (is_debate_specific): Speech Coach coaches
everyday speech. /api/advice (T40) hands the candidates to the model to write 2-3 tips from, and
shows the first ones word for word when it cannot. The caller passes everything in (the library
from load_library(), the take's numbers, the speaker's tier and the ids already shown), so
nothing here reads a file, the clock or the network.
"""

import hashlib
import math
import re
from collections.abc import Sequence
from functools import cache
from itertools import zip_longest
from typing import NotRequired, TypedDict
from urllib.parse import unquote

from backend.advice import AdviceEntry

SECONDS_PER_MINUTE = 60

# The skills a take is measured on, named by their library tags, in the order a tie is broken.
# pace_fast and pace_slow are the two edges of one skill, pace (see weakest_skills). "general"
# advice is about speaking as a whole, so no take is ranked weak in it.
MEASURED_SKILLS = ("restart", "filler", "mid_pause", "long_pause", "pace_fast", "pace_slow")

# The targets. A take right on one is at distance 0 from it (see distances_from_target).
# Under 3 fillers a minute: the line on the Results card, Progress chart and tips (progress.js).
FILLERS_PER_MINUTE_TARGET = 3.0
# 1 restart a minute, our choice, a third of the fillers' line: a listener hears each phrase twice.
RESTARTS_PER_MINUTE_TARGET = 1.0
# 1 mid-sentence pause a minute, our choice: pauses belong at the ends of sentences (how.html).
MID_SENTENCE_PAUSES_PER_MINUTE_TARGET = 1.0
# No long pause: a 5 s freeze reads as a lost place wherever it falls (how.html, "Pauses").
LONG_PAUSES_TARGET = 0
# The pace band when a take sends none: the default in progress.js, results.js and tips.js.
DEFAULT_TARGET_WPM = (140.0, 160.0)
# The distance of a skill the take shows none of: a rate of 0, or no long pause at all.
NONE_AT_ALL = -1.0
# Distances are compared to 9 decimal places: two rates exactly as far from their targets can
# come out of float division a last digit apart, and must still tie.
TIE_DECIMALS = 9

# The rank tiers, lowest first (PLAN T36). The tier comes with the request; rank.js works it out.
TIERS = ("Novice", "Contender", "Varsity", "Elite", "Champion", "Master", "Flawless")
# Advice is beginner level below this tier and advanced from it up (PLAN T39).
FIRST_ADVANCED_TIER = "Elite"
# A speaker with no tier yet, or with one TIERS does not name, is treated as a Novice.
DEFAULT_TIER = "Novice"
BEGINNER = "beginner"
ADVANCED = "advanced"
OTHER_LEVEL = {BEGINNER: ADVANCED, ADVANCED: BEGINNER}

# Advice covers the two weakest skills (PLAN T39): enough for 2-3 tips, few enough to act on.
SKILLS_ADVISED = 2
# Room for the model to choose 2-3 tips that fit the take, in a prompt that stays short.
DEFAULT_CANDIDATE_LIMIT = 25

# Speech Coach is for non-native speakers and anyone who wants to speak more fluidly and sound
# more articulate; it is not a debate tool (the owner's rule, 2026-10-14). These words and
# phrases mark advice written for competitive debate (is_debate_specific). Each matches as whole
# words, ignoring case, and a space inside a phrase also matches a hyphen or a line break, so
# "lincoln douglas" finds "Lincoln-Douglas".
DEBATE_WORDS = (
    # Debate itself, its events and the bodies that run them. The National Speech & Debate
    # Association's web address runs its name together, so it is listed as written there.
    "debate", "debates", "debater", "debaters", "debating",
    "nsda", "speechanddebate", "forensics", "forensic league",
    "public forum", "lincoln douglas", "student congress",
    # The parts of a debate: its speeches, the resolution it argues, its two sides, its ballots.
    "rebuttal", "rebuttals", "cross ex", "cross exam", "cross examination", "cross examine",
    "resolution", "resolutions", "affirm", "affirmative", "negate",
    "opponent", "opponents", "ballot", "ballots",
    # Everyday words that count only in their debate phrases: a Congress (debate event) speech,
    # not the Congress of Phonetic Sciences; a constructive speech, not constructive feedback.
    "congress speech", "congress speeches",
    "constructive speech", "constructive speeches", "constructives",
    # A contest's judge or round. "Judge your progress", the judges who rated speakers in a
    # study and "the next round" of a drill are everyday English, so only these phrases count.
    "a judge", "your judge", "some judges", "lay judge", "lay judges", "parent judge",
    "parent judges", "adult judges", "practice judge", "recitation judges",
    "in front of judges", "for judges", "or judge",
    "your round", "in a round",
    # Speech contests pull the same way: extemp (the contest event), advice "in competition",
    # contest speeches and contest prep time. "Extemporaneous" alone is everyday public
    # speaking, so only the event's short name counts.
    "extemp", "in competition", "contest", "contests",
)
_DEBATE_WORDS_PATTERN = re.compile(
    r"(?<!\w)(?:"
    + "|".join(r"[\s-]+".join(map(re.escape, words.split())) for words in DEBATE_WORDS)
    + r")(?!\w)",
    re.IGNORECASE,
)


class ReportSummary(TypedDict):
    """One take's numbers, as the frontend sends them with a request for advice (T41).

    The frontend reads each one from the take's app.delivery report (frontend/delivery.js),
    which re-scores the /api/analyze output, so they are the numbers the Results screen shows.
    The keys are the JSON keys. A summary without `target_wpm` is judged against
    DEFAULT_TARGET_WPM.
    """

    # Speaking time from the first word to the last: delivery speakingSeconds (analyze duration).
    duration_seconds: float
    # Pace as the Pace card shows it: delivery wordsPerMinute, which leaves out hesitation
    # sounds (the analyze output's words_per_minute counts them).
    words_per_minute: float
    # Hesitation sounds and verbal habits: delivery fillerCount.
    filler_count: int
    # Repeats and restarts, script restarts included: delivery repeatCount (analyze repeats).
    restart_count: int
    # Pauses of 1.5 s or more inside a sentence: delivery midSentencePauseCount.
    mid_sentence_pause_count: int
    # Pauses of 5 s or more, wherever they fall: delivery longPauseCount.
    long_pause_count: int
    # The passage's [lo, hi] pace band in words per minute, the target Results shows.
    target_wpm: NotRequired[list[float]]


def weakest_skills(report_summary: ReportSummary) -> list[str]:
    """Every measured skill's tag, the skill farthest from its target first.

    Ranked by distances_from_target(): the skills past their targets come first, the farthest
    leading, then the skills on target, the one nearest its target first, so a clean take still
    gets advice on what is closest to slipping. Pace is one skill with a tag for each edge of
    the band. A take is nearer one edge, the fast one from the middle of the band up, so the far
    edge's tag ranks last: advice never tells the speaker to slow down and to speed up at once.
    Distances are compared to TIE_DECIMALS places, and ties keep the order of MEASURED_SKILLS.
    """
    distances = {
        skill: round(distance, TIE_DECIMALS)
        for skill, distance in distances_from_target(report_summary).items()
    }
    # The tag for the edge of the pace band the take is farther from.
    far_edge = "pace_slow" if distances["pace_fast"] >= distances["pace_slow"] else "pace_fast"
    return sorted(MEASURED_SKILLS, key=lambda skill: (skill == far_edge, -distances[skill]))


def distances_from_target(report_summary: ReportSummary) -> dict[str, float]:
    """How far the take is from target on each measured skill, by tag. Above 0 is past it.

    Every skill reads on one scale, so different skills compare. A rate is its share of its
    target, less one: 6 fillers a minute against the target of 3 is 1.0, exactly 3 is 0.0 and
    none is -1.0. Long pauses have a target of none, so each one is a full 1.0 and a take
    without one reads -1.0. Pace counts band widths past the edge of the band: against
    140-160, 180 wpm is 1.0 for pace_fast, and 150 wpm is -0.5 for pace_fast and pace_slow.
    """
    minutes = report_summary["duration_seconds"] / SECONDS_PER_MINUTE
    lo, hi = _pace_band(report_summary.get("target_wpm"))
    wpm = report_summary["words_per_minute"]
    long_pauses = report_summary["long_pause_count"]
    return {
        "restart": _rate_distance(
            report_summary["restart_count"], minutes, RESTARTS_PER_MINUTE_TARGET
        ),
        "filler": _rate_distance(
            report_summary["filler_count"], minutes, FILLERS_PER_MINUTE_TARGET
        ),
        "mid_pause": _rate_distance(
            report_summary["mid_sentence_pause_count"],
            minutes,
            MID_SENTENCE_PAUSES_PER_MINUTE_TARGET,
        ),
        "long_pause": float(long_pauses) if long_pauses > LONG_PAUSES_TARGET else NONE_AT_ALL,
        "pace_fast": (wpm - hi) / (hi - lo),
        "pace_slow": (lo - wpm) / (hi - lo),
    }


def _rate_distance(count: float, minutes: float, target_per_minute: float) -> float:
    """A count's rate as a share of its per-minute target, less one.

    With no speaking time there is no rate, as in backend/metrics.py, so it reads NONE_AT_ALL.
    """
    per_minute = count / minutes if minutes > 0 else 0.0
    return per_minute / target_per_minute - 1


def _pace_band(target_wpm: object) -> tuple[float, float]:
    """The take's (lo, hi) pace band, or DEFAULT_TARGET_WPM unless it is two numbers, lo < hi."""
    if isinstance(target_wpm, list | tuple) and len(target_wpm) == 2:
        lo, hi = target_wpm
        if _is_number(lo) and _is_number(hi) and lo < hi:
            return float(lo), float(hi)
    return DEFAULT_TARGET_WPM


def _is_number(value: object) -> bool:
    """True for a finite int or float. A bool is an int in Python, but not a number of wpm.

    An int too large for a float (JSON allows thousands of digits) is not a pace either.
    """
    if not isinstance(value, int | float) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def level_for(tier: str | None) -> str:
    """The library level for a speaker's advice: "advanced" from Elite up, "beginner" below.

    The tier is matched to TIERS ignoring case and surrounding spaces. A missing or unknown
    tier, or anything that is not a string, is DEFAULT_TIER, so a speaker with no rank yet
    starts with beginner advice.
    """
    known = {name.casefold(): name for name in TIERS}
    asked = tier.strip().casefold() if isinstance(tier, str) else ""
    name = known.get(asked, DEFAULT_TIER)
    return ADVANCED if TIERS.index(name) >= TIERS.index(FIRST_ADVANCED_TIER) else BEGINNER


def mentions_debate(text: str) -> bool:
    """True when `text` holds one of DEBATE_WORDS, as whole words and ignoring case."""
    return _DEBATE_WORDS_PATTERN.search(text) is not None


@cache
def is_debate_specific(entry: AdviceEntry) -> bool:
    """True when the entry is advice written for competitive debate, which is never offered.

    Every text of the entry is read with mentions_debate(): its advice and drill (the speaker
    sees the drill word for word, and the model reads both), its quote, and its source's author,
    credentials, title, publisher and URL. The URL is read with its escapes decoded, so
    "%7Edebate" is "~debate". Entries are frozen, so each one is read once.
    """
    source = entry.source
    texts = (
        entry.advice,
        entry.quote,
        entry.drill,
        source.author,
        source.credentials,
        source.title,
        source.publisher,
        unquote(source.url),
    )
    return any(mentions_debate(text) for text in texts)


def candidates(
    library: Sequence[AdviceEntry],
    weak_tags: Sequence[str],
    tier: str | None,
    shown_ids: Sequence[str],
    limit: int = DEFAULT_CANDIDATE_LIMIT,
    *,
    session_id: str,
) -> list[AdviceEntry]:
    """The library entries a take's advice may draw on, best first, at most `limit` of them.

    An entry written for competitive debate (is_debate_specific) is never one of them, under any
    rule below. `weak_tags` is in weakest_skills() order. The first SKILLS_ADVISED different tags
    are used, and their entries take turns, the weakest skill's first; an entry for both is
    listed once. A tag's entries are those found by the first of these rules that finds any:
    1. never shown to the speaker, at the speaker's level (level_for(tier));
    2. never shown, at the other level;
    3. every one, as the speaker has been shown them all: least recently shown first.
    Rules 1 and 2 order their entries by a sha256 hash of `session_id` and the entry's id, a
    seeded shuffle: the same take gets the same list every time, the next take a new one.

    `shown_ids` lists the ids of the entries the speaker has been shown, oldest first; an id
    listed twice counts as last shown at its later place. Ids not in the library, and those of
    entries written for debate, are ignored.
    """
    if limit < 0:
        raise ValueError(f"limit must be 0 or more, not {limit}")
    level = level_for(tier)
    last_shown = {entry_id: place for place, entry_id in enumerate(shown_ids)}
    advisable = [entry for entry in library if not is_debate_specific(entry)]
    # dict.fromkeys keeps the first copy of each tag, in order.
    advised_tags = list(dict.fromkeys(weak_tags))[:SKILLS_ADVISED]
    per_tag = [
        _entries_for_tag(advisable, tag, level, last_shown, session_id) for tag in advised_tags
    ]
    return _taking_turns(per_tag)[:limit]


def _entries_for_tag(
    library: Sequence[AdviceEntry],
    tag: str,
    level: str,
    last_shown: dict[str, int],
    session_id: str,
) -> list[AdviceEntry]:
    """One tag's entries, by the rules in candidates().

    `last_shown` maps each shown id to its place in the shown list, the latest place for an id
    shown twice.
    """
    for_tag = [entry for entry in library if tag in entry.targets]
    never_shown = [entry for entry in for_tag if entry.id not in last_shown]
    for wanted_level in (level, OTHER_LEVEL[level]):
        at_level = [entry for entry in never_shown if entry.level == wanted_level]
        if at_level:
            return sorted(at_level, key=lambda entry: _shuffle_key(session_id, entry.id))
    shown = [entry for entry in for_tag if entry.id in last_shown]
    return sorted(shown, key=lambda entry: last_shown[entry.id])


def _shuffle_key(session_id: str, entry_id: str) -> str:
    """Where an entry falls in a take's seeded shuffle: sha256 of the take's id and its own.

    Python's hash() is salted afresh in every process, so it could not give the same order twice.
    """
    return hashlib.sha256(f"{session_id}:{entry_id}".encode()).hexdigest()


def _taking_turns(lists: Sequence[list[AdviceEntry]]) -> list[AdviceEntry]:
    """One entry from each list in turn, the first list first, each entry at its first place."""
    merged: dict[str, AdviceEntry] = {}
    for row in zip_longest(*lists):
        for entry in row:
            if entry is not None:
                merged.setdefault(entry.id, entry)
    return list(merged.values())
