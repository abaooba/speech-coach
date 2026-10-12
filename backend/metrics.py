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

FILLER_WORDS = ("um", "uh", "hmm", "mhm", "like", "so", "basically", "actually")
FILLER_PHRASE = ("you", "know")
FILLER_KEYS = ("um", "uh", "hmm", "mhm", "like", "you know", "so", "basically", "actually")
# Agreement sounds the speaker makes to fill a gap, in any spelling ('mhmm', 'mm-hmm', 'mm-hm',
# 'uh-huh'), all count under the 'mhm' key.
_AGREEMENT_SOUND = re.compile(r"^(?:m+-?h+m+|u+h+-h+u+h+)$")

# Hesitation sounds that may sit between the two copies of a repeated phrase.
REPEAT_SKIP_WORDS = ("um", "uh", "hmm")
# Long enough that reading a whole clause again counts as one repeat.
MAX_REPEAT_PHRASE_WORDS = 8
# A restart is a phrase of at least two words said again after the speaker gave up on a few
# words: 'the few decisions a day, uh, the few decisions a student'. At most this many
# abandoned words may sit between the copies; um/uh/hmm there are skipped and do not count.
RESTART_MAX_ABANDONED_WORDS = 2
# A dash at the end of a word marks where the speaker cut themselves off ('day—'); AssemblyAI
# writes it into the word text. A hyphen inside a word ('well-known') is not a cut-off.
CUTOFF_MARKS = ("—", "–", "-")
# After a cut-off the speaker must start again within this many words (um/uh/hmm not counted)
# for it to be a restart: 'I kinda ner— I'm kinda nervous'.
CUTOFF_LOOKAHEAD_WORDS = 4
# A cut-off fragment shorter than this ('a—') is not matched to a word it begins ('and').
CUTOFF_MIN_FRAGMENT_LETTERS = 2

_EDGE_PUNCTUATION = re.compile(r"^\W+|\W+$")
_SENTENCE_END = re.compile(r"[.?!][\"')\]]*$")
_CONTRACTION = re.compile(r"(?:n['’]t|['’](?:m|s|re|ve|ll|d))$")


class Repeat(TypedDict):
    """A phrase said twice in a row or restarted: the phrase as first spoken and when it began."""

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


def filler_key(token: str) -> str | None:
    """The FILLER_WORDS key a normalized token counts under ('mm-hmm' -> 'mhm'), else None."""
    key = "mhm" if _AGREEMENT_SOUND.match(token) else token
    return key if key in FILLER_WORDS else None


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

    Every spelling of the agreement sound ('Mhm.', 'mm-hmm', 'uh-huh') counts as 'mhm'.
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
        key = filler_key(tokens[index])
        if key is not None:
            counts[key] += 1
        index += 1
    return counts


def find_repeats(words: Sequence[Word]) -> list[Repeat]:
    """Phrases of up to eight words said twice in a row, such as 'and I, uh, and I', or restarted.

    Only um/uh/hmm are skipped between the copies; 'like' and 'so' stay, so 'I, like, I'
    is not a repeat. A restart is a phrase of two or more words said again after up to
    RESTART_MAX_ABANDONED_WORDS abandoned words, when something shows the speaker gave up:
    um/uh/hmm between the copies or a cut-off mark on an abandoned word ('day—'). Without
    that sign, parallel phrasing ('we need to protect, we need to defend') is deliberate,
    not a restart; nor is a new sentence that opens like the last one.
    A cut-off restart is a phrase ending in a cut-off word ('I kinda ner—') that the speaker
    starts again within CUTOFF_LOOKAHEAD_WORDS words ('I'm kinda nervous'); its text is the
    abandoned phrase up to the fragment.
    `at` is the start of the first copy in clip seconds. A word stuttered three times
    yields two repeats, one per extra copy. Matches never overlap: the search goes on from
    the second copy, so a stutter among the abandoned words is part of the restart.
    """
    spoken: list[Word] = []
    hesitation_before: list[bool] = []
    hesitated = False
    for word in words:
        token = normalize(word.text)
        if token in REPEAT_SKIP_WORDS:
            hesitated = True
        elif token:
            spoken.append(word)
            hesitation_before.append(hesitated)
            hesitated = False
    tokens = [normalize(w.text) for w in spoken]
    repeats: list[Repeat] = []
    index = 0
    while index < len(tokens):
        length, abandoned = _repeated_phrase_length(tokens, index), 0
        if length == 0:
            length, abandoned = _restarted_phrase(spoken, tokens, hesitation_before, index)
        if length == 0:
            length, abandoned = _cut_off_phrase(spoken, tokens, index)
        if length == 0:
            index += 1
            continue
        phrase = spoken[index : index + length]
        repeats.append(Repeat(text=" ".join(clean(w.text) for w in phrase), at=phrase[0].start))
        index += length + abandoned
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


def _restarted_phrase(
    spoken: list[Word], tokens: list[str], hesitation_before: list[bool], index: int
) -> tuple[int, int]:
    """(phrase length, abandoned words) of the longest restart at `index`, else (0, 0).

    `tokens[i]` is the normalized text of `spoken[i]`, and `hesitation_before[i]` says
    whether um/uh/hmm came just before it. Among equally long phrases the one with the
    fewest abandoned words wins.
    """
    for length in range(MAX_REPEAT_PHRASE_WORDS, 1, -1):
        first = tokens[index : index + length]
        for abandoned in range(1, RESTART_MAX_ABANDONED_WORDS + 1):
            second_start = index + length + abandoned
            second = tokens[second_start : second_start + length]
            if first != second:
                continue
            # The last word of the first copy, then the abandoned words.
            between = spoken[index + length - 1 : second_start]
            if any(_SENTENCE_END.search(word.text) for word in between):
                continue
            hesitated = any(hesitation_before[index + length : second_start + 1])
            cut_off = any(word.text.endswith(CUTOFF_MARKS) for word in between[1:])
            if hesitated or cut_off:
                return length, abandoned
    return 0, 0


def _cut_off_phrase(spoken: list[Word], tokens: list[str], index: int) -> tuple[int, int]:
    """(phrase length, words before the restart) of a cut-off restart at `index`, else (0, 0).

    The phrase runs from `index` to the first word ending in a cut-off mark, within one
    sentence and at most MAX_REPEAT_PHRASE_WORDS long. It is a restart when the speaker says
    its opening words again soon after the cut (see _cut_off_match). When a later start
    before the cut lines up at least as well ('So I think I kinda ner— I'm kinda'), that
    later start is the real one, so this index is not. The words before the restart are
    abandoned.
    """
    for cut in range(index, min(index + MAX_REPEAT_PHRASE_WORDS, len(spoken))):
        if spoken[cut].text.endswith(CUTOFF_MARKS):
            break
        if _SENTENCE_END.search(spoken[cut].text):
            return 0, 0
    else:
        return 0, 0
    matched, restart = _cut_off_match(spoken, tokens, index, cut)
    needed = 1 if index == cut else 2
    if matched < needed:
        return 0, 0
    if any(
        _cut_off_match(spoken, tokens, later, cut)[0] >= matched
        for later in range(index + 1, cut + 1)
    ):
        return 0, 0
    return cut - index + 1, restart - cut - 1


def _cut_off_match(spoken: list[Word], tokens: list[str], start: int, cut: int) -> tuple[int, int]:
    """(words matched, restart index) for the phrase tokens[start : cut + 1] said again.

    The restart is one of the CUTOFF_LOOKAHEAD_WORDS words after the cut that has the same
    stem as the phrase's first word (I/I'm, decision/decisions), or, for a phrase that is only
    the fragment, begins with it ('pro—' then 'protect'). From there the phrase's words are
    matched in order, one inserted word allowed before each ('I'm going to— I am going'),
    until one is missing. The restart matching the most words wins, the earliest on a tie.
    """
    phrase = tokens[start : cut + 1]
    best = (0, 0)
    for restart in range(cut + 1, min(cut + 1 + CUTOFF_LOOKAHEAD_WORDS, len(spoken))):
        if says_again(phrase[0], tokens[restart], is_fragment=start == cut):
            matched, at = 1, restart + 1
            for position, token in enumerate(phrase[1:], start=start + 1):
                following = tokens[at : at + 2]
                hits = [says_again(token, said, is_fragment=position == cut) for said in following]
                if not any(hits):
                    break
                matched, at = matched + 1, at + hits.index(True) + 1
            if matched > best[0]:
                best = (matched, restart)
        if _SENTENCE_END.search(spoken[restart].text):
            break
    return best


def says_again(token: str, said: str, is_fragment: bool) -> bool:
    """Whether `said` repeats `token`: the same stem, or the cut-off fragment finished."""
    if _stem(said) == _stem(token):
        return True
    return is_fragment and len(token) >= CUTOFF_MIN_FRAGMENT_LETTERS and said.startswith(token)


def _stem(token: str) -> str:
    """A normalized token without its contraction or plural ending: "I'm" -> 'i'."""
    token = _CONTRACTION.sub("", token)
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


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


def analyze(words: Sequence[Word]) -> dict[str, object]:
    """Every metric for one recording, in the shape the API returns and the frontend stores.

    Keys: words_per_minute, duration (seconds from the first word), word_count,
    pauses ([at, length] pairs), fillers (every key in FILLER_KEYS), repeats ({text, at}) and
    pace_windows ({start, end, wpm}). JSON-serializable as is.
    """
    return {
        "words_per_minute": words_per_minute(words),
        "duration": duration_seconds(words),
        "word_count": len(words),
        "pauses": find_pauses(words),
        "fillers": count_fillers(words),
        "repeats": find_repeats(words),
        "pace_windows": pace_windows(words),
    }
