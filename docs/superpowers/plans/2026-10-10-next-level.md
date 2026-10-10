# Speech Coach Next-Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo most work runs through `tasks/queue.json` and `automation/night.sh`, so every queue brief in Task 0 points at one task below.

**Goal:** Make Speech Coach the delivery coach debaters can trust. It counts fillers by rules a judge can read, measures pace without counting "um" as a word, coaches with specific moments and one technique, and frames everything around debate formats.

**Architecture:** A new pure browser module, `frontend/delivery.js` (`app.delivery`), re-scores every stored session from its transcript. It applies context rules for "like", "so", "you know", "actually" and "basically", and derives pace without hesitation sounds, mid-sentence pauses and the longest clean stretch. Results, tips and Progress read its report. The FastAPI backend and its metrics contract do not change in Phase 1, so no backend test changes, and old sessions are re-scored by the same rules as new ones.

**Tech Stack:** Vanilla JavaScript (ES2020 IIFE modules, `node:test` with `vm`), FastAPI on Python 3.13 (unchanged in Phase 1), AssemblyAI with `disfluencies: true` (the default provider) or Deepgram nova-3 with `filler_words=true`.

**Spec:** `reports/Speech coach apps and filler detection.md` (the research report on Ares's machine, gitignored), `docs/superpowers/specs/2026-10-08-speech-coach-design.md`, and `frontend/DESIGN.md` as amended in Task 0.

**Verified:** Every diff and code block in Task 0 (design and shell-test edits), Task 1 and Task 2 was copied out of this file and applied to a fresh copy of branch `t08-pauses` at `ea1a15e` (main `baefbc3` plus T08). The result passed all three checks: `node --test frontend/tests` 192 of 192, `.venv/bin/pytest -q` 72 of 72, and `ruff check .` clean. Each diff also passed `git apply --check` against the real repo. Tasks 3 to 9 are written as briefs with exact test cases, the format this repo's queue already uses.

## Global Constraints

- Frontend: no frameworks, no build step, no CDN scripts. Vanilla only. (CLAUDE.md)
- JS: ES2020, small modules, no globals except a single `app` namespace. (CLAUDE.md)
- Every file is an IIFE assigning exactly one `app.<name>`; `window.app` is the only global. (DESIGN.md section 2)
- Transcript and user text never go through `innerHTML`; build nodes with `app.ui.el`. (DESIGN.md section 2)
- Copy: second person, present tense, under 15 words a sentence, no exclamation marks, no blame. (DESIGN.md section 8)
- Tokens only, spacing from the scale; raw hex exists only in the token block. (DESIGN.md sections 4 and 10)
- Run `.venv/bin/pytest -q`, `.venv/bin/ruff check .` and `node --test frontend/tests` before every commit. All three must pass.
- Never skip, delete, weaken or mark tests as expected-fail. The only exceptions are the supersessions Ares approves in Task 0, printed hunk by hunk in Task 2.
- Python 3.13, type hints, ruff clean, line length 100. New JS lines also stay within 100 characters.
- Dates: scope freeze Wed Oct 14, video day Thu Oct 22, submit target Sat Oct 24, hard deadline Mon Oct 26 at 11:00 AM Chicago time.
- Out of scope (docs/PLAN.md): accounts, server-side storage, native apps, live feedback during recording, LLM features.

## Review Focus

The five inputs most likely to bite a real user that no feature test would naturally hit. Each has a test in the task that owns the code.

1. **A session saved without words** (the README store check, hand-made or very old sessions): Results, tips and Progress fall back to the backend tallies and never throw. Task 1 test "without words, analyze falls back to the backend tallies"; the existing "no words means no Transcript section" test keeps passing in Task 2.
2. **Provider spelling variants:** "Umm,", "Uhh.", "erm" and "hmmm" count as hesitations; the agreement sounds "mhm", "uh-huh", "mm-hmm" and "huh" never do. Task 1 test "isHesitation knows um, uh, er, ah, hm…".
3. **A transcript without punctuation** (Deepgram with punctuation off, or a recognizer that drops commas): "i like this plan" is still never flagged, and a pause still sets off a filler "like". Task 1 test "a transcript with no punctuation…".
4. **An energy-only pause from pauses.js** whose `at` is not a word end: it is placed after the last word ending by `at`, the same rule Results uses for the marker. Task 1 test "an energy-only pause between word ends…".
5. **A ten-minute constructive** of about 1,500 words on a phone: the report takes well under 100 ms. Task 1 test "a ten-minute, 1,500-word take…".

## Why these changes

| Research finding | Decision | Task |
|---|---|---|
| No coach publishes filler accuracy. All of them transcribe, then match words; the careful ones add context rules (Zoom patent US 12,112,748 B2, Microsoft Speaker Coach). | Write the rules as small tested functions and show them on a How we measure page. | 1, 5 |
| Only 37% of "like"s in meeting speech are fillers. A pause over 240 ms before "like" marked a filler in 70 of 78 leftover cases (Zufferey and Popescu-Belis, 2004). | "like" counts only when a comma, an um or a 0.25 s pause sets it off, and never right after I, would, looks, just and similar words. | 1 |
| Debaters say "so" as a connective. Gong found "so" was 33% of every filler it counted. | "so" counts only when an um or a half-second hang follows it. | 1 |
| Counting every token inflates pace. The Oct 8 clip had 18 hesitations a minute. Microsoft and tl;dv strip non-speech from their rates. | Pace leaves out hesitation sounds. | 1, 2 |
| Zoom and tl;dv put 0.6 to 3.0 fillers a minute in range; the app warned only above 6. | The fillers tip and card hint trigger above 3 a minute. | 2 |
| High-information feedback averages d = 0.99, against 0.24 for rewards. Habit-reversal training (spot it, then do something else) cuts fillers. | Tips name the moments and one technique. The habit tip names the top crutch word, as Toastmasters' Ah-Counter does. | 2 |
| A silent pause before a word helps listeners remember it. NSDA's drill hunts "fluency breaks or unnecessarily long pauses", not pauses as such. | Count and coach only mid-sentence pauses. | 1, 2 |
| NSDA's Start Stops and Perfect Point drills; DebateDrills sets 15 clean seconds as a beginner target. | Longest clean stretch, as a card and a Progress chip. | 1, 2 |
| General speech coaches already won districts (LionLang TX-01, SpeakSmart CA-38 in 2025); no current tool pairs debate formats with delivery metrics. | Debate presets with time limits and guidance bands. | 3 |
| Rubrics separate "app works" from "works, yet encounters errors", and a judge may have no microphone. | See a sample result. | 4 |
| No vendor or coach publishes filler accuracy; AssemblyAI advises testing on 25 representative files. | Hand-label 10 to 25 takes and publish measured precision and recall. | 6, 7 |

## Roadmap at a glance

| Task | Queue id | What it delivers | Owner | Depends on | When |
|---|---|---|---|---|---|
| 0 | — | Design amendment, shell-test load order, queue entries, sample take | Ares | — | Sat Oct 10 evening |
| 1 | T14 | `frontend/delivery.js`: the filler rules and the delivery report | agent, or Ares by hand | Task 0 | Sat night |
| 3 | T12 (rewritten) | Passages plus Congress and PF presets with time limits | agent | Task 0 | Sat night |
| — | T10a-1 | App icons (already queued) | agent | — | Sat night |
| 6 | T19 | Accuracy scorer script | agent | T14 | Sun day batch |
| — | T10b | Onboarding (already queued) | agent | T07 (done) | Sun day batch |
| 2 | T15 | Results, tips and Progress read the report | agent | T14 | Sun night (largest task; gets the 40-minute night slot) |
| — | T10a-2 | Manifest and service worker (already queued) | agent | T09 (done), T10a-1, T10b | Sun night |
| 4 | T17 | See a sample result | agent | T15, the sample file from Task 0 | Mon day batch |
| 5 | T18 | How we measure page | agent | T15 | Mon day batch |
| — | T11, T13a, T13b | State audit and judge polish (already queued; T11 gains dependencies) | agent | T15, T17, T18 | Mon and Tue nights |
| 7 | — | Label 10 to 25 takes; publish measured accuracy | Ares, then a content edit | T18, T19 | Oct 15 to 19 |
| 8 | T20 | Pin the AssemblyAI model; compare Deepgram nova-2 | agent plus Ares's call | T19 | Oct 15 to 19 |
| 9 | — | Polish and stretch items | mixed | Phase 1 | Oct 19 to 21 |

Nights run 3 tasks with 40 minutes each, and day batches run 2 tasks with 30 minutes each (`automation/night.sh`, `automation/README.md`). Tasks 1 and 2 carry their full code, so each is mostly apply, run and commit.

What changes for the user, screen by screen:

- **Results:** the four cards become Words per minute (hesitations no longer count as words), Fillers per minute (with a "Target under 3" hint), Mid-sentence pauses and Longest clean stretch. Ums keep the amber highlight, and verbal habits get a dotted underline. A one-line legend names the most-used habit and links to How we measure. Tips name the moments, as in "Fillers at 0:42, 1:15, 1:58 and 2 more.", then one technique.
- **Practice:** Congress speech (3:00) and PF constructive (4:00) presets, plus a "See a sample result" button for judges without a microphone.
- **Progress:** a fourth chip, Clean stretch. Every saved session, old or new, is re-scored by the same rules.
- **How we measure:** a static page with every rule, band and source.

---

## Task 0 (Ares): contract, queue and sample take

**Files:**
- Modify: `frontend/DESIGN.md` (human-owned; the diff below)
- Modify: `backend/tests/test_frontend_shell.py:31-44` (existing test; agents are blocked from it by `automation/hooks/protect.sh`)
- Modify: `tasks/queue.json` (human-owned)
- Create: `frontend/sample-session.json` (from a real take)

- [ ] **Step 0.1: Approve T08.** Merge `t08-pauses` the usual way. Task 1's `index.html` line sits next to the `pauses.js` tag, and pause reconcile feeds the mid-sentence pause count.

- [ ] **Step 0.2: Amend the design spec.** Save the block below as `/tmp/design.diff`, then run `git apply /tmp/design.diff` from the repo root.

````diff
--- a/frontend/DESIGN.md
+++ b/frontend/DESIGN.md
@@ -26,19 +26,24 @@
   ui.js               app.ui: el, renderState, clear, announce, formatClock, formatDate
   store.js            app.store: IndexedDB sessions + flags
   api.js              app.api.analyze
-  passages.js         app.passages: [{id, title, text, targetWpm: [lo, hi]}]
-  tips.js             app.tips.select(metrics) -> up to two {id, text}
+  passages.js         app.passages: [{id, kind, title, text, targetWpm: [lo, hi], source?,
+                      format?, timeLimitSeconds?}]
+  delivery.js         app.delivery: the filler rules and the delivery report (analyze, classify)
+  tips.js             app.tips.select(report, options) -> up to two {id, text}
   pauses.js           app.pauses, human-owned (T08); agents never touch it
   screens/practice.js results.js history.js progress.js onboarding.js
+  how.html            static "How we measure" page: each metric's rule, band and source
+  sample-session.json one real take, loaded by Practice's "See a sample result"
   manifest.json  sw.js  icons/   (T10)
 ```
 
-Script order: `app.js`, `ui.js`, `store.js`, `api.js`, `passages.js`, `tips.js`, then the five screens. Classic `<script>` tags, no modules, no build, no CDN. Every file is an IIFE assigning exactly one `app.<name>`; `window.app` is the only global. Each file opens with a two-to-four line comment saying what it owns. Transcript and user text never go through `innerHTML`; build nodes with `app.ui.el`.
+Script order: `app.js`, `ui.js`, `store.js`, `api.js`, `passages.js`, `delivery.js`, `tips.js`, `pauses.js`, then the five screens. Classic `<script>` tags, no modules, no build, no CDN. Every file is an IIFE assigning exactly one `app.<name>`; `window.app` is the only global. Each file opens with a two-to-four line comment saying what it owns. Transcript and user text never go through `innerHTML`; build nodes with `app.ui.el`.
 
 Contracts (exact names):
 
 - `app.router.go(name, params)`, `app.router.current()`. A screen registers `app.screens[name] = { mount(root), show(params), hide() }`; `app.js` calls `mount` once at boot with its `<section id="screen-<name>" class="screen">`, then `show`/`hide` on each hash change. A module never touches DOM outside its `root`; shared data goes through `app.store` and route params.
 - `app.store.save(session) -> Promise<id>`, `list()` newest first, `get(id)`, `remove(id)`, `getFlag(key)`, `setFlag(key, value)`. Session: `{id, createdAt, passageId, passageTitle, durationSeconds, metrics, transcript}`; `metrics` is the backend dict unchanged, `transcript` the backend word list `[{text, start, end}]`. Audio is never stored.
+- `app.delivery.analyze(words, metrics) -> report` re-scores a stored take from its words, so every saved session uses today's rules: `kinds` (`"hesitation"`, `"habit"` or null per word), `fillers` (`{index, text, kind, start, end}`, "you know" is one event), `fillerCount`, `hesitationCount`, `habitCounts`, `topHabit` (`{text, count}` or null), `speakingSeconds`, `wordsPerMinute` (hesitation sounds are not words), `fillersPerMinute`, `pauses` (`{at, length, midSentence}`), `midSentencePauseCount`, `longestMidSentencePause`, `cleanStretch` (`{start, end, seconds}` or null) and `repeatCount`. A session with no words falls back to the backend tallies. Results, tips and Progress read this report; `metrics` stays the backend dict unchanged.
 - `app.api.analyze(blob, contentType) -> Promise<{transcript, metrics}>`; rejects with an `Error` whose `.kind` is `"network" | "too_short" | "provider" | "unknown"` and whose `.message` is the matching string in section 8.
 - `app.ui.el(tag, attrs, children)`; `renderState(root, {kind, title, body, actionLabel, onAction})`, kind `"empty" | "error" | "loading"`; `clear(root)`; `announce(text)` writes the `.sr-only` live region; `formatClock(seconds) -> "1:05"`; `formatDate(iso) -> "Oct 9, 10:21 PM"`.
 - Practice keeps its state in one string, `app.screens.practice.state`; one `render(state)` function is the only code that touches that screen's DOM.
@@ -96,7 +101,7 @@
 --fs-micro:  12px / 1.3 / 500   uppercase labels, timestamps (letter-spacing 0.04em)
 ```
 
-Body never goes below 16px. Metric labels are full phrases: "Words per minute", "Fillers per minute", "Pauses over 1.5 s", "Longest pause".
+Body never goes below 16px. Metric labels are full phrases: "Words per minute", "Fillers per minute", "Mid-sentence pauses", "Longest clean stretch".
 
 ## 6. Component inventory
 
@@ -108,9 +113,9 @@
 
 **Timer** `.timer`: `--fs-hero`, centered, text `0:00`, `aria-live="off"` (announcements use `app.ui.announce`). **`.rec-dot`**: 8px `--record` circle before the timer, `opacity 1 -> .3` 1s pulse.
 
-**Metric card** `.metric-card` (surface, border, `--r-card`, padding `--s-4`): `.metric-card__label` (micro, uppercase, muted), `.metric-card__value` (metric size), `.metric-card__unit` (small, muted, inline: "wpm", "per min", "s"), `.metric-card__hint` (small; `--ok` or `--warn`, always words: "Target 140 to 160", "Slow down"). Results shows exactly four, in order: words per minute (`metrics.words_per_minute` rounded), fillers per minute (total fillers / (duration / 60), one decimal), pauses (`metrics.pauses.length`), longest pause (one decimal).
+**Metric card** `.metric-card` (surface, border, `--r-card`, padding `--s-4`): `.metric-card__label` (micro, uppercase, muted), `.metric-card__value` (metric size), `.metric-card__unit` (small, muted, inline: "wpm", "per min", "s"), `.metric-card__hint` (small; `--ok` or `--warn`, always words: "Target 140 to 160", "Slow down"). Results shows exactly four, in order: words per minute (`report.wordsPerMinute` rounded, pace hint as before), fillers per minute (`report.fillersPerMinute`, hint "Target under 3" in `--ok` at 3 or less and "Aim for under 3" in `--warn` above), mid-sentence pauses (`report.midSentencePauseCount`, no hint), longest clean stretch (`report.cleanStretch.seconds`, unit "s", 0 for a session without words, no hint). The meta line ends with " · 2:41 of 3:00" when the passage has `timeLimitSeconds`.
 
-**Transcript** `.transcript`: a `<p>` at body size, `line-height: 1.8`. Every word is `<span class="tok">` plus a space. `.tok--filler`: filler text and bg, `padding: 0 var(--s-1)`, radius `--r-tok`, weight 600, `aria-label="um, filler word"`. A word is a filler when its lowercased, punctuation-stripped text is one of `um uh hmm like so basically actually`, or starts the phrase `you know` (both words get the class). `.tok--pause`: an inline marker, not a word, inserted after the last word whose `end <= at` for each `[at, length]` in `metrics.pauses`: pause text and bg, radius `--r-chip`, `padding: 0 var(--s-2)`, micro size, text `2.1 s pause`, `aria-label="pause, 2.1 seconds"`. Repeats are not styled; they appear in tips only.
+**Transcript** `.transcript`: a `<p>` at body size, `line-height: 1.8`. Every word is `<span class="tok">` plus a space. Words are labeled by `app.delivery.classify`. `.tok--filler` marks a hesitation sound (um, uh, er, ah, hm at any length): filler text and bg, `padding: 0 var(--s-1)`, radius `--r-tok`, weight 600, `aria-label="um, filler word"`. `.tok--habit` marks a verbal habit the rules counted (like, so, you know, actually, basically): filler text color, weight 600, no background, a 2px dotted underline in `--filler` offset by `--s-1`, `aria-label="like, verbal habit"`. Between the Transcript heading and the paragraph, `.transcript__legend` (small, muted) reads "Highlighted words are ums and uhs. Underlined words are verbal habits.", adds "Most used: “like”, 4 times." when a habit was counted, and ends with a "How we count" link to `how.html`. `.tok--pause`: an inline marker, not a word, inserted after the last word whose `end <= at` for each `[at, length]` in `metrics.pauses`: pause text and bg, radius `--r-chip`, `padding: 0 var(--s-2)`, micro size, text `2.1 s pause`, `aria-label="pause, 2.1 seconds"`. Repeats are not styled; they appear in tips only.
 
 **Chips** `.chip`: `<button>`, `min-height: 44px; padding: 0 var(--s-4); border-radius: var(--r-chip); font: 500 var(--fs-small)`, surface bg, 1px border. `.chip--selected`: accent bg, on-accent text, `aria-pressed="true"`. `.chip-row`: horizontal flex, `gap: var(--s-2)`, `overflow-x: auto`. Used for the passage picker and the Progress metric toggle.
 
@@ -124,7 +129,7 @@
 
 **Nav** `<nav class="nav" aria-label="Main">`: fixed bottom, `height: calc(var(--nav-h) + env(safe-area-inset-bottom))`, surface bg, 1px top border, three `<a class="nav__item">` flex columns (flex 1, `min-height: 56px`): `.nav__icon` 24px SVG over `.nav__label` micro. `.nav__item--active`: `--accent`, `aria-current="page"`; inactive `--muted`.
 
-**Chart** `.chart`: inline SVG `viewBox="0 0 320 200"`, `width: 100%`. Gridlines `--grid` 1px, axes `--border`, labels micro `--muted`. One `<polyline>` at a time, `stroke-width: 2`, 4px circle points, colored by series: wpm `--accent`, fillers per minute `--filler`, pauses `--pause`; chosen by the chip row. `role="img"` with an `aria-label` naming series, latest value and session count; a `.sr-only` `<table>` lists the numbers.
+**Chart** `.chart`: inline SVG `viewBox="0 0 320 200"`, `width: 100%`. Gridlines `--grid` 1px, axes `--border`, labels micro `--muted`. One `<polyline>` at a time, `stroke-width: 2`, 4px circle points, colored by series: wpm `--accent`, fillers per minute `--filler`, pauses `--pause`, clean stretch `--ok`; chosen by the chip row of four. `role="img"` with an `aria-label` naming series, latest value and session count; a `.sr-only` `<table>` lists the numbers.
 
 **`.sr-only`**: the standard visually-hidden rule.
 
@@ -134,7 +139,7 @@
 
 | State | Timer | Record button | Chips | Below | Nav |
 |---|---|---|---|---|---|
-| `idle` | `0:00`, muted | mic, "Record" | enabled | `.practice__hint` "Tap to record. Stop uploads automatically." | visible |
+| `idle` | `0:00`, muted | mic, "Record" | enabled | `.practice__hint` "Tap to record. Stop uploads automatically." and a `.btn--ghost` "See a sample result" | visible |
 | `recording` | counting, text color, `.rec-dot` | stop, "Stop" | disabled | passage text stays readable | hidden |
 | `uploading` | final value held | hidden | disabled | `.state--loading` "Analyzing your speech" / "Usually 5 to 15 seconds." No cancel. | hidden |
 | `error` | last value | mic, "Record" | enabled | `.state--error`, fixed message, one action | visible |
@@ -150,6 +155,7 @@
 - History empty: "No sessions yet" / "Your first recording will show up here." Action "Record".
 - Progress under two sessions: "Need two sessions" / "Record one more to see a trend." Action "Record".
 - Results bad id: "Session not found". Action "History".
+- Sample failed: "Could not load the sample. Try again." Action "Try again" (back to idle).
 
 Copy: second person, present tense, under 15 words a sentence, no exclamation marks, no blame.
 
````

- [ ] **Step 0.3: Add `delivery.js` to the fixed script order.** The order list allows any subset, so this change passes on its own before Task 1 lands.

````diff
--- a/backend/tests/test_frontend_shell.py
+++ b/backend/tests/test_frontend_shell.py
@@ -34,6 +34,7 @@
     "store.js",
     "api.js",
     "passages.js",
+    "delivery.js",
     "tips.js",
     "pauses.js",
     "screens/practice.js",
````

- [ ] **Step 0.4: Update `tasks/queue.json`.** Add the five entries below to the `tasks` array, after T08. Replace T12's `brief` and `acceptance` with the text under "Rewritten T12". Set T11's `depends_on` to `["T10a-2", "T12", "T15", "T17", "T18"]`. Append this sentence to T13b's brief: "In the module table also list delivery.js (app.delivery: analyze, classify, isHesitation) and how.html (static page, no script)." The T15 brief records your approval of the test supersessions listed in Task 2. Read that list before you approve.

```json
[
  {
    "id": "T14",
    "title": "Delivery rules: frontend/delivery.js classifies fillers and builds the delivery report",
    "brief": "Implement Task 1 of docs/superpowers/plans/2026-10-10-next-level.md exactly. The plan holds the complete test file and module: write the test file first, run it and watch it fail because delivery.js is missing, then add the module and watch all 16 tests pass. Scope: create frontend/delivery.js and frontend/tests/delivery.test.js; in frontend/index.html add <script src=\"delivery.js\"></script> on its own line immediately after the passages.js script; if frontend/sw.js exists, add 'delivery.js' to its SHELL list and bump CACHE_NAME. backend/tests/test_frontend_shell.py already lists delivery.js in SCRIPT_LOAD_ORDER (human edit in Task 0). Do not touch results.js, tips.js or any existing test. Commit when .venv/bin/pytest -q, .venv/bin/ruff check . and node --test frontend/tests all pass.",
    "acceptance": "Script: `node --test frontend/tests` passes including the 16 tests in delivery.test.js; `.venv/bin/pytest -q` passes (the shell test checks the script order and runs node --check on delivery.js). Manual (1 min): open the app, and in the DevTools console `app.delivery.isHesitation('Umm,')` returns true and `app.delivery.classify([{text:'I',start:0,end:0.2},{text:'like',start:0.3,end:0.5},{text:'it.',start:0.6,end:0.8}])` returns [null, null, null].",
    "status": "todo",
    "owner": "agent",
    "depends_on": [],
    "notes": []
  },
  {
    "id": "T15",
    "title": "Results, tips and Progress read the delivery report",
    "brief": "Implement Task 2 of docs/superpowers/plans/2026-10-10-next-level.md exactly; the plan holds every diff and new file. Apply the diffs with git apply, replace frontend/tips.js and frontend/tests/tips.test.js with the plan's versions, add frontend/tests/results_delivery.test.js, and run the suite. Ares approved these supersessions of existing tests, and only these: frontend/tests/tips.test.js is replaced whole; frontend/tests/results.test.js, transcript.test.js and progress.test.js change only by the hunks printed in the plan. If any other existing assertion fails, stop and report it instead of editing it. frontend/DESIGN.md was amended by Ares in Task 0 to describe this screen. Scope: frontend/screens/results.js, frontend/screens/progress.js, frontend/tips.js, frontend/styles.css, those four test files and the new test file. Commit when .venv/bin/pytest -q, .venv/bin/ruff check . and node --test frontend/tests all pass.",
    "acceptance": "Script: `node --test frontend/tests` and `.venv/bin/pytest -q` pass. Manual (2 min): record about 10 seconds saying 'I like this plan, so the impact is clear.' then 'Um, like, you know, the plan works.' On Results, nothing in the first sentence is marked; 'Um,' has the amber highlight; 'like,' and 'you know,' are underlined; the legend under Transcript names the most-used habit; the Fillers per minute card has a hint; a tip lists filler moments as m:ss; Progress shows four chips including Clean stretch.",
    "status": "todo",
    "owner": "agent",
    "depends_on": [
      "T14"
    ],
    "notes": []
  },
  {
    "id": "T17",
    "title": "Practice: See a sample result",
    "brief": "Implement Task 4 of docs/superpowers/plans/2026-10-10-next-level.md. Already exists: frontend/sample-session.json (a real take Ares recorded and exported), app.store.save, app.router.go, Practice's render(state, detail) and its .practice__hint paragraph. In mount(), append a <button type=\"button\" class=\"btn btn--ghost practice__sample\"> 'See a sample result' as the last child of the existing .practice__hint paragraph (not of .screen__body: practice.test.js pins the body's children). CSS: show .practice__sample only when the screen's data-state is idle. Tap: fetch('sample-session.json'); require an object with an array transcript and an object metrics; save {passageId, passageTitle, durationSeconds, metrics, transcript} with app.store.save; then app.router.go('results', {id}). On any failure render('error', {title: 'Sample unavailable', body: 'Could not load the sample. Try again.', actionLabel: 'Try again', onAction: () => render('idle')}). A second tap while loading does nothing. Tests in a new frontend/tests/practice_sample.test.js with a fake fetch, store and router: the button exists and is labeled; a good file saves once and routes to results with the saved id; a 404, a network rejection and a file without a transcript array each show the error block with that exact copy; a double tap fetches once. Do not edit existing tests. Commit when pytest, ruff and node --test frontend/tests pass.",
    "acceptance": "Script: `node --test frontend/tests` passes including practice_sample.test.js. Manual (1 min): on Practice in idle, tap 'See a sample result': Results opens with the sample's transcript and tips, and History lists the sample; while recording, the button is hidden.",
    "status": "todo",
    "owner": "agent",
    "depends_on": [
      "T15"
    ],
    "notes": []
  },
  {
    "id": "T18",
    "title": "How we measure page and the legend's How we count link",
    "brief": "Implement Task 5 of docs/superpowers/plans/2026-10-10-next-level.md. Create frontend/how.html, a static page that loads styles.css only (no scripts) with an h1 'How we measure', a back link to ./#/practice, and one section per item in the plan's content outline, copied in plain language from the rules in frontend/delivery.js and the bands in frontend/tips.js, each band with its named source. In frontend/screens/results.js, buildLegend appends a link <a class=\"transcript__how\" href=\"how.html\">How we count</a> after the legend text as a child node (the legend's own text must stay exactly as Task 2 set it). Add .transcript__how to styles.css with tokens only. If frontend/sw.js exists, add 'how.html' to SHELL and bump CACHE_NAME. Tests in a new frontend/tests/how_page.test.js: the legend contains one a.transcript__how with href how.html; how.html exists, has exactly one h1, links styles.css, contains no <script and no '!' in its text, and names every rule word (like, so, you know, actually, basically) and every source in the outline. Do not edit existing tests. Commit when pytest, ruff and node --test frontend/tests pass.",
    "acceptance": "Script: `node --test frontend/tests` passes including how_page.test.js; `.venv/bin/pytest -q` passes. Manual (1 min): on Results tap 'How we count': the page opens at 320px with no horizontal scroll in light and dark, every metric has a rule and a source, and the back link returns to Practice.",
    "status": "todo",
    "owner": "agent",
    "depends_on": [
      "T15"
    ],
    "notes": []
  },
  {
    "id": "T19",
    "title": "Accuracy scorer: scripts/measure_fillers.js",
    "brief": "Implement Task 6 of docs/superpowers/plans/2026-10-10-next-level.md. Create scripts/measure_fillers.js (node, no dependencies): it loads frontend/delivery.js into a vm context, exports score(transcript, labels) and, when run as `node scripts/measure_fillers.js <folder>`, reads every *.json in the folder in the labeled format the plan defines and prints one row per file plus a total row: hesitation precision and recall, habit precision and recall, and the fillers the transcript missed. Precision or recall with nothing to divide is printed as '-' and returned as null, never NaN. Tests in a new frontend/tests/measure_fillers.test.js covering the four exact cases in the plan. Add samples/labeled/ to .gitignore. Do not edit existing tests. Commit when pytest, ruff and node --test frontend/tests pass.",
    "acceptance": "Script: `node --test frontend/tests` passes including measure_fillers.test.js. Manual (2 min): label one real take into samples/labeled/ as the plan describes, run `node scripts/measure_fillers.js samples/labeled`, and check its row against your own count.",
    "status": "todo",
    "owner": "agent",
    "depends_on": [
      "T14"
    ],
    "notes": []
  }
]
```

Rewritten T12 `brief`:

> Scope: edit frontend/passages.js only, plus a new test file frontend/tests/passages_content.test.js. tips.js is no longer part of this task (T15 replaces the tips). Do not edit passages.test.js; it tolerates this growth (at least four entries, a 60-word floor on passages, prompts of at least 10 words). Keep every existing id and the 'free-talk' prompt. Grow to exactly six passages plus four prompts. Passages: two debate-style rebuttal paragraphs you write yourself (80-110 words, Congress-style 'my opponent argues ... but' structure, target [150,170]); two persuasive public-domain excerpts of 90-130 words (Lincoln 1863, Frederick Douglass 1852, Sojourner Truth 1851 as commonly transcribed, or Patrick Henry 1775; a 'source' field naming speaker and year, target [130,150]); two clarity drills of 60-80 words built from repeated consonant clusters, written by you, titled as drills, target [120,140]. Prompts, all kind 'prompt' with text of at least 10 words: keep 'free-talk' (target [140,160]); add 'impromptu' ('Explain a rule your school should change and why, for one minute.', target [140,160]); add 'congress-speech' (title 'Congress speech', format 'Congress', timeLimitSeconds 180, target [130,160], text telling the speaker to give a three-minute speech for or against a bill of their choice, opening with a clear claim); add 'pf-constructive' (title 'PF constructive', format 'Public Forum', timeLimitSeconds 240, target [140,180], text telling the speaker to deliver a constructive case they are working on, clear enough for a lay judge). Only the two presets carry format and timeLimitSeconds. Every entry: lowercase slug id, title under 40 characters, no exclamation marks. Tests in passages_content.test.js: exactly 10 entries, 6 of kind passage, 4 prompts, unique ids, every passage 60-130 words, each targetWpm lo < hi, a non-empty string source on the two excerpts, exactly two entries with a positive integer timeLimitSeconds and a non-empty format (congress-speech 180, pf-constructive 240), no '!' anywhere, titles under 40 characters. Commit when pytest, ruff and node --test frontend/tests pass.

Rewritten T12 `acceptance`:

> Script: `node --test frontend/tests` passes including passages_content.test.js and the unchanged passages.test.js. Manual (1 min): the Practice chip row scrolls through ten chips at 320px without page overflow; the Congress speech card shows 'Target 130 to 160 wpm'; after T15, a Congress speech take shows '... · m:ss of 3:00' in the Results meta line.

T12 drops its old tips half. Its `likes` rule becomes T15's `habit` rule, which reads the context-aware count. `pause-none` and `pace-uneven` are dropped: the research gives no support for a 1.5 s pause floor, and listeners rate pace changes as charismatic, not as a fault.

- [ ] **Step 0.5: Record the sample take (any time before Monday's day batch).** Record 45 to 60 seconds on Free talk, or on Congress speech once T12 lands, in your own voice. Use your natural delivery with a couple of real ums, and stop once after a period for a beat. When Results opens, run this in the DevTools console:

```js
const [take] = await app.store.list();
copy(JSON.stringify({
  passageId: take.passageId,
  passageTitle: "Sample: " + take.passageTitle,
  durationSeconds: take.durationSeconds,
  metrics: take.metrics,
  transcript: take.transcript,
}, null, 2));
```

Paste the clipboard into `frontend/sample-session.json`.

- [ ] **Step 0.6: Verify and commit.** Run the three checks, then commit the design amendment, the shell-test line, the queue changes, the sample file and this plan file together. Night agents work from `main`, so they can only read this plan once it is committed there.

```bash
.venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
```

Expected: all pass. The shell test accepts an `index.html` that does not load `delivery.js` yet.

---

## Task 1 (T14): `frontend/delivery.js`, the filler rules and the delivery report

**Files:**
- Create: `frontend/delivery.js`
- Create: `frontend/tests/delivery.test.js`
- Modify: `frontend/index.html` (one line after the `passages.js` script)
- Modify, only if it exists: `frontend/sw.js` (add `'delivery.js'` to `SHELL`, bump `CACHE_NAME`)

**Interfaces:**
- Consumes: the stored session's `transcript` (`[{text, start, end}]`, the backend word list) and `metrics` (`pauses` as `[at, length]` pairs after pauses.js reconcile, `repeats` as `{text, at}`, plus `fillers`, `duration` and `words_per_minute` for the no-words fallback).
- Produces `app.delivery`:
  - `classify(words) -> Array<"hesitation" | "habit" | null>`, one label per word, aligned by index.
  - `analyze(words, metrics) -> report`, where `report` is `{kinds, fillers: [{index, text, kind, start, end}], fillerCount, hesitationCount, habitCounts: {like, so, "you know", actually, basically}, topHabit: {text, count} | null, speakingSeconds, wordsPerMinute, fillersPerMinute, pauses: [{at, length, midSentence}], midSentencePauseCount, longestMidSentencePause, cleanStretch: {start, end, seconds} | null, repeatCount}`.
  - `isHesitation(text) -> boolean`.
  - The constants `HESITATION`, `HABIT` and `HABIT_WORDS`.

The rules, in the words the How we measure page will use:

| Word | Counts as a filler when | Never counts |
|---|---|---|
| um, uh, er, ah, hm (any length: umm, uhh, erm, hmmm) | always | agreement sounds: mhm, uh-huh, mm-hmm, huh |
| like | a comma or um sets it off, or a 0.25 s pause comes before it mid-sentence; at the start of a sentence, a comma or um must follow it | right after I, you, we, they, would, to, do, don't, not, really, just, looks, sounds, feels, seems, something, things, stuff, more, much, even with an um in between ("I, um, like this plan") |
| you know | a comma or stop, an um, or a 0.25 s pause follows "know" | right after do, does, did, don't, if, would, let, as ("I'll let you know.", "Do you know why?"); "You know the drill." |
| so | an um or a half-second hang follows it | "So the impact is…", "So, the impact is…", "so far", "I think so." |
| actually, basically | they open a sentence or clause: first word, after a comma or stop, or right after another filler | mid-clause: "It is actually true." |

Known limitation, chosen on purpose: "I, like, think" is missed, because flagging a real verb costs more trust than missing one filler. The accuracy run in Task 7 measures this choice.

- [ ] **Step 1: Write the failing test.** Create `frontend/tests/delivery.test.js`:

```js
// Tests for frontend/delivery.js, the delivery rules: which words are hesitation sounds or
// verbal habits, and the report Results, tips and Progress read (pace without hesitations,
// fillers per minute, mid-sentence pauses, the longest clean stretch). The module is pure, so
// it loads into a bare vm context with an empty app and no browser fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DELIVERY_SOURCE = fs.readFileSync(path.join(__dirname, "..", "delivery.js"), "utf8");

// The real AssemblyAI word list for samples/test-clip.m4a, and the backend metrics for it
// (backend/tests/test_metrics.py pins every one of these numbers).
const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};

function load() {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  return app.delivery;
}

// Objects built inside the vm realm have a foreign prototype; a JSON round-trip makes them
// comparable with deepEqual.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Words 0.3 s long with 0.1 s between them; `extraGapBefore` maps a word index to extra
// silence before that word, for the pause cues.
function timed(sentence, extraGapBefore = {}) {
  let clock = 0;
  return sentence.split(" ").map((text, index) => {
    clock += extraGapBefore[index] || 0;
    const word = { text, start: round(clock), end: round(clock + 0.3) };
    clock += 0.4;
    return word;
  });
}

function round(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

// The words classify() marked, as "text:kind" strings in order.
function marked(delivery, words) {
  const kinds = delivery.classify(words);
  return words.flatMap((word, index) => (kinds[index] ? [word.text + ":" + kinds[index]] : []));
}

test("delivery.js assigns exactly app.delivery with analyze, classify and isHesitation", () => {
  const app = {};
  vm.runInNewContext(DELIVERY_SOURCE, { app }, { filename: "delivery.js" });
  assert.deepEqual(Object.keys(app), ["delivery"]);
  for (const name of ["analyze", "classify", "isHesitation"]) {
    assert.equal(typeof app.delivery[name], "function", name);
  }
});

test("isHesitation knows um, uh, er, ah, hm and their stretched spellings, nothing else", () => {
  const delivery = load();
  for (const word of ["um", "Um,", "umm", "uhm", "uh", "Uhh.", "er", "erm", "ah", "hm", "hmmm"]) {
    assert.equal(delivery.isHesitation(word), true, word);
  }
  for (const word of ["mhm", "uh-huh", "mm-hmm", "huh", "umbrella", "m", "a", "", undefined]) {
    assert.equal(delivery.isHesitation(word), false, String(word));
  }
});

test("on the real clip: nine hesitations, and 'so,' and 'basically,' are the only habits", () => {
  const delivery = load();
  const kinds = delivery.classify(CLIP_WORDS);
  assert.equal(kinds.length, CLIP_WORDS.length);
  assert.equal(kinds.filter((kind) => kind === "hesitation").length, 9);
  assert.deepEqual(
    CLIP_WORDS.flatMap((word, index) => (kinds[index] === "habit" ? [word.text] : [])),
    ["so,", "basically,"],
  );
  const likeIndex = CLIP_WORDS.findIndex((word) => word.text === "like");
  assert.equal(kinds[likeIndex], null, "'I like to play tennis' is a verb");
  const farIndex = CLIP_WORDS.findIndex((word) => word.text === "far.");
  assert.equal(kinds[farIndex - 1], null, "'good so far' is not a habit");
});

test("like counts when a comma, an um or a 0.25 s pause sets it off", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("It was, like, a disaster.")), ["like,:habit"]);
  assert.deepEqual(marked(delivery, timed("It was um like really big.")), [
    "um:hesitation",
    "like:habit",
  ]);
  assert.deepEqual(marked(delivery, timed("Like, the plan fails.")), ["Like,:habit"]);
  assert.deepEqual(marked(delivery, timed("Um, like, the plan fails.")), [
    "Um,:hesitation",
    "like,:habit",
  ]);
  assert.deepEqual(marked(delivery, timed("It was like really big.", { 2: 0.25 })), ["like:habit"]);
  assert.deepEqual(marked(delivery, timed("It was like really big.", { 2: 0.1 })), []);
});

test("like after I, looks or just is a verb or comparison, even with an um in between", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("I like this plan.")), []);
  assert.deepEqual(marked(delivery, timed("I, um, like this plan.")), ["um,:hesitation"]);
  assert.deepEqual(marked(delivery, timed("It looks like, um, a problem.")), ["um,:hesitation"]);
  assert.deepEqual(marked(delivery, timed("Just like the evidence says.")), []);
  assert.deepEqual(marked(delivery, timed("Like my opponent said, the plan fails.")), []);
  assert.deepEqual(marked(delivery, timed("Um like the evidence says, no.")), ["Um:hesitation"]);
});

test("you know counts when set off after know; not 'the drill', 'let you know', a question", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("You know, the drill.")), [
    "You:habit",
    "know,:habit",
  ]);
  assert.deepEqual(marked(delivery, timed("It is, you know, hard.")), ["you:habit", "know,:habit"]);
  assert.deepEqual(marked(delivery, timed("You know the drill.")), []);
  assert.deepEqual(marked(delivery, timed("I'll let you know.")), []);
  assert.deepEqual(marked(delivery, timed("Do you know why?")), []);
});

test("so counts only when an um or a half-second hang follows it", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("Hey, so, um, we start.")), [
    "so,:habit",
    "um,:hesitation",
  ]);
  assert.deepEqual(marked(delivery, timed("So the impact is clear.", { 1: 0.5 })), ["So:habit"]);
  for (const sentence of [
    "So the impact is extinction.",
    "So, the impact is extinction.",
    "I like this plan, so the impact is clear.",
    "It is good so far.",
    "I think so.",
  ]) {
    assert.deepEqual(marked(delivery, timed(sentence)), [], sentence);
  }
  assert.deepEqual(marked(delivery, timed("So the impact is clear.", { 1: 0.3 })), []);
});

test("actually and basically count only where a sentence or clause begins", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("Basically, the plan fails.")), ["Basically,:habit"]);
  assert.deepEqual(marked(delivery, timed("Actually the card says otherwise.")), [
    "Actually:habit",
  ]);
  assert.deepEqual(marked(delivery, timed("The plan basically fails.")), []);
  assert.deepEqual(marked(delivery, timed("It is actually true.")), []);
});

test("a transcript with no punctuation still never counts 'I like', and pauses still work", () => {
  const delivery = load();
  assert.deepEqual(marked(delivery, timed("i like this plan so the impact is clear")), []);
  assert.deepEqual(marked(delivery, timed("it was like really big", { 2: 0.3 })), ["like:habit"]);
});

test("analyze on the clip: pace without ums, fillers per minute, breaks and clean stretch", () => {
  const delivery = load();
  const report = delivery.analyze(CLIP_WORDS, CLIP_METRICS);
  assert.equal(report.fillerCount, 11);
  assert.equal(report.hesitationCount, 9);
  assert.deepEqual(plain(report.habitCounts), {
    like: 0,
    so: 1,
    "you know": 0,
    actually: 0,
    basically: 1,
  });
  assert.deepEqual(plain(report.topHabit), { text: "so", count: 1 });
  assert.equal(report.speakingSeconds, 30.908);
  assert.equal(report.wordsPerMinute, 75.7, "39 words that are not um or uh over 30.908 s");
  assert.equal(report.fillersPerMinute, 21.4, "11 fillers over 30.908 s");
  assert.equal(report.midSentencePauseCount, 3);
  assert.equal(report.longestMidSentencePause, 2.5);
  assert.deepEqual(plain(report.cleanStretch), { start: 5.436, end: 10.352, seconds: 4.9 });
  assert.equal(report.repeatCount, 1);
  assert.deepEqual(
    plain(report.fillers.slice(0, 2)),
    [
      { index: 1, text: "so", kind: "habit", start: 1.723, end: CLIP_WORDS[1].end },
      { index: 2, text: "um", kind: "hesitation", start: 2.417, end: CLIP_WORDS[2].end },
    ],
  );
});

test("a pause after a sentence-ending word is not a break and does not cut the stretch", () => {
  const delivery = load();
  const words = timed("We win. The plan works today.", { 2: 2 });
  const report = delivery.analyze(words, { pauses: [[words[1].end, 2.1]], repeats: [] });
  assert.deepEqual(
    plain(report.pauses),
    [{ at: words[1].end, length: 2.1, midSentence: false }],
  );
  assert.equal(report.midSentencePauseCount, 0);
  assert.equal(report.cleanStretch.seconds, 4.3, "the whole take, first start to last end");
});

test("a mid-sentence pause and a restart each cut the clean stretch", () => {
  const delivery = load();
  const words = timed("The plan works because the the cost is low.", { 3: 2 });
  const pause = [words[2].end, 2.1];
  const report = delivery.analyze(words, {
    pauses: [pause],
    repeats: [{ text: "the", at: words[4].start }],
  });
  assert.equal(report.midSentencePauseCount, 1);
  // Cuts: the pause [1.1, 3.2] and the restart [3.6, 4.0]; the longest clean run is the
  // restarted "the cost is low." from 4.0 to 5.5.
  assert.deepEqual(plain(report.cleanStretch), { start: 4, end: 5.5, seconds: 1.5 });
});

test("an energy-only pause between word ends is placed after the last word ending by it", () => {
  const delivery = load();
  const words = timed("Our plan solves the harm.", { 3: 2.5 });
  const report = delivery.analyze(words, { pauses: [[words[2].end + 0.4, 2]], repeats: [] });
  assert.equal(report.pauses[0].midSentence, true, "'solves' does not end a sentence");
});

test("without words, analyze falls back to the backend tallies", () => {
  const delivery = load();
  const report = delivery.analyze([], CLIP_METRICS);
  assert.equal(report.fillerCount, 13);
  assert.equal(report.hesitationCount, 9);
  assert.equal(report.wordsPerMinute, 93.2);
  assert.equal(report.fillersPerMinute, 25.2);
  assert.equal(report.midSentencePauseCount, 3, "every pause counts when no word can place it");
  assert.equal(report.longestMidSentencePause, 2.5);
  assert.equal(report.cleanStretch, null);
  assert.deepEqual(plain(report.kinds), []);
});

test("analyze never throws on missing or malformed input and never changes its inputs", () => {
  const delivery = load();
  const words = CLIP_WORDS.map((word) => ({ ...word }));
  const metrics = JSON.parse(JSON.stringify(CLIP_METRICS));
  const before = JSON.stringify({ words, metrics });
  delivery.analyze(words, metrics);
  assert.equal(JSON.stringify({ words, metrics }), before);

  const empty = delivery.analyze(undefined, undefined);
  assert.equal(empty.fillerCount, 0);
  assert.equal(empty.wordsPerMinute, 0);
  assert.equal(empty.topHabit, null);
  const junk = delivery.analyze([{ text: null }, { start: "x" }], { pauses: [null, [1], "x"] });
  assert.equal(junk.pauses.length, 0);
  assert.equal(junk.fillerCount, 0);
  const holes = delivery.analyze([null, { text: "um", start: 1, end: 1.2 }, undefined], {
    pauses: [],
    repeats: [null, { text: "the" }, { text: "we", at: "1" }],
  });
  assert.equal(holes.hesitationCount, 1);
  assert.equal(holes.repeatCount, 0);
});

test("a ten-minute, 1,500-word take is analyzed in well under 100 ms", () => {
  const delivery = load();
  const sentence = "So, um, the plan works because, like, the cost is very low. ";
  const words = timed(sentence.repeat(125).trim());
  const pauses = Array.from({ length: 40 }, (_, k) => [words[k * 30].end, 1.6]);
  const started = process.hrtime.bigint();
  const report = delivery.analyze(words, { pauses, repeats: [] });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(report.kinds.length, 1500);
  assert.ok(elapsedMs < 100, "took " + elapsedMs.toFixed(1) + " ms");
});
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `node --test frontend/tests/delivery.test.js`
Expected: FAIL with `ENOENT: no such file or directory, open '.../frontend/delivery.js'`.

- [ ] **Step 3: Write the module.** Create `frontend/delivery.js`:

```js
/* delivery.js: app.delivery, the rules the coach applies to the words of a stored take.
   classify(words) labels every word a hesitation sound, a verbal habit or neither; analyze(words,
   metrics) turns those labels plus the backend's pauses and repeats into the delivery report the
   Results cards, tips and Progress chart read. Pure: no DOM, no store, no I/O. Every saved session
   is re-scored with the same rules, so History and Progress never mix two definitions. */
(function () {
  "use strict";

  const HESITATION = "hesitation";
  const HABIT = "habit";

  // um, umm, uhm, uh, uhh, er, erm, ah, ahh, hm, hmm and longer stretches of the same letters.
  // Agreement sounds (mhm, uh-huh, mm-hmm) and "huh" never match: they are not hesitations.
  const HESITATION_PATTERN = /^(?:u+h*m+|u+h+|e+r+m*|a+h+|h+m+)$/;

  // The verbal habits the app counts, in the order a tie for "most used" is broken.
  const HABIT_WORDS = ["like", "so", "you know", "actually", "basically"];

  // Words that make the next "like" a verb or a comparison: "I like", "looks like", "just like".
  const LIKE_VERB_OR_COMPARISON_AFTER = [
    "i", "you", "we", "they", "people", "would", "i'd", "you'd", "we'd", "they'd", "to",
    "do", "does", "did", "don't", "doesn't", "didn't", "not", "really", "also", "just",
    "look", "looks", "looked", "sound", "sounds", "sounded", "feel", "feels", "felt",
    "seem", "seems", "seemed", "something", "nothing", "anything", "things", "stuff",
    "more", "much",
  ];

  // Habits that only count where a sentence or clause begins ("Basically, the plan fails").
  const CLAUSE_OPENERS = ["actually", "basically"];

  // Words that make the next "you know" a real question or verb: "do you know", "let you know".
  const YOU_KNOW_VERB_AFTER = [
    "do", "does", "did", "don't", "doesn't", "didn't", "if", "would", "let", "as",
  ];

  // A pause this long right before "like" marks a filler (Zufferey and Popescu-Belis, 2004).
  const SET_OFF_PAUSE_SECONDS = 0.25;
  // Debaters pause briefly after a connective "so"; only a longer hang counts as a stall.
  const SO_HANG_SECONDS = 0.5;

  const CLAUSE_END = /[,;:.?!]["')\]]*$/;
  const SENTENCE_END = /[.?!]["')\]]*$/;
  const EDGE_PUNCTUATION = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;
  const SECONDS_PER_MINUTE = 60;
  // Word ends and pause starts are millisecond values; allow for float error when comparing.
  const MILLISECOND = 0.001;

  function normalizeWord(text) {
    return String(text || "").toLowerCase().replace(EDGE_PUNCTUATION, "");
  }

  function isHesitation(text) {
    return HESITATION_PATTERN.test(normalizeWord(text));
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  // One label per word, left to right: "hesitation", "habit" or null.
  function classify(words) {
    const list = toWords(words);
    const tokens = list.map((word) => normalizeWord(word.text));
    const kinds = tokens.map((token) => (HESITATION_PATTERN.test(token) ? HESITATION : null));
    const context = {
      text: (i) => (list[i] ? list[i].text : ""),
      token: (i) => tokens[i] || "",
      hesitation: (i) => kinds[i] === HESITATION,
      gapBefore: (i) => (i > 0 ? list[i].start - list[i - 1].end : 0),
      gapAfter: (i) => (i < list.length - 1 ? list[i + 1].start - list[i].end : Infinity),
      // The nearest earlier word that is not a hesitation, or -1: an um never hides the word
      // that decides whether "like" is a verb ("I, um, like this plan").
      wordBefore: (i) => {
        let index = i - 1;
        while (index >= 0 && kinds[index] === HESITATION) {
          index -= 1;
        }
        return index;
      },
    };

    for (let i = 0; i < list.length; i += 1) {
      if (kinds[i] !== null) {
        continue;
      }
      const token = tokens[i];
      if (token === "you" && tokens[i + 1] === "know") {
        if (youKnowIsHabit(context, i)) {
          kinds[i] = HABIT;
          kinds[i + 1] = HABIT;
        }
        i += 1;
      } else if (token === "like" && likeIsHabit(context, i)) {
        kinds[i] = HABIT;
      } else if (token === "so" && soIsHabit(context, i)) {
        kinds[i] = HABIT;
      } else if (CLAUSE_OPENERS.includes(token) && startsClause(context, kinds, i)) {
        kinds[i] = HABIT;
      }
    }
    return kinds;
  }

  // True when the word that decides a phrase's meaning (the nearest non-hesitation word
  // before position i) is in `words` and sits in the same sentence.
  function followsWordIn(context, i, words) {
    const before = context.wordBefore(i);
    return (
      before !== -1 &&
      !SENTENCE_END.test(context.text(before)) &&
      words.includes(context.token(before))
    );
  }

  // True when position i opens the take or a sentence, looking past any hesitations.
  function opensSentence(context, i) {
    const before = context.wordBefore(i);
    return before === -1 || SENTENCE_END.test(context.text(before));
  }

  // "like" right after I, would, looks, just and the rest is a verb or a comparison and never
  // counts. Otherwise it counts when something sets it off: at the start of a sentence, a comma
  // or um right after it ("Like, the plan fails"); mid-sentence, a comma or um on either side
  // or a 0.25 s pause before it ("it was, like, a disaster").
  function likeIsHabit(context, i) {
    if (followsWordIn(context, i, LIKE_VERB_OR_COMPARISON_AFTER)) {
      return false;
    }
    const setOffAfter = CLAUSE_END.test(context.text(i)) || context.hesitation(i + 1);
    if (opensSentence(context, i)) {
      return setOffAfter;
    }
    return (
      setOffAfter ||
      CLAUSE_END.test(context.text(i - 1)) ||
      context.hesitation(i - 1) ||
      context.gapBefore(i) >= SET_OFF_PAUSE_SECONDS
    );
  }

  // "you know" right after do, if, let and the rest is a real verb and never counts. Otherwise
  // it counts when something sets it off after "know": a comma or stop, an um, or a 0.25 s
  // pause. "You know the drill" and "I'll let you know." never count.
  function youKnowIsHabit(context, i) {
    if (followsWordIn(context, i, YOU_KNOW_VERB_AFTER)) {
      return false;
    }
    const know = i + 1;
    return (
      CLAUSE_END.test(context.text(know)) ||
      context.hesitation(know + 1) ||
      context.gapAfter(know) >= SET_OFF_PAUSE_SECONDS
    );
  }

  // "so" counts only when the speaker hangs on it: an um right after it, or half a second of
  // silence mid-sentence. "So the impact is" and "so far" never count.
  function soIsHabit(context, i) {
    if (SENTENCE_END.test(context.text(i))) {
      return false;
    }
    return context.hesitation(i + 1) || context.gapAfter(i) >= SO_HANG_SECONDS;
  }

  // "actually" and "basically" count only where a sentence or clause begins: the first word,
  // after a comma or stop, or right after another filler.
  function startsClause(context, kinds, i) {
    return i === 0 || CLAUSE_END.test(context.text(i - 1)) || kinds[i - 1] !== null;
  }

  // Everything the Results cards, tips and Progress chart need from one take. Words come from
  // the stored transcript; pauses (transcript gaps merged with pauses.js silences) and repeats
  // come from the backend metrics. A take saved without words falls back to the backend's own
  // tallies, so old or hand-made sessions still render.
  function analyze(words, metrics) {
    const list = toWords(words);
    const given = metrics && typeof metrics === "object" ? metrics : {};
    const pauses = pausePairs(given.pauses);
    const repeats = validRepeats(given.repeats);
    if (list.length === 0) {
      return reportWithoutWords(given, pauses, repeats);
    }
    const kinds = classify(list);
    const fillers = fillerEvents(list, kinds);
    const hesitationCount = fillers.filter((event) => event.kind === HESITATION).length;
    const habitCounts = countHabits(fillers);
    const speakingSeconds = roundToMillisecond(list[list.length - 1].end - list[0].start);
    const classified = pauses.map(([at, length]) => ({
      at,
      length,
      midSentence: isMidSentence(list, at),
    }));
    const breaks = classified.filter((pause) => pause.midSentence);
    return {
      kinds,
      fillers,
      fillerCount: fillers.length,
      hesitationCount,
      habitCounts,
      topHabit: topHabit(habitCounts),
      speakingSeconds,
      wordsPerMinute: perMinute(list.length - hesitationCount, speakingSeconds),
      fillersPerMinute: perMinute(fillers.length, speakingSeconds),
      pauses: classified,
      midSentencePauseCount: breaks.length,
      longestMidSentencePause: longest(breaks.map((pause) => pause.length)),
      cleanStretch: longestCleanStretch(list, fillers, breaks, repeats),
      repeatCount: repeats.length,
    };
  }

  // The same report shape from the backend tallies alone, for a session saved without words.
  // Without words no pause can be placed in a sentence, so every pause counts as mid-sentence.
  function reportWithoutWords(metrics, pauses, repeats) {
    const tallies = metrics.fillers && typeof metrics.fillers === "object" ? metrics.fillers : {};
    const fillerCount = Object.values(tallies).reduce((sum, count) => sum + numberOr0(count), 0);
    const habitCounts = {};
    HABIT_WORDS.forEach((habit) => {
      habitCounts[habit] = numberOr0(tallies[habit]);
    });
    const speakingSeconds = numberOr0(metrics.duration);
    return {
      kinds: [],
      fillers: [],
      fillerCount,
      hesitationCount: ["um", "uh", "hmm"].reduce((sum, key) => sum + numberOr0(tallies[key]), 0),
      habitCounts,
      topHabit: topHabit(habitCounts),
      speakingSeconds,
      wordsPerMinute: numberOr0(metrics.words_per_minute),
      fillersPerMinute: perMinute(fillerCount, speakingSeconds),
      pauses: pauses.map(([at, length]) => ({ at, length, midSentence: true })),
      midSentencePauseCount: pauses.length,
      longestMidSentencePause: longest(pauses.map(([, length]) => length)),
      cleanStretch: null,
      repeatCount: repeats.length,
    };
  }

  // One event per filler in time order; "you know" is one event spanning both words.
  function fillerEvents(list, kinds) {
    const events = [];
    for (let i = 0; i < list.length; i += 1) {
      if (kinds[i] === null) {
        continue;
      }
      const pair =
        normalizeWord(list[i].text) === "you" &&
        kinds[i + 1] === HABIT &&
        normalizeWord(list[i + 1].text) === "know";
      const last = pair ? i + 1 : i;
      events.push({
        index: i,
        text: pair ? "you know" : normalizeWord(list[i].text),
        kind: kinds[i],
        start: list[i].start,
        end: list[last].end,
      });
      i = last;
    }
    return events;
  }

  function countHabits(fillers) {
    const counts = {};
    HABIT_WORDS.forEach((habit) => {
      counts[habit] = fillers.filter((event) => event.text === habit).length;
    });
    return counts;
  }

  // The most-used habit as {text, count}; a tie goes to the word listed first in HABIT_WORDS.
  function topHabit(habitCounts) {
    let best = null;
    HABIT_WORDS.forEach((habit) => {
      if (habitCounts[habit] > 0 && (best === null || habitCounts[habit] > best.count)) {
        best = { text: habit, count: habitCounts[habit] };
      }
    });
    return best;
  }

  // A pause is mid-sentence unless the word right before it ends a sentence. "Right before"
  // is the last word ending by `at`, the rule Results uses to place the pause marker.
  function isMidSentence(list, at) {
    let before = -1;
    list.forEach((word, index) => {
      if (word.end <= at + MILLISECOND) {
        before = index;
      }
    });
    if (before === -1 || before === list.length - 1) {
      return false;
    }
    return !SENTENCE_END.test(list[before].text);
  }

  // The longest stretch of speech with no filler, no mid-sentence pause and no restart, as
  // {start, end, seconds}. Every filler and break cuts the take; a restart cuts from the first
  // copy of the phrase to the moment the speaker starts it over.
  function longestCleanStretch(list, fillers, breaks, repeats) {
    const cuts = [
      ...fillers.map((event) => [event.start, event.end]),
      ...breaks.map((pause) => [pause.at, pause.at + pause.length]),
      ...repeatCuts(list, repeats),
    ].sort((a, b) => a[0] - b[0]);
    let best = { start: 0, end: 0, seconds: 0 };
    let from = list[0].start;
    const consider = (to) => {
      const seconds = roundToTenth(to - from);
      if (seconds > best.seconds) {
        best = { start: from, end: to, seconds };
      }
    };
    cuts.forEach(([cutStart, cutEnd]) => {
      consider(cutStart);
      from = Math.max(from, cutEnd);
    });
    consider(list[list.length - 1].end);
    return best;
  }

  // [first copy start, restart] for each backend repeat {text, at}: the restart is the first
  // word after as many words as the phrase has, skipping hesitations as the backend does.
  // When no word starts at `at`, the cut shrinks to that instant.
  function repeatCuts(list, repeats) {
    return repeats.map((repeat) => {
      const first = list.findIndex((word) => Math.abs(word.start - repeat.at) < MILLISECOND);
      if (first === -1) {
        return [repeat.at, repeat.at];
      }
      let index = first;
      let counted = 0;
      while (index < list.length && (counted < repeat.words || isHesitation(list[index].text))) {
        if (!isHesitation(list[index].text)) {
          counted += 1;
        }
        index += 1;
      }
      return [repeat.at, index < list.length ? list[index].start : repeat.at];
    });
  }

  // The backend's repeats as {at, words}, skipping any entry without a numeric `at`.
  function validRepeats(repeats) {
    if (!Array.isArray(repeats)) {
      return [];
    }
    return repeats
      .filter((repeat) => repeat && isFiniteNumber(repeat.at))
      .map((repeat) => ({
        at: repeat.at,
        words: Math.max(1, String(repeat.text || "").split(" ").filter(Boolean).length),
      }));
  }

  // A copy of the word list where every entry has a string text and numeric times, so one
  // malformed entry can never throw; indexes stay aligned with the stored transcript.
  function toWords(words) {
    return (Array.isArray(words) ? words : []).map((word) => ({
      text: String((word && word.text) || ""),
      start: numberOr0(word && word.start),
      end: numberOr0(word && word.end),
    }));
  }

  // Only [number, number] pairs are pauses; anything else in the list is skipped.
  function pausePairs(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(isPausePair).map((pause) => [pause[0], pause[1]]);
  }

  function isPausePair(pause) {
    return Array.isArray(pause) && isFiniteNumber(pause[0]) && isFiniteNumber(pause[1]);
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function perMinute(count, seconds) {
    return seconds > 0 ? roundToTenth(count / (seconds / SECONDS_PER_MINUTE)) : 0;
  }

  function longest(values) {
    return values.length > 0 ? roundToTenth(Math.max(...values)) : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  function roundToMillisecond(value) {
    return Math.round(value * 1000) / 1000;
  }

  app.delivery = { analyze, classify, isHesitation, HESITATION, HABIT, HABIT_WORDS };
})();
```

- [ ] **Step 4: Run it and watch it pass.**

Run: `node --test frontend/tests/delivery.test.js`
Expected: PASS, 16 tests.

- [ ] **Step 5: Load it in the page.** Use the diff below, or add the line by hand right after the `passages.js` script. If `frontend/sw.js` exists by now, also add `'delivery.js'` to its `SHELL` array and bump `CACHE_NAME`.

````diff
--- a/frontend/index.html
+++ b/frontend/index.html
@@ -73,6 +73,7 @@
   <script src="store.js"></script>
   <script src="api.js"></script>
   <script src="passages.js"></script>
+  <script src="delivery.js"></script>
   <script src="tips.js"></script>
   <script src="pauses.js"></script>
   <script src="screens/practice.js"></script>
````

- [ ] **Step 6: Run everything and commit.**

```bash
.venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
git add frontend/delivery.js frontend/tests/delivery.test.js frontend/index.html
git commit -m "Add app.delivery: context rules for fillers and the delivery report"
```

---

## Task 2 (T15): Results, tips and Progress read the delivery report

**Files:**
- Modify: `frontend/screens/results.js` (diff below)
- Modify: `frontend/screens/progress.js` (one line)
- Replace: `frontend/tips.js` (new version below)
- Modify: `frontend/styles.css` (two rules)
- Replace: `frontend/tests/tips.test.js` (approved supersession: the old file pins the six v1 rules, the 6-per-minute line and `select(metrics)`)
- Modify: `frontend/tests/results.test.js`, `frontend/tests/transcript.test.js`, `frontend/tests/progress.test.js` (approved hunks only)
- Create: `frontend/tests/results_delivery.test.js`

**Interfaces:**
- Consumes: `app.delivery.analyze` and `app.delivery.classify` from Task 1, plus `HABIT`.
- Produces:
  - `app.tips.select(report, options) -> [{id, text}]`, at most two. Ids in priority order: `pace-fast`, `pace-slow`, `fillers`, `habit`, `break-long`, `repeats`, then `clean`.
  - `app.screens.results.summarize(session) -> {wpm, fillersPerMinute, pauseCount, longestPause, cleanStretchSeconds, topHabit, target, paceHint, fillersHint, timeUsed, report}`. `pauseCount` and `longestPause` now mean mid-sentence pauses.
  - `buildTranscriptPlan(words, pauses)` word items gain `kind`.
  - `isFiller` is removed; `app.delivery` owns the rules.
  - `progress.js` gets a fourth series, `cleanStretchSeconds`.

Why the tips and the screen change in one task: if `results.js` passed the report to the old `tips.select(metrics)`, every pace would read as 0 and every take would get "under target pace". The reverse order breaks the transcript test that uses the real tips. Shipping them together keeps every commit green.

Approved supersessions of existing tests (each hunk is in the diffs below):

| Test file | What changes and why |
|---|---|
| `tips.test.js` | Replaced whole. It pins `select(metrics)`, the 6-per-minute line and the old copy; the new file pins the report-based rules. |
| `results.test.js` | The loader also runs `delivery.js`. Card labels 3 and 4 become "Mid-sentence pauses" and "Longest clean stretch", card 4 reads "0 s" for a session without words, and card 2 gains the "Aim for under 3" hint. |
| `transcript.test.js` | The loader also runs `delivery.js`. `isFiller` leaves the exports, and its test is deleted (its cases now live in `delivery.test.js`). Plan items gain `kind`. "so," and "basically," become `tok tok--habit` read as "verbal habit". The Transcript section gains `p.transcript__legend`. The tips receive the report. The fixture's tips become pace-slow and fillers with moments. |
| `progress.test.js` | The chip row has four chips, so four arrays gain a fourth entry. |

- [ ] **Step 1: Apply the test changes first.** Save each block to a file and `git apply` it. Then create the two new test files.

````diff
--- a/frontend/tests/results.test.js
+++ b/frontend/tests/results.test.js
@@ -16,6 +16,7 @@
   path.join(__dirname, "..", "screens", "results.js"),
   "utf8",
 );
+const DELIVERY_SOURCE = fs.readFileSync(path.join(__dirname, "..", "delivery.js"), "utf8");
 const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");
 
 // One known passage so the target range is read from app.passages, never hard-coded.
@@ -40,8 +41,8 @@
 const EXPECTED_LABELS = [
   "Words per minute",
   "Fillers per minute",
-  "Pauses over 1.5 s",
-  "Longest pause",
+  "Mid-sentence pauses",
+  "Longest clean stretch",
 ];
 
 function sessionWith(metricOverrides, sessionOverrides) {
@@ -70,6 +71,7 @@
 // Loads results.js with no document and a stub app.ui, exactly as the brief describes.
 function loadPure() {
   const context = { app: bareApp() };
+  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
   vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
   return { app: context.app, results: context.app.screens.results };
 }
@@ -88,6 +90,7 @@
     calls.routes.push({ name, params });
   };
   vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
+  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
   vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
 
   const root = new FakeElement("section");
@@ -228,7 +231,7 @@
   );
   const values = cards.map((card) => byClass(card, "metric-card__value"));
   values.forEach((value) => assert.ok(value.classList.contains("num")));
-  assert.deepEqual(values.map(fullText), ["162 wpm", "18 per min", "2", "2.2 s"]);
+  assert.deepEqual(values.map(fullText), ["162 wpm", "18 per min", "2", "0 s"]);
   assert.deepEqual(
     values.map((value) => {
       const unit = byClass(value, "metric-card__unit");
@@ -241,8 +244,11 @@
   assert.equal(hint.textContent, "Slow down");
   assert.ok(hint.classList.contains("metric-card__hint--warn"));
   assert.ok(!hint.classList.contains("metric-card__hint--ok"));
-  for (const card of cards.slice(1)) {
-    assert.equal(byClass(card, "metric-card__hint"), undefined, "only the wpm card has a hint");
+  const fillersHint = byClass(cards[1], "metric-card__hint");
+  assert.equal(fillersHint.textContent, "Aim for under 3");
+  assert.ok(fillersHint.classList.contains("metric-card__hint--warn"));
+  for (const card of cards.slice(2)) {
+    assert.equal(byClass(card, "metric-card__hint"), undefined, "the last two cards have no hint");
   }
 
   const actions = body.children[2];
````

````diff
--- a/frontend/tests/transcript.test.js
+++ b/frontend/tests/transcript.test.js
@@ -14,6 +14,7 @@
 
 const FRONTEND_DIR = path.join(__dirname, "..");
 const RESULTS_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "screens", "results.js"), "utf8");
+const DELIVERY_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "delivery.js"), "utf8");
 const UI_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "ui.js"), "utf8");
 const TIPS_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, "tips.js"), "utf8");
 
@@ -80,6 +81,7 @@
 
 function loadPure() {
   const context = { app: bareApp() };
+  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
   vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
   return context.app.screens.results;
 }
@@ -103,6 +105,7 @@
   } else if (tips === "real") {
     vm.runInNewContext(TIPS_SOURCE, context, { filename: "tips.js" });
   }
+  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
   vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
 
   const root = new FakeElement("section");
@@ -124,29 +127,13 @@
   );
 }
 
-test("results.js exposes isFiller and buildTranscriptPlan beside mount, show, hide, summarize", () => {
+test("results.js exposes buildTranscriptPlan beside mount, show, hide, summarize", () => {
   const results = loadPure();
-  for (const name of ["isFiller", "buildTranscriptPlan"]) {
+  for (const name of ["buildTranscriptPlan"]) {
     assert.equal(typeof results[name], "function", `results.${name} should be a function`);
   }
 });
 
-test("isFiller ignores case and edge punctuation: 'Um,' yes, 'umbrella' no", () => {
-  const { isFiller } = loadPure();
-  assert.equal(isFiller("Um,"), true);
-  assert.equal(isFiller("umbrella"), false);
-  for (const word of FILLER_WORDS) {
-    assert.equal(isFiller(word), true, word);
-    assert.equal(isFiller(word.toUpperCase() + "."), true, word.toUpperCase() + ".");
-    assert.equal(isFiller('"' + word + '?"'), true, '"' + word + '?"');
-  }
-  for (const word of ["you", "know", "", "so-called", "likely", "hmmm", "day's"]) {
-    assert.equal(isFiller(word), false, word);
-  }
-  assert.doesNotThrow(() => isFiller(undefined));
-  assert.equal(isFiller(undefined), false);
-});
-
 test("buildTranscriptPlan marks both halves of 'you know' and nothing around them", () => {
   const { buildTranscriptPlan } = loadPure();
   const plan = buildTranscriptPlan(words("You", "know,", "the", "drill"), []);
@@ -178,7 +165,10 @@
     ["m", false],
   ]);
   assert.deepEqual({ ...plan[4] }, { type: "pause", length: 1.308 });
-  assert.deepEqual({ ...plan[3] }, { type: "word", text: "basically,", filler: true });
+  assert.deepEqual(
+    { ...plan[3] },
+    { type: "word", text: "basically,", filler: true, kind: "habit" },
+  );
 });
 
 test("a pause before the first word goes first and one after the last word goes last", () => {
@@ -227,6 +217,7 @@
     "p.results__meta num",
     "div.metric-grid",
     "h2.results__heading",
+    "p.transcript__legend",
     "p.transcript",
     "h2.results__heading",
     "div.tip-card",
@@ -234,9 +225,9 @@
     "div.results__actions",
   ]);
   assert.equal(body.children[2].textContent, "Transcript");
-  assert.equal(body.children[4].textContent, "Tips");
+  assert.equal(body.children[5].textContent, "Tips");
   assert.deepEqual(
-    [body.children[5], body.children[6]].map((card) => card.textContent),
+    [body.children[6], body.children[7]].map((card) => card.textContent),
     ["First fake tip.", "Second fake tip."],
   );
   assert.equal(byClass(body, "metric-grid").children.length, 4, "the cards are untouched");
@@ -265,9 +256,9 @@
     items.map((item) => item.className),
     [
       "tok",
+      "tok tok--habit",
       "tok tok--filler",
-      "tok tok--filler",
-      "tok tok--filler",
+      "tok tok--habit",
       "tok--pause num",
       "tok tok--filler",
       "tok",
@@ -277,9 +268,9 @@
     items.map((item) => item.getAttribute("aria-label")),
     [
       null,
-      "so, filler word",
+      "so, verbal habit",
       "um, filler word",
-      "basically, filler word",
+      "basically, verbal habit",
       "pause, 1.3 seconds",
       "um, filler word",
       null,
@@ -303,26 +294,29 @@
   );
 });
 
-test("tips come from app.tips.select with the session metrics and the passage target", async () => {
+test("tips come from app.tips.select with the delivery report and the passage target", async () => {
   const known = sessionWith();
   const unknown = sessionWith({}, { id: "s2", passageId: "not-a-passage" });
   const { results, calls } = mountResults({ s1: known, s2: unknown }, "fake");
   await results.show({ id: "s1" });
   await results.show({ id: "s2" });
   assert.equal(calls.tips.length, 2);
-  assert.equal(calls.tips[0].metrics, known.metrics);
+  assert.equal(calls.tips[0].metrics.fillerCount, 4, "so, um, basically, um");
   assert.deepEqual(Array.from(calls.tips[0].options.targetWpm), [130, 150]);
-  assert.equal(calls.tips[1].metrics, unknown.metrics);
+  assert.equal(calls.tips[1].metrics.fillerCount, 4);
   assert.deepEqual(Array.from(calls.tips[1].options.targetWpm), FALLBACK_TARGET);
 });
 
-test("with the real tips.js, nine fillers in 30 seconds show exactly the filler tip", async () => {
+test("with the real tips.js, the six-word fixture gets the pace and fillers tips", async () => {
   const { results, body } = mountResults({ s1: sessionWith() }, "real");
   await results.show({ id: "s1" });
   const cards = body.children.filter((node) => node.className === "tip-card");
   assert.deepEqual(
     cards.map((card) => card.textContent),
-    ["Replace um with a silent beat. Judges hear silence as confidence."],
+    [
+      "You are under target pace. Shorten the pauses between ideas.",
+      "Fillers at 0:01, 0:02, 0:03 and 1 more. Next take, close your mouth and pause instead.",
+    ],
   );
 });
 
@@ -348,6 +342,7 @@
     "p.results__meta num",
     "div.metric-grid",
     "h2.results__heading",
+    "p.transcript__legend",
     "p.transcript",
     "div.results__actions",
   ]);
````

````diff
--- a/frontend/tests/progress.test.js
+++ b/frontend/tests/progress.test.js
@@ -28,7 +28,7 @@
 const TOLERANCE = 1e-6;
 
 const EMPTY_STATE_CLASS = "state state--empty";
-const CHIP_LABELS = ["Words per minute", "Fillers per minute", "Pauses"];
+const CHIP_LABELS = ["Words per minute", "Fillers per minute", "Pauses", "Clean stretch"];
 const WPM_COLOR = "var(--accent)";
 const FILLERS_COLOR = "var(--filler)";
 const PAUSES_COLOR = "var(--pause)";
@@ -312,6 +312,7 @@
       ["chip chip--selected", "true"],
       ["chip", "false"],
       ["chip", "false"],
+      ["chip", "false"],
     ],
   );
 
@@ -458,6 +459,7 @@
     [
       ["chip", "false"],
       ["chip chip--selected", "true"],
+      ["chip", "false"],
       ["chip", "false"],
     ],
   );
@@ -497,7 +499,7 @@
   childrenByTag(svg, "circle").forEach((dot) => assert.equal(dot.getAttribute("fill"), PAUSES_COLOR));
   assert.deepEqual(
     chipsOf(body).map((chip) => chip.getAttribute("aria-pressed")),
-    ["false", "false", "true"],
+    ["false", "false", "true", "false"],
   );
   assert.deepEqual(
     tableRows(tableOf(body)).map((cells) => cells[2]),
@@ -516,7 +518,7 @@
   assert.equal(body.children.length, 3, "a second show replaces the chart, never stacks");
   assert.deepEqual(
     chipsOf(body).map((chip) => chip.getAttribute("aria-pressed")),
-    ["false", "true", "false"],
+    ["false", "true", "false", "false"],
   );
   assert.equal(polylineOf(chartOf(body)).getAttribute("stroke"), FILLERS_COLOR);
 });
````

`frontend/tests/tips.test.js` (replaces the old file):

```js
// Tests for frontend/tips.js: which coaching tips a take gets and what they say. select()
// reads an app.delivery report, so every case starts from a neutral report that fires no rule
// and changes one field. The module is pure and loads into a bare vm context.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TIPS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "tips.js"), "utf8");

// In-target pace, no fillers, no habit, no long break, no restarts.
const NEUTRAL = {
  wordsPerMinute: 150,
  fillersPerMinute: 0,
  fillers: [],
  topHabit: null,
  longestMidSentencePause: 0,
  repeatCount: 0,
};
const CLEAN_TIP = { id: "clean", text: "Clean run. Push the pace a little next time." };
const MAX_SENTENCE_WORDS = 15;

function load() {
  const app = {};
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  return app.tips;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function reportWith(overrides) {
  return { ...NEUTRAL, ...overrides };
}

function fillerAt(start) {
  return { index: 0, text: "um", kind: "hesitation", start, end: start + 0.2 };
}

function ids(tips) {
  return plain(tips).map((tip) => tip.id);
}

test("tips.js assigns exactly app.tips with a select function", () => {
  const app = {};
  vm.runInNewContext(TIPS_SOURCE, { app }, { filename: "tips.js" });
  assert.deepEqual(Object.keys(app), ["tips"]);
  assert.equal(typeof app.tips.select, "function");
});

test("a neutral report gets exactly the clean tip, with or without options", () => {
  const tips = load();
  assert.deepEqual(plain(tips.select(NEUTRAL, { targetWpm: [140, 160] })), [CLEAN_TIP]);
  assert.deepEqual(plain(tips.select(NEUTRAL)), [CLEAN_TIP]);
});

test("pace-fast needs more than hi + 15 and pace-slow less than lo - 15", () => {
  const tips = load();
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 175 }))), ["clean"]);
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 175.6 }))), ["pace-fast"]);
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 125 }))), ["clean"]);
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 124 }))), ["pace-slow"]);
  const congress = { targetWpm: [130, 160] };
  assert.deepEqual(ids(tips.select(reportWith({ wordsPerMinute: 114 }), congress)), [
    "pace-slow",
  ]);
});

test("fillers fires above 3 a minute and names the first three moments", () => {
  const tips = load();
  assert.deepEqual(ids(tips.select(reportWith({ fillersPerMinute: 3 }))), ["clean"]);
  const report = reportWith({
    fillersPerMinute: 3.1,
    fillers: [2.4, 5, 10.35, 16.1, 19.8].map(fillerAt),
  });
  assert.deepEqual(plain(tips.select(report)), [
    {
      id: "fillers",
      text:
        "Fillers at 0:02, 0:05, 0:10 and 2 more. " +
        "Next take, close your mouth and pause instead.",
    },
  ]);
  const two = reportWith({ fillersPerMinute: 4, fillers: [62, 75].map(fillerAt) });
  assert.equal(tips.select(two)[0].text.split(". ")[0], "Fillers at 1:02 and 1:15");
});

test("a take saved without words still gets the fillers advice, without moments", () => {
  const tips = load();
  assert.deepEqual(plain(tips.select(reportWith({ fillersPerMinute: 25.2, fillers: [] }))), [
    {
      id: "fillers",
      text: "Replace um with a silent beat. Next take, close your mouth and pause instead.",
    },
  ]);
});

test("habit fires at three of the top habit and names it", () => {
  const tips = load();
  const twice = reportWith({ topHabit: { text: "like", count: 2 } });
  assert.deepEqual(ids(tips.select(twice)), ["clean"]);
  const report = reportWith({ topHabit: { text: "you know", count: 3 } });
  assert.deepEqual(plain(tips.select(report)), [
    { id: "habit", text: "You said “you know” 3 times. Drop it and let the sentence land." },
  ]);
});

test("break-long reads the longest mid-sentence pause; repeats needs three", () => {
  const tips = load();
  assert.deepEqual(ids(tips.select(reportWith({ longestMidSentencePause: 3 }))), ["clean"]);
  assert.deepEqual(ids(tips.select(reportWith({ longestMidSentencePause: 3.2 }))), [
    "break-long",
  ]);
  assert.deepEqual(ids(tips.select(reportWith({ repeatCount: 2 }))), ["clean"]);
  assert.deepEqual(ids(tips.select(reportWith({ repeatCount: 3 }))), ["repeats"]);
});

test("at most two tips, in priority order", () => {
  const tips = load();
  const everything = reportWith({
    wordsPerMinute: 190,
    fillersPerMinute: 9,
    fillers: [fillerAt(1)],
    topHabit: { text: "like", count: 5 },
    longestMidSentencePause: 4,
    repeatCount: 4,
  });
  assert.deepEqual(ids(tips.select(everything)), ["pace-fast", "fillers"]);
  const lower = reportWith({ longestMidSentencePause: 4, repeatCount: 4 });
  assert.deepEqual(ids(tips.select(lower)), ["break-long", "repeats"]);
});

test("every tip is short second-person copy: under 15 words a sentence, no exclamation", () => {
  const tips = load();
  const reports = [
    reportWith({ wordsPerMinute: 190 }),
    reportWith({ wordsPerMinute: 100 }),
    reportWith({ fillersPerMinute: 9, fillers: [1, 2, 3, 4].map(fillerAt) }),
    reportWith({ fillersPerMinute: 9 }),
    reportWith({ topHabit: { text: "basically", count: 7 } }),
    reportWith({ longestMidSentencePause: 5 }),
    reportWith({ repeatCount: 5 }),
    NEUTRAL,
  ];
  for (const report of reports) {
    for (const tip of tips.select(report)) {
      assert.ok(!tip.text.includes("!"), tip.text);
      for (const sentence of tip.text.split(/(?<=\.)\s+/)) {
        const words = sentence.split(/\s+/).filter(Boolean).length;
        assert.ok(words < MAX_SENTENCE_WORDS, sentence + " has " + words + " words");
      }
    }
  }
});

test("select never changes the report and survives junk", () => {
  const tips = load();
  const report = reportWith({ fillersPerMinute: 9, fillers: [fillerAt(3)] });
  const before = JSON.stringify(report);
  tips.select(report, { targetWpm: [130, 150] });
  assert.equal(JSON.stringify(report), before);
  for (const junk of [undefined, null, {}, { wordsPerMinute: "fast", fillers: "many" }]) {
    const result = tips.select(junk, { targetWpm: ["x", 3] });
    assert.ok(result.length >= 1 && result.length <= 2);
  }
  const badHabit = reportWith({ topHabit: { text: 5, count: "lots" } });
  assert.deepEqual(ids(tips.select(badHabit)), ["clean"]);
});
```

`frontend/tests/results_delivery.test.js`:

```js
// Tests for what the Results screen draws from the app.delivery report: the four cards and
// their hints on the real clip, the transcript legend, the two highlight styles and the time
// line for a timed preset. ui.js, delivery.js, tips.js and results.js all run for real against
// the fake DOM; only app.store and app.router are stubs.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8")],
);

const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};
const CREATED_AT = "2026-10-10T19:21:00.000Z";
const PASSAGES = [
  { id: "gettysburg", targetWpm: [130, 150] },
  { id: "congress-speech", targetWpm: [130, 160], timeLimitSeconds: 180 },
];

function clipSession(overrides) {
  return {
    id: "s1",
    createdAt: CREATED_AT,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 33.1,
    metrics: JSON.parse(JSON.stringify(CLIP_METRICS)),
    transcript: CLIP_WORDS.map((word) => ({ ...word })),
    ...(overrides || {}),
  };
}

async function showSession(session) {
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry })),
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: session.id });
  return { app: context.app, body };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function cardsOf(body) {
  return byClass(body, "metric-grid").children;
}

function hintOf(card) {
  const hint = byClass(card, "metric-card__hint");
  return hint ? [hint.textContent, hint.className] : null;
}

test("on the real clip the cards show pace without ums, breaks and the clean stretch", async () => {
  const { body } = await showSession(clipSession());
  const cards = cardsOf(body);
  assert.deepEqual(
    cards.map((card) => fullText(byClass(card, "metric-card__value"))),
    ["76 wpm", "21.4 per min", "3", "4.9 s"],
  );
  assert.deepEqual(cards.map(hintOf), [
    ["Speed up", "metric-card__hint metric-card__hint--warn"],
    ["Aim for under 3", "metric-card__hint metric-card__hint--warn"],
    null,
    null,
  ]);
});

test("the legend explains both styles and names the most-used habit", async () => {
  const { body } = await showSession(clipSession());
  assert.equal(
    byClass(body, "transcript__legend").textContent,
    "Highlighted words are ums and uhs. Underlined words are verbal habits. " +
      "Most used: “so”, 1 time.",
  );
});

test("habits are underlined tokens read as verbal habits; ums keep the filler style", async () => {
  const { body } = await showSession(clipSession());
  const tokens = byClass(body, "transcript").children.filter((node) => node.tagName === "span");
  const byText = (text) => tokens.find((token) => token.textContent === text);
  assert.equal(byText("so,").className, "tok tok--habit");
  assert.equal(byText("so,").getAttribute("aria-label"), "so, verbal habit");
  assert.equal(byText("um,").className, "tok tok--filler");
  assert.equal(byText("um,").getAttribute("aria-label"), "um, filler word");
  assert.equal(byText("like").className, "tok", "'I like to play tennis' is not flagged");
});

test("the tips on the real clip name the moments", async () => {
  const { body } = await showSession(clipSession());
  const tips = body.children.filter((node) => node.className === "tip-card");
  assert.deepEqual(
    tips.map((card) => card.textContent),
    [
      "You are under target pace. Shorten the pauses between ideas.",
      "Fillers at 0:01, 0:02, 0:03 and 8 more. Next take, close your mouth and pause instead.",
    ],
  );
});

test("a preset with a time limit adds the time used to the meta line", async () => {
  const session = clipSession({ passageId: "congress-speech", passageTitle: "Congress speech" });
  const { app, body } = await showSession(session);
  assert.equal(
    byClass(body, "results__meta").textContent,
    "Congress speech · " + app.ui.formatDate(CREATED_AT) + " · 0:30 of 3:00",
  );
});

test("a fluent take gets the ok fillers hint and no habit in the legend", async () => {
  const words = "We win because the plan solves the harm.".split(" ").map((text, index) => ({
    text,
    start: index * 0.4,
    end: index * 0.4 + 0.3,
  }));
  const session = clipSession({
    transcript: words,
    metrics: { ...CLIP_METRICS, pauses: [], repeats: [], fillers: {} },
  });
  const { body } = await showSession(session);
  assert.deepEqual(hintOf(cardsOf(body)[1]), [
    "Target under 3",
    "metric-card__hint metric-card__hint--ok",
  ]);
  assert.equal(
    byClass(body, "transcript__legend").textContent,
    "Highlighted words are ums and uhs. Underlined words are verbal habits.",
  );
});
```

- [ ] **Step 2: Run the suite and watch the new expectations fail.**

Run: `node --test frontend/tests`
Expected: FAIL in `tips.test.js`, `results.test.js`, `transcript.test.js`, `progress.test.js` and `results_delivery.test.js`, with old labels, `isFiller` still exported, three chips instead of four, and `select` still reading metrics.

- [ ] **Step 3: Replace `frontend/tips.js`.**

```js
/* tips.js: app.tips, the coaching tips shown under the Results transcript. select(report,
   options) reads one take's app.delivery report and the passage's target range and returns at
   most two {id, text} tips in priority order. A tip names the moments it is about and one thing
   to try on the next take. Pure: no DOM, no store, no I/O. */
(function () {
  "use strict";

  /* Rules, top to bottom; the first two that fire are shown, and "clean" shows only when none
     fire. [lo, hi] is options.targetWpm, default [140, 160]. Every number is rounded as the
     Results cards show it, so a tip never disagrees with the card above it.

       id          fires when                  why it matters for a debater
       pace-fast   wpm > hi + 15               a judge who cannot keep up stops flowing
       pace-slow   wpm < lo - 15               a slow speech runs out of time for its last point
       fillers     fillers per minute > 3      Zoom and tl;dv put 0.6 to 3 a minute in range
       habit       top habit 3 times or more   the Ah-Counter names each speaker's crutch word
       break-long  mid-sentence pause > 3 s    a pause at a period lands; mid-sentence it stalls
       repeats     3 restarts or more          each restart costs the judge's trust in the line
       clean       nothing above fired */

  const DEFAULT_TARGET_WPM = [140, 160];
  const MAX_TIPS = 2;
  const PACE_MARGIN_WPM = 15;
  const MAX_FILLERS_PER_MINUTE = 3;
  const MIN_HABIT_COUNT = 3;
  const MAX_BREAK_SECONDS = 3;
  const MIN_REPEATS = 3;
  // The fillers tip lists this many moments, then "and N more".
  const MAX_TIMES_LISTED = 3;
  const SECONDS_PER_MINUTE = 60;

  const RULES = [
    {
      id: "pace-fast",
      fires: (facts) => facts.wpm > facts.hi + PACE_MARGIN_WPM,
      text: () => "You are above target pace. Breathe at each period.",
    },
    {
      id: "pace-slow",
      fires: (facts) => facts.wpm < facts.lo - PACE_MARGIN_WPM,
      text: () => "You are under target pace. Shorten the pauses between ideas.",
    },
    {
      id: "fillers",
      fires: (facts) => facts.fillersPerMinute > MAX_FILLERS_PER_MINUTE,
      text: fillersText,
    },
    {
      id: "habit",
      fires: (facts) => facts.topHabit !== null && facts.topHabit.count >= MIN_HABIT_COUNT,
      text: (facts) =>
        "You said “" + facts.topHabit.text + "” " + facts.topHabit.count + " times. " +
        "Drop it and let the sentence land.",
    },
    {
      id: "break-long",
      fires: (facts) => facts.longestBreak > MAX_BREAK_SECONDS,
      text: () =>
        "A pause in the middle of a sentence ran past 3 seconds. " +
        "Glance at your next point first.",
    },
    {
      id: "repeats",
      fires: (facts) => facts.repeatCount >= MIN_REPEATS,
      text: () => "You restarted phrases three times. Finish the sentence, then fix it.",
    },
  ];

  const CLEAN_TIP = { id: "clean", text: "Clean run. Push the pace a little next time." };

  function select(report, options) {
    const facts = readFacts(report || {}, options || {});
    const fired = RULES.filter((rule) => rule.fires(facts)).slice(0, MAX_TIPS);
    if (fired.length === 0) {
      return [{ id: CLEAN_TIP.id, text: CLEAN_TIP.text }];
    }
    return fired.map((rule) => ({ id: rule.id, text: rule.text(facts) }));
  }

  // "Fillers at 0:02, 0:05 and 0:10." or "... 0:10 and 8 more.", then the technique. A take
  // saved without words has no moments to name, so it gets the advice alone.
  function fillersText(facts) {
    const technique = "Next take, close your mouth and pause instead.";
    if (facts.fillerTimes.length === 0) {
      return "Replace um with a silent beat. " + technique;
    }
    const listed = facts.fillerTimes.slice(0, MAX_TIMES_LISTED).map(clockText);
    const more = facts.fillerTimes.length - listed.length;
    return "Fillers at " + joinMoments(listed, more) + ". " + technique;
  }

  // "0:02", "0:02 and 0:05", "0:02, 0:05 and 0:10", or "0:02, 0:05, 0:10 and 8 more".
  function joinMoments(listed, more) {
    if (more > 0) {
      return listed.join(", ") + " and " + more + " more";
    }
    if (listed.length === 1) {
      return listed[0];
    }
    return listed.slice(0, -1).join(", ") + " and " + listed[listed.length - 1];
  }

  // The numbers the rules compare, read once. Missing or malformed values read as 0 (or no
  // habit) so a bad record still yields a tip instead of an exception.
  function readFacts(report, options) {
    const [lo, hi] = targetRange(options.targetWpm);
    const fillers = Array.isArray(report.fillers) ? report.fillers : [];
    const habit = report.topHabit;
    const validHabit =
      habit && typeof habit.text === "string" && Number.isFinite(Number(habit.count));
    return {
      lo,
      hi,
      wpm: Math.round(numberOr0(report.wordsPerMinute)),
      fillersPerMinute: roundToTenth(numberOr0(report.fillersPerMinute)),
      fillerTimes: fillers.map((event) => numberOr0(event && event.start)),
      topHabit: validHabit ? { text: habit.text, count: Number(habit.count) } : null,
      longestBreak: roundToTenth(numberOr0(report.longestMidSentencePause)),
      repeatCount: numberOr0(report.repeatCount),
    };
  }

  // The same m:ss text as app.ui.formatClock, kept here so tips.js loads on its own.
  function clockText(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
    const rest = whole % SECONDS_PER_MINUTE;
    return minutes + ":" + String(rest).padStart(2, "0");
  }

  // A copy of [lo, hi] when the option is a pair of finite numbers, else the default range.
  function targetRange(targetWpm) {
    const valid =
      Array.isArray(targetWpm) &&
      targetWpm.length === 2 &&
      targetWpm.every((bound) => Number.isFinite(Number(bound)));
    const range = valid ? targetWpm : DEFAULT_TARGET_WPM;
    return [Number(range[0]), Number(range[1])];
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  app.tips = { select };
})();
```

- [ ] **Step 4: Apply the screen, chart and style diffs.**

````diff
--- a/frontend/screens/results.js
+++ b/frontend/screens/results.js
@@ -1,24 +1,23 @@
 /* screens/results.js: app.screens.results, the Results screen after a take (DESIGN.md sections
-   1 and 6). Three pure helpers do the thinking without the DOM: summarize(session) turns the
-   backend metrics into the card numbers and the pace hint, isFiller(text) names the filler
-   words, buildTranscriptPlan(words, pauses) lays the transcript out with its pause markers.
-   show({id}) loads the session from app.store and builds the meta line, the metric grid, the
-   highlighted transcript, the tips from app.tips and the Record again / History actions. */
+   1 and 6). Two pure helpers do the thinking without the DOM: summarize(session) turns the
+   app.delivery report into the card numbers, hints and time line, and buildTranscriptPlan(words,
+   pauses) lays the transcript out with each filler's kind and the pause markers. show({id})
+   loads the session from app.store and builds the meta line, the metric grid, the highlighted
+   transcript with its legend, the tips from app.tips and the Record again / History actions. */
 (function () {
   "use strict";
 
   // Used when the session's passage is no longer in app.passages.
   const DEFAULT_TARGET_WPM = [140, 160];
-  const SECONDS_PER_MINUTE = 60;
 
   // Card labels and units (DESIGN.md sections 5 and 6), in display order.
   const WPM_LABEL = "Words per minute";
   const WPM_UNIT = "wpm";
   const FILLERS_LABEL = "Fillers per minute";
   const FILLERS_UNIT = "per min";
-  const PAUSES_LABEL = "Pauses over 1.5 s";
-  const LONGEST_PAUSE_LABEL = "Longest pause";
-  const LONGEST_PAUSE_UNIT = "s";
+  const PAUSES_LABEL = "Mid-sentence pauses";
+  const CLEAN_STRETCH_LABEL = "Longest clean stretch";
+  const CLEAN_STRETCH_UNIT = "s";
 
   // Pace hint copy: always words, never a bare number (DESIGN.md section 9).
   const TARGET_PREFIX = "Target ";
@@ -28,6 +27,12 @@
   const TONE_OK = "ok";
   const TONE_WARN = "warn";
 
+  // Filler hint (Zoom and tl;dv put 0.6 to 3 fillers a minute in range) and the time line.
+  const MAX_FILLERS_PER_MINUTE = 3;
+  const FILLERS_OK = "Target under 3";
+  const FILLERS_HIGH = "Aim for under 3";
+  const TIME_USED_JOINER = " of ";
+
   // Fixed copy for the bad-id state and the two actions (DESIGN.md sections 1 and 8).
   const NOT_FOUND_TITLE = "Session not found";
   const NOT_FOUND_BODY = "It may have been deleted.";
@@ -39,12 +44,6 @@
   const TRANSCRIPT_TITLE = "Transcript";
   const TIPS_TITLE = "Tips";
 
-  // Fillers (DESIGN.md section 6, "Transcript"): single words matched one at a time, plus the
-  // two-word phrase "you know". The lists mirror backend/metrics.py so the highlighted tokens
-  // are exactly the ones the fillers card counted.
-  const FILLER_WORDS = ["um", "uh", "hmm", "like", "so", "basically", "actually"];
-  const FILLER_PHRASE = ["you", "know"];
-
   // Punctuation at either end of a token, the same rule as backend.metrics.clean: "Um," and
   // "um" compare equal while "so-called" and "day's" stay whole words.
   const EDGE_PUNCTUATION = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;
@@ -54,6 +53,8 @@
   const PAUSE_ITEM = "pause";
   const TOKEN_SEPARATOR = " ";
   const FILLER_LABEL_SUFFIX = ", filler word";
+  const HABIT_LABEL_SUFFIX = ", verbal habit";
+  const LEGEND_TEXT = "Highlighted words are ums and uhs. Underlined words are verbal habits.";
   const PAUSE_TEXT_SUFFIX = " s pause";
   const PAUSE_LABEL_PREFIX = "pause, ";
   const PAUSE_LABEL_SUFFIX = " seconds";
@@ -68,29 +69,26 @@
     body = root.querySelector(".screen__body");
   }
 
-  // The numbers on the four cards plus the pace hint, from one stored session. Pure: reads the
-  // session and app.passages, returns a fresh object. Missing or malformed numbers read as 0 so
-  // a bad record never breaks the screen.
+  // The numbers on the four cards, their hints and the time line, from one stored session,
+  // plus the app.delivery report the transcript and tips are drawn from. Pure: reads the session
+  // and app.passages, returns a fresh object. A take saved without words falls back to the
+  // backend tallies inside app.delivery, so a bad or old record never breaks the screen.
   function summarize(session) {
-    const metrics = session.metrics || {};
-    const fillers = metrics.fillers || {};
-    const pauses = Array.isArray(metrics.pauses) ? metrics.pauses : [];
-
-    const wpm = Math.round(numberOr0(metrics.words_per_minute));
-    const minutes = numberOr0(metrics.duration) / SECONDS_PER_MINUTE;
-    const fillerCount = Object.values(fillers).reduce((sum, count) => sum + numberOr0(count), 0);
-    const fillersPerMinute = minutes > 0 ? roundToTenth(fillerCount / minutes) : 0;
-    const pauseLengths = pauses.map((pause) => numberOr0(pause[1]));
-    const longestPause = pauseLengths.length > 0 ? roundToTenth(Math.max(...pauseLengths)) : 0;
+    const report = app.delivery.analyze(session.transcript, session.metrics);
+    const wpm = Math.round(report.wordsPerMinute);
     const target = targetFor(session.passageId);
-
     return {
       wpm,
-      fillersPerMinute,
-      pauseCount: pauses.length,
-      longestPause,
+      fillersPerMinute: report.fillersPerMinute,
+      pauseCount: report.midSentencePauseCount,
+      longestPause: report.longestMidSentencePause,
+      cleanStretchSeconds: report.cleanStretch ? report.cleanStretch.seconds : 0,
+      topHabit: report.topHabit,
       target,
       paceHint: paceHintFor(wpm, target),
+      fillersHint: fillersHintFor(report.fillersPerMinute),
+      timeUsed: timeUsedFor(session.passageId, report.speakingSeconds),
+      report,
     };
   }
 
@@ -99,10 +97,6 @@
     return Number.isFinite(number) ? number : 0;
   }
 
-  function roundToTenth(value) {
-    return Math.round(value * 10) / 10;
-  }
-
   // A copy of the passage's [lo, hi] target, or the default when the passage is unknown.
   function targetFor(passageId) {
     const passages = app.passages || [];
@@ -112,6 +106,23 @@
     return [range[0], range[1]];
   }
 
+  function fillersHintFor(fillersPerMinute) {
+    return fillersPerMinute > MAX_FILLERS_PER_MINUTE
+      ? { text: FILLERS_HIGH, tone: TONE_WARN }
+      : { text: FILLERS_OK, tone: TONE_OK };
+  }
+
+  // "2:41 of 3:00" for a preset with a time limit, else null.
+  function timeUsedFor(passageId, speakingSeconds) {
+    const passages = app.passages || [];
+    const passage = passages.find((entry) => entry.id === passageId);
+    if (!passage || !Number.isFinite(passage.timeLimitSeconds)) {
+      return null;
+    }
+    const used = app.ui.formatClock(speakingSeconds);
+    return used + TIME_USED_JOINER + app.ui.formatClock(passage.timeLimitSeconds);
+  }
+
   function paceHintFor(wpm, target) {
     const [lo, hi] = target;
     if (wpm > hi) {
@@ -123,12 +134,6 @@
     return { text: TARGET_PREFIX + lo + TARGET_JOINER + hi, tone: TONE_OK };
   }
 
-  // True for a filler said on its own: "Um," and "so" yes, "umbrella" no. The phrase "you
-  // know" is a pair of tokens, so buildTranscriptPlan handles it instead.
-  function isFiller(text) {
-    return FILLER_WORDS.includes(normalizeWord(text));
-  }
-
   function normalizeWord(text) {
     return String(text || "").toLowerCase().replace(EDGE_PUNCTUATION, "");
   }
@@ -141,7 +146,7 @@
   function buildTranscriptPlan(words, pauses) {
     const wordList = Array.isArray(words) ? words : [];
     const pauseList = Array.isArray(pauses) ? pauses : [];
-    const fillers = fillerFlags(wordList);
+    const kinds = app.delivery.classify(wordList);
 
     // Slot 0 holds the pauses that go before the first word; slot i + 1 those after word i.
     const slots = Array.from({ length: wordList.length + 1 }, () => []);
@@ -153,7 +158,12 @@
 
     const plan = [...slots[0]];
     wordList.forEach((word, index) => {
-      plan.push({ type: WORD_ITEM, text: textOf(word), filler: fillers[index] });
+      plan.push({
+        type: WORD_ITEM,
+        text: textOf(word),
+        filler: kinds[index] !== null,
+        kind: kinds[index],
+      });
       plan.push(...slots[index + 1]);
     });
     return plan;
@@ -169,19 +179,6 @@
     return -1;
   }
 
-  // One flag per word: the single fillers by isFiller, then both halves of every "you know".
-  function fillerFlags(wordList) {
-    const tokens = wordList.map((word) => normalizeWord(textOf(word)));
-    const flags = tokens.map((token) => FILLER_WORDS.includes(token));
-    tokens.forEach((token, index) => {
-      if (token === FILLER_PHRASE[0] && tokens[index + 1] === FILLER_PHRASE[1]) {
-        flags[index] = true;
-        flags[index + 1] = true;
-      }
-    });
-    return flags;
-  }
-
   function textOf(word) {
     return String((word && word.text) || "");
   }
@@ -233,13 +230,14 @@
     const metrics = session.metrics || {};
     const plan = buildTranscriptPlan(session.transcript, metrics.pauses);
     const hasWords = plan.some((item) => item.type === WORD_ITEM);
-    const tips = selectTips(metrics, summary.target);
+    const tips = selectTips(summary.report, summary.target);
 
     app.ui.clear(body);
-    body.appendChild(buildMeta(session));
+    body.appendChild(buildMeta(session, summary.timeUsed));
     body.appendChild(buildMetricGrid(summary));
     if (hasWords) {
       body.appendChild(sectionTitle(TRANSCRIPT_TITLE));
+      body.appendChild(buildLegend(summary.topHabit));
       body.appendChild(buildTranscript(plan));
     }
     if (tips.length > 0) {
@@ -251,13 +249,23 @@
 
   // tips.js loads before this file in index.html. Without it (a failed load, or a context that
   // stubs app without tips) the screen simply has no Tips section instead of an error.
-  function selectTips(metrics, target) {
+  function selectTips(report, target) {
     if (!app.tips || typeof app.tips.select !== "function") {
       return [];
     }
-    return app.tips.select(metrics, { targetWpm: target });
+    return app.tips.select(report, { targetWpm: target });
   }
 
+  // What the two highlight styles mean, plus the most-used habit when there is one.
+  function buildLegend(topHabit) {
+    if (!topHabit) {
+      return app.ui.el("p", { class: "transcript__legend", text: LEGEND_TEXT });
+    }
+    const times = topHabit.count === 1 ? " time." : " times.";
+    const habitLine = " Most used: “" + topHabit.text + "”, " + topHabit.count + times;
+    return app.ui.el("p", { class: "transcript__legend", text: LEGEND_TEXT + habitLine });
+  }
+
   function sectionTitle(text) {
     return app.ui.el("h2", { class: "results__heading", text });
   }
@@ -278,9 +286,10 @@
     if (!item.filler) {
       return app.ui.el("span", { class: "tok", text: item.text });
     }
+    const habit = item.kind === app.delivery.HABIT;
     return app.ui.el("span", {
-      class: "tok tok--filler",
-      "aria-label": normalizeWord(item.text) + FILLER_LABEL_SUFFIX,
+      class: habit ? "tok tok--habit" : "tok tok--filler",
+      "aria-label": normalizeWord(item.text) + (habit ? HABIT_LABEL_SUFFIX : FILLER_LABEL_SUFFIX),
       text: item.text,
     });
   }
@@ -299,18 +308,22 @@
     return app.ui.el("div", { class: "tip-card", text: tip.text });
   }
 
-  function buildMeta(session) {
-    const text = session.passageTitle + META_SEPARATOR + app.ui.formatDate(session.createdAt);
+  function buildMeta(session, timeUsed) {
+    const parts = [session.passageTitle, app.ui.formatDate(session.createdAt)];
+    if (timeUsed) {
+      parts.push(timeUsed);
+    }
+    const text = parts.join(META_SEPARATOR);
     return app.ui.el("p", { class: "results__meta num", text });
   }
 
-  // Exactly four cards, in the order DESIGN.md fixes; only the pace card carries a hint.
+  // Exactly four cards, in the order DESIGN.md fixes; the pace and fillers cards carry hints.
   function buildMetricGrid(summary) {
     return app.ui.el("div", { class: "metric-grid" }, [
       metricCard(WPM_LABEL, summary.wpm, WPM_UNIT, summary.paceHint),
-      metricCard(FILLERS_LABEL, summary.fillersPerMinute, FILLERS_UNIT),
+      metricCard(FILLERS_LABEL, summary.fillersPerMinute, FILLERS_UNIT, summary.fillersHint),
       metricCard(PAUSES_LABEL, summary.pauseCount),
-      metricCard(LONGEST_PAUSE_LABEL, summary.longestPause, LONGEST_PAUSE_UNIT),
+      metricCard(CLEAN_STRETCH_LABEL, summary.cleanStretchSeconds, CLEAN_STRETCH_UNIT),
     ]);
   }
 
@@ -353,5 +366,5 @@
     ]);
   }
 
-  app.screens.results = { mount, show, hide, summarize, isFiller, buildTranscriptPlan };
+  app.screens.results = { mount, show, hide, summarize, buildTranscriptPlan };
 })();
````

````diff
--- a/frontend/screens/progress.js
+++ b/frontend/screens/progress.js
@@ -16,6 +16,7 @@
     { key: "wpm", label: "Words per minute", color: "var(--accent)", fromZero: false },
     { key: "fillersPerMinute", label: "Fillers per minute", color: "var(--filler)", fromZero: true },
     { key: "pauseCount", label: "Pauses", color: "var(--pause)", fromZero: true },
+    { key: "cleanStretchSeconds", label: "Clean stretch", color: "var(--ok)", fromZero: true },
   ];
   const DEFAULT_KEY = "wpm";
 
````

````diff
--- a/frontend/styles.css
+++ b/frontend/styles.css
@@ -539,8 +539,26 @@
   background: var(--filler-bg);
   color: var(--filler);
   font-weight: 600;
+}
+
+/* A verbal habit is a real word used as filler: the filler color, underlined, no fill, so it
+   reads lighter than an um and still never relies on color alone. */
+.tok--habit {
+  color: var(--filler);
+  font-weight: 600;
+  text-decoration: underline dotted var(--filler);
+  text-decoration-thickness: 2px;
+  text-underline-offset: var(--s-1);
 }
 
+/* One small muted line under the Transcript heading that explains the two highlight styles. */
+.transcript__legend {
+  margin: var(--s-2) 0 0;
+  font-size: var(--fs-small);
+  line-height: 1.4;
+  color: var(--muted);
+}
+
 /* A pause marker is a small pill between words, not a word: inline-block, micro type. */
 .tok--pause {
   display: inline-block;
````

- [ ] **Step 5: Run everything.**

Run: `.venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests`
Expected: PASS. At verification time the frontend suite had 192 tests, all passing.

- [ ] **Step 6: Commit once.** The new tips and the new screen only pass together, so they share one commit.

```bash
git add frontend/tips.js frontend/tests/tips.test.js \
  frontend/screens/results.js frontend/screens/progress.js frontend/styles.css \
  frontend/tests/results.test.js frontend/tests/transcript.test.js \
  frontend/tests/progress.test.js frontend/tests/results_delivery.test.js
git commit -m "Results, tips and Progress read the delivery report"
```

---

## Task 3 (T12, rewritten): passages and debate presets

**Files:** Modify `frontend/passages.js`. Create `frontend/tests/passages_content.test.js`.

**Interfaces:** Produces prompt entries with `format` and `timeLimitSeconds`. Task 2's `timeUsedFor` already reads `timeLimitSeconds`, so a Congress take shows "· 2:41 of 3:00" in the Results meta line as soon as both tasks land, in either order.

The full brief and acceptance line are in Task 0, Step 0.4. The bands are labeled as guidance on the How we measure page. No peer-reviewed source sets pace norms per debate format. The research gives Public Forum about 140 to 180 wpm from a secondary glossary and gives Congress no number. World Schools norms say there should be no spreading, so no preset covers policy-style speed.

- [ ] Step 1: Write `passages_content.test.js` with the brief's checks and run it to see it fail (8 entries exist today, the test wants 10).
- [ ] Step 2: Grow `passages.js` to six passages and four prompts.
- [ ] Step 3: Run the three checks and commit: `git commit -m "Passages: six readings, impromptu, and timed Congress and PF presets"`.

---

## Task 4 (T17): See a sample result

**Files:** Modify `frontend/screens/practice.js` and `frontend/styles.css`. Create `frontend/tests/practice_sample.test.js`. Uses `frontend/sample-session.json` from Task 0, Step 0.5.

**Interfaces:** Consumes `app.store.save(session) -> Promise<id>` and `app.router.go("results", {id})`. Produces nothing other modules use.

The button goes inside the existing `.practice__hint` paragraph because `practice.test.js` pins the children of `.screen__body`. CSS hides it in every state but idle:

```css
.practice__sample {
  margin-top: var(--s-2);
}

.screen[data-state]:not([data-state="idle"]) .practice__sample {
  display: none;
}
```

Exact test cases for `practice_sample.test.js`. Use the fake DOM from `tests/fake-dom.js`, a fake `fetch` that returns `{ok, json()}`, a fake store that records `save` calls and resolves `"sample-1"`, and a router that records `go`:

| Case | Fake fetch returns | Expected |
|---|---|---|
| Good file | `{ok: true, json: () => ({passageId: "free-talk", passageTitle: "Sample: Free talk", durationSeconds: 48.2, metrics: {pauses: []}, transcript: [{text: "We", start: 0.4, end: 0.6}]})}` | one `save` call with exactly those five fields; `go("results", {id: "sample-1"})` |
| Missing file | `{ok: false}` | the `.state--error` block with title "Sample unavailable", body "Could not load the sample. Try again.", action "Try again" |
| Network failure | a rejected promise | the same error block |
| No transcript array | `{ok: true, json: () => ({metrics: {}})}` | the same error block, and no `save` call |
| Double tap | a fetch that stays pending | `fetch` called once |
| Try again | tap the error action | state returns to `idle` |

- [ ] Step 1: Write the test file, run it, and watch it fail.
- [ ] Step 2: Add the button in `mount()` and the click handler with a `loadingSample` guard.
- [ ] Step 3: Add the two CSS rules.
- [ ] Step 4: Run the three checks and commit: `git commit -m "Practice: See a sample result for judges without a microphone"`.

---

## Task 5 (T18): How we measure

**Files:** Create `frontend/how.html` and `frontend/tests/how_page.test.js`. Modify `frontend/screens/results.js` (`buildLegend` appends the link as a child node) and `frontend/styles.css` (`.transcript__how`, tokens only).

The page content, in this order. Use plain language, one short paragraph or table per section, with each number followed by its source:

1. **What counts as a filler.** The rule table from Task 1, the examples that never count, and the reason: a coach that flags "I like this plan" teaches you to ignore it.
2. **Fillers per minute.** The line at 3 a minute; Zoom Revenue Accelerator ("0.6-3.0 filler words per minute") and tl;dv publish the same range. Fillers are a clarity signal, not a verdict: Gong found no link between filler rate and closed deals.
3. **Words per minute.** Hesitation sounds are not words, as in Microsoft's patent application and tl;dv. The guidance bands: Microsoft Speaker Coach recommends 100 to 165 wpm; lecturers average about 145 and TED speakers about 169 (Wingrove). The preset bands are guidance, with the NSDA World Schools line "There should be no 'spreading' in this format."
4. **Mid-sentence pauses.** Only gaps of 1.5 s or more that do not follow a period, question mark or exclamation point. A pause at a period helps listeners remember the next word (MacGregor and colleagues). NSDA's "I Spy Fluency Breaks" drill hunts "fluency breaks or unnecessarily long pauses".
5. **Longest clean stretch.** What cuts it (any filler, a mid-sentence pause, a restart) and where the goal comes from: NSDA's Start Stops and Perfect Point drills, and DebateDrills' 15 clean seconds for beginners.
6. **The tips.** The rule table from `tips.js`, and why each tip names moments and one technique: high-information feedback averaged d = 0.99 across 435 studies (Wisniewski and colleagues, 2019), and brief habit-reversal training cut speech disfluencies in college speakers.
7. **What these numbers cannot tell you.** Transcription can miss quiet ums; "I, like, think" is missed on purpose; noise, accents and speech above about 250 wpm lower accuracy.

Exact test cases for `how_page.test.js`:

- On the real clip session, the legend holds one `a.transcript__how` child whose `href` is `how.html` and whose text is "How we count". The legend's own text stays exactly as Task 2 set it.
- `how.html` exists, has exactly one `<h1>` reading "How we measure", links `styles.css`, contains no `<script`, and has no `!` in its visible text.
- `how.html` mentions each rule word ("like", "so", "you know", "actually", "basically") and each source named above (Zoom, tl;dv, Microsoft, Gong, NSDA, DebateDrills, Wisniewski).

- [ ] Step 1: Write the test, run it, and watch it fail.
- [ ] Step 2: Write `how.html`, the link and the style.
- [ ] Step 3: Run the three checks and commit: `git commit -m "How we measure page, linked from the transcript legend"`.

---

## Task 6 (T19): the accuracy scorer

**Files:** Create `scripts/measure_fillers.js` and `frontend/tests/measure_fillers.test.js`. Modify `.gitignore` (add `samples/labeled/`, because teammates' transcripts stay off GitHub).

**Interfaces:** Consumes `app.delivery.classify` (loaded from `frontend/delivery.js` in a `vm` context). Produces `score(transcript, labels) -> {hesitation: {flagged, labeled, correct, precision, recall}, habit: {...}}`, where `precision` and `recall` are numbers or `null`.

The labeled file format (one take per file in `samples/labeled/`):

```json
{
  "name": "ares-congress-1",
  "transcript": [{ "text": "So,", "start": 0.52, "end": 0.81 }],
  "labels": { "hesitation": [1, 7], "habit": [0] },
  "missed": 1
}
```

`labels` lists the word indexes a careful listener calls fillers, by kind. `missed` counts fillers you heard that the transcript does not contain at all.

Exact test cases, built with the same `timed()` helper as `delivery.test.js`:

| Transcript | Labels | Expected |
|---|---|---|
| "Um, like, the plan works." | hesitation `[0]`, habit `[1]` | both kinds precision 1, recall 1 |
| "It was like really big." | habit `[2]` | habit flagged 0, labeled 1: precision `null`, recall 0 |
| "Basically, the plan fails." | habit `[]` | habit flagged 1, labeled 0: precision 0, recall `null` |
| "The plan works." | none | every precision and recall `null`, and the printed row shows "-" |

- [ ] Step 1: Write the test, run it, and watch it fail.
- [ ] Step 2: Write the script with `score` exported for the test and a CLI that prints one row per file plus a total.
- [ ] Step 3: Run the three checks and commit: `git commit -m "Accuracy scorer for hand-labeled takes"`.

---

## Phase 2: measure and polish (Oct 15 to 21)

The scope is frozen, so this phase adds no features. It measures what Phase 1 built, finishes the queued polish, and fills in the How we measure page with real numbers.

### Task 7 (Ares): label takes and publish the accuracy

- [ ] Record or collect 10 to 25 takes: yours, plus teammates who agree to it. Mix Free talk, the Congress preset and one fast reading.
- [ ] For each take, export the session JSON (the Step 0.5 snippet, without the "Sample:" prefix) into `samples/labeled/<name>.json`. Listen once with the transcript open, then fill `labels` and `missed`.
- [ ] Run `node scripts/measure_fillers.js samples/labeled` and keep the total row.
- [ ] Add a "Measured accuracy" section to `how.html` with the total row, the number of takes and minutes, and one sentence on the biggest miss. This is a content edit to an existing page, not a feature.
- [ ] If "like" or "so" recall is poor and precision is high, consider one rule change at a time, each with a new test case from a real take. Re-run the scorer after each change.

### Task 8 (T20, agent plus your call): pin the provider model

Queue the agent half as T20 after the freeze, with this section as its brief. It changes no screen.

- [ ] Agent: in `backend/providers/assemblyai.py` add `"speech_models": ["universal-3-5-pro", "universal-2"]` to the transcript request. That pair is today's documented default, so behavior does not change; pinning it means a vendor default change cannot shift your numbers during judging. Add a new test file, `backend/tests/test_assemblyai_models.py`, asserting the request body carries that list. `test_providers.py` checks `disfluencies` and `audio_url` by key, so it keeps passing unchanged.
- [ ] Ares: run `scripts/compare_providers.py` on five labeled takes. It already tries nova-3 and then nova-2. Count kept ums against your labels. Keep AssemblyAI as the default unless the counts say otherwise.

### Task 9: polish and stretch, in this order

1. T11's known nit: the unit "per min" wraps at 375px, so shorten it to "/min". T11 already owns this.
2. Progress shading: a band from 0 to 3 on the Fillers per minute chart, in `--ok` at low opacity.
3. Stretch: a pace sparkline on Results from the existing 10-second `pace_windows`, reusing the Progress SVG helpers.
4. Stretch: tap a highlighted filler to hear it. The recording is held in memory only while Results is open, through an in-memory `app.store.holdAudio(id, blob)` / `heldAudio(id)` pair that is never written to IndexedDB. Safari's `audio/mp4` needs its own check.

Video day (Oct 22) shot list, built on this plan:

| Time | On screen |
|---|---|
| 0:00 to 0:15 | You on camera: who you are, the app's name, why a debater needs it |
| 0:15 to 0:30 | One-sentence purpose and audience, and that PF and World Schools want conversational pace |
| 0:30 to 1:20 | A real Congress-preset take, then Results: cards, highlights, legend, a timestamped tip, "0:30 of 3:00". Say "I like this plan, so the impact is clear" and "Um, like, you know" to show only the second gets flagged. |
| 1:20 to 1:35 | History and your real Progress chart with the Clean stretch chip |
| 1:35 to 2:15 | The rule code in `delivery.js` and its tests; a ten-second diagram: Python, FastAPI, JavaScript, Web Audio, IndexedDB, AssemblyAI; the measured accuracy |
| 2:15 to 2:50 | How we measure, then the 2.0 list |

---

## Phase 3: the 2.0 roadmap (for the written answers and after judging)

| Idea | Evidence | Effort in this stack |
|---|---|---|
| **Pitch variation:** the semitone spread over 10-second windows, with "flat stretches" marked | Spreads run about 2.1 semitones in low-liveliness speech and about 4.0 to 4.8 in lively speech (Traunmüller and Eriksson). Visual pitch feedback raised variation by more than 2.5 semitones, and the gain lasted (Hincks and Edlund). Phone mics track pitch well. | 3 to 5 days: a hand-written YIN or McLeod pitch detector over the frames pauses.js already reads, plus octave-error filtering |
| **Every NSDA format as a preset**, with a "clarity at speed" mode for policy and LD that marks metrics low-confidence above about 250 wpm | Ballots ask for clarity; policy spreads at a reported 300 to 400 wpm; no study measures recognition at that speed | 2 to 3 days |
| **Provider bake-off:** ElevenLabs Scribe v2 (verbatim by default), Speechmatics (disfluency tags), AssemblyAI's verbatim prompt | The only cross-vendor benchmark scores Scribe v2 far ahead; the Oct 8 test reversed the vendor order, so measure on your own takes | About a day per adapter behind `Transcriber` |
| **Possible hesitations:** voiced stretches with no transcribed word, from pauses.js loudness | PodcastFillers reached 92.8 F1 with a voiced-but-untranscribed classifier, against 71.0 without it | 2 to 4 days; low precision without a classifier |
| **Hedges** ("I think", "kind of", "maybe") with a "commit to your claims, qualify the evidence" tip | Powerless markers lower attitudes when listeners care about the issue; honest qualifiers on evidence can raise trust | About a day; `delivery.js` already has the pattern |
| **Articulation rate** (pace with pauses removed) beside words per minute | On Switchboard, the same calls measured 196 wpm overall and 236 with silences removed | 1 to 2 days |
| **Weekly focus goal** against a rolling median, with streaks that can be repaired | Goal setting d = 0.34; broken streaks discourage return unless they can be repaired | 1 to 2 days |
| **Drill modes:** Just a Minute, Perfect Point, and an optional "guess your count" before Results | NSDA drills; habit-reversal awareness training | 1 to 2 days |
| **Coach export:** a summary file a coach can open, no accounts | Institutions want team views; a file keeps "no server storage" | 1 day |
| **One rules engine:** move the context rules into `backend/metrics.py` too, or retire the backend's raw filler tally | Two filler definitions confuse a reader; today the backend tally is only the no-words fallback | Half a day plus a contract test update |

## Deliberately not doing

| Idea | Why not |
|---|---|
| Live cues while recording | Out of scope in PLAN.md, and the evidence agrees: continuous concurrent feedback hurts retention once removed (Schmidt and Wulf), and Microsoft retired Teams Speaker Coach. Results shows "2:41 of 3:00" after the take instead. |
| An LLM-written tip | Out of scope; it adds a vendor, a key, a failure point and a larger disclosure. Reasoning models over-delete fluent text when used to find disfluencies. |
| A composite score or grade | Rewards and grades are the least informative feedback (d = 0.24); reviewers called LikeSo's verdicts discouraging. Ranges and moments instead. |
| Whisper or Web Speech in the browser | Both drop fillers, browser Whisper needs hundreds of megabytes, and the no-CDN rule rules out the libraries. |
| Eye contact or video | The app records audio only; this would be a different product. |
| Saving audio for replay from History | Breaks "audio is never stored" and leaves recordings on shared school devices; in-session replay (Task 9) covers the need. |
| Counting every "like" and "so" | The research's central finding: about six in ten "like"s in natural speech are not fillers. |

## Self-review notes

- **Coverage:** every pre-freeze recommendation in the research report's tables maps to a task: rules (1), the split by kind (1 and 2, as two styles and a legend rather than two cards, so the card count stays at four), recalibrated tips (2), clean stretch (1 and 2), presets (3), the sample button (4), How we measure (5) and measurement (6 and 7). Provider pinning sits in Phase 2 (8). Its research table also placed it before the freeze, but it changes nothing a user sees and only matters once accuracy is measured.
- **Deliberate departures from the research table:** fillers stay one card. Hesitations and habits share the 3-a-minute line because Zoom's range covers all filler words, and the split shows in the transcript and the legend. The pause threshold stays 1.5 s, with only its position judged. A finer threshold waits for the accuracy run.
- **Placeholders:** none. Tasks 3 to 6 are briefs with exact test cases rather than full code, matching how `tasks/queue.json` drives the night runner.
- **Names checked across tasks:** `analyze`, `classify`, `isHesitation`, `HABIT`, `wordsPerMinute`, `fillersPerMinute`, `fillers[].start`, `topHabit`, `longestMidSentencePause`, `midSentencePauseCount`, `cleanStretch.seconds`, `repeatCount`, `speakingSeconds` and `timeLimitSeconds` are spelled the same in Tasks 1 to 5. Tasks 1 and 2 were verified by running them together.
- **Unmeasured until Task 7:** how often "like" and "so" are fillers in debate speech, whether the "so" and "you know" rules are accurate, and recognition accuracy above 250 wpm.

