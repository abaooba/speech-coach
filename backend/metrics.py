"""Speech metrics: pure functions over a list of timed words.

Every function takes the words of one recording in time order, as the providers return
them, and does no I/O. All timing starts at the first spoken word: silence before it is
not a pause and is not part of the duration. Provider times are millisecond precision,
so gaps and durations are rounded to the millisecond and rates to one decimal.
"""

import re
from collections.abc import Sequence
from itertools import pairwise
from typing import TypedDict

from backend.providers.base import Word

DEFAULT_MIN_PAUSE_SECONDS = 1.5
DEFAULT_PACE_WINDOW_SECONDS = 10.0

FILLER_WORDS = ("um", "uh", "hmm", "like", "so", "basically", "actually")
FILLER_PHRASE = ("you", "know")
FILLER_KEYS = ("um", "uh", "hmm", "like", "you know", "so", "basically", "actually")

# Hesitation sounds that may sit between the two copies of a repeated phrase.
REPEAT_SKIP_WORDS = ("um", "uh", "hmm")
MAX_REPEAT_PHRASE_WORDS = 4

_EDGE_PUNCTUATION = re.compile(r"^\W+|\W+$")


class Repeat(TypedDict):
    """A phrase said twice in a row: the phrase as first spoken and when it began."""

    text: str
    at: float


class PaceWindow(TypedDict):
    """Speaking rate over one stretch of the recording, in seconds after the first word."""

    start: float
    end: float
    wpm: float


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
    return _rate(len(words), duration_seconds(words))


def _rate(word_count: int, seconds: float) -> float:
    """Words per minute, or 0.0 when there is no time to divide by."""
    if seconds <= 0:
        return 0.0
    return round(word_count / seconds * 60, 1)


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


def find_repeats(words: Sequence[Word]) -> list[Repeat]:
    """Phrases of up to four words said twice in a row, such as 'and I, uh, and I'.

    Only um/uh/hmm are skipped between the copies; 'like' and 'so' stay, so 'I, like, I'
    is not a repeat. `at` is the start of the first copy in clip seconds. A word
    stuttered three times yields two repeats, one per extra copy.
    """
    spoken = [w for w in words if normalize(w.text) not in ("", *REPEAT_SKIP_WORDS)]
    tokens = [normalize(w.text) for w in spoken]
    repeats: list[Repeat] = []
    index = 0
    while index < len(tokens):
        length = _repeated_phrase_length(tokens, index)
        if length == 0:
            index += 1
            continue
        phrase = spoken[index : index + length]
        repeats.append(Repeat(text=" ".join(clean(w.text) for w in phrase), at=phrase[0].start))
        index += length
    return repeats


def _repeated_phrase_length(tokens: list[str], index: int) -> int:
    """Length of the shortest phrase at `index` that is said again right after it, else 0."""
    for length in range(1, MAX_REPEAT_PHRASE_WORDS + 1):
        first = tokens[index : index + length]
        second = tokens[index + length : index + 2 * length]
        if len(second) < length:
            return 0
        if first == second:
            return length
    return 0


def pace_windows(
    words: Sequence[Word], window: float = DEFAULT_PACE_WINDOW_SECONDS
) -> list[PaceWindow]:
    """Speaking rate in consecutive windows of `window` seconds from the first word.

    The last window ends at the recording's duration. A tail shorter than half a window
    is folded into the window before it, so a few trailing words cannot produce a wild
    rate. Each word belongs to the window its start time falls in.
    """
    if window <= 0:
        raise ValueError("window must be a positive number of seconds")
    if not words:
        return []
    origin = words[0].start
    edges = _window_edges(duration_seconds(words), window)
    counts = [0] * (len(edges) - 1)
    for word in words:
        offset = round(word.start - origin, 3)
        counts[min(int(offset // window), len(counts) - 1)] += 1
    return [
        PaceWindow(start=start, end=end, wpm=_rate(count, end - start))
        for (start, end), count in zip(pairwise(edges), counts, strict=True)
    ]


def _window_edges(duration: float, window: float) -> list[float]:
    """Boundaries [0, window, 2*window, ..., duration], folding away a short final tail."""
    full_windows = int(duration // window)
    tail = duration - full_windows * window
    if full_windows and tail < window / 2:
        full_windows -= 1
    return [i * window for i in range(full_windows + 1)] + [duration]
