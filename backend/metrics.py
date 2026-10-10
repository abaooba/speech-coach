"""Speech metrics: pure functions over a list of timed words.

Every function takes the words of one recording in time order, as the providers return
them, and does no I/O. All timing starts at the first spoken word: silence before it is
not a pause and is not part of the duration. Provider times are millisecond precision,
so gaps and durations are rounded to the millisecond and rates to one decimal.
"""

import re
from collections.abc import Sequence
from itertools import pairwise

from backend.providers.base import Word

DEFAULT_MIN_PAUSE_SECONDS = 1.5

FILLER_WORDS = ("um", "uh", "hmm", "like", "so", "basically", "actually")
FILLER_PHRASE = ("you", "know")
FILLER_KEYS = ("um", "uh", "hmm", "like", "you know", "so", "basically", "actually")

_EDGE_PUNCTUATION = re.compile(r"^\W+|\W+$")


def clean(text: str) -> str:
    """Strip punctuation from both ends of a token, keeping its case: 'Um,' -> 'Um'."""
    return _EDGE_PUNCTUATION.sub("", text)


def normalize(text: str) -> str:
    """Lower-case a token and strip edge punctuation so 'Um,' and 'um' compare equal."""
    return clean(text).lower()


def duration_seconds(words: Sequence[Word]) -> float:
    """Seconds from the start of the first word to the end of the last word."""
    if not words:
        return 0.0
    return round(words[-1].end - words[0].start, 3)


def words_per_minute(words: Sequence[Word]) -> float:
    """Speaking rate over the whole recording, counting every token including fillers."""
    duration = duration_seconds(words)
    if duration <= 0:
        return 0.0
    return round(len(words) / duration * 60, 1)


def find_pauses(
    words: Sequence[Word], min_gap: float = DEFAULT_MIN_PAUSE_SECONDS
) -> list[tuple[float, float]]:
    """Gaps between consecutive words of at least min_gap seconds.

    Each pause is (at, length): `at` is the end time of the word before the gap in clip
    seconds, so the frontend can place a marker right after that word.
    """
    pauses: list[tuple[float, float]] = []
    for previous, current in pairwise(words):
        gap = round(current.start - previous.end, 3)
        if gap >= min_gap:
            pauses.append((previous.end, gap))
    return pauses


def count_fillers(words: Sequence[Word]) -> dict[str, int]:
    """How often each filler was said. Always returns every key in FILLER_KEYS.

    The two-word phrase 'you know' counts once and its halves count as nothing else.
    """
    counts = dict.fromkeys(FILLER_KEYS, 0)
    tokens = [normalize(w.text) for w in words]
    index = 0
    while index < len(tokens):
        if tuple(tokens[index : index + 2]) == FILLER_PHRASE:
            counts["you know"] += 1
            index += 2
            continue
        if tokens[index] in FILLER_WORDS:
            counts[tokens[index]] += 1
        index += 1
    return counts
