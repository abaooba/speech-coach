# Tester feedback before submission (2026-10-22)

A tester's notes, passed on by the owner on 2026-10-22 with "evaluate it and take action":

> Every time you click on option, randomize prompt/reading, path still doesn't give different
> passages (find out why), redesign the paths section so that you don't have to scroll down for
> separate paths and easy to see there are multiple, graphs still aren't separated FIX IT, see if
> you can have a live counter of your wpm so you don't have to guess

Built on branch `tester-feedback`, off `progress-talk-read` (the talk-only rank and the
Progress Talk | Read split, never merged). Where this spec and an older one disagree, this one
wins. It amends docs/superpowers/specs/2026-10-14-loop-path.md and builds section 3 of
docs/superpowers/specs/2026-10-18-fresh-reads-and-rehearsal-design.md.

## 1. What the tester ran into, and why

1. **Same passages.** Nothing in Practice is random: every launch opens on each prompt's first
   topic, a chip tap keeps the topic it was on, New topic steps through the list in order, and
   each Read chip is one fixed text. On the Path, Pace levels 1 and 2 and the Pace crown read
   one passage, "Explainer: how rainbows form", on every read, every retry and every day. The
   owner reported the Pace repeat on 2026-10-18; the fix was written up (the 10-18 spec,
   section 3) and never built, hence "still". Every other level draws its material once at the
   Goal by design, from pools of 15 cold reads and 25 Impromptu topics.
2. **Paths.** The Path's four units (Restarts, Fillers, Long pauses, Pace) sit in one vertical
   stack, each about 960px tall: unit 2 starts 1.7 screens down and unit 4 4.2 screens down at
   390x844, and nothing on the first screen says other units exist.
3. **Graphs.** The live app runs main, which charts every take on one line. The Talk | Read
   split lives on the unmerged branch. Once deployed, the switch still looks exactly like the
   metric switch under it, Results arrows still compare a talk with a read, and History marks
   neither kind.
4. **Live pace.** Pace exists only after Stop: the take is uploaded once and pace comes from
   AssemblyAI's batch word timings. Nothing shows while recording.

## 2. Practice: a new topic or passage on every tap

### 2.1 The draw

- Practice draws with `Math.random`. (Tests fix the draw by giving the vm context a `Math`
  whose `random` is a stub; no test hook is added to the screen.)
- Practice keeps the speaker's own takes in module state for the draws: `app.store.list()`,
  guarded (`typeof app.store.list === "function"`, any rejection or throw ignored), loaded at
  `show()` and added to when a take is saved. Without it, a draw is uniform.
- The rule is the Path's (`app.path.pickTopic`, `pickColdRead`): from the pool minus the item on
  screen now, an item no own take has used, at random; once every item has been used, the one
  used longest ago. A pool of one gives that one. Talk topics use `app.path.pickTopic(history,
  promptId, Math.random, current)` when `app.path` is loaded; passages use a new pure
  `app.path.pickPassage(history, passages, random, exclude)` with the same rule, and
  `pickColdRead(history, random)` becomes `pickPassage` over the cold reads (same results, so
  its tests hold). Without `app.path` (some test harnesses), the draw is uniform over the pool
  minus the current item.

### 2.2 Talk

- At mount each prompt with topics starts on a drawn topic, not its first.
- A tap on a Talk chip, the selected one or another, draws a new topic for that prompt and
  selects it. New topic draws a new topic for the selected prompt. Both read the new topic out,
  as New topic does today.
- The Talk | Read tabs keep each tab's selection and topic as they were. Coming back to Practice
  keeps them too, so Results' "Record again" retries the same topic.
- Level mode is unchanged: no chips, no New topic, the request's material.

### 2.3 Read: four groups, a new passage on every tap

- Every Read-tab entry in `app.passages` carries `group`: `"explainer"`, `"story"`, `"speech"`
  or `"drill"`. `app.passages.groups()` returns a new array of `{id, label}` on every call, in
  Read-tab order: Explainer, Story, Speech, Drill.
- The Read tab shows one chip per group, labeled with the group's label. An entry with no
  `group` (the plain-array fixtures many tests use) keeps a chip of its own, as today.
- A tap on a group chip, the selected one or another, draws a passage of that group (2.1) and
  selects it. On the Read tab the card's New topic button reads **New passage** (same button,
  icon and place) and draws another passage of the selected passage's group. It shows when the
  group holds two passages or more.
- At mount the Read tab starts on a drawn passage of the first group.
- A take saves the passage's own `passageId` and `passageTitle`, as today, so Results, History,
  Progress, the rank and `app.language.isReadTake` read it unchanged.

## 3. New reading material

All of it original everyday prose except the speeches; never debate (no rounds, cases,
rebuttals, resolutions, judges or opponents); no exclamation mark anywhere in passages.js.

### 3.1 The Read tab: 24 passages in four groups

| Group | Today | New | Rules (frontend/tests/passages_content.test.js, passages_everyday.test.js) |
|---|---|---|---|
| Explainer | explainer-rainbows | 5 | 80 to 110 words, title "Explainer: ...", band 150 to 170, no source; no digit, symbol, quotation mark, number word or habit word |
| Story | story-wrong-train | 5 | the same rules, title "Story: ..." |
| Speech | gettysburg-opening, liberty-or-death | 4 | 90 to 130 words, verbatim from a US public-domain speech checked against an authoritative transcript, `source` "Speaker, work, year", band 130 to 150; an exclamation mark becomes a period, said in a comment, as Patrick Henry's is |
| Drill | drill-st-clusters, drill-pl-bl-clusters | 4 | 60 to 80 words, title "Drill: ...", band 120 to 140, one sound pattern non-native speakers find hard (th, r and l, v and w, word endings) |

Ids are lowercase slugs; titles are unique and under 40 characters; the existing six keep their
ids, titles and texts.

Read as written, with a pause at each comma and stop, no text read word for word (a Read passage,
a cold read or the benchmark read) shows a filler (passages_read_as_written.test.js). delivery.js
counts "so" before a comma as a habit, so no speech excerpt holds "So," or "And so,". That is why
Roosevelt's "fear itself" and Kennedy's "ask not" lines are not on the Read tab: the speeches are
fdr-happiness (First Inaugural, 1933) and jfk-to-the-moon (Rice University, 1962) instead.
Bringing those two lines back would mean delivery.js skipping a habit word the script holds at
that point, which re-scores saved reads: an owner decision.

### 3.2 The Path: 15 more cold reads

`app.passages.coldReads()` grows from 15 to 30. The new ones come after the old (whose ids,
titles and order stay), 142 to 164 words each like the old ones, band 140 to 160, plain sentences
(a capital first, a stop or question mark last), with no digit, symbol, quotation mark, number
word or habit word, on everyday subjects none of the 15 covers. Titles say what each is about:
"Cold read: ...". Pace and Restarts now share this pool (section 4), so it has to last both.

## 4. The Path: a new passage for every Pace read

Build section 3 of the 10-18 spec (3.1 to 3.4) as written, with three changes:

- `app.path.evaluate` keeps working without `context.material`: a ladder read is judged on
  `readThrough` and its band, and set seconds only feed `talkShare`, so nothing needs them.
  (loop_path_rules.test.js and fix_loop_path_guard_lists.test.js stay as they are.)
- The material key stays `"ladder"` (loop_path_levels.test.js pins it); only what it draws
  changes.
- `explainer-rainbows` stays on the Read tab, in the Explainer group.

So: every read of Pace level 1, Pace level 2 and the Pace crown, retries included, draws a cold
read with `pickColdRead` over the run's own saved takes (newest first) followed by the history,
so read 2 never repeats read 1 while another is unread. The draw is kept on the run per take
(`target.materials[takeIndex]`), so the Review, the change line, the coach and the judge read the
passage that take read. A ladder read's set seconds are the drawn passage's words at the read's
target pace, `ceil(words * 60 / wpm)`. The Goal says "2 reads of a new passage" and the crown
"One read of a new passage". Restarts keeps one passage per run, talk levels keep their topic,
the benchmark keeps its passage and prompt.

## 5. The Path: every unit in sight

- On the first screen at 320x568, 375x667 and 390x844, all four units are named, each with its
  progress ("Level 3 of 5", "All 5 cleared") and, when one of its check-backs is due, a clock
  icon with ", check-back due" for screen readers.
- One tap shows a unit; one unit's path shows at a time, so the page is about two screens at
  390x844 instead of five and a half.
- The units are listed in the fixed `app.path.UNITS` order, so a place never moves under the
  thumb. The one shown first is the unit holding the screen's primary Start (the weakest that
  can start, as today), else `app.path.order()[0]`. The pick is kept in module state while the
  app is open, so a level visit and its back link ("#/path", unchanged) return to it.
- The shown unit's next step holds the screen's one `btn--primary` when it can start.
- The control is the house segmented pattern: toggle buttons with `aria-pressed` in a
  `role="group"` labeled "Units" (DESIGN.md section 6), never a tablist.
- Copy never says rank, tier, rating or streak, or a tier name, even inside another word
  (fix_path_screen_no_rank.test.js). Section 13 of styles.css keeps its rules: tokens only, no
  animation or transition, `--warn` only on gold, crown and half nodes.
- The look comes from Superdesign (section 9). It may also make the benchmark card compact or
  fold a unit's why and source lines, if that keeps the shown unit's Start on the first screen.

## 6. Progress, Results and History: Talk and Read kept apart

- Deploying this branch puts the split on the live app.
- Progress: the Talk | Read switch is restyled so it reads as two separate sets of charts, not
  one more filter. The look comes from Superdesign (section 9).
- Results: the arrows compare a take with the latest earlier own take **of the same kind** (Talk
  with Talk, Read with Read, by `app.language.isReadTake`), and show nothing when there is none.
- History: a read take's row says "Read" in words, not color alone.
- how.html says what the Progress switch does in words that match it.

## 7. Live pace while recording

A local estimate: nothing leaves the phone, it works offline and with blank API keys, and the
pinned privacy sentences stay true. (Streaming the audio to AssemblyAI for exact live words is
the upgrade path; it changes the privacy copy and the cost, so it waits for the owner.)

- **Estimator**, pure, in delivery.js (DESIGN.md: a helper lives in the module that owns its
  data; a new file would need docs/PLAN.md): syllable-nucleus peaks after de Jong and Wempe
  (2009). 100 to 5000 Hz band-pass; intensity over 32 ms windows every 8 ms; a peak above the
  running median plus 2 dB, with a dip of at least 1.5 dB since the last peak and a 3-hop
  look-ahead; voiced when the normalized autocorrelation is at least 0.45 between 75 and 400 Hz.
  Words are peaks times a factor.
- **Factor**: starts at 0.69 words a peak. After a take's analysis returns, words without
  hesitations (`app.delivery.isHesitation`) over the peaks in the speech span updates an
  exponentially weighted average per mode (Talk, Read by `app.language.isReadTake`), clamped to
  0.45 to 1.1, kept with `app.store.setFlag` behind a typeof guard; only takes of 20 seconds or
  more with 30 words or more count. Never on the saved session.
- **Capture**: in `beginTake`, after `app.pauses.start`, only when `AudioContext` (or
  `webkitAudioContext`) and the estimator exist: a separate AudioContext at its native rate,
  MediaStreamSource(stream) -> ScriptProcessor(1024, 1, 1) -> a zero gain -> destination, resumed
  when suspended as pauses.js does, torn down in `releaseCapture`. pauses.js and the
  getUserMedia constraints are never touched.
- **Display**: a row inside `.practice__timer`, under the clock and the bar (grid row 3),
  shown only while recording a normal take (never in level mode, where takes count), hidden in
  idle, uploading and error. Until enough speech: "Your pace shows after a few seconds." Then
  "About 150 wpm" with a check icon and "On target", or an alert icon and "Slow down" or "Speed
  up", against the entry's band. The number is the trailing 15 seconds (less near the start),
  shown after 5 seconds of speech, rounded to 5, repainted once a second from the existing 250 ms
  tick (no new interval). A cue changes only when the pace is more than 10 wpm outside the band
  and has been for 3 seconds; a silence over 1.5 seconds keeps the last value. The row is
  `aria-live="off"`, like the clock: nothing new is announced.
- **Validation** before it ships: speech made with macOS `say` at known rates (several voices,
  120 to 200 wpm) and the repo's real takes, run through the estimator; report the error. If the
  uncalibrated median error is over 15%, show the cue words without the number.
- **Validation result** (2026-10-22, 76 `say` clips from 8 voices at 121 to 247 wpm, plus the
  repo's two real takes): uncalibrated, the median whole-clip error is 22.0% (it reads low), over
  the bar; calibrated, 6.3% (leave-one-out) and, tuning in sequence as the app does, 12.6% on a
  mode's second take and 8.3% on its third; the two real takes are within 7%. So the number
  waits for the factor: until a mode (Talk or Read) has one take that counts for the factor
  (20 seconds and 30 words), its row shows the cue words alone, centred, after the waiting
  sentence; from then on, "About 150 wpm" and the cue. The first reading shows its own cue. A
  silence counts as speech only up to 1.5 seconds, in the 15-second window and in the 5 seconds
  before the first reading, so a pause at a full stop never drags the number down for long.
  Capture runs on every take, level mode included, so every counted take tunes its mode; only
  the row stays hidden in level mode. The write-up goes in the repo next to this spec.
- how.html: "While you record, a live pace shows under the clock. Your phone estimates it from
  the beats of your syllables. Results counts your real words, so the two can differ. The live
  pace runs on your phone and sends nothing." and, after it: "It tunes itself to your voice,
  once for Talk and once for Read. Until a take of 20 seconds or more has tuned it, it shows only
  On target, Slow down or Speed up."

## 8. Tests and docs

- Test first. New behavior gets new test files.
- An existing test changes only where it pins behavior this spec changes on purpose, and the new
  assertion pins the new rule as strictly as the old one pinned the old. Every such change is
  logged in docs/superpowers/specs/2026-10-22-tester-feedback-test-changes.md: file and test
  name, what it asserted, what it asserts now, and the section here that changed it. Tests are
  never skipped, deleted to get green, or weakened.
- Before every commit: `.venv/bin/pytest -q`, `.venv/bin/ruff check .` and
  `node --test frontend/tests`, all passing.
- Docs follow the code: frontend/DESIGN.md (the owner asked for these redesigns), frontend/README.md,
  README.md, docs/ARCHITECTURE.md, how.html, keeping their copy rules (each fixed sentence once,
  short sentences where tests ask).

## 9. Design

The Path (section 5), Practice's Read groups and live pace row (sections 2.3 and 7) and the
Progress switch (section 6) are designed in Superdesign first (project 6caab459), a judge agent
picks among the directions, and the build follows the chosen mockup.

## 10. Not in this change

The line rehearsal (10-18 spec section 4), live words over a streaming connection, Pauses per
minute and a pace band on Progress, the Path baseline that still mixes reads, and more Talk
topics.
