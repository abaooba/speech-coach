# Speech Coach frontend design spec

Every screen is built from this file. Angle: **drill-first**. A debater runs timed reps between rounds: one thumb, one glance, next rep. Numbers are big, chrome is minimal, nothing moves unless it carries information. Two agents building two screens without talking must produce siblings. If something is missing, use the closest existing token or class; never invent a parallel one or edit this file in a task.

## 1. Screens and navigation

| Screen | Route | Purpose |
|---|---|---|
| Onboarding | `#/onboarding` | First launch only: what is measured, audio is deleted after analysis, one button. |
| Practice | `#/practice` (default) | Talk on a timed topic or read a passage aloud, record, stop. Home. |
| Results | `#/results/:id` | A two-sentence headline, four metric cards with "vs last take" lines, the speech timeline, the highlighted transcript, one or two tips. |
| History | `#/history` | Sessions newest first with a status word, tap to reopen, delete with confirm. |
| Progress | `#/progress` | Metric switch, summary row, hand-rolled SVG line chart with the target band and the personal best. |

**Flow.** On boot, if `app.store.getFlag("onboarded")` is false the router opens Onboarding; its single button sets the flag and goes to Practice. Practice is home: the empty hash, the left nav item, where "Record again" returns. It opens on the Talk tab with "Your day" selected; the tab, the option and the topic stay as the speaker left them while the app is open. Stop uploads immediately (no submit step); on success the session is saved and the router goes to `#/results/<id>`. Results keeps an action bar stuck above the nav with "History" (`.btn--ghost`) and "Record again" (`.btn--primary`); History rows open Results by id. The nav shows Practice, History, Progress; on Results no item is active. The nav is hidden on Onboarding and while Practice is `recording` or `uploading`, so a stray thumb cannot abandon a take.

Routing is hash-based in `app.js`. Exactly one `.screen` has `.screen--active`; the others carry the `hidden` attribute.

## 2. File layout and the `app` namespace

```
frontend/
  index.html          five <section class="screen">, <nav>, scripts in the order below
  styles.css          tokens, base, components, screens, one file
  app.js              creates window.app, hash router, boots on DOMContentLoaded
  ui.js               app.ui: el, renderState, clear, announce, formatClock, formatDate,
                      formatDay, icon, getTheme, applyTheme, setTheme, nextTheme
  store.js            app.store: IndexedDB sessions + flags
  api.js              app.api.analyze
  passages.js         app.passages: [{id, kind, title, text, targetWpm: [lo, hi], source?,
                      format?, timeLimitSeconds?, topics?}]
  delivery.js         app.delivery: the filler rules and the delivery report (analyze, classify)
  tips.js             app.tips.select(report, options) -> up to two {id, text}
  pauses.js           app.pauses, human-owned (T08); agents never touch it
  screens/practice.js results.js history.js progress.js onboarding.js
  how.html            static "How we measure" page: each metric's rule, band and source
  sample-session.json one real take, loaded by Practice's "See a sample result"
  manifest.json  sw.js  icons/   (T10)
```

Script order: `app.js`, `ui.js`, `store.js`, `api.js`, `passages.js`, `delivery.js`, `tips.js`, `pauses.js`, then the five screens. Classic `<script>` tags, no modules, no build, no CDN. The list is fixed by `backend/tests/test_frontend_shell.py`, so a new helper lives in the module that owns its data, never in a new file. Every file is an IIFE assigning exactly one `app.<name>`; `window.app` is the only global. Each file opens with a two-to-four line comment saying what it owns. Transcript and user text never go through `innerHTML`; build nodes with `app.ui.el`, and SVG with `createElementNS`.

Contracts (exact names):

- `app.router.go(name, params)`, `app.router.current()`. A screen registers `app.screens[name] = { mount(root), show(params), hide() }`; `app.js` calls `mount` once at boot with its `<section id="screen-<name>" class="screen">`, then `show`/`hide` on each hash change. A module never touches DOM outside its `root`; shared data goes through `app.store` and route params.
- `app.store.save(session) -> Promise<id>`, `list()` newest first, `get(id)`, `remove(id)`, `getFlag(key)`, `setFlag(key, value)`. Session: `{id, createdAt, passageId, passageTitle, durationSeconds, metrics, transcript}`; `metrics` is the backend dict unchanged, `transcript` the backend word list `[{text, start, end}]`. Audio is never stored.
- `app.passages`: `kind: "passage"` is read word for word and lists on the Read tab; `kind: "prompt"` is a topic to talk on and lists on the Talk tab. Every prompt has `timeLimitSeconds`. A prompt with `topics` shows one topic at a time, starting with the first, and New topic moves to the next one, wrapping; its `text` repeats `topics[0]` so every entry has text. The `free-talk` id is titled "Your day"; the id stays so saved takes still find their band.
- `app.delivery.analyze(words, metrics) -> report` re-scores a stored take from its words, so every saved session uses today's rules: `kinds` (`"hesitation"`, `"habit"` or null per word), `fillers` (`{index, text, kind, start, end}`, "you know" is one event), `fillerCount`, `hesitationCount`, `habitCounts`, `topHabit` (`{text, count}` or null), `speechStart` (the first word's start, null without words), `speakingSeconds`, `wordsPerMinute` (hesitation sounds are not words), `fillersPerMinute`, `pauses` (`{at, length, midSentence}`), `midSentencePauseCount`, `longestMidSentencePause`, `cleanStretch` (`{start, end, seconds}` or null) and `repeatCount`. Every time in the report is in recording seconds, the clock the tips print. A session with no words falls back to the backend tallies. Results, tips and Progress read this report; `metrics` stays the backend dict unchanged.
- `app.screens.results` also exports pure helpers that touch no DOM and no `app.ui`: `summarize(session)` (shared with History and Progress), `buildTranscriptPlan(words, pauses)`, `headlineFor(summary, previousSummary) -> {strength, focus}`, `compareWithPrevious(summary, previousSummary) -> null | [four {direction, text} or null, in card order]` and `timelineSegments(report) -> null | {start, seconds, fillers, pauses, cleanStretch}`. `app.screens.history.statusFor(summary) -> {text, tone} | null`. `app.screens.progress` exports `series`, `scale` and `summaryFor`.
- `app.api.analyze(blob, contentType) -> Promise<{transcript, metrics}>`; rejects with an `Error` whose `.kind` is `"network" | "too_short" | "provider" | "unknown"` and whose `.message` is the matching string in section 8.
- `app.ui.el(tag, attrs, children)`; `renderState(root, {kind, title, body, actionLabel, onAction, icon, secondaryLabel, onSecondary})`, kind `"empty" | "error" | "loading"`, icon `"mic" | "chart" | "search"`; `clear(root)`; `announce(text)` writes the `.sr-only` live region; `formatClock(seconds) -> "1:05"`; `formatDate(iso) -> "Oct 9, 10:21 PM"`; `formatDay(iso) -> "Oct 9"`; `icon(name, size = 20) -> <svg> | null` (null for an unknown name), a 24-unit icon in `currentColor`, `aria-hidden="true"`, `data-icon` set to its name, built on each call; the triangles and half of `contrast` are filled, the rest are 2-unit strokes: `mic`, `chart`, `search`, `alert`, `trash`, `check`, `arrow-right`, `refresh`, `triangle-up`, `triangle-down`, `dash`, `contrast`, `moon`, `sun`. Theme: `getTheme() -> "auto" | "dark" | "light"` ("auto" when nothing is saved or storage is blocked), `applyTheme(choice)` sets `data-theme` on `<html>` (none for auto) and points both theme-color metas at that theme's `--bg`, `setTheme(choice)` saves then applies, `nextTheme(choice)` cycles auto, dark, light. The theme is the one setting kept in `localStorage` (key `speech-coach-theme`, every access in try/catch), because it is read synchronously; `app.js` applies it at boot, before any screen mounts. On a slow load a forced theme can show the device scheme for a frame, since the classic scripts sit at the end of `<body>`. Sessions and flags stay in IndexedDB.
- Practice keeps its state in one string, `app.screens.practice.state`; one `render(state)` function is the only code that touches that screen's DOM.

## 3. Layout and spacing

Single column, phone first. `main` is `max-width: var(--col-max); margin: 0 auto; padding: var(--s-4) var(--s-4) calc(var(--nav-h) + var(--s-5) + env(safe-area-inset-bottom))`. Never horizontal scroll at 320px; transcript uses `overflow-wrap: anywhere`.

```
--s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
--s-5: 24px; --s-6: 32px; --s-7: 48px;
--r-card: 12px; --r-btn: 10px; --r-tok: 4px; --r-chip: 999px;
--nav-h: 56px; --col-max: 640px;
```

Only these values for margin, padding and gap. Rhythm: section gap `--s-6`, card gap `--s-3`, label-to-value `--s-1`. No shadows; separation is `--surface` on `--bg` plus a 1px `--border`. `.metric-grid` is `display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3)` at every width, so the four cards always sit 2 x 2 inside the column.

**Practice fits one screen.** Its body, top to bottom: `.segmented` (Talk or Read), `.chip-row`, `.passage-card`, `.practice__timer`, `.btn-record`, `.btn-record__label`, `.practice__hint`, `.practice__state`. The active Practice section is a flex column at least as tall as the viewport minus `main`'s padding, so the record zone sits in the bottom thumb zone above the nav at 375 x 667 and 320 x 568 without scrolling. The topic or passage card takes the height left over (`flex: 1 1 0; min-height: 120px`) and scrolls inside; every other child keeps its size (`flex: none`). Under `max-height: 600px` the card floor drops to 88px, the record button shrinks to 72px and the hint text hides. At 200% zoom or in landscape the column grows and the page scrolls.

**Wide screens.** The nav's items sit in the same centered column as the content. The Results action bar spans the column; its primary button caps at 320px.

## 4. Color tokens

Declare on `:root`. Dark values apply under `@media (prefers-color-scheme: dark)` to `:root:not([data-theme="light"])`, and always to `:root[data-theme="dark"]`; the two dark blocks carry the same values. Each block sets `color-scheme`. Raw hex exists only in this block. `body` sets `background: var(--bg); color: var(--text)`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0F1115` | page |
| `--surface` | `#F4F5F7` | `#1A1D24` | cards, nav, chips, segmented controls |
| `--text` | `#111318` | `#F2F4F7` | primary text |
| `--muted` | `#5B6270` | `#9AA3B2` | labels, hints, icon buttons |
| `--border` | `#D9DDE3` | `#2A2F3A` | 1px lines |
| `--grid` | `#E4E6EA` | `#2B3038` | chart gridlines, the time-limit track |
| `--accent` | `#2457F5` | `#6B93FF` | primary buttons, active nav, focus ring, chart wpm, time-limit fill |
| `--on-accent` | `#FFFFFF` | `#0F1115` | text on accent |
| `--accent-soft` | `#E3ECFA` | `#1E2C44` | tip card background |
| `--record` | `#E5484D` | `#FF6369` | record button, recording dot, error icon and block edge |
| `--on-record` | `#FFFFFF` | `#0F1115` | the icon on the record button |
| `--record-text` | `#B91C1C` | `#FF6369` | red text: error titles, the Delete confirm |
| `--record-bg` | `#FEE2E2` | `#3F1414` | error block background |
| `--filler` | `#B45309` | `#FBBF24` | filler token text, timeline filler ticks, chart fillers |
| `--filler-bg` | `#FEF3C7` | `#3B2A05` | filler token background |
| `--pause` | `#6D28D9` | `#B49CFF` | pause marker text, timeline pause blocks, chart pauses |
| `--pause-bg` | `#EDE9FE` | `#2A1F4D` | pause marker background |
| `--ok` | `#15803D` | `#4ADE80` | in-target hints and status, clean-stretch edge, chart clean stretch |
| `--ok-bg` | `#DCFCE7` | `#163B26` | clean-stretch band, the Progress target band |
| `--warn` | `#9A3412` | `#FF8A4C` | out-of-target hints and status, always with the warning icon |

Red appears only on the record button, the recording dot, error blocks and Delete. Warnings are rust orange, never filler amber or record red, and always carry the triangle icon. `<meta name="theme-color">` is `--bg` per scheme.

Contrast, light / dark: `--warn` on `--surface` 6.70 / 7.22 and on `--bg` 7.31 / 8.09; `--on-record` on `--record` 3.91 / 6.52 (non-text); `--record-text` on `--bg` 6.47 / 6.52, on `--record-bg` 5.30 / 5.48; `--ok` on `--ok-bg` 4.57 / 7.14; `--accent` on `--grid` 4.47 / 4.58 (non-text); `--filler`, `--pause` and `--ok` on `--surface` at least 4.60 (non-text). `--ok-bg` is decorative; the solid `--ok` edge and the words carry the meaning.

## 5. Type scale

`font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Every number uses `font-variant-numeric: tabular-nums`.

```
--fs-metric:        40px / 1.0 / 700   metric card value, the Practice timer
--fs-metric-narrow: 32px / 1.0 / 700   metric card value under 360px
--fs-h1:            24px / 1.2 / 700   screen title (one per screen)
--fs-h2:            18px / 1.3 / 600   section title, passage title, Progress summary value
--fs-body:          16px / 1.5 / 400   transcript, passage text, headline, body
--fs-small:         14px / 1.4 / 500   labels, chips, segments, hints, row text
--fs-micro:         12px / 1.3 / 500   nav labels, timestamps, axis labels, delta lines, legends
```

Body never goes below 16px. Everything is sentence case; no label is uppercased or letter-spaced. Metric labels are short: "Pace", "Fillers", "Mid-sentence pauses", "Clean stretch". Labels wrap; they never truncate.

## 6. Component inventory

Class names are exact (`block__part`, `block--modifier`).

**Buttons** `.btn`: `min-height: 48px; padding: 0 var(--s-5); border-radius: var(--r-btn); font: 600 var(--fs-body); display: inline-flex; align-items: center; justify-content: center; gap: var(--s-2)`. Variants: `.btn--primary` (accent bg, on-accent text; one per screen), `.btn--secondary` (surface bg, text color, 1px border), `.btn--ghost` (transparent, accent text), `.btn--danger` (transparent, `--record-text` text and a 1px `--record` border; Delete only), `.btn--block` (width 100%). Disabled: `opacity: .5`, ignores clicks. `.icon-btn`: a 44 x 44 transparent button holding one 20px `app.ui.icon`, `--muted`, with an `aria-label`.

**Header** `.screen__header` (Practice): the `h1` and, at the right, `.wordmark` (a 16px mic mark and "Speech Coach", small, 500, muted, no-wrap) followed by `button.icon-btn.theme-toggle`. The toggle shows the current choice, `contrast` for Auto, `moon` for Dark, `sun` for Light, and each tap moves to the next. Its `aria-label` names the choice and the next one: "Theme: Auto. Switch to dark." Its 44px hit area overlaps the header's padding so the row stays as tall as the `h1`.

**Segmented control** `.segmented` (Practice mode, Progress metric): `role="group"` with an `aria-label`, one row of equal `button.segmented__option` (`aria-pressed`) in a `--surface` container with a 1px border, `--r-btn` radius and `--s-1` inner padding. Options are 44px tall, small, `--muted`, with corners of `calc(var(--r-btn) - var(--s-1))` so they nest inside the container; `.segmented__option--selected` is accent fill with on-accent text. Practice: "Talk" and "Read" (`aria-label="Practice mode"`), disabled outside idle. Progress: "Pace", "Fillers", "Pauses", "Clean" (`aria-label="Chart metric"`), which fits 288px.

**Chips** `.chip`: `<button>`, `min-height: 44px; padding: 0 var(--s-4); border-radius: var(--r-chip); font: 500 var(--fs-small)`, surface bg, 1px border. `.chip--selected`: accent bg, on-accent text, `aria-pressed="true"`. `.chip-row`: horizontal flex, `gap: var(--s-2)`, `overflow-x: auto`. Practice's chips are the options of the current tab; a timed option reads "Your day 1:00". Its row bleeds to the screen edges (a negative inline margin of `--s-4` with matching padding) and fades out over its last `--s-6`, with `--s-6` of end padding so the last chip can scroll clear. While a take runs, the selected chip keeps full contrast and the others dim to .5.

**Passage card** `.passage-card` (topic or passage): surface, `--r-card`, padding `--s-4`, a flex column that takes Practice's free height. `.passage-card__title` (h2: "Your day" or the passage title), `.passage-card__target` (small, muted, "Target 140 to 160 wpm"), `.passage-card__text` (body, line-height 1.6: the current topic or the passage), which scrolls inside the card and fades out over its last `--s-5` (a mask, with matching end padding so the last line scrolls clear of the fade). `.passage-card__new` is a `.btn--ghost` "New topic" with the refresh icon, shown only for a prompt with `topics` and only in idle. No pill or label ever sits on the text.

**Record button** `.btn-record`: 88px circle (72px under `max-height: 600px`), `--record` bg, `color: var(--on-record)`, centered. Idle: 28px microphone SVG; recording: 24px rounded square; both draw in `currentColor`. `aria-pressed` mirrors recording; `aria-label` is "Start recording" or "Stop recording". `.btn-record__label` (small, 600) below reads "Record" or "Stop". Button and label hide together in uploading and error.

**Timer** `.practice__timer`: a three-column grid that keeps the clock centered. `.rec-dot` (8px `--record` circle, `opacity 1 -> .3` 1s pulse while recording) sits in the left column, `.timer` (`--fs-metric`, `--muted` in idle, `--text` while recording, `aria-live="off"`; announcements use `app.ui.announce`) in the middle, and `.practice__limit` ("/ 1:00", small, muted) on the right for timed options. `.practice__limit-bar` (`aria-hidden`) spans the next row: 4px tall, `min(100%, 240px)` wide, a `--grid` track with an `--accent` fill scaled by elapsed over limit. Past the limit the fill stays full and turns `--warn` while the clock keeps counting. Untimed options hide the limit and the bar.

**Practice hint** `.practice__hint`: `span.practice__hint-text` (small, muted) reads "Tap to record. Stop uploads automatically." in idle and "Tap Stop when you finish. It uploads right away." while recording; hidden in uploading and error. Its `.btn--ghost` "See a sample result" follows the text, idle only.

**Headline** `.headline` (Results, under the meta line): surface card, 1px border, `--r-card`, padding `--s-4`, two body-size lines. `.headline__strength` (600) with a `--ok` check icon, `.headline__focus` (400) with an `--accent` arrow. The words come from `headlineFor`; each icon is appended after the words and drawn first with `order: -1`.

**Metric card** `.metric-card` (surface, border, `--r-card`, padding `--s-4`, `--s-3` under 360px): four rows on a subgrid shared by the two cards of a grid row, so values line up. `.metric-card__label` (small, 500, muted, sentence case), `.metric-card__value` (no-wrap, `--fs-metric`, `--fs-metric-narrow` under 360px, bottom of its row) holding `.metric-card__unit` (small, muted: "wpm", "/min", "s"), `.metric-card__hint` (small, 600; `--ok` with the check icon: "Target 140 to 160", "Target under 3"; `--warn` with the alert icon: "Speed up", "Slow down", "Aim for under 3") and `.metric-card__delta` (micro, muted, one line; `.metric-card__delta--up`, `--down` or `--same` with the `triangle-up`, `triangle-down` or `dash` icon: "12 faster", "12 slower", "1.2 fewer", "1.2 more", "1 fewer", "1 more", "2.1 s longer", "2.1 s shorter", "No change"; a visually hidden " than your last take" or " from your last take" finishes the sentence). Results shows exactly four, in order: Pace (`report.wordsPerMinute` rounded, pace hint), Fillers (`report.fillersPerMinute`, hint "Target under 3" in `--ok` at 3 or less and "Aim for under 3" in `--warn` above), Mid-sentence pauses (`report.midSentencePauseCount`, no hint), Clean stretch (`report.cleanStretch.seconds`, unit "s", 0 for a session without words, no hint). Deltas compare with the most recent earlier session in `app.store` and appear only when one exists; then `.metric-grid__note` (micro, muted) under the grid reads "Arrows compare with your last take." The meta line `.results__meta` reads "Gettysburg Address, opening · Oct 10, 10:30 AM", plus " · 2:41 of 3:00" for a timed option; `.results__date` and `.results__time-used` never break.

**Timeline** `.timeline` (Results, between the cards and the transcript, only for a take with words): `h2.results__heading` "Speech timeline", then `svg.timeline__strip` (`role="img"`, `aria-label` such as "Speech timeline from 0:01 to 0:32: 11 fillers, 3 mid-sentence pauses, a 4.9 second clean stretch"), 40px tall, `viewBox="0 0 320 40"`, `preserveAspectRatio="none"`. It draws a track (`--surface` fill, `--border` stroke) from the first word to the last, the clean-stretch band (`--ok-bg` with a 3-unit `--ok` base line), each mid-sentence pause as a `--pause` block as wide as the pause, and each filler as a 2-unit `--filler` tick taller than the track. `.timeline__axis` (micro, muted, tabular) labels the first word, the midpoint and the last word in recording time. `.timeline__legend` (micro) pairs a swatch with "Filler", "Mid-sentence pause" and "Clean stretch". `ul.sr-only.timeline__moments` lists every moment: "Filler “um” at 0:02", "Mid-sentence pause at 0:15, 1.5 seconds", "Clean stretch from 0:05 to 0:10, 4.9 seconds".

**Transcript** `.transcript`: a `<p>` at body size, `line-height: 1.8`. Every word is `<span class="tok">` plus a space. Words are labeled by `app.delivery.classify`. `.tok--filler` marks a hesitation sound (um, uh, er, ah, hm at any length): filler text and bg, `padding: 0 var(--s-1)`, radius `--r-tok`, weight 600, `aria-label="um, filler word"`. `.tok--habit` marks a verbal habit the rules counted (like, so, you know, actually, basically): filler text color, weight 600, no background, a 2px dotted underline in `--filler` offset by `--s-1`, `aria-label="like, verbal habit"`. Between the Transcript heading and the paragraph, `.transcript__legend` (small, muted) reads "Highlighted words are ums and uhs. Underlined words are verbal habits.", adds "Most used: “like”, 4 times." when a habit was counted, and ends with a "How we count" link to `how.html`. `.tok--pause`: an inline marker, not a word, for each mid-sentence pause in the report, inserted after the last word whose `end <= at`: pause text and bg, radius `--r-chip`, `padding: 0 var(--s-2)`, micro size, text `2.1 s pause`, `aria-label="pause, 2.1 seconds"`. Pauses between sentences are not marked, so the transcript, the card and the timeline count the same pauses. Repeats are not styled; they appear in tips only.

**Tip card** `.tip-card`: `--accent-soft` bg, 4px `--accent` left border, `--r-card`, padding `--s-4`, body text; one tip each, at most two.

**Results action bar** `.results__actions`: the last child of Results, `position: sticky; bottom: calc(var(--nav-h) + env(safe-area-inset-bottom))`, `--bg` with a 1px top border, padding `--s-3` 0, one row: `.btn--ghost` "History", then `.btn--primary` "Record again" (`flex: 1 1 auto; max-width: 320px`).

**Session row** `.session-row` (History): an `li` holding `button.session-row__open` and the delete control. The open button is a grid: `.session-row__text` (`.session-row__title`, small 600, over `.session-row__date`, micro, muted, no-wrap) and, under it below 480px or at the right from 480px, `.session-row__stats` (small, tabular, "152 wpm · 3.1 /min") over `.session-row__status` (micro, 600, with an icon: `--ok` check "On target"; `--warn` alert "Too slow", "Too fast" or "Fillers over 3", joined by " · "). The delete control is `button.icon-btn.session-row__delete` with the trash icon and `aria-label="Delete session from <date>"`. A tap swaps it for `span.session-row__confirm` (`role="group"`, `aria-label="Delete session from <date>?"`): "Delete?", `.btn--danger` "Yes", `.btn--ghost` "No". Focus moves to No; No brings the trash button back and focuses it; Yes deletes, announces "Session deleted" and focuses the row now in that place, or the empty state's action.

**State block** `.state` (centered column, `padding: var(--s-7) var(--s-4)`, `max-width: 320px`, margin auto): `.state__icon` (32px inline SVG, muted; a named icon when the caller passes one: `mic` for empty History, `chart` for Progress under two sessions, `search` for a missing session), `.state__title` (h2), `.state__body` (body, muted, at most two sentences), `.state__action` (`.btn--primary` for retry, `.btn--secondary` otherwise), then an optional `.btn--ghost` secondary action. `.state--empty`; `.state--error` (`--record-bg` bg, the alert icon in `--record`, `--record-text` title, `--r-card`, `role="alert"`); `.state--loading` (icon replaced by `.spinner`: 24px ring, `border: 3px solid var(--border); border-top-color: var(--accent)`, 1s rotation, `role="status"`). Only `app.ui.renderState` builds these. Inside Practice the block takes the record zone with `--s-4` padding.

**Nav** `<nav class="nav" aria-label="Main">`: fixed bottom, `height: calc(var(--nav-h) + env(safe-area-inset-bottom))`, surface bg, 1px top border, items centered: three `<a class="nav__item">` flex columns (`flex: 1 1 0; max-width: calc(var(--col-max) / 3); min-height: var(--nav-h)`): `.nav__icon` 24px SVG over `.nav__label` (micro, 600, sentence case). `.nav__item--active`: `--accent`, `aria-current="page"`; inactive `--muted`.

**Chart** `.chart` (Progress): under the segmented control, `h2.progress__title` names the metric in full ("Words per minute", "Fillers per minute", "Mid-sentence pauses", "Longest clean stretch"), then `dl.progress-summary`: three surface cells, each `dt` (small, muted) over `dd.num` (`--fs-h2`, 700, no-wrap): "Latest", "Best" and "From your average" (the latest take against the mean of the takes before it, in the delta words: "12 faster", "1.2 fewer", "No change", with the matching triangle or dash icon). Best is the lowest fillers, the fewest mid-sentence pauses, the longest clean stretch, and for pace the take closest to its own target band; ties go to the most recent take. The chart is inline SVG, `viewBox="0 0 320 200"`, `width: 100%`. Y ticks are round: steps of 1, 2, 5, 10, 20, 25, 50, 100 or 200, at most five intervals. Gridlines `--grid` 1px, axes `--border`, labels micro `--muted`. Fillers per minute gets a `--ok-bg` band from 0 to 3 with a dashed `--ok` line at 3 and the micro label "Target under 3". One `<polyline>` at a time, `stroke-width: 2`, 4px circle points, colored by series: wpm `--accent`, fillers per minute `--filler`, pauses `--pause`, clean stretch `--ok`. The best take gets a 7-unit ring in the series color and a micro "Best" label. X labels are short dates ("Oct 9"): every take up to five, otherwise five spread labels, the last one anchored at the end and repeats of the same day skipped. `role="img"` with an `aria-label` naming series, latest value and session count; a `.sr-only` `<table>` lists the numbers.

**`.sr-only`**: the standard visually-hidden rule.

## 7. Recording states (Practice)

`<section class="screen" id="screen-practice" data-state="idle">` carries one of four values. CSS shows and hides children by `[data-state]`; `render(state)` sets the attribute and text.

| State | Timer | Record button | Tabs and chips | Below | Nav |
|---|---|---|---|---|---|
| `idle` | `0:00`, muted; "/ 1:00" and an empty bar for timed options | mic, "Record" | enabled | hint "Tap to record. Stop uploads automatically." and a `.btn--ghost` "See a sample result" | visible |
| `recording` | counting, text color, `.rec-dot`; the bar fills | stop, "Stop" | disabled; the selected chip stays readable; New topic hidden | hint "Tap Stop when you finish. It uploads right away."; the text stays readable | hidden |
| `uploading` | final value held | hidden with its label | disabled | `.state--loading` "Analyzing your speech" / "Usually 5 to 15 seconds." No cancel. | hidden |
| `error` | hidden | hidden with its label | disabled | `.state--error` in the record zone with its title focused, fixed message, one action; after a failed upload a secondary "Record a new take" drops the take | visible |

Mic permission is requested on the first record tap, never on load. Stopping under 5 s goes straight to `error`; nothing is uploaded. The blob stays in memory through `uploading` and `error` so Retry re-sends it. Reaching the time limit never stops a take.

## 8. Fixed copy

- Mic denied: "Microphone is blocked. Allow it in your browser settings, then tap Record." Action "Try again" (back to idle).
- Network: "Could not reach the server. Your recording is still here." Action "Retry upload", secondary "Record a new take".
- Provider (502) or unknown: "Analysis failed on our side. Your recording is still here." Action "Retry upload", secondary "Record a new take".
- Too short: "That was under 5 seconds. Try again." Action "Record again".
- History empty: "No sessions yet" / "Your first recording will show up here." Action "Record".
- Progress under two sessions: "Need two sessions" / "Record one more to see a trend." Action "Record".
- Results bad id: "Session not found". Action "History".
- Sample failed: "Could not load the sample. Try again." Action "Try again" (back to idle).
- Practice: tabs "Talk" and "Read"; "New topic"; recording hint "Tap Stop when you finish. It uploads right away."
- Theme toggle: "Theme: Auto. Switch to dark.", "Theme: Dark. Switch to light.", "Theme: Light. Switch to auto." After a tap the live region says "Theme: Dark", "Theme: Light" or "Theme: Auto".
- Results headline, first match wins. Strength: "Fillers are down from 4.2 to 1.8 a minute." (vs the last take, a drop of at least 0.5); "Your pace is inside the 130 to 150 target."; "Your fillers are under 3 a minute."; "No pause breaks a sentence."; "Your longest clean stretch is 4.9 seconds."; "This take is on your progress chart." Focus: "Next take, cut fillers under 3 a minute."; "Next take, slow toward 130 to 150 wpm."; "Next take, lift your pace toward 130 to 150 wpm."; "Next take, save pauses for the ends of sentences."; "Next take, stretch your clean run past 4.9 seconds."; "Next take, hold this delivery on a longer topic." The thresholds are the cards': the band ends count as inside, fillers over 3 are high, and a clean stretch under 15 seconds has room to grow.
- Results: "Arrows compare with your last take."; "Speech timeline"; legend "Filler", "Mid-sentence pause", "Clean stretch".
- History status: "On target", "Too slow", "Too fast", "Fillers over 3". After a delete the live region says "Session deleted".
- Progress: "Latest", "Best", "From your average", "Target under 3".

Copy: second person, present tense, under 15 words a sentence, no exclamation marks, no blame. Words, never symbols: "under 3", not "<3".

## 9. Accessibility

- Tap targets are at least 44 x 44px; interactive elements are real `<button>` or `<a>`.
- `:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px }` everywhere; never `outline: none` without a replacement. Scrollers and masked rows keep enough padding that a ring is never clipped; the nav items and segmented options, which touch an edge or a neighbor, draw it inside (`outline-offset: -3px`), in `--on-accent` on the selected option.
- The `.sr-only` region with `aria-live="polite"`, written only by `app.ui.announce`, says "Recording started", the elapsed time every 30 seconds, "Recording stopped, 42 seconds", "Results ready", "Session deleted" and the theme after each toggle.
- Focus moves on purpose: to the error title (`tabindex="-1"`) when Practice shows an error, to No when a delete confirm opens, back to the trash button on No, and to the next row after a delete. Every `focus()` call is guarded, because the test fakes have none.
- Color never carries meaning alone: fillers are bold with labels, pause markers contain text, hints and status words carry words and an icon, deltas carry a triangle and words, the timeline has a legend and a hidden list, the chart has a table. Every text pair is at least 4.5:1 and every meaningful non-text mark at least 3:1 in both schemes (section 4).
- Segmented controls are toggle buttons with `aria-pressed` inside `role="group"` with an `aria-label`.
- `@media (prefers-reduced-motion: reduce)` stops the `.rec-dot` pulse and the spinner rotation; nothing else animates.
- Icons are inline SVG, `aria-hidden="true"`, beside visible text or an `aria-label`. One `h1` per screen, `h2` for sections. Tab order top to bottom, nav last.
- `lang="en"`, viewport `width=device-width, initial-scale=1`, no `user-scalable=no`. Layout survives 200% zoom.

## 10. Done checklist for any screen

Tokens only, spacing from the scale. One `.screen` with the required id, registered with `mount/show/hide`. Every empty, loading and error state built by `app.ui.renderState` and reachable (document how in `frontend/README.md`). One `.btn--primary` per screen. Correct at 320 x 568, 375 x 667, 375 x 844 and 1024 x 900, light and dark, both from the device setting and from the theme toggle; Practice fits above the nav at 320 x 568 and 375 x 667. `how.html` has no script, so it follows the device setting only. No console errors, no globals beyond `app`.
