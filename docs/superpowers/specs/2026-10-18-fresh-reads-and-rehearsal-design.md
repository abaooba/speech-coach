# Fresh reads and the line rehearsal (Loop Path)

Owner's report of 2026-10-18, from two screenshots of Pace level 1 ("Feel the band"):

1. "It feels impossible to get through level 1. Strict grading is fine, but I shouldn't have
   to read the same passage every time. Refresh the passage every time."
2. "I really like the coach popup. What I don't like is that Try again makes me redo the whole
   reading. Make Try again not count as another take, and only make me reread the sentence I
   messed up on."

Owner's answers to the two design questions (2026-10-18):

- The reread is a **rehearsal only**. It never counts, never saves, never clears anything. The
  real retry is still a full read.
- **A new passage for every read** of a Pace level, retries included. Pace levels stop using
  the one fixed "rainbows" passage and draw from the read library too; their time bar is set
  from the passage's length.
- **Restarts levels keep one passage per run** (owner's answer to the builder check, same day):
  "Read it 3 times" is that unit's method, and its research line says restarts fade only after
  the fourth repeat of the same text. Each new run of a Restarts level already draws a passage
  the speaker has read least recently.

This spec amends docs/superpowers/specs/2026-10-14-loop-path.md (the Loop Path). Where the two
disagree, this one wins. It changes no server code.

## 1. Intent

A level is a loop: read, review, read again. Reading the same 100 words four times in a row is
the part that feels like a wall, not the standard. So every read in a level is a passage the
speaker has not read lately, and a miss offers a thirty-second rehearsal of the one line that
went wrong before the next full read. The grading stays exactly as strict.

## 2. Goals, non-goals, anti-goals

Goals:

- Every Pace read (loop reads, retries, the check-back, the crown) draws a passage the speaker
  has read least recently. Two Pace reads in one level never share a passage unless the library
  is exhausted. Restarts levels keep their run's passage for every read of the run, retries
  included, and draw a fresh one for each new run and each check-back, as today.
- After a missed read, the coach sheet's primary button rehearses the line the coach named.
  A rehearsal is short, is judged the same way, says how it went, and leaves the level's
  attempts, takes and history untouched.
- The full retry ("Try read 4") stays one tap away, on the Result under the sheet and on the
  rehearsal's verdict card.

Non-goals:

- Talk takes keep their topic within a loop (Long pauses depends on it; Fillers level 1 is the
  same topic twice by design). Only reads refresh.
- The benchmark keeps its held-out passage and prompt. "Same passage every 14 days" is its point.
- No change to any rule, guard, band, slip limit or daily attempt count.

Anti-goals (a failure even if it works):

- A rehearsal that passes the level, lowers the slip limit, or burns one of the day's three
  attempts.
- A rehearsal the backend turns down as too short (under 5 seconds of speech).
- A read passage shorter or easier than the one it replaces (the pool is the fifteen cold reads,
  142 to 164 words each).

## 3. Fresh reads

### 3.1 The read pool

`app.passages.coldReads()`: the fifteen cold reads, 142 to 164 words, band 140 to 160. Every
read take of the Path draws from this pool, except the benchmark's read (held out, unchanged).
Pace reads and Restarts reads share it; `pickColdRead` treats every read of either unit as a
read of that passage, so the pool rotates across both.

The `explainer-rainbows` ladder passage is no longer the Pace material. It stays in
`app.passages` for Practice's Read tab. `LADDER_PASSAGE_ID`, `ladderWords()` and the
`materialFor` branch that returns it go.

### 3.2 The draw

`app.path.pickColdRead(history, random)` already picks an unread passage at random, else the
one read longest ago. It stays as it is. For a **ladder** (Pace) read it is called **once per
read take**, with the run's own saved sessions prepended to the history, so read 2 never draws
read 1's passage while another is unread. For a **cold-read** (Restarts) loop it is called once
per run, as today.

- `startRun` draws take 1's material at the Goal, as today.
- `materialOf(target, takeIndex)` draws afresh for every ladder take with `takeIndex > 0`, from
  `target.sessions` (newest first) followed by `target.history`; it already asks again for
  ladder and benchmark takes, so the change is the draw itself. Cold-read and prompt takes keep
  `target.material`.
- The draw happens when the take's request is built (`requestFor`), once per take, and is kept on
  the run as `target.materials[takeIndex]` (the take entry itself is created only after the
  upload, in `judgeTake`), so the Review, the change line, the coach request, the judge and the
  rehearsal read the passage that take was read from, not the run's first. `materialOf` returns
  the kept one when there is one.

### 3.3 Set seconds for a pace read

A ladder read's set seconds were the fixed passage's words at the read's target pace. They are
now the **drawn passage's** words at that pace: `ceil(words * 60 / wpm)`. The seconds are
resolved inside path.js, where every other take's seconds are resolved today:

- In the level data a ladder read is `read(null, {band, wpm})`: no fixed seconds, its band and
  its target pace. `ladderRead(wpm)`, `ladderWords()` and `LADDER_PASSAGE_ID` go.
- `resolveTake(spec, take, index, usual, material)` fills a ladder read's `seconds` from
  `material`: `ceil(words(material.text) * 60 / take.wpm)`, `words()` splitting on whitespace as
  `ladderWords()` did. Without a material the seconds stay null.
- `app.path.takeAt(playId, takeIndex, {baseline, cleared, material})` takes the material in its
  context and returns the resolved take; without it a ladder read has `seconds: null`.
- `app.path.evaluate(play, takeIndex, report, context)` takes `context.material` the same way,
  and throws a TypeError for a ladder read without one, as it does for a missing baseline after
  take 1. `crownTake` resolves the Pace crown's read the same way. `measure(report, setSeconds)`
  is unchanged.
- The Level screen passes the take's kept material (3.2) to `takeAt` and `evaluate`. Practice's
  time bar follows the resolved seconds.

Pace levels 1 and 2 and the Pace crown are the only ladder reads. Their rules (`readThrough`,
wpm in band, restarts ≤ 2 on level 2, ≤ 1 on the crown) do not change.

### 3.4 Copy

- Path popover for Pace level 1: "150 wpm, twice" stays.
- Goal length line (`lengthOf`): ladder levels read "2 reads of a new passage", the wording
  cold-read levels already use, instead of "2 reads of the passage"; the Pace crown's
  `crownGoal` length "One read of a new passage". No line shows the computed seconds.
- The Review step's "Read it again" button, the read banner bodies ("Read the passage at 140 to
  160 wpm. Read 2 counts: 140 to 160 wpm.") and every other string are unchanged; the passage
  card simply shows a different passage.
- Spec section 3 of the Loop Path doc: "A loop uses the same material for every take" becomes
  "A loop keeps its material for every take, except that a ladder read draws a passage the
  speaker has read least recently for every read (this spec, 3.2). A check-back, checkpoint or
  crown always uses new material."

## 4. The line rehearsal

### 4.1 When it is offered

After a **missed, scored read** of a loop level (Restarts 1 to 4, Pace 1 and 2), when the take
the Result shows (`target.last`; on Pace level 2 that is the pair's second read) has a moment to
point at **in the passage**: a restart, a misread or a skip. The moment the coach line names
(`headline.momentId`) is used when it is one of those; otherwise the take's first restart,
misread or skip in time order. A pause, a filler, a hint (stumble, unclear) or a pace third
never locates a line: a rehearsal checks the words as written and the pace, which a pause does
not answer to. The moment is picked once, when the sheet opens; Claude's headline arriving
later changes the sheet's line, never the rehearsal's.

Not offered, so the sheet keeps today's "Try again" (the full retry) or its next move:

- talk takes (no script);
- a read with no such moment (a pace-only miss with a clean read);
- check-backs, crowns, checkpoints (not loops; their retry rules differ);
- a miss that leaves no attempt today (the sheet already says the level opens tomorrow, and a
  rehearsal with no retry to rehearse for is noise).

### 4.2 The sheet

The coach sheet after the miss keeps its line, pill ("Not yet · 1 try left") and
"See full results". Its primary button becomes:

- label **"Try that line again"**, icon `rotate-ccw`;
- `why`: **"A rehearsal: it is not saved and counts no take."** (replaces "One clean take 2
  clears the level." on this sheet only).

The Result card under the sheet is unchanged: "Try read 4" (full retry) and "Back to path".

`app.nextMove` is unchanged and pure; the Level screen swaps the primary when a rehearsal is
available (`rehearsalFor(target, takeIndex)` is non-null).

### 4.3 The line

`app.loop.lineAround(passageText, moment, minWords)` (new, pure):

1. Splits the passage into sentences at `.`, `!` or `?` followed by whitespace or the end
   (a decimal point or an abbreviation inside a sentence is not followed by whitespace, so it
   stays). Sentences keep their original text and order.
2. Scores each sentence by how many of the moment's words (`before`, `text`, `expected` for a
   misread, `after`, lower-cased, punctuation stripped) it contains, counting each word once.
   The best sentence wins; a tie goes to the earlier one. With no word in common (the moment
   is not in the script after all), returns null.
3. Grows the pick to at least `minWords` words by appending the following sentences, then, at
   the passage's end, prepending the preceding ones. `minWords` is 20: at 150 wpm that is 8
   seconds, past the backend's 5-second floor and Practice's own, with room for a slow start.

Returns `{text, first, last}`: the line to read and the indexes of the sentences it spans.

### 4.4 The take

`startRehearsal(target, takeIndex)` builds a Practice request from the missed take's material and
the line:

```
{
  eyebrow: "Path: Pace, level 1",
  title: "Try that line again",
  body: "Read the line as written. A rehearsal: it is not saved and counts no take.",
  material: { kind: "passage", id: <passage id>, title: <passage title>, text: <line>,
              targetWpm: <take band, or the passage's band>, topic: null },
  seconds: readSeconds(material, take) for a pace read, else ceil(words * 60 / 120),
  liveTap: false,
  save: false,                      // new (4.5)
  judge(result)  -> null,           // a rehearsal has no path field; the verdict is drawn below
  onSaved(saved) -> rehearsalDone(target, takeIndex, saved),
  onLeave()      -> leaveLevel(target),
}
```

`seconds` for a Restarts-level rehearsal is generous on purpose (120 wpm): the bar is a guide,
not a limit, and those levels do not judge pace. For the same reason the verdict (4.6) gets
`band: take.band` for a Pace read and `band: null` for a Restarts read, never the passage's
own `targetWpm`.

The request is pushed onto `target.requests` like any take's, so the run survives the route to
Practice (`routeKeeps`).

### 4.5 The Practice contract: `save: false`

A request with `save === false` goes through Practice's level mode as any other, except that
step 3 (the save) is skipped: `onSaved` gets `{id: null, session, blob, contentType,
liveTaps}`, where `session` is what would have been saved (with `path: null`). Nothing reaches
the store, History, Progress, the rank or the attempt count. `isLevelRequest` accepts the field;
a request without it saves, as today. Practice keeps no reference to the blob, as today.

### 4.6 The verdict

`app.path.rehearsalVerdict(report, {band, seconds})` (new, pure) measures the rehearsal with
`measure(report, seconds)` and returns `{clean, sentence}`:

| Case | `clean` | `sentence` |
|---|---|---|
| no speech | false | "No words were heard. Read the line out loud." |
| `followedScript` false | false | "That was not the line as written. Read it as it is." |
| `readSlips` > 0 | false | "Still 1 slip: “send the send”." / "Still 2 slips: “…”, “…”." (each slip's said words, in time order, at most 3 quoted) |
| band given and wpm outside it | false | "Read as written, but 178 wpm. The band is 140 to 160." |
| otherwise | true | "Clean: read as written at 152 wpm." |

The slip words come from the report's restarts (`text`) and misreads (`said`), as the speech
map quotes them.

### 4.7 After the rehearsal

`rehearsalDone` keeps `{line, verdict, count}` on the run as `target.rehearsal` (count: how many
rehearsals this miss has had) and returns to the level's Result step. No sheet opens. The Result
shows, above the miss card:

**Rehearsal card** `div.level-card.level-rehearsal` with `.level-rehearsal--clean` when clean:

- heading "Rehearsal" (h3) with a small "2 of today" style count: "Rehearsal 2";
- the line, quoted, in `.level-rehearsal__line` (muted, at most 3 lines, clipped with an
  ellipsis);
- the verdict sentence in `.level-rehearsal__verdict`, with the check icon when clean and the
  alert icon otherwise, in `--ok` or `--warn`;
- when clean: "Now try the whole read." Otherwise: "Try the line once more, or go on to the
  whole read.";
- buttons: **"Try that line again"** (`.btn--secondary`, 44px) and the existing primary
  **"Try read 4"** below in the Result's own action row, which stays as it is.

Keyboard focus goes to the card's heading (`tabindex="-1"`) when the Result shows after a
rehearsal, and the live region says "Rehearsal: clean" or "Rehearsal: still a slip". The
Result step is shown again rather than entered (`render()` moves focus and announces only on a
step change), so `rehearsalDone` does both itself. The sheet does not reopen: `openResultSheet`
already keeps it closed for a Result it has shown (`sheetFor === target.last`).

Leaving the level, starting the full retry, or the Result for the next take clears
`target.rehearsal`. A rehearsal never changes `target.last`, `target.takes`, `target.sessions`
or the attempt count, and never asks the coach for notes.

### 4.8 Audio

The rehearsal's blob is handed to `onSaved` as any level take's is, and `rehearsalDone` drops it
at once. It is never kept, played or decoded.

## 5. Store, history, attempts

Nothing is saved for a rehearsal (4.5). `attemptsLeft`, `statusOf`, the jump test, check-backs
and the week chip are unchanged. The only store-visible change is that read takes of one level
now carry different `passageId` values, which `pickColdRead`, the change line ("the latest
earlier take that followed a script") and History already handle.

## 6. Docs

- Loop Path spec section 3 (material, 3.4 above), section 7 (the `save` field), section 8
  (the rehearsal card under "Not yet", the sheet's primary).
- frontend/DESIGN.md: section 2 contracts (`save: false`, `readSeconds`, `rehearsalVerdict`,
  `lineAround`), section 6 (the rehearsal card), section 8 copy (the sheet why, the banner
  body, the verdict sentences, the card's lines), section 9 (focus and the live region).
- frontend/README.md: the Level and Path rows, the manual checks table (a rehearsal row), the
  hands-on checks.

## 7. Tests

- `app.loop.lineAround`: the sentence split (decimals, abbreviations, a passage with one
  sentence), the pick by overlap, the tie, the growth to 20 words forward then backward, null
  with no overlap.
- `app.path.readSeconds`: a number is kept; a band gives words at its center; the crown's band.
- `app.path.rehearsalVerdict`: each row of the table, the quoted slips, the cap of 3.
- `app.path.materialFor` / the Level screen: every read take draws from the pool; read 2 avoids
  read 1's passage; a prompt loop keeps its topic; the benchmark keeps its passage; Pace takes
  carry `seconds: null` and the screen resolves them from the passage.
- Practice: `save: false` skips the store and hands `id: null`; a request without it saves.
- The Level screen: the sheet's primary and why with and without a locatable moment; the
  rehearsal request (material, seconds, no coach request, no attempt consumed, nothing saved);
  the verdict card for clean and for a slip; "Try that line again" from the card; "Try read 4"
  clears the card; leaving clears it.
- Existing tests that pin the fixed ladder passage, same-material loops or `ladderWords` are
  rewritten to pin the new rule with equal strictness (Loop Path spec section 12).

## 8. Left to the builder

- Exact sentence-split regex and the punctuation stripped from moment words (match what
  `bareText` in results.js strips). All fifteen cold reads have no digits or abbreviations, so
  those cases matter for the tests, not the live pool.
- The rehearsal card's exact spacing, from DESIGN.md's tokens.
- Existing tests that pin the rainbows passage or `ladderRead` seconds: `level_screen_takes`,
  `practice_level_mode`, `loop_path_rules`, `path`, `fix_loop_path_guard_lists`,
  `loop_path_levels`, `retired_passages`, `results_sheet`, `passages_*` where they name it.
  Rewritten to pin the new rule with equal strictness, as the Loop Path spec section 12 and the
  commits that replaced the uniforms passage did.
