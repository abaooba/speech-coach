# Speech Coach frontend design spec

Every screen is built from this file. Angle: **drill-first**. A debater runs timed reps between rounds: one thumb, one glance, next rep. Numbers are big, chrome is minimal, nothing moves unless it carries information. Two agents building two screens without talking must produce siblings. If something is missing, use the closest existing token or class; never invent a parallel one or edit this file in a task.

## 1. Screens and navigation

| Screen | Route | Purpose |
|---|---|---|
| Onboarding | `#/onboarding` | First launch only: what is measured, audio is deleted after analysis, one button. |
| Practice | `#/practice` (default) | Pick a passage or free-talk prompt, record, stop. Home. |
| Results | `#/results/:id` | Four metric cards, highlighted transcript, one or two tips. |
| History | `#/history` | Sessions newest first, tap to reopen, delete with confirm. |
| Progress | `#/progress` | Hand-rolled SVG line chart, metric toggle. |

**Flow.** On boot, if `app.store.getFlag("onboarded")` is false the router opens Onboarding; its single button sets the flag and goes to Practice. Practice is home: the empty hash, the left nav item, where "Record again" returns. Stop uploads immediately (no submit step); on success the session is saved and the router goes to `#/results/<id>`. Results ends with "Record again" (`.btn--primary`) and "History" (`.btn--secondary`); History rows open Results by id. The nav shows Practice, History, Progress; on Results no item is active. The nav is hidden on Onboarding and while Practice is `recording` or `uploading`, so a stray thumb cannot abandon a take.

Routing is hash-based in `app.js`. Exactly one `.screen` has `.screen--active`; the others carry the `hidden` attribute.

## 2. File layout and the `app` namespace

```
frontend/
  index.html          five <section class="screen">, <nav>, scripts in the order below
  styles.css          tokens, base, components, screens, one file
  app.js              creates window.app, hash router, boots on DOMContentLoaded
  ui.js               app.ui: el, renderState, clear, announce, formatClock, formatDate
  store.js            app.store: IndexedDB sessions + flags
  api.js              app.api.analyze
  passages.js         app.passages: [{id, title, text, targetWpm: [lo, hi]}]
  tips.js             app.tips.select(metrics) -> up to two {id, text}
  pauses.js           app.pauses, human-owned (T08); agents never touch it
  screens/practice.js results.js history.js progress.js onboarding.js
  manifest.json  sw.js  icons/   (T10)
```

Script order: `app.js`, `ui.js`, `store.js`, `api.js`, `passages.js`, `tips.js`, then the five screens. Classic `<script>` tags, no modules, no build, no CDN. Every file is an IIFE assigning exactly one `app.<name>`; `window.app` is the only global. Each file opens with a two-to-four line comment saying what it owns. Transcript and user text never go through `innerHTML`; build nodes with `app.ui.el`.

Contracts (exact names):

- `app.router.go(name, params)`, `app.router.current()`. A screen registers `app.screens[name] = { mount(root), show(params), hide() }`; `app.js` calls `mount` once at boot with its `<section id="screen-<name>" class="screen">`, then `show`/`hide` on each hash change. A module never touches DOM outside its `root`; shared data goes through `app.store` and route params.
- `app.store.save(session) -> Promise<id>`, `list()` newest first, `get(id)`, `remove(id)`, `getFlag(key)`, `setFlag(key, value)`. Session: `{id, createdAt, passageId, passageTitle, durationSeconds, metrics, transcript}`; `metrics` is the backend dict unchanged, `transcript` the backend word list `[{text, start, end}]`. Audio is never stored.
- `app.api.analyze(blob, contentType) -> Promise<{transcript, metrics}>`; rejects with an `Error` whose `.kind` is `"network" | "too_short" | "provider" | "unknown"` and whose `.message` is the matching string in section 8.
- `app.ui.el(tag, attrs, children)`; `renderState(root, {kind, title, body, actionLabel, onAction})`, kind `"empty" | "error" | "loading"`; `clear(root)`; `announce(text)` writes the `.sr-only` live region; `formatClock(seconds) -> "1:05"`; `formatDate(iso) -> "Oct 9, 10:21 PM"`.
- Practice keeps its state in one string, `app.screens.practice.state`; one `render(state)` function is the only code that touches that screen's DOM.

## 3. Layout and spacing

Single column, phone first. `main` is `max-width: 640px; margin: 0 auto; padding: var(--s-4) var(--s-4) calc(var(--nav-h) + var(--s-5) + env(safe-area-inset-bottom))`. Never horizontal scroll at 320px; transcript uses `overflow-wrap: anywhere`.

```
--s-1: 4px;  --s-2: 8px;  --s-3: 12px;  --s-4: 16px;
--s-5: 24px; --s-6: 32px; --s-7: 48px;
--r-card: 12px; --r-btn: 10px; --r-tok: 4px; --r-chip: 999px;
--nav-h: 56px;
```

Only these values for margin, padding and gap. Rhythm: section gap `--s-6`, card gap `--s-3`, label-to-value `--s-1`. No shadows; separation is `--surface` on `--bg` plus a 1px `--border`. `.metric-grid` is `display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3)`; four columns at `min-width: 600px`.

## 4. Color tokens

Declare on `:root`, override under `@media (prefers-color-scheme: dark)`. Raw hex exists only in this block. `body` sets `background: var(--bg); color: var(--text)`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0F1115` | page |
| `--surface` | `#F4F5F7` | `#1A1D24` | cards, nav, chips |
| `--text` | `#111318` | `#F2F4F7` | primary text |
| `--muted` | `#5B6270` | `#9AA3B2` | labels, hints |
| `--border` | `#D9DDE3` | `#2A2F3A` | 1px lines |
| `--grid` | `#E4E6EA` | `#2B3038` | chart gridlines |
| `--accent` | `#2457F5` | `#6B93FF` | primary buttons, active nav, focus ring, chart wpm |
| `--on-accent` | `#FFFFFF` | `#0F1115` | text on accent |
| `--accent-soft` | `#E3ECFA` | `#1E2C44` | tip card background |
| `--record` | `#E5484D` | `#FF6369` | record button, recording dot, errors, delete |
| `--record-bg` | `#FEE2E2` | `#3F1414` | error block background |
| `--filler` | `#B45309` | `#FBBF24` | filler token text, chart fillers |
| `--filler-bg` | `#FEF3C7` | `#3B2A05` | filler token background |
| `--pause` | `#6D28D9` | `#B49CFF` | pause marker text, chart pauses |
| `--pause-bg` | `#EDE9FE` | `#2A1F4D` | pause marker background |
| `--ok` | `#15803D` | `#4ADE80` | in-target pace hint |
| `--warn` | `#B45309` | `#FBBF24` | out-of-target pace hint |

Red appears only on the record button, recording dot, error blocks and Delete. `<meta name="theme-color">` is `--bg` per scheme.

## 5. Type scale

`font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Every number uses `font-variant-numeric: tabular-nums`.

```
--fs-hero:   64px / 1.0 / 700   timer on Practice
--fs-metric: 40px / 1.0 / 700   metric card value
--fs-h1:     24px / 1.2 / 700   screen title (one per screen)
--fs-h2:     18px / 1.3 / 600   section title, passage title
--fs-body:   16px / 1.5 / 400   transcript, passage text, body
--fs-small:  14px / 1.4 / 500   labels, chips, nav, hints
--fs-micro:  12px / 1.3 / 500   uppercase labels, timestamps (letter-spacing 0.04em)
```

Body never goes below 16px. Metric labels are full phrases: "Words per minute", "Fillers per minute", "Pauses over 1.5 s", "Longest pause".

## 6. Component inventory

Class names are exact (`block__part`, `block--modifier`).

**Buttons** `.btn`: `min-height: 48px; padding: 0 var(--s-5); border-radius: var(--r-btn); font: 600 var(--fs-body); display: inline-flex; align-items: center; justify-content: center; gap: var(--s-2)`. Variants: `.btn--primary` (accent bg, on-accent text; one per screen), `.btn--secondary` (surface bg, text color, 1px border), `.btn--ghost` (transparent, accent text), `.btn--danger` (transparent, `--record` text and 1px border; Delete only), `.btn--block` (width 100%). Disabled: `opacity: .5`, ignores clicks.

**Record button** `.btn-record`: 88px circle, `--record` bg, centered, `--s-6` below the timer. Idle: white 28px microphone SVG; recording: white 24px rounded square. `aria-pressed` mirrors recording; `aria-label` is "Start recording" or "Stop recording". `.btn-record__label` (small, 600) below reads "Record" or "Stop".

**Timer** `.timer`: `--fs-hero`, centered, text `0:00`, `aria-live="off"` (announcements use `app.ui.announce`). **`.rec-dot`**: 8px `--record` circle before the timer, `opacity 1 -> .3` 1s pulse.

**Metric card** `.metric-card` (surface, border, `--r-card`, padding `--s-4`): `.metric-card__label` (micro, uppercase, muted), `.metric-card__value` (metric size), `.metric-card__unit` (small, muted, inline: "wpm", "per min", "s"), `.metric-card__hint` (small; `--ok` or `--warn`, always words: "Target 140 to 160", "Slow down"). Results shows exactly four, in order: words per minute (`metrics.words_per_minute` rounded), fillers per minute (total fillers / (duration / 60), one decimal), pauses (`metrics.pauses.length`), longest pause (one decimal).

**Transcript** `.transcript`: a `<p>` at body size, `line-height: 1.8`. Every word is `<span class="tok">` plus a space. `.tok--filler`: filler text and bg, `padding: 0 var(--s-1)`, radius `--r-tok`, weight 600, `aria-label="um, filler word"`. A word is a filler when its lowercased, punctuation-stripped text is one of `um uh hmm like so basically actually`, or starts the phrase `you know` (both words get the class). `.tok--pause`: an inline marker, not a word, inserted after the last word whose `end <= at` for each `[at, length]` in `metrics.pauses`: pause text and bg, radius `--r-chip`, `padding: 0 var(--s-2)`, micro size, text `2.1 s pause`, `aria-label="pause, 2.1 seconds"`. Repeats are not styled; they appear in tips only.

**Chips** `.chip`: `<button>`, `min-height: 44px; padding: 0 var(--s-4); border-radius: var(--r-chip); font: 500 var(--fs-small)`, surface bg, 1px border. `.chip--selected`: accent bg, on-accent text, `aria-pressed="true"`. `.chip-row`: horizontal flex, `gap: var(--s-2)`, `overflow-x: auto`. Used for the passage picker and the Progress metric toggle.

**Passage card** `.passage-card`: surface, `--r-card`, padding `--s-4`, `max-height: 40vh; overflow-y: auto`. `.passage-card__title` (h2), `.passage-card__target` (micro, muted, "Target 140 to 160 wpm"), `.passage-card__text` (body, line-height 1.6). Free-talk prompts use the same card.

**Tip card** `.tip-card`: `--accent-soft` bg, 4px `--accent` left border, `--r-card`, padding `--s-4`, body text; one tip each, at most two.

**Session row** `.session-row` (History): a full-width `<button>`, `min-height: 64px`, bottom border, flex. Left: `.session-row__title` (passage title, small, 600) over `.session-row__date` (micro, muted). Right: `.session-row__stats`, tabular, `152 wpm · 3.1 per min`. Beside it a `.btn--ghost` "Delete" (`aria-label="Delete session from <date>"`); first tap swaps it to "Delete? Yes / No" (`.btn--danger` Yes, `.btn--ghost` No).

**State block** `.state` (centered column, `padding: var(--s-7) var(--s-4)`, `max-width: 320px`, margin auto): `.state__icon` (32px inline SVG, muted), `.state__title` (h2), `.state__body` (body, muted, at most two sentences), `.state__action` (`.btn--primary` for retry, `.btn--secondary` otherwise). `.state--empty`; `.state--error` (`--record-bg` bg, `--record` title, `--r-card`, `role="alert"`); `.state--loading` (icon replaced by `.spinner`: 24px ring, `border: 3px solid var(--border); border-top-color: var(--accent)`, 1s rotation, `role="status"`). Only `app.ui.renderState` builds these.

**Nav** `<nav class="nav" aria-label="Main">`: fixed bottom, `height: calc(var(--nav-h) + env(safe-area-inset-bottom))`, surface bg, 1px top border, three `<a class="nav__item">` flex columns (flex 1, `min-height: 56px`): `.nav__icon` 24px SVG over `.nav__label` micro. `.nav__item--active`: `--accent`, `aria-current="page"`; inactive `--muted`.

**Chart** `.chart`: inline SVG `viewBox="0 0 320 200"`, `width: 100%`. Gridlines `--grid` 1px, axes `--border`, labels micro `--muted`. One `<polyline>` at a time, `stroke-width: 2`, 4px circle points, colored by series: wpm `--accent`, fillers per minute `--filler`, pauses `--pause`; chosen by the chip row. `role="img"` with an `aria-label` naming series, latest value and session count; a `.sr-only` `<table>` lists the numbers.

**`.sr-only`**: the standard visually-hidden rule.

## 7. Recording states (Practice)

`<section class="screen" id="screen-practice" data-state="idle">` carries one of four values. CSS shows and hides children by `[data-state]`; `render(state)` sets the attribute and text.

| State | Timer | Record button | Chips | Below | Nav |
|---|---|---|---|---|---|
| `idle` | `0:00`, muted | mic, "Record" | enabled | `.practice__hint` "Tap to record. Stop uploads automatically." | visible |
| `recording` | counting, text color, `.rec-dot` | stop, "Stop" | disabled | passage text stays readable | hidden |
| `uploading` | final value held | hidden | disabled | `.state--loading` "Analyzing your speech" / "Usually 5 to 15 seconds." No cancel. | hidden |
| `error` | last value | mic, "Record" | enabled | `.state--error`, fixed message, one action | visible |

Mic permission is requested on the first record tap, never on load. Stopping under 5 s goes straight to `error`; nothing is uploaded. The blob stays in memory through `uploading` and `error` so Retry re-sends it.

## 8. Fixed copy

- Mic denied: "Microphone is blocked. Allow it in your browser settings, then tap Record." Action "Try again" (back to idle).
- Network: "Could not reach the server. Your recording is still here." Action "Retry upload".
- Provider (502) or unknown: "Analysis failed on our side. Your recording is still here." Action "Retry upload".
- Too short: "That was under 5 seconds. Try again." Action "Record again".
- History empty: "No sessions yet" / "Your first recording will show up here." Action "Record".
- Progress under two sessions: "Need two sessions" / "Record one more to see a trend." Action "Record".
- Results bad id: "Session not found". Action "History".

Copy: second person, present tense, under 15 words a sentence, no exclamation marks, no blame.

## 9. Accessibility

- Tap targets are at least 44 x 44px; interactive elements are real `<button>` or `<a>`.
- `:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px }` everywhere; never `outline: none` without a replacement.
- The `.sr-only` region with `aria-live="polite"`, written only by `app.ui.announce`, says "Recording started", the elapsed time every 30 seconds, "Recording stopped, 42 seconds", and "Results ready".
- Color never carries meaning alone: fillers are bold with labels, pause markers contain text, pace hints use words. Every text pair above is at least 4.5:1 in both schemes.
- `@media (prefers-reduced-motion: reduce)` stops the `.rec-dot` pulse and the spinner rotation.
- Icons are inline SVG, `aria-hidden="true"`, beside visible text or an `aria-label`. One `h1` per screen, `h2` for sections. Tab order top to bottom, nav last.
- `lang="en"`, viewport `width=device-width, initial-scale=1`, no `user-scalable=no`. Layout survives 200% zoom.

## 10. Done checklist for any screen

Tokens only, spacing from the scale. One `.screen` with the required id, registered with `mount/show/hide`. Every empty, loading and error state built by `app.ui.renderState` and reachable (document how in `frontend/README.md`). One `.btn--primary` per screen. Correct at 320px and 640px, light and dark. No console errors, no globals beyond `app`.
