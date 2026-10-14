"""Script alignment: line a take up word by word against the script it was read from.

Pure functions, no I/O. The spoken words and the script words are normalized the same way as
the metrics (backend/metrics.py) and lined up with Needleman-Wunsch global alignment, which
finds the cheapest way to turn one list into the other by reading, misreading, skipping and
adding words. That is O(spoken x script) time and memory: a 3-minute take (~600 words)
against a 600-word script is 360,000 cells. alignment_cells() counts them before any is filled.

From the alignment come three lists: restarts (the speaker went back to script words already
passed), skipped script words and misread ones. Fillers in speech ('um', 'like', 'you know')
are not part of the reading and are ignored, unless the script has that word right there.
analyze_reading() puts the three lists into a take's metrics for the API.
"""

import re
from array import array
from collections.abc import Sequence
from dataclasses import dataclass

from backend.metrics import (
    CUTOFF_MARKS,
    FILLER_PHRASE,
    MAX_REPEAT_PHRASE_WORDS,
    Repeat,
    analyze,
    clean,
    filler_key,
    find_repeats,
    is_repeat_skip,
    normalize,
    says_again,
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
# A take that reads under half of the words it could have read as written (the script's, or
# the take's own when the script is longer) does not follow the script: a stale or wrong one
# would turn nearly every word into a misread, so the take is scored as free talk.
MIN_SCRIPT_FOLLOWED_SHARE = 0.5

# Two words joined by a dash with no space ('bullying—the', 'well-known', 'a--b') are compared
# as two words, in the script and in speech alike, since either may be written either way.
_JOINING_DASH = re.compile(r"(?<=\w)(?:--|[-—–])(?=\w)")
# A script typed in a word processor curls its apostrophes (don’t); transcripts do not (don't).
_STRAIGHT_APOSTROPHES = str.maketrans("‘’", "''")

# One alignment step: (spoken index, script index). Both set is a read word (a match or a
# misread), (i, None) is a spoken word with no script word, (None, j) a skipped script word.
type Step = tuple[int | None, int | None]


@dataclass(frozen=True, slots=True)
class ScriptSlip:
    """A script word not read as written: skipped (said is None) or misread as `said`.

    `word` is the script word without edge punctuation and `index` its position in
    script.split(); the two halves of a dash-joined word ('bullying—the') share one index.
    `at` is in clip seconds: the start of the misread word, or for a skip the end of the
    spoken word before it (the start of the take when nothing came before).
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


@dataclass(frozen=True, slots=True)
class _ReadSpan:
    """The part of a take that reads the script: from its first word read as written to its last.

    `read_words` counts the spoken words read as written, `could_read` the most there could
    be (the fewer of the script's words and the take's words that are not fillers). `start`
    and `end` are in clip seconds.
    """

    read_words: int
    could_read: int
    start: float
    end: float

    @property
    def follows_script(self) -> bool:
        return self.read_words >= MIN_SCRIPT_FOLLOWED_SHARE * self.could_read


@dataclass(frozen=True, slots=True)
class _Spoken:
    """The spoken words as aligned: each word, its token, and what kind of word it is."""

    words: list[Word]
    tokens: list[str]
    fillers: list[bool]
    cut_offs: list[bool]


def align(words: Sequence[Word], script: str) -> ScriptReport:
    """Line the take's words up against `script` and report restarts, skips and misreads.

    A misread is a spoken word in the place of a different script word. A skip is a script
    word with no spoken word against it. A restart is the speaker going back to a script
    position already passed, as in 'the few decisions a day — the few decisions a student':
    its text is the phrase as first spoken, up to its last word that read the script (a
    cut-off fragment such as 'evi—' reads the word it begins), without um/uh/hmm, and `at` is
    when that phrase began. Words said after the last script word read as written are off the
    script and start no restart. A script with no words reports nothing.
    """
    return _read(words, script)[0]


def alignment_cells(words: Sequence[Word], script: str) -> int:
    """How many cells align() fills for this take and script: spoken words times script words.

    Each is counted as the alignment splits it, a dash-joined word ('bullying—the') as two, so a
    caller can turn down a take and script too large to line up before a cell is filled.
    """
    return len(_spoken(words).tokens) * len(_script_words(script))


def _read(words: Sequence[Word], script: str) -> tuple[ScriptReport, _ReadSpan | None]:
    """align()'s report, and the span of the take that reads the script (None: no word does)."""
    spoken = _spoken(words)
    script_words = _script_words(script)
    script_tokens = [_token(part) for _, part in script_words]
    if not script_tokens:
        return ScriptReport(restarts=[], skipped=[], misread=[]), None
    steps = _alignment(spoken.tokens, spoken.fillers, script_tokens)
    read_as_written = [
        said
        for said, read in steps
        if said is not None and read is not None and spoken.tokens[said] == script_tokens[read]
    ]

    skipped: list[ScriptSlip] = []
    misread: list[ScriptSlip] = []
    last_end = spoken.words[0].start if spoken.words else 0.0
    for said, read in steps:
        if read is not None:
            index, raw = script_words[read]
            if said is None:
                skipped.append(ScriptSlip(word=clean(raw), index=index, at=last_end))
            elif spoken.tokens[said] != script_tokens[read]:
                word = spoken.words[said]
                misread.append(
                    ScriptSlip(word=clean(raw), index=index, at=word.start, said=clean(word.text))
                )
        if said is not None:
            last_end = spoken.words[said].end

    restarts: list[Repeat] = []
    last_read = read_as_written[-1] if read_as_written else -1
    for first, last in _restart_phrases(steps, spoken, script_tokens, last_read):
        phrase = [
            clean(spoken.words[i].text)
            for i in range(first, last + 1)
            if not is_repeat_skip(spoken.tokens[i])
        ]
        restarts.append(Repeat(text=" ".join(phrase), at=spoken.words[first].start))
    report = ScriptReport(restarts=restarts, skipped=skipped, misread=misread)
    if not read_as_written:
        return report, None
    span = _ReadSpan(
        read_words=len(read_as_written),
        could_read=min(len(script_tokens), spoken.fillers.count(False)),
        start=spoken.words[read_as_written[0]].start,
        end=spoken.words[last_read].end,
    )
    return report, span


def analyze_reading(words: Sequence[Word], script: str) -> dict[str, object]:
    """Every metric for a take read from `script`, in the shape the API returns.

    The free-talk metrics (backend/metrics.py analyze) plus a `script` block: restarts
    ({text, at}), skipped ({word, index, at}) and misread ({word, index, at, said}). Where
    the take reads the script, from its first word read as written to its last, the script's
    restarts replace the free-talk repeats, so a phrase said again is counted once and a word
    the script itself says twice ('that that') is no repeat. Before and after that span the
    speaker talks freely (a pasted opening, then more), so the free-talk repeats said there
    stay, unless a script restart begins at the same moment. A script with no words, or one
    the take does not follow (MIN_SCRIPT_FOLLOWED_SHARE), is no script: the free-talk metrics
    come back unchanged.
    """
    result = analyze(words)
    report, span = _read(words, script)
    if span is None or not span.follows_script:
        return result
    restart_starts = {restart["at"] for restart in report.restarts}
    off_script = [
        repeat
        for repeat in find_repeats(words)
        if (repeat["at"] < span.start or repeat["at"] >= span.end)
        and repeat["at"] not in restart_starts
    ]
    result["repeats"] = sorted(report.restarts + off_script, key=lambda repeat: repeat["at"])
    result["script"] = {
        "restarts": report.restarts,
        "skipped": [_slip_json(slip) for slip in report.skipped],
        "misread": [_slip_json(slip) for slip in report.misread],
    }
    return result


def _slip_json(slip: ScriptSlip) -> dict[str, object]:
    """A slip as JSON: a skipped word has no `said` field, a misread one names what was said."""
    fields: dict[str, object] = {"word": slip.word, "index": slip.index, "at": slip.at}
    if slip.said is not None:
        fields["said"] = slip.said
    return fields


def _script_words(script: str) -> list[tuple[int, str]]:
    """(index in script.split(), word) for each script word, dash-joined ones split in two."""
    return [
        (index, part)
        for index, raw in enumerate(script.split())
        for part in _JOINING_DASH.split(raw)
        if _token(part)
    ]


def _token(text: str) -> str:
    """A word as compared: normalized, with straight apostrophes."""
    return normalize(text).translate(_STRAIGHT_APOSTROPHES)


def _spoken(words: Sequence[Word]) -> _Spoken:
    """The spoken words that say something, dash-joined ones split in two at the same time.

    A hyphenated hesitation ('mm-hmm', 'uh-huh') stays one filler word. A word ending in a
    cut-off mark ('ner—') keeps it, so it is still known as a fragment.
    """
    pieces: list[Word] = []
    for word in words:
        if filler_key(normalize(word.text)) is not None:
            parts = [word.text]
        else:
            parts = _JOINING_DASH.split(word.text)
        pieces += [
            Word(text=part, start=word.start, end=word.end) for part in parts if _token(part)
        ]
    tokens = [_token(piece.text) for piece in pieces]
    fillers = [filler_key(token) is not None for token in tokens]
    for index in range(len(tokens) - 1):
        if tuple(tokens[index : index + 2]) == FILLER_PHRASE:
            fillers[index] = fillers[index + 1] = True
    cut_offs = [piece.text.endswith(CUTOFF_MARKS) for piece in pieces]
    return _Spoken(words=pieces, tokens=tokens, fillers=fillers, cut_offs=cut_offs)


def _alignment(spoken: list[str], fillers: list[bool], script: list[str]) -> list[Step]:
    """The cheapest alignment of spoken to script tokens, as steps in reading order.

    Among equally cheap alignments the later copy of a repeated phrase is the one read, so
    the speaker's first, abandoned attempt is left as extra words before it. Once the trace
    (which runs backwards) is in such a run of extra words it stays in it while that is as
    cheap, so the abandoned attempt is kept whole even across a doubled script word ('that
    that nation — that nation').
    """
    extra_costs = [FILLER_COST if filler else GAP_COST for filler in fillers]
    # Each finished row is stored as 4-byte ints: at the 20,000-character cap a script has up to
    # 10,000 words, and rows of Python ints would take hundreds of megabytes for a long take.
    costs = [array("i", [j * GAP_COST for j in range(len(script) + 1)])]
    for token, extra in zip(spoken, extra_costs, strict=True):
        previous = costs[-1]
        row = [previous[0] + extra]
        for j, script_token in enumerate(script, start=1):
            read = previous[j - 1] + (MATCH_COST if script_token == token else MISREAD_COST)
            row.append(min(read, previous[j] + extra, row[j - 1] + GAP_COST))
        costs.append(array("i", row))

    steps: list[Step] = []
    i, j = len(spoken), len(script)
    in_abandoned_run = False
    while i or j:
        cost = costs[i][j]
        extra_fits = i > 0 and cost == costs[i - 1][j] + extra_costs[i - 1]
        if i and j and not (in_abandoned_run and extra_fits):
            read_cost = MATCH_COST if spoken[i - 1] == script[j - 1] else MISREAD_COST
            if cost == costs[i - 1][j - 1] + read_cost:
                i, j = i - 1, j - 1
                steps.append((i, j))
                in_abandoned_run = False
                continue
        if extra_fits:
            i -= 1
            steps.append((i, None))
            in_abandoned_run = in_abandoned_run or not fillers[i]
        else:
            j -= 1
            steps.append((None, j))
            in_abandoned_run = False
    steps.reverse()
    return steps


def _restart_phrases(
    steps: list[Step], spoken: _Spoken, script: list[str], last_read: int
) -> list[tuple[int, int]]:
    """(first, last) spoken index of each phrase the speaker abandoned to go back in the script.

    Every spoken word gets the script position it reads: its own for a read word. A filler
    the alignment left out reads the position the speaker is at when it is that script word
    ('so' in 'so skilled stewards — so skilled'), else nothing. Any other extra word reads the
    position the speaker is at when it says that word (see says_again: 'I' for "I'm",
    'evi—' for 'evidence'); or one past it, or up to RESTART_MAX_GO_BACK_WORDS back, when it
    says that word and the next spoken word reads on from there. Otherwise ('day' in
    'a day —') it reads nothing. A restart is a word reading a position before the one the
    speaker had reached. Its phrase runs from where the speaker first read that position,
    since the last restart, to the last word before the jump that read the script. A word
    after `last_read`, the last spoken word read as written, is off the script: it reads nothing.
    """
    readings = [said for said, _ in steps if said is not None]
    reads = {said: read for said, read in steps if said is not None}
    # The next spoken word after each one that is not a filler the alignment left out.
    following: list[int | None] = []
    next_word: int | None = None
    for said in reversed(readings):
        following.append(next_word)
        if reads[said] is not None or not spoken.fillers[said]:
            next_word = said
    following.reverse()

    positions: list[int | None] = []
    phrases: list[tuple[int, int]] = []
    reached, since = 0, 0
    for order, said in enumerate(readings):
        position = reads[said]
        if said > last_read:
            position = None
        elif position is None and spoken.fillers[said]:
            is_script_word = reached < len(script) and script[reached] == spoken.tokens[said]
            position = reached if is_script_word else None
        elif position is None:
            after = following[order]
            after_read = None if after is None else (after, reads[after])
            position = _extra_word_position(spoken, script, said, reached, after_read)
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
    spoken: _Spoken,
    script: list[str],
    said: int,
    at: int,
    following: tuple[int, int | None] | None,
) -> int | None:
    """The script position an extra word reads when the speaker is at `at`, else None.

    See _restart_phrases; `following` is the next spoken word and what it reads.
    """

    def says(position: int) -> bool:
        return says_again(spoken.tokens[said], script[position], spoken.cut_offs[said])

    if at < len(script) and says(at):
        return at
    if following is None:
        return None
    go_back = range(at - 1, max(-1, at - 1 - RESTART_MAX_GO_BACK_WORDS), -1)
    for position in (at + 1, *go_back):
        reads_here = position < len(script) and says(position)
        if reads_here and _reads_on(spoken, script, position, following):
            return position
    return None


def _reads_on(
    spoken: _Spoken, script: list[str], position: int, following: tuple[int, int | None]
) -> bool:
    """Whether the next spoken word goes on from `position`: it reads it again or the next one.

    An extra next word goes on when it says one of the two script words after `position`.
    """
    next_said, next_read = following
    if next_read is not None:
        return next_read in (position, position + 1)
    return any(
        says_again(spoken.tokens[next_said], token, spoken.cut_offs[next_said])
        for token in script[position + 1 : position + 3]
    )


def _abandoned_phrase(
    readings: list[int], positions: list[int | None], since: int, target: int
) -> tuple[int, int] | None:
    """(first, last) spoken index from the first reading of `target` (after `since`) to the jump.

    Walks back from the jump over words that read `target` or later, or nothing, and drops
    the words at either end that read nothing.
    """
    start = len(positions)
    while start > since and (positions[start - 1] is None or positions[start - 1] >= target):
        start -= 1
    kept = [order for order in range(start, len(positions)) if positions[order] is not None]
    if not kept:
        return None
    return readings[kept[0]], readings[kept[-1]]
