"""Script alignment: line a take up word by word against the script it was read from.

Pure functions, no I/O. The spoken words and the script words are normalized the same way as
the metrics (backend/metrics.py) and lined up with Needleman-Wunsch global alignment, which
finds the cheapest way to turn one list into the other by reading, misreading, skipping and
adding words. That is O(spoken x script) time and memory: a 3-minute take (~600 words)
against a 600-word script is 360,000 cells.

From the alignment come three lists: restarts (the speaker went back to script words already
passed), skipped script words and misread ones. Fillers in speech ('um', 'like', 'you know')
are not part of the reading and are ignored.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from backend.metrics import (
    FILLER_PHRASE,
    MAX_REPEAT_PHRASE_WORDS,
    Repeat,
    clean,
    filler_key,
    normalize,
)
from backend.providers.base import Word

# Reading the next script word as written is what the speaker should do, so it costs nothing.
MATCH_COST = 0
# A skipped script word, or a spoken word the script does not have at that point.
GAP_COST = 2
# Above one gap, so a dropped or added word is never explained as a run of shifted misreads;
# below two gaps, so one word said in place of another is one misread, not a skip plus an extra.
MISREAD_COST = 3
# Fillers are not reading, so saying one anywhere costs nothing and never counts as an extra.
FILLER_COST = 0
# How far back, in script words, an extra spoken word may jump to start a restart; the same
# reach as a repeated phrase in free talk, so a whole clause read again counts.
RESTART_MAX_GO_BACK_WORDS = MAX_REPEAT_PHRASE_WORDS

# One alignment step: (spoken index, script index). Both set is a read word (a match or a
# misread), (i, None) is a spoken word with no script word, (None, j) a skipped script word.
type Step = tuple[int | None, int | None]


@dataclass(frozen=True, slots=True)
class ScriptSlip:
    """A script word not read as written: skipped (said is None) or misread as `said`.

    `word` is the script word without edge punctuation and `index` its position in
    script.split(). `at` is in clip seconds: the start of the misread word, or for a skip the
    end of the spoken word before it (the start of the take when nothing came before).
    """

    word: str
    index: int
    at: float
    said: str | None = None


@dataclass(frozen=True, slots=True)
class ScriptReport:
    """What went wrong reading one script: restarts, then skipped and misread script words."""

    restarts: list[Repeat]
    skipped: list[ScriptSlip]
    misread: list[ScriptSlip]


def align(words: Sequence[Word], script: str) -> ScriptReport:
    """Line the take's words up against `script` and report restarts, skips and misreads.

    A misread is a spoken word in the place of a different script word. A skip is a script
    word with no spoken word against it. A restart is the speaker going back to a script
    position already passed, as in 'the few decisions a day — the few decisions a student':
    its text is the phrase as first spoken up to its last word that read the script, and `at`
    is when that phrase began. A script with no words reports nothing.
    """
    spoken = [word for word in words if normalize(word.text)]
    spoken_tokens = [normalize(word.text) for word in spoken]
    script_words = [(index, raw) for index, raw in enumerate(script.split()) if normalize(raw)]
    script_tokens = [normalize(raw) for _, raw in script_words]
    if not script_tokens:
        return ScriptReport(restarts=[], skipped=[], misread=[])
    fillers = _filler_flags(spoken_tokens)
    steps = _alignment(spoken_tokens, fillers, script_tokens)

    skipped: list[ScriptSlip] = []
    misread: list[ScriptSlip] = []
    last_end = spoken[0].start if spoken else 0.0
    for said, read in steps:
        if read is not None:
            index, raw = script_words[read]
            if said is None:
                skipped.append(ScriptSlip(word=clean(raw), index=index, at=last_end))
            elif spoken_tokens[said] != script_tokens[read]:
                word = spoken[said]
                misread.append(
                    ScriptSlip(word=clean(raw), index=index, at=word.start, said=clean(word.text))
                )
        if said is not None:
            last_end = spoken[said].end

    restarts = [
        Repeat(text=" ".join(clean(spoken[i].text) for i in phrase), at=spoken[phrase[0]].start)
        for phrase in _restart_phrases(steps, spoken_tokens, fillers, script_tokens)
    ]
    return ScriptReport(restarts=restarts, skipped=skipped, misread=misread)


def _filler_flags(tokens: list[str]) -> list[bool]:
    """Whether each normalized spoken token is a filler; both halves of 'you know' are."""
    flags = [filler_key(token) is not None for token in tokens]
    for index in range(len(tokens) - 1):
        if tuple(tokens[index : index + 2]) == FILLER_PHRASE:
            flags[index] = flags[index + 1] = True
    return flags


def _alignment(spoken: list[str], fillers: list[bool], script: list[str]) -> list[Step]:
    """The cheapest alignment of spoken to script tokens, as steps in reading order.

    Among equally cheap alignments the later copy of a repeated phrase is the one read, so
    the speaker's first, abandoned attempt is left as extra words before it.
    """
    extra_costs = [FILLER_COST if filler else GAP_COST for filler in fillers]
    costs = [[j * GAP_COST for j in range(len(script) + 1)]]
    for token, extra in zip(spoken, extra_costs, strict=True):
        previous = costs[-1]
        row = [previous[0] + extra]
        for j, script_token in enumerate(script, start=1):
            read = previous[j - 1] + (MATCH_COST if script_token == token else MISREAD_COST)
            row.append(min(read, previous[j] + extra, row[j - 1] + GAP_COST))
        costs.append(row)

    steps: list[Step] = []
    i, j = len(spoken), len(script)
    while i or j:
        cost = costs[i][j]
        if i and j:
            read_cost = MATCH_COST if spoken[i - 1] == script[j - 1] else MISREAD_COST
            if cost == costs[i - 1][j - 1] + read_cost:
                i, j = i - 1, j - 1
                steps.append((i, j))
                continue
        if i and cost == costs[i - 1][j] + extra_costs[i - 1]:
            i -= 1
            steps.append((i, None))
        else:
            j -= 1
            steps.append((None, j))
    steps.reverse()
    return steps


def _restart_phrases(
    steps: list[Step], spoken: list[str], fillers: list[bool], script: list[str]
) -> list[list[int]]:
    """Spoken indexes of each phrase the speaker abandoned to go back in the script.

    Every spoken word that is not a filler gets the script position it reads: its own for a
    read word, and for an extra word the position the speaker is at, or one past it, when it
    says that word ('the few decisions a' read again ahead of the copy the alignment kept).
    Otherwise an extra word may jump back up to RESTART_MAX_GO_BACK_WORDS words to a script
    word it says, when the next spoken word reads on from there; any other extra word ('day'
    in 'a day —') reads nothing. A restart is a word reading a position before the one the
    speaker had reached. Its phrase runs from where the speaker first read that position,
    since the last restart, to the last word before the jump that read the script.
    """
    readings = [(said, read) for said, read in steps if said is not None and not fillers[said]]
    positions: list[int | None] = []
    phrases: list[list[int]] = []
    reached, since = 0, 0
    for order, (said, read) in enumerate(readings):
        position = read
        if position is None:
            following = readings[order + 1] if order + 1 < len(readings) else None
            position = _extra_word_position(spoken, script, said, reached, following)
        if position is not None and position < reached:
            phrase = _abandoned_phrase(readings, positions, since, position)
            if phrase:
                phrases.append(phrase)
            since = order
        positions.append(position)
        if position is not None:
            reached = position + 1
    return phrases


def _extra_word_position(
    spoken: list[str],
    script: list[str],
    said: int,
    at: int,
    following: tuple[int, int | None] | None,
) -> int | None:
    """The script position an extra word reads when the speaker is at `at`, else None.

    See _restart_phrases; `following` is the next non-filler spoken word and what it reads.
    """
    token = spoken[said]
    for ahead in (at, at + 1):
        if ahead < len(script) and script[ahead] == token:
            return ahead
    for back in range(at - 1, max(-1, at - 1 - RESTART_MAX_GO_BACK_WORDS), -1):
        if script[back] != token or following is None:
            continue
        next_said, next_read = following
        if next_read == back + 1:
            return back
        if next_read is None and spoken[next_said] in script[back + 1 : back + 3]:
            return back
    return None


def _abandoned_phrase(
    readings: list[tuple[int, int | None]], positions: list[int | None], since: int, target: int
) -> list[int]:
    """Spoken indexes from the first reading of `target` (after `since`) to the jump back.

    Walks back from the jump over words that read `target` or later, or nothing, and drops
    the words at either end that read nothing.
    """
    start = len(positions)
    while start > since and (positions[start - 1] is None or positions[start - 1] >= target):
        start -= 1
    kept = [order for order in range(start, len(positions)) if positions[order] is not None]
    if not kept:
        return []
    return [readings[order][0] for order in range(kept[0], kept[-1] + 1)]
