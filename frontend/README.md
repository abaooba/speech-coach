# Speech Coach frontend

Plain HTML, CSS and JavaScript served by the FastAPI backend. The design spec is
`DESIGN.md`; automated checks live in `tests/` and run with `node --test frontend/tests`
from the repository root.

## Module responsibilities

Each script `index.html` loads is an IIFE that assigns exactly one `app.<name>`. Every script
opens with a short comment, four to eight lines, saying what it owns and what it must not do.
`DESIGN.md` section 2 holds the full contracts; this table is the map.

| File | Export | Owns and promises |
|---|---|---|
| `app.js` | `app.router` | Creates `window.app` (with an empty `app.screens`) and owns the hash router. `go(name, params)` sets the hash to `#/<name>` or `#/<name>/<id>`; `current()` returns `{name, params}` for the hash, and Practice for an unknown one. At boot it applies the saved theme, mounts every registered screen once, then routes, to Onboarding on a first launch. Each route names the tab after the screen's h1 and highlights that screen's nav item, the Path's on a level (`#/level/<playId>`). |
| `ui.js` | `app.ui` | The DOM helpers every screen builds from. `el(tag, attrs, children)` builds nodes, never markup; `renderState(root, {kind, title, body, actionLabel, onAction, icon, secondaryLabel, onSecondary})` is the only builder of the empty, error and loading blocks; `clear(root)` empties a node; `announce(text)` writes the live region; `formatClock(seconds)` gives "1:05" and `formatDate(iso)` "Oct 9, 10:21 PM". Also `formatDay`, `icon` and the theme helpers `getTheme`, `applyTheme`, `setTheme`, `nextTheme`. `icon(name, size)` builds a named icon in `currentColor`, or null for an unknown name: among them `flame`, beside the Path's week and the rank card's streak, and for the Loop Path `route` (the shape of the nav's Path item), `lock`, `flag`, `crown`, `clock`, `play`, `stop`, `lightbulb`, `external-link`, `chevron-left`, `calendar`, `close` and `user`. A state block's `icon` may name any icon `icon` draws, as the Level screen's `lock`, `moon`, `calendar` and `check` do. |
| `auth.js` | `app.auth` | The optional account (docs/PLAN.md T49). `signUp(email, password)` and `logIn(email, password)` resolve the account's email and sign this device in; `logOut()`, `deleteAccount()` and `me()` (the email, or null for a guest) talk to `/api/auth/*` and `/api/me`. A failure rejects with an `Error` whose `.kind` names it and whose `.message` is the matching sentence in `messages`: one uniform "Email or password is wrong.", "Too many tries. Wait 15 minutes, then try again." for a 429 and "Accounts are not available right now." for a 503. `request(method, url, body)` is the one way the account's routes are called: the session cookie goes along (same origin) and every change is sent as JSON. It reads as no reply when the server says nothing for 20 seconds, but a reply whose body keeps arriving is read whole, and a request that sends a big body (an import batch is up to 1.9 MB) gets a millisecond more for every 8 bytes, a 64 kbit/s uplink. `logOut()` sends the queued writes first, waiting 10 seconds at most; the rest wait for the account's next sign in on this device. A log out the server could not record (a 503 while accounts are off) still signs the device out, and `me()` later ends that session rather than sign the account back in from its cookie, until someone logs in here. `guestImportOffer()`, `importGuestTakes()` and `declineGuestImport()` ask an account once about each guest take on this device. `syncStatus()` resolves `{endedSession, takesNotKept}` for the account screen and History: `endedSession` is `{email, takesHere}` once the server has ended this device's session (any 401) and until someone signs in, and `takesNotKept` counts the signed-in account's takes the server refused. `keepEndedTakesHere()` lets that ended account go, for a speaker who cannot log in again. It loads before `store.js`, which connects its sync here (`connectStore`). |
| `store.js` | `app.store` | IndexedDB on the device. `save(session)` resolves with the new id, `list()` is newest first, then `get(id)` and `remove(id)`; `getFlag(key)` and `setFlag(key, value)` keep small settings such as `onboarded`; `markLevelCleared(levelId, clearedAt)` and `listClearedLevels()` keep the Loop Path's records (a level such as `fillers-3`, a passed check-back `fillers-3_cb1`, a crown tier `fillers_crown-2`, a checkpoint `fillers_checkpoint`), each at its first clearing, `clearedAt` now unless given. A session holds metrics and transcript, the `topic` it was said on when it had one and, for a Path take, `path` (`{play, kind, take, scored, passed, stage, inRoom}`), from which the Path reads attempts, misses and benchmark sittings; never audio: `save` refuses a session carrying `blob` or `audio`. For a guest nothing else happens and nothing is sent. Signed in through `auth.js`, the same eight functions also sync with the server (backend/sessions_api.py): saves (with their `topic` and `path`), deletes and cleared levels go through to it, with IndexedDB as the offline copy; `list()`, `get(id)` and `listClearedLevels()` merge the server's, and fall back to the device's own with no reply; a write the server misses waits in a queue (in the flags store) and goes up on the next load or when the device is back online. Each account's copies on the device, and the levels it clears, show to that account alone, never to a guest or another account; a take the server refuses (409 once the account is full) stays the account's, on this device only. Signing out keeps them for the next sign in. When the server ends the session (a 401: 30 days have passed, `SESSION_SECRET` changed, or the account was deleted elsewhere) the device is a guest's and sends nothing, but the account's takes still show until someone signs in, so a take recorded just before still opens; guest takes recorded meanwhile are offered to the account when it logs back in. The first list after a log in may come from an account made again under the same email, so when that list holds none of the takes recorded here, the ones it leaves out stay, as the device's own; otherwise they were deleted on another device, and go. Deleting the account keeps the takes recorded here (sent or not) and its levels as the device's own, and removes the copies of takes from other devices. Signed in, `list()` waits at most a second for the server's list (20 seconds on a device that has never listed the account) and otherwise answers with the device's copy, which the server's list updates for the next one. |
| `api.js` | `app.api` | The one call to the backend. `analyze(blob, contentType, script)` posts to `POST /api/analyze` and resolves with `{transcript, metrics}`; a `script` with words goes along as the form field `script`, and `metrics.script` then lists restarts, skipped and misread script words (the backend drops a script the take does not follow and scores it as free talk). A failure rejects with an `Error` whose `.kind` is one of four: `network` (no reply, or still open after three minutes), `too_short` (400), `provider` (502) or `unknown` (any other failure). `messages` holds the fixed sentences for the first three; `unknown` reads as `provider`. |
| `passages.js` | `app.passages` | The fixed practice material, everyday only (no debate), `[{id, kind, title, text, targetWpm: [lo, hi], source?, timeLimitSeconds?, topics?}]`: timed prompts (the Talk tab) first, then passages (the Read tab). `coldReads()` returns a new list of the cold reads (`coldRead: true`), original everyday passages that the Path's Restarts levels 1 to 4 and their check-backs read and no tab lists. `benchmark()` returns new `{read, talk}` objects, the Path's benchmark: the passage "Benchmark read" and the 90-second prompt "Benchmark talk", which no tab lists and no other take practices. `retired()` returns new `{id, kind, targetWpm, timeLimitSeconds?}` objects for the ids old takes still carry after the debate entries left Practice on 2026-10-14, so an old take keeps its band and time limit; nothing shows them. No DOM. |
| `delivery.js` | `app.delivery` | The filler rules. `analyze(words, metrics)` re-scores a stored take into the delivery report that Results, tips and Progress read; `classify(words)` labels each word `"hesitation"`, `"habit"` or null; `isHesitation(text)` tests one word. Also the `HESITATION`, `HABIT` and `HABIT_WORDS` constants. Pure: no DOM, no store. |
| `rank.js` | `app.rank` | Owner-written (docs/PLAN.md T36). `takeScore(report, targetWpm)` scores one take from 0 to 100 from its `app.delivery` report and pace band; `rating(history)` averages the newest 10 takes, weighted by length and pulled toward 40; `tier(rating, history)` names it from `TIERS` (Novice, Contender 40, Varsity 60, Elite 75, Champion 88, Master 96, and Flawless 99, which also needs each of the last 10 takes to run 2 minutes or more, score 97 or more and hold no long pause); `streak(history, today)` gives `{current, longest}`, the days in a row with a take. Pure: no DOM, no store. Results and the rank card read it; the Path and the Level screen never do. |
| `rankcard.js` | `app.rankCard` | The rank card, "ladder and lens" (docs/PLAN.md T37), on Progress and Results only. `model(takes, options)` works out everything it shows, reading the rank only through `app.rank` and scoring each take with `app.screens.results.summarize` against its own band; it is pure (no clock, DOM or store). Samples and undated takes never count, and it returns null with no rated take, without rank.js or results.js, or on Results for a sample. Progress passes `{screen: "progress", today}` and gets the streak foot; Results passes `{screen: "results", takeId}` and gets the card as it stood after that take, with the change line, the notch and the take's foot sentences. `build(model, {screen})` draws it node by node, the wedge with `createElementNS`; nothing in it takes focus. |
| `path.js` | `app.path` | The Loop Path's data and rules (docs/superpowers/specs/2026-10-14-loop-path.md, which overrides docs/PLAN.md T42 and T43). `UNITS` holds Restarts, Fillers, Long pauses and Pace, each five levels and a checkpoint after level 5, with a crown beside level 3 for Fillers and Pace; a level is a loop of goal, take 1, review and take 2, which counts. `playById(playId, {baseline, cleared})` gives a play, everything the Level screen shows (a loop `fillers-3`, a check-back `fillers-3_checkback`, a crown `fillers_crown`, a checkpoint `restarts_checkpoint` or `benchmark`), and `takeAt` one take of it, retries included. `measure(report, setSeconds)` and `baseline(history)` read the numbers every rule reads; `evaluate(play, takeIndex, report, context)` judges one take against its rule and its guards and lists the records a pass keeps; `order(history)` puts the weakest unit first. `statusOf`, `attemptsLeft` (3 scored attempts a local day), `ringOf`, `checkbacks`, `crownState`, `checkpointState`, `benchmarkState` and `weekDays` read the cleared records and the saved takes' `path` fields; `materialFor`, `pickTopic`, `pickColdRead` and `topFillers` pick what a take is said or read on. Pure: no DOM, store, clock or Math.random; a day is a local `"YYYY-MM-DD"` string the caller passes in (`localDay`, `addDays`). |
| `loop.js` | `app.loop` | The Level screen's pure helpers (spec section 8), which read the rules only through `app.path`: `stepsFor(play)` (Goal · Take 1 · Review · Take 2 · Result for a two-take loop), `feedbackFor` (take 1's number against its target, the change line such as "1.4 fewer than Tuesday" and, on a live-tap level, "You caught 3 of 5 live."), `momentsFor` (up to three moments, earliest first, with the words around each slip), `matchTaps` with `SPOT_IT_WINDOW` and `LIVE_TAP_WINDOW`, `fillerTimes`, `clipFor` (what "Play 3 s" plays: from 1 s before the moment, never before 0), `dateText` and `whenText` (days in words), and `WHAT_HAPPENED`, the review's four choices. No DOM, store, clock or Math.random. |
| `tips.js` | `app.tips` | `select(report, options)` returns at most two `{id, text}` rule tips in priority order; pure. `coachNotes(session, report, targetWpm, tier)` is the one request to `POST /api/advice` (docs/PLAN.md T41): it resolves `{tips: [{entryId, text, drill, citation: {label, url, type}}], source}` (`source` is `"ai"` when Claude wrote the notes for the take, `"library"` when the library's own words stand in) or null, and never rejects. It asks through `app.auth.request`, so a signed-in speaker's cookie goes along and the server keeps their shown entries; for everyone it keeps a reply Claude wrote under the flag `coachNotes:<id>`, so that take is asked about once (the library's own words are shown but not kept, so a later visit asks again), and the entry ids shown under `coachNotesShown`, oldest first and at most 2,000, which the next request sends so a guest sees each entry once while new ones remain. That list is read again when a reply lands and written one reply at a time, so two takes answered together both add their ids, and a take asked about again while its request is open gets that request's promise instead of a second request. `adviceRequest` and `parseCoachNotes` are the pure halves: the request body with whole counts, a real pace band and a 1,500-character excerpt, and the reply checked so only web links are drawn. |
| `pauses.js` | `app.pauses` | Human-owned (T08); agents never edit it. `start(stream)` samples the microphone's loudness while a take records, `stop()` hands the samples back, and `reconcile(metrics, samples)` folds the quiet stretches into the backend's pauses. |
| `screens/practice.js` | `app.screens.practice` | `mount`, `show`, `hide`, plus `startLevelTake(request)`, `render(state, detail)` (the one function that repaints the screen), the `state` string (`idle`, `recording`, `uploading` or `error`), `STATES`, `viewFor` and `selectedPassage`. Records a take, uploads it through `app.api` and saves it through `app.store`, with the topic on screen as its `topic` for a prompt with topics. `startLevelTake(request)` (spec section 7) holds one take's request from the Level screen and goes to `#/practice` in level mode: a banner with the request's eyebrow, title and body and "Leave level" takes the place of the Talk / Read switch and the chips; New topic, the script box and "See a sample result" hide; the card shows the request's material and the clock its `seconds`; with `liveTap`, "Heard one" counts taps while the take records. Record, Stop and every error behave as in normal mode. A saved level take never opens Results: Practice calls `request.judge` before the save and `request.onSaved` after it, with the blob, which it then keeps no reference to; "Leave level" calls `request.onLeave`. |
| `screens/results.js` | `app.screens.results` | `mount`, `show({id})`, `hide`, plus the pure helpers `summarize`, `buildTranscriptPlan`, `headlineFor`, `compareWithPrevious`, `timelineSegments`, `speechMapRows` and `isSample`, which touch no DOM. `show` draws the take at once with its rule tips, again with the "vs last take" lines and the rank card once `app.store.list()` answers, and a third time with the "Coach notes" from `app.tips.coachNotes` in the tips' place when they arrive. The one list rates the takes up to and including this one for the card (`app.rankCard`; a sample gets none, and a first take, with nothing to compare, is drawn again for its card alone) and gives the speaker's tier for the notes request (from `app.rank` when rank.js is loaded, else Novice). That third draw says "Coach notes ready." through `app.ui.announce` and, when keyboard focus was inside the body it rebuilds, moves focus to the Coach notes heading (`tabindex="-1"`). `hide` drops any draw still on its way, so a screen the speaker has left is never redrawn and never speaks. |
| `screens/history.js` | `app.screens.history` | `mount`, `show`, `hide`, plus `formatStats(session)` and the pure `statusFor(summary)`. Once the server has ended this device's account session (`app.auth.syncStatus`), a small line above the rows says to log in again from Account. |
| `screens/progress.js` | `app.screens.progress` | `mount`, `show`, `hide`, plus the pure `series`, `scale` and `summaryFor`. `show` draws the rank card first (`app.rankCard`, its streak counted to now), above the metric switch, or above "Need two sessions" with one take; with no rated take, or a card that cannot be built, Progress draws as it did before the card. |
| `screens/path.js` | `app.screens.path` | `#/path`, the Path: `mount`, `show`, `hide`, plus the pure layout helpers `nodeX`, `dropD` and `linkD`. Each `show` reads `app.store.list()` and `app.store.listClearedLevels()` and draws what `app.path` decides: this week's practice days and a chip for the check-backs due today, the benchmark, then one block per unit, weakest first, whose level nodes wind down the page, each a button that opens a small card; every Start opens `#/level/<playId>`. "Loading your path" shows only until a first path is drawn, and a store that fails shows "Path unavailable". It shows no rank, tier, rating or rank streak. |
| `screens/level.js` | `app.screens.level` | `#/level/<playId>`, one play step by step: `mount`, `show`, `hide`. `mount` puts a "Path" back link before the h1, and `show` sets the h1 to the play ("Fillers, level 1"). The screen keeps one run in memory (`{playId, baseline, material, takes, choices, fix, audio}`), hands each take to Practice through `app.screens.practice.startLevelTake(request)`, judges it with `app.path.evaluate`, keeps a pass's records through `app.store.markLevelCleared` (one `clearedAt` for all of them), and plays take 1 back from memory for the review: `AudioContext.decodeAudioData` on the first Play tap, else an `<audio>` element on an object URL. The run ends, and take 1's audio is released, when the Result shows, the speaker leaves the level, another play starts, or a route leaves both Practice and this play; a reload starts the level again at Goal. A play that cannot start says why in a state block. It shows no rank, tier, rating or rank streak. |
| `screens/account.js` | `app.screens.account` | `#/account`, reached from the "Account" link in History's header (it has no nav item). `mount`, `show`, `hide`, plus `COPY`, every string on the screen. A guest signs up or logs in; signed in, the speaker sees who they are, how many takes the server did not keep, the offer to add this device's takes (asked once about each), Log out, and Delete account behind a second tap. Once the server has ended this device's session, the form opens on Log in with that email filled in, and a card offers to keep the account's takes recorded here on the device instead. One line says what the server keeps: each take's metrics and transcript, never audio, until the account is deleted. It talks only to `app.auth`. |
| `screens/onboarding.js` | `app.screens.onboarding` | `mount`, `show`, `hide`, plus `COPY`, every string on the screen. |
| `sw.js` | none | The service worker, which runs in its own scope with no `app`. It caches the app shell (`SHELL`) so the app opens offline, and never touches `/api/`. Its cache is `CACHE_NAME`, `speech-coach-shell-v4` since the Loop Path's files joined `SHELL`; activate deletes older ones. |
| `how.html` | none | The static "How we measure" page, with no script, linked from the Results transcript legend. Its last section, "The Path", explains the levels, check-backs, crowns, checkpoints and the benchmark, with their sources. |

**Screens.** Every screen registers `app.screens[name] = { mount(root), show(params), hide() }`.
`app.js` calls `mount(root)` once at boot with the screen's `<section id="screen-<name>"
class="screen">`, then `show(params)` each time a route lands on it (`params.id` is the session
id on Results and the play id on Level) and `hide()` when a route leaves it. `index.html` holds
eight sections: Onboarding, Practice, Results, History, Progress, Path, Level and Account. The
`screen__body` rule: each section holds exactly one `div.screen__body`
(`backend/tests/test_frontend_shell.py` checks it), and the screen draws its content, state
blocks included, inside it, so the `h1` above it (and Practice's header) stays put. The Level
screen adds one thing outside its body, the "Path" back link it puts above its `h1` once at
mount, and names that `h1` after the play. A screen touches nothing outside its own section;
shared data goes through `app.store` (the account through `app.auth`) and route params, and the
Level screen hands each take to Practice through `app.screens.practice.startLevelTake`. The nav
holds four items, Practice · Path · Progress · History: none is highlighted on Results or
Account, the Path's is on a level, and the nav hides on Onboarding and while a take records or
uploads.

**Script load order.** `index.html` loads classic `<script>` tags (no modules, no build step, no
CDN) in this order, fixed by `backend/tests/test_frontend_shell.py`: `app.js`, `ui.js`,
`auth.js`, `store.js`, `api.js`, `passages.js`, `delivery.js`, `rank.js`, `rankcard.js`,
`path.js`, `loop.js`, `tips.js`, `pauses.js`, then `screens/practice.js`, `screens/results.js`,
`screens/history.js`, `screens/progress.js`, `screens/path.js`, `screens/level.js`,
`screens/account.js` and `screens/onboarding.js`. `app.js` comes first because it creates
`window.app`; `auth.js` comes before `store.js`, which connects its sync to it as it loads; and
`passages.js` comes before `path.js`, which reads the ladder passage as it builds its units.
Every `<script src>` is also listed in `SHELL` in `sw.js` (`backend/tests/test_pwa_files.py`).

**Two rules every script keeps.**

- `window.app` is the only global. Each file adds its one `app.<name>` and nothing else to
  `window`.
- Transcript text, like any text from the speaker or the backend, never goes through `innerHTML`.
  Nodes are built with `app.ui.el`, where text becomes a text node, and SVG with
  `createElementNS`. `backend/tests/test_frontend_shell.py` fails if `innerHTML` or `outerHTML`
  appears in any frontend script except the human-owned `pauses.js`.

**Tests.** From the repository root:

```bash
node --test frontend/tests
```

Plain `node:test`, no dependencies: each test loads the scripts into a `node:vm` sandbox with a
small fake DOM. `pytest` runs the same suite through `backend/tests/test_frontend_node.py` when
`node` is installed.

## Manual checks

Start the server with a real speech-to-text key in `.env` and open http://127.0.0.1:8000/
in Chrome. `.env` is read when the server starts, so restart uvicorn after changing it.

```bash
.venv/bin/uvicorn backend.app:app --reload
```

Every block in the table is built by `app.ui.renderState` inside the screen's
`div.screen__body`, so the screen's h1 stays above it; the rows whose state says "not a block"
are parts a screen draws itself. On Practice the block takes the record zone under the card: the
timer, the record button and its "Record" label hide, and an error block's red title takes
keyboard focus (press Tab once to reach its button). On Results, History, Progress, Path and
Level the block sits centered between the heading and the nav, its button as wide as the block.
"Empty the store" is the first DevTools snippet under the table; "Path records" and "Hold or fail
the store" set up the Path and Level rows.

| Screen | State | How to trigger | Expected copy |
|---|---|---|---|
| Practice | Uploading | Tap Record, allow the microphone, speak about 10 seconds, tap Stop. DevTools network throttling ("Slow 4G") holds the state longer. | Spinner, "Analyzing your speech" / "Usually 5 to 15 seconds." No button. Results opens when the reply arrives. |
| Practice | Microphone blocked | Click the lock icon in the address bar, set Microphone to Block, reload, tap Record. | "Microphone blocked" / "Microphone is blocked. Allow it in your browser settings, then try again." Button "Try again". |
| Practice | Too short | Tap Record, then Stop before 5 seconds; the Network tab shows no request to `/api/analyze`. Or record 8 seconds and speak only in the first 2: the backend answers 400. | "Too short" / "That was under 5 seconds. Try again." Button "Record again", never "Retry upload". |
| Practice | Upload failed, network | Tap Record, stop uvicorn (Ctrl-C) while recording, tap Stop. | "Upload failed" / "Could not reach the server. Your recording is still here." Button "Retry upload", then a ghost "Record a new take". |
| Practice | Upload failed, provider | Set `STT_PROVIDER=bogus` in `.env`, restart uvicorn, record 10 seconds, tap Stop. Restore `STT_PROVIDER` and restart afterwards. | "Upload failed" / "Analysis failed on our side. Your recording is still here." Button "Retry upload", then a ghost "Record a new take". |
| Practice | Sample unavailable | In DevTools tick Application > Service workers > "Bypass for network", block the URL pattern `sample-session.json` under More tools > Network request blocking, tap "See a sample result". | "Sample unavailable" / "Could not load the sample. Try again." Button "Try again". |
| Practice | Level banner (not a block) | Empty the store, open the Path, tap Start on Fillers level 1, then "Record take 1" (the Level walkthrough, steps 1 and 2). | In the place of the Talk / Read switch and the chips, a card reading "Path: Fillers, level 1", "Take 1 of 2", "Talk for 60 s. Take 2 counts: 8 or fewer fillers a minute, or halfway there from take 1." and "Leave level". New topic, the script box and "See a sample result" are gone; the card shows "Your day" with a topic, and the clock "/ 1:00". |
| Practice | Leave level (not a block) | From the level banner, tap "Leave level" in idle or under an error block; it hides while a take records or uploads. Opening another screen from the nav in idle leaves the level too. | Practice in normal idle: the switch, the chips and "See a sample result" are back, and focus on "Leave level" moves to the selected Talk / Read option. Nothing more is saved, and Start on the Path opens the level again at a fresh Goal. |
| Practice | Upload failed, level mode | From the level banner, tap Record, stop uvicorn (Ctrl-C) while recording, tap Stop. | Under the banner, "Upload failed" / "Could not reach the server. Your recording is still here." Button "Retry upload", then a ghost "Record a new take", with "Leave level" back in the banner. With uvicorn running again, Retry hands the take back to the level, never to Results; "Record a new take" keeps the banner for a new take at 0:00; "Leave level" drops the take with the level. |
| Results | Session not found | Open `#/results/nope`. The same block shows for `#/results` with no id and for a deleted session's id. | Magnifying glass, "Session not found" / "It may have been deleted." Button "History", which opens `#/history`. |
| History | No sessions yet | Empty the store, tap "Start practicing", open `#/history`. Deleting the last session in History shows it too. | Microphone, "No sessions yet" / "Your first recording will show up here." Button "Record", which opens Practice. |
| Progress | Need two sessions, one take | Empty the store, tap "Start practicing", save one session (store round trip, step 1), open `#/progress`. A sample is not a take: tap "See a sample result" on Practice, come back, and the same block shows. | Chart, "Need two sessions" / "Record one more to see a trend." Button "Record", which opens Practice. The rank card sits above the block: "Contender", "40.1", "19.9 to Varsity" and "Current streak 1 day, longest 1" for the store round trip's take. |
| Progress | Need two sessions, no take | Empty the store, tap "Start practicing", open `#/progress`. | Chart, "Need two sessions" / "Record two sessions to see a trend." Button "Record". No rank card. |
| Path | Loading | Reload on Practice, run "Hold the store" (Hold or fail the store), then open `#/path`. Reload to undo. | Spinner, "Loading your path" / "This takes a moment." No button. Only a first draw shows it: a later visit keeps the drawn path up until the new one is ready. |
| Path | Path unavailable | Reload on Practice, run "Fail the store", then open `#/path`. | Alert triangle, "Path unavailable" / "Could not load your path. Try again." Button "Try again", which reads the store again: run "Restore the store" first and the path draws, focus on its first heading. |
| Level | Loading | As for the Path's Loading, but open `#/level/fillers-1`. | Spinner, "Loading your level" / "Reading your past takes." No button, and the h1 already reads "Fillers, level 1". A store that fails shows no error here: with "Fail the store" the level opens at Goal, as a new speaker's. |
| Level | Level not found | Open `#/level/nope`. | h1 "Level", magnifying glass, "Level not found" / "Pick a level on the path." Button "Back to path", which opens `#/path`. The Path nav item is highlighted. |
| Level | Not open yet | Empty the store, then open `#/level/fillers-3`. | Lock, "Not open yet" / "Clear level 2 first." Button "Back to path". `#/level/fillers-3_checkback` reads "Clear level 3 first.", and `#/level/fillers_crown` and `#/level/fillers_checkpoint` "Clear the levels before it first." |
| Level | Back tomorrow | Miss Fillers level 1 three times in one day ("Not yet", then "Try take 3" and "Try take 4"), or empty the store and run "Three misses today" (Path records). Open `#/level/fillers-1`. | Moon, "Back tomorrow" / "This level opens again tomorrow." Button "Back to path". The third miss's Result ends with "This level opens again tomorrow." over a primary "Back to path", and on the Path the node shows a moon and "Back tomorrow", its card "This level opens again tomorrow." with no Start. |
| Level | Not due yet | Empty the store, run "Cleared today" (Path records), open `#/level/fillers-1_checkback`. | Calendar, "Not due yet" / "Check-back 1 is due Friday, Oct 16." (two days after the level was cleared, here on Wednesday, Oct 14). Button "Back to path". |
| Level | Locked in | Empty the store, run "Locked in" (Path records), open `#/level/fillers-1_checkback`. | Check, "Locked in" / "Both check-backs passed. Nothing is left to check." Button "Back to path". On the Path the node wears a full gold ring, its card "Cleared Oct 14." and "Locked in Oct 14." (the day the snippet ran). |
| Level | Take 1's audio gone (not a block) | A reload never shows it: it starts the level again at Goal, and take 1 goes with the run. Instead, start Fillers level 1, tap "Record take 1" and Record, say "um" at least three times, stop uvicorn while recording and tap Stop. Tap History in the nav, which ends the run, then Practice: the Upload failed block is back under the banner. Start uvicorn, tap "Retry upload", then "Review 3 moments (30 s)". | The level opens on take 1's feedback. Under "Look at 3 moments", "Take 1's audio is gone: it is kept only while this level is open." stands where the "Play 3 s" buttons would; the moments, their "What happened?" chips, "Your fix for take 2" and "Say it again" stay. |
| Account | Checking | Open `#/account` with DevTools network throttling at "Slow 4G". | Spinner, "Checking your account" / "This takes a moment." No button. |
| Account | Accounts not available | Run uvicorn without `DATABASE_URL` (accounts off), open `#/account`. | Plain circle, "Accounts are not available right now" / "Your takes stay on this device, and everything else works as before." Button "Practice". Every other screen works as a guest's. |
| Account | Could not reach the server, guest | Load the app once, stop uvicorn, open `#/account` (the service worker serves the page). | "Could not reach the server" / "Check your connection, then try again." Button "Try again", which checks again and moves focus to the first line of what it shows. |
| Account | Could not check your account | Sign up, then restart uvicorn with `DATABASE_URL` pointing at a SQLite file in a folder that does not exist: the startup logs the fault and goes on, and `GET /api/me` with the session cookie answers 500. Open `#/account`. To see a guest's block, first clear the site's IndexedDB in the Application tab, keeping the cookie. | Signed in: the account view, with "Something went wrong on our side. Try again." as the note under "Signed in as", never "You are offline". A guest: alert triangle, "Could not check your account" / "Something went wrong on our side. Try again." Button "Try again". |
| Account | Session ended | Sign up, record a take, then end the session: delete the account from a second browser (log in there, Delete account), or delete the `sc_session` cookie in DevTools. Open `#/account`. | "Your session has ended. Log in again to sync your takes." over the switch on "Log in", the email filled in, and a blue card "Cannot log in? Keep the 1 take recorded here on this device, without the account." with a ghost "Keep on this device", which keeps the take here as the device's own and brings back the plain sign-up form. |
| History | Session ended note | As for Account, Session ended, then open `#/history`. | The account's takes still listed, under the small muted line "Your session has ended. Log in again from Account to sync your takes." |

### DevTools snippets

Run each line in the DevTools console on the app, waiting for it to resolve before the next.

**Empty the store.** A first launch opens Onboarding whatever the hash:

```js
indexedDB.deleteDatabase('speech-coach')
```

Reload, tap "Start practicing", then open the hash the check names.

**Onboarding flag.** After "Start practicing",

```js
await app.store.getFlag('onboarded')
```

prints `true`. To see Onboarding again, run `await app.store.setFlag('onboarded', false)` and
reload.

**Store round trip.**

1. Save one session:

   ```js
   await app.store.save({passageId:'free-talk', passageTitle:'Your day', durationSeconds:12, metrics:{words_per_minute:150, duration:12, word_count:30, fillers:{um:1}, pauses:[], repeats:[], pace_windows:[]}, transcript:[]})
   ```

   It resolves with a new id string.

2. Reload the page, then list:

   ```js
   await app.store.list()
   ```

   It shows one record. Save a second session and list again: the newer record comes first.

3. Remove the record using the id from step 1 (or from the listed record), then list again:

   ```js
   await app.store.remove(id)
   await app.store.list()
   ```

   The list is empty.

4. Flags round-trip:

   ```js
   await app.store.setFlag('onboarded', true)
   await app.store.getFlag('onboarded')
   ```

   The second line prints `true`.

5. Passages are loaded:

   ```js
   app.passages.length
   ```

   It prints `11`: five timed prompts, then six passages. `app.passages.coldReads().length`
   prints `15`, the cold reads, which no tab lists, and `app.passages.benchmark().read.title`
   prints `'Benchmark read'`, the Path's benchmark passage, which no tab lists either.

**Progress seed.** Five sessions with varied numbers, one per day over the last five days.
Each lasts one minute, so the `um` count is also the fillers-per-minute value, and `pauses`
is the pause count:

```js
for (const [daysAgo, wpm, um, pauses] of [[5,128,4,1],[4,141,3,2],[3,137,2,2],[2,152,1,0],[1,158,1,1]]) {
  await app.store.save({createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString(), passageId:'free-talk', passageTitle:'Your day', durationSeconds:60, metrics:{words_per_minute:wpm, duration:60, word_count:wpm, fillers:{um}, pauses:Array.from({length:pauses}, (_, k) => [10 + 10 * k, 2]), repeats:[], pace_windows:[]}, transcript:[]})
}
```

**Live region log.** Prints every announcement while you work:

```js
new MutationObserver(() => console.log('live:', document.getElementById('live').textContent)).observe(document.getElementById('live'), {childList: true, characterData: true, subtree: true})
```

**Path records.** Each one sets up a state of Fillers level 1. Empty the store first, since a
level cleared again keeps its first date, then open `#/path` or the level again.

- Cleared today:

  ```js
  await app.store.markLevelCleared('fillers-1')
  ```

- Cleared two days ago, so check-back 1 is due today:

  ```js
  await app.store.markLevelCleared('fillers-1', new Date(Date.now() - 2 * 864e5).toISOString())
  ```

- Locked in: both check-backs passed (leave out `'fillers-1_cb2'` for the half ring):

  ```js
  for (const id of ['fillers-1', 'fillers-1_cb1', 'fillers-1_cb2']) await app.store.markLevelCleared(id)
  ```

- Three misses today, take 2, then takes 3 and 4, so the level rests until tomorrow (History
  lists them as three "Your day" rows):

  ```js
  for (const take of [2, 3, 4]) await app.store.save({passageId:'free-talk', passageTitle:'Your day', durationSeconds:60, metrics:{words_per_minute:150, duration:60, word_count:150, fillers:{um:12}, pauses:[], repeats:[], pace_windows:[]}, transcript:[], path:{play:'fillers-1', kind:'loop', take, scored:true, passed:false, stage:null, inRoom:null}})
  ```

**Hold or fail the store.** Reload the page on Practice, then keep the real list:

```js
const realList = app.store.list
```

"Hold the store" leaves every list waiting, so a loading block stays up:

```js
app.store.list = () => new Promise(() => {})
```

"Fail the store" makes every list fail:

```js
app.store.list = () => Promise.reject(new Error('test'))
```

"Restore the store" puts the real list back (a reload does too):

```js
app.store.list = realList
```

### Hands-on checks (human)

A night session cannot run these: each needs a real browser, a microphone or a person at the
keyboard.

- Retry upload re-sends the same take: trigger "Upload failed, network", start uvicorn again
  and tap "Retry upload". Results opens with the words you said before the failure, and
  nothing asked for the microphone again.
- Microphone denied: tap Record and close the permission prompt with its X instead of
  Allow. The Microphone blocked block shows; "Try again" returns to idle with the record
  button back, and the next Record tap shows the prompt again. With Microphone set to Block
  the prompt cannot come back: set it to Ask and the next tap prompts.
- No sideways scroll: at 320px wide (DevTools device toolbar), in light and in dark (the
  theme toggle on Practice), every row of the table above leaves
  `document.documentElement.scrollWidth === 320` true in the console.
- Live region: with the live region log running, a take logs "Recording started", "0:30" and
  "1:00" for a take past a minute, "Recording stopped, N seconds" and "Results ready". New
  topic logs the new topic, a theme tap "Theme: Dark", "Theme: Light" or "Theme: Auto", a
  delete "Session deleted". An error block logs nothing: its alert role speaks it. A take for a
  Path level logs no "Results ready"; each new step of the level logs instead, such as "Step 3
  of 5: Review. Take 1" and "Step 5 of 5: Result. Level cleared", and "Start planning" on Long
  pauses level 1 logs "Planning for 30 seconds.", then "Planning time is up." or, after Skip,
  "Planning skipped.".
- Reduced motion: DevTools > Rendering > "Emulate CSS media feature prefers-reduced-motion:
  reduce". The red dot beside the clock stops pulsing while recording and the uploading
  spinner stops turning.
- Keyboard: press Tab from the top of each screen. Focus moves top to bottom, the nav comes
  last, and every focused control shows a blue ring.
- Console: no errors on any screen, including `#/results/nope`, `#/level/nope` and an empty
  History. One network line is expected: a guest's visit to `#/account` asks `GET /api/me`,
  which answers 401 (503 with accounts off), and Chrome logs every 4xx and 5xx reply as
  "Failed to load resource". That is the server saying "not signed in", not an error in the
  page.
- Two devices (needs the deployed app with `DATABASE_URL` set): sign up on the phone, record a
  take, then log in on a laptop. History, Progress, the Path and the take's Results match the
  phone's. Delete the account on the laptop: at its next sync the phone is a guest's but still
  lists its takes, History says the session has ended, and Account offers Log in or "Keep on
  this device". Guest mode still records and saves with the network off.
- Replay (needs a phone, so the deployed app): run a Fillers level to its review. Each "Play
  3 s" plays its moment of take 1 with sound, one clip at a time, and nothing plays until a
  tap.

## Screen walkthroughs

**Onboarding (about one minute).** Empty the store and reload.

1. The Onboarding screen shows under its "Speech Coach" heading, with no nav: the line
   "Record a practice speech. Get your pace, pauses and filler words in seconds.", three
   items, each after an icon (a microphone, a magnifying glass, a chart), the muted line
   "Audio is deleted right after analysis. During a Path level, take 1 stays in this phone's
   memory for replay. It is deleted when the level ends. Coach notes send the first 1,500
   characters of your transcript to Anthropic." and a full-width "Start practicing" button.
   The tab reads "Speech Coach" and nothing has focus.

2. Tap "Start practicing": Practice shows with the nav. Reload: Practice opens directly, and
   the onboarding flag snippet prints `true`.

**Practice (about one minute).** Start the server as under Manual checks.

1. Talk and Read: Practice opens on the Talk tab with "Your day 1:00" selected. The chips
   read "Your day 1:00", "Impromptu 2:00", "Interview answer 1:30", "Explain something 2:00"
   and "Tell a story 2:00", and the card shows "Talk about the best part of your day and why it
   stood out." Tap "New topic" at the card's top right: the next topic shows, and after the
   eighth the first comes back. Every prompt has eight topics. Tap "Read": the chips become the
   six passages (no times), starting with "Explainer: how rainbows form" and "Story: the wrong
   train", and the card shows the passage
   and New topic is gone. Tap "Talk": "Your day" is still selected, on the topic you left.
   Under the clock a timed chip shows "/ 1:00" and an empty bar; a passage shows neither.

2. Happy path: tap Record. The microphone prompt appears now, not on page load. Allow it,
   speak for about 10 seconds (the timer counts with the red dot pulsing to its left while the
   clock stays centered, the bar under it fills toward the limit, the nav and "See a sample
   result" disappear and the card grows into their room, and the hint reads "Tap Stop when you
   finish. It uploads right away."), then tap Stop. While recording, the tabs, the chips and
   New topic are disabled; the selected tab and chip stay readable. "Analyzing your speech"
   shows with a spinner under the held timer; the record button and its label are both hidden.
   The hash becomes `#/results/<id>`, and in the console:

   ```js
   await app.store.list()
   ```

   returns one session whose `metrics.words_per_minute` is a number, whose `passageTitle` is
   the chip's title ("Your day"), not the topic, and whose `topic` is the topic the card
   showed. A passage's take has no `topic`.

3. Time limit: record "Your day" past 1:00. At the limit the bar stays full and turns rust,
   the clock keeps counting ("1:05 / 1:00") and the take goes on until you tap Stop.

4. Record a new take: trigger "Upload failed, network" and tap "Record a new take" instead of
   Retry upload. Practice returns to idle with the record button back, the clock at 0:00 and
   the bar empty, and nothing is uploaded. Coming back from Results also starts at 0:00 with
   an empty bar.

5. Small phones: in the DevTools device toolbar at 375 x 667, idle shows the whole "Your day"
   topic, the record button, "Record", the hint and "See a sample result" above the nav with
   no page scroll. At 320 x 568 the card still shows the whole topic, two lines above its fade:
   the hint and the sample button hide, the record button shrinks and the gaps under the card
   tighten, so the button and its label sit above the nav with no page scroll. Tap Record: the
   nav hides and the card grows into its room. An error block from the table takes the card's
   place too, so the whole block, both actions included, sits above the nav with no page
   scroll; the selected chip still names the option. In landscape (667 x 375) the card keeps
   those two lines, the sample button stays, and the page scrolls. At 200% zoom (187 x 333)
   the card keeps its two lines, the hint and the sample button hide as on a small phone, and
   the page scrolls.

6. Theme toggle: the icon right of "Speech Coach" is a half-filled circle for Auto, and a
   screen reader names it "Theme: Auto. Switch to dark." Tap it: the page turns dark whatever
   the device setting, the icon becomes a moon and the live region says "Theme: Dark". Tap
   again for Light (a sun, "Theme: Light"), and again for Auto (the device setting decides).
   Reload: the choice is kept. The header stays one line, as tall as the "Practice" heading.

**Results (about two minutes).** Needs one saved session, so run the Practice happy path
first; the hash is then `#/results/<id>`. Without a microphone, Practice in idle shows "See a
sample result", which opens a sample take on this screen: "Sample: Explain something", a short
explanation of making coffee.

1. Under the "Results" heading: a muted line with the passage title and the date (for a timed
   prompt such as Explain something it ends with "· m:ss of 2:00"). Then the headline, two
   sentences in plain text: a bold strength after a green check and a focus after a blue
   arrow, such as "Your longest clean stretch is 4.9 seconds." and "Next take, cut fillers
   under 3 a minute." Then the speech map (step 4), then one strip of four stats, two per row
   on a phone and four across from 480px, in this order: "Pace", "Fillers", "Pauses", "Clean
   stretch". Hesitation sounds (um, uh) are not counted as words. The Pace hint reads "Target
   lo to hi" in green with a check when the pace is inside the passage's range, or "Slow
   down" / "Speed up" in rust with a warning triangle outside it; the numbers come from the
   passage you recorded (Gettysburg and Patrick Henry are 130 to 150, the explainer and the
   story 150 to 170, Explain something 130 to 160, Your day 140 to 160). An old take saved on
   a retired debate entry keeps the band it was recorded under. The Fillers stat shows "/min"
   and its hint reads "Target under 3" in green at 3 or less and "Aim for under 3" in rust
   above. The Pauses stat reads "1 pause" or "3 pauses", and its hint counts the freezes,
   "0 over 5 s" in green or "1 over 5 s" in rust. The Clean stretch stat shows seconds and reads "Target 15 s" in green from 15 s, or
   "Aim past 15 s" in rust. Every cell has the same rows, so the four stay level. Then the
   rank card (step 8), its big number labelled "Rating" above "This take scored 34.". No nav
   item is highlighted.

2. Compare with the last take: record a second take (the Practice happy path again), or run
   the Progress seed snippet and open the newest row in History. Every stat ends with a small
   grey line, a triangle or a dash and words such as "12 faster", "1.2 fewer" or "No change",
   and "Arrows compare with your last take." sits under the strip. The very first session in
   the store shows neither. A take saved without words (the store round trip, or the seed)
   reads "Not compared" after a dash on the Clean stretch cell. The sample is never compared: tap "See a sample result" after
   your takes, even twice, and its Results shows no grey lines, no note, no rank card and no
   "Fillers are down" headline. The next take you record compares with your take before the
   sample.

3. "Record again" sits alone in a bar stuck above the nav while the page scrolls under it;
   History is the nav's tab under the bar. Tap "Record again": Practice opens in idle. Use
   the browser's back button to return. With a keyboard, press Tab from the top of the page:
   the "How we count" link scrolls up above the bar with its whole focus ring in view, and
   the next Tab moves to "Record again" without moving the page. In landscape (568 x 320) or
   at 200% zoom on a phone (DevTools at 187 x 333 or 160 x 284) the bar is not stuck: the
   transcript and tips read through the whole window above the nav, and the bar sits at the
   end of the page, "Record again" inside the screen. Tabbing through the page there keeps
   every focused control, the bar's own included, with its whole ring clear of the nav.

4. Speech map: under the headline, a "Speech map" heading, then "0:00 · First word" beside a
   hollow ring, a grey rail that is linear in time with the take's moments stacked as two-line
   cards beside it, and "1:01 · Last word" beside a ring at the bottom, the same speaking time
   the meta line counts; every clock on the map counts from the first word. Every card is 56px
   tall, so six fit about one phone screen, the rail is exactly as tall as the stack, and a
   take with more than eight moments shows eight and a "Show all 12 moments" button that draws
   the rest (the moments past eight still mark the rail). Each moment's mark sits on the rail
   at its true second and a curve in its colour joins it to its card; the card's first line is
   the clock and the kind in that colour, its second the words around the moment with the
   moment marked as the transcript marks it, and a chevron sits at its right edge: the whole
   card is the control; its words start at the moment after at most one lead-in word, so the
   mark is in view on a 320px phone. An amber dot and "Filler" with the words around it,
   "…because, um, I put…" (fillers within 5 s of each other share a card, "3 fillers" over
   "um · like · you know"); a purple block as long as the pause and "Mid-sentence pause ·
   1.5 s" with "…piano, 1.5 s um, and…"; a pink block as long as the pause for each pause of
   5 s or more, even after a period, and its card reads "Long pause · 5.2 s" over "…sad. 5.2 s
   Mhm. I…"; a purple diamond and "Restart" with the abandoned start and the restart marked,
   "…I kinda ner— I'm kinda nervous though…"; a pale green block with a green edge for the
   longest clean stretch, "0:00 to 0:26 Clean stretch · 26.5 s" over "No filler, pause or
   restart." Tap a card: the page scrolls so the mark sits mid-window, the mark
   flashes a blue ring for a moment (no fade with reduced motion), focus lands on it, and
   VoiceOver says "Shown in transcript." (each card's hidden text names the action). A screen
   reader hears the list's label, "Speech map from 0:00 to 0:30: 11 fillers, 3 mid-sentence
   pauses, 1 restart, a 4.9 second clean stretch", with "1 long pause" after the mid-sentence
   count when there is one, and then every card as one sentence. End a sentence and stay
   silent for 6 seconds: the map draws the pink block and the card reads "Long pause · 6.0 s".
   A session saved with an empty transcript shows no map.

5. Transcript: under the rank card, a "Transcript" heading, a small legend and every word of the
   take. The legend reads "Highlighted words are hesitations: um, uh, mhm. Underlined words
   are verbal habits.", names the most-used habit (for example "Most used: “like”, 4 times.")
   and ends with a "How we count" link to `how.html`. Hesitations ("um", "uh", "er", "ah",
   "hm", and "mhm", "uh-huh", "mm-hmm") get an amber highlight. Verbal habits ("like", "so",
   "you know", "actually", "basically") get a dotted underline, and only where the context
   rules count them: "I like this plan" is not marked. When a long pause is marked the legend
   adds "Pink outlined pills are long pauses of 5 s or more.". Each mid-sentence pause of 1.5 s or
   more is a purple pill such as "2.1 s pause" right after the word before the gap. A pause
   of 5 s or more is marked wherever it falls, even after a period, as an outlined pink pill
   such as "6.0 s long pause". A shorter pause after a period is not marked, so the
   transcript, the Pauses stat and the speech map always show the same pauses.
   Record 10 seconds, say "um" five times and stop talking for 3 seconds mid-sentence: five
   amber "um" tokens and one "x.x s pause" pill. A session saved with an empty transcript
   (the store round trip) shows no Transcript section at all.

6. Tips: a "Tips" heading with one or two cards, chosen in this order. Tips that point at
   moments name them as m:ss, such as "0:42". Record 10 to 15 seconds doing one thing at a
   time:

   - "You are above target pace." Read the passage faster than its top target plus 15 wpm
     (over 175 wpm on Your day).
   - "You are under target pace." Read slower than the bottom target minus 15 wpm (under
     125 wpm on Your day).
   - "Fillers at 0:02, 0:05 and 0:09. Next take, close your mouth and pause instead." Say
     "um" three or more times in 15 seconds (more than 3 a minute); the tip names when the first
     three came, then "and N more". A take saved without words reads "Replace um with a silent
     beat." instead.
   - "You said “like” 3 times. Drop it and let the sentence land." Use one verbal habit
     ("like", "basically") three times.
   - "A pause in the middle of a sentence ran past 3 seconds." Stop mid-sentence for 4
     seconds, then keep talking; silence before the first word or after the last one is not
     counted, and a pause at a period gets the next tip instead, once it reaches 5 seconds.
   - "You froze for 6.0 seconds at 0:04. Know how your next point opens." End a sentence,
     stay silent for 6 seconds, then keep talking.
   - "You restarted phrases 3 times." Say a word twice in a row ("the the") on three
     separate occasions; with more restarts the tip names that count.
   - "Clean run. No filler, habit or long pause stood out." None of the above. It gives no
     direction, so it never argues with the headline's "Next take" line.

   Talking fast and full of "um" shows two cards, pace first; a third problem is dropped.

   Coach notes: within a second or so (up to nine with `ANTHROPIC_API_KEY` set, while Claude
   writes) the "Tips" heading becomes "Coach notes" and the tip cards give way to one card
   holding two or three notes, a thin line between two. Each note has its text, "Drill:" and an
   exercise when the entry has one, then "Source:" with the citation as a link on the same line
   ("Lisa B. Marshall, Um, How Do I Stop, Ya Know, Using Um and Ah? (2017)", wrapping like the
   words around it at 320px) that opens in a new tab; a peer-reviewed source adds a green "Peer
   reviewed" pill after the link. The line under the heading reads "Written for this take by
   Claude, from the research library." when the key is set and the hour's budget of AI calls
   lasts, and "The research library's own words, picked for this take." otherwise. The Network
   tab shows one `POST /api/advice`; with the key set, open the same take again from History
   and there is none: Claude's notes are kept on the device. The library's words are not kept,
   so without the key that take asks again and shows entries it has not shown before. Record
   another take: none of its notes repeats an entry shown before. With VoiceOver on, Tab to
   "How we count" before the notes arrive: when they do, focus moves to the "Coach notes"
   heading and VoiceOver says "Coach notes ready."; leave for History first and nothing is said.
   Stop uvicorn and reopen a take without kept notes (a fresh id): the Tips stay, with no error.

7. Narrow the window to 320px (DevTools device toolbar): two stats per row with each number
   and its unit on one line, the date in the meta line never split, the speech map's cards
   inside the column with their clocks on the rail, the transcript wrapping with the pause
   pills staying on their line, no horizontal scroll, no console errors. At 1024px the column
   doubles into two: the speech map, the stat strip (four across) and the rank card on the
   left, the transcript and the coach notes on the right, and "Record again" is at most
   320px wide at the column's end. Switch the OS theme (or DevTools "Emulate CSS
   prefers-color-scheme: dark", or the theme toggle): the rust warnings, amber
   and purple marks and the green band stay readable on both backgrounds.

8. Rank card: empty the store, run the Progress seed snippet and open the newest row in
   History. Between the stat strip and the transcript sits the rank card. On the left: "Contender",
   "Up 3.0" in green after an up triangle, "53.3" at the metric size, a thin ruler of seven
   slices with Contender's taller and blue, a pale wedge from that slice down to a bar filled
   about two thirds of the way from "40" to "60", with a dark notch where the rating stood
   before this take, and "6.7 to Varsity". On the right, the ladder of all seven tiers, best
   first, from "Flawless" 99 down to "Novice" 0, Contender's row a blue pill. Under both: "This
   take scored 74. One 2-minute take scoring 87 or more reaches Varsity." Open the oldest row
   instead: the card stands as it did after that take, "First rated take" with no icon,
   "41.2", no notch, "18.8 to Varsity" and "This take scored 45. One 2-minute take scoring 98
   or more reaches Varsity." A screen reader hears "Your rank", "Tier: Contender", "Rating
   53.3 out of 100" and "6.7 points to Varsity, which starts at 60", then the ladder, from
   "Flawless, from 99" to "Contender, from 40, your tier" and "Novice, from 0"; nothing in the
   card takes focus. The sample shows no card.

**History (about one minute).** Needs two saved sessions: run the Practice happy path twice,
or save two with the store round trip. Then open http://127.0.0.1:8000/#/history.

1. At the right of the "History" heading, a small "Account" link opens `#/account`, which has
   no nav item: the nav keeps Practice, Path, Progress and History. Under the heading, one row
   per session, newest first: the passage title over
   the date, then the stats as `152 wpm · 3.1 /min` (the same numbers as that session's
   first two Results cards) and a status word with its icon. A green check reads "On
   target"; a rust warning triangle reads "Too slow", "Too fast" or "Fillers over 3", and
   two misses read "Too slow · Fillers over 3". Pace is judged against that passage's
   target range, ends included; fillers miss above 3 a minute. The store round trip's
   session (150 wpm, one "um" in 12 seconds, so 5 a minute) reads "Fillers over 3". A muted
   trash icon sits at the right of each row. The History nav item is highlighted.

2. Tap a row: the hash becomes `#/results/<id>` and Results shows that session, opened at
   the top of the page even when the list was scrolled, and the tab reads "Results · Speech
   Coach". With a keyboard, Enter on a row puts focus on the "Results" heading, so the next
   Tab goes into Results rather than to the nav. Use the browser's back button to return.

3. Tap the trash icon: it becomes "Delete?" with "Yes" and "No". Tap "No": the trash icon
   comes back and the row stays. Tap the trash icon on one row, then on another: the first
   row's trash icon comes back on its own, so only one row asks at a time.

4. Tap the trash icon, then "Yes": the row disappears and the others keep their order. In
   the console:

   ```js
   await app.store.list()
   ```

   no longer includes that session.

5. Keyboard and screen reader: Tab to a trash icon; it is named "Delete session from
   <date>". Press Enter: focus moves to "No", inside a group named "Delete session from
   <date>?". Press Enter on "No": focus returns to the trash icon. Open the prompt again,
   press Shift+Tab to reach "Yes" and press Enter: the live region says "Session deleted"
   and focus moves to the row now in that place (the new bottom row after deleting the
   bottom one), or to "Record" when no session is left. On a 320 x 568 window with five or
   more sessions, Tab down to the bottom row, open its prompt, then Shift+Tab back to the
   top. Each focused control scrolls fully into view, its whole blue ring clear of the nav
   and of the top edge.

6. Narrow the window to 320px: the stats and the status sit under the title and date,
   left-aligned, with the trash icon on the right. Open a prompt: "Delete? Yes / No" drops
   below the status, at the right, and nothing overlaps. No horizontal scroll, no console
   errors, even at 200% browser zoom, where the prompt wraps inside the row. From 480px the
   stats and the status move to the right of the title and date.
   Switch the OS theme (or DevTools "Emulate CSS prefers-color-scheme: dark"): the green
   and rust status words stay readable.

**Progress (about one minute).** Needs two saved sessions; a real trend needs more. Run the
Progress seed snippet, then open http://127.0.0.1:8000/#/progress.

1. Under the "Progress" heading: the rank card (step 6), then a segmented control of four
   options, "Pace" (selected), "Fillers", "Pauses" and "Clean", all on one row at 320px; then
   the heading "Words per minute", three summary cells and the chart. The cells read "Latest"
   158 wpm, "Best" 158 wpm (the most recent take inside the 140 to 160 band) and "From your
   average" "19 faster" with an up triangle. The chart has five blue dots joined by a line,
   gridlines at the round values 100, 120, 140 and 160, and a short date such as "Oct 5" under
   every dot, oldest on the left, the last one ending at the right edge. The best take wears a
   ring and a small "Best" label that does not touch the line. The Progress nav item is
   highlighted.

2. Tap "Fillers": that option is selected, the heading reads "Fillers per minute", the line
   and dots turn amber, the y labels read 0, 2, 4, 6, 8, 10 and the dots fall 4, 3, 2, 1, 1.
   A green band shades 0 to 3 with a dashed line at 3, and under the chart a legend with a
   swatch of the band reads "Target under 3". The cells read 1.0 /min, 1.0 /min and "1.5
   fewer" with a down triangle; the ring sits on the last dot (ties go to the most recent take).
   Tap "Pauses": purple, the heading "Pauses", dots at 1, 2, 2, 0, 1, the ring on
   the 0, and "No change" with a dash. Tap "Clean": green, "Longest clean stretch"; these
   sessions have no words, so every value is 0.0 s. Open History and come back: the option you
   chose is still selected. Only the fillers chart has the band and the legend.

3. In the Elements panel the `<svg class="chart">` has `role="img"` and an `aria-label` such
   as "Words per minute over 5 sessions, latest 158"; under it a visually hidden table lists
   one row per session (number, date, value) with the caption "Words per minute by session".
   A screen reader reads the summary cells as text and then the table.

4. Run the seed snippet a second time (ten sessions, two a day): every session still gets a
   dot, and the x axis shows five dates spread from the first take to the last. A second take
   on a day that already has a label gets none. Then tap "See a sample result" on Practice and
   come back: History lists the sample, but the chart gains no dot, and neither the cells nor
   the rank card change.

5. Narrow the window to 320px: the four options fit on one row, "Latest" and "Best" sit side
   by side with "From your average" across the row under them, every value bold at the heading
   size on one line, and nothing scrolls sideways; the chart fills the width with readable
   labels. From 600px the three cells share one row, and at 640px the chart scales up with the
   column. Zoom to 200% on a phone (or narrow the window to 160px): the options form two rows
   of two, the cells stack, a long change such as "4.9 s longer" may wrap after the number, and
   still nothing scrolls sideways. Switch the theme with the toggle on Practice, or the OS
   setting: gridlines, labels, the band, the ring and all four line colors stay visible in both
   themes.

6. Rank card: with the seed alone in the store (empty the store first), the card above the
   options reads "Contender" over "53.3", the ruler with Contender's slice in blue, the bar
   about two thirds full from "40" to "60" and "6.7 to Varsity", beside the ladder of all seven
   tiers, best first, Contender's row a blue pill and Novice's mark filled. At its foot, a
   flame and "Current streak 5 days, longest 5"; once a whole day goes by with no take, it
   reads "No current streak, longest 5 days". Unlike on Results there is no change line and no
   notch. With one take the card sits above "Need two sessions"; with none, or only the
   sample, there is no card. Narrower than 320px (200% zoom on a phone) the ladder moves under
   the stats.

**Path (about two minutes).** Empty the store, reload, tap "Start practicing", then tap "Path"
in the nav, its icon two dots joined by an S curve.

1. The Path nav item is highlighted and the tab reads "Path · Speech Coach". Under the "Path"
   heading, "This week: 0 of 4 days" after a flame, plain text and never a button. With no
   benchmark sitting yet, the "Benchmark day" card follows: "Same passage, same prompt, every
   14 days. See your real progress.", "About 3 minutes" and a secondary "Start benchmark".
   Then four units, Restarts, Fillers, Long pauses and Pace: with no takes none is weaker, so
   they keep that order. Each opens with its card: the title, the subtitle ("Name it, spot it,
   catch it, pause instead" for Fillers) and the why line, which ends with its source, a link
   that opens in a new tab ("Brittany Pawlik, Christopher J. Perrin, Reducing speech
   disfluencies during public speaking using brief habit reversal (2020)" for Fillers). No
   rank, tier or rating shows anywhere on the Path.

2. Under each card the unit's steps wind left and right down the page, joined by a grey line:
   level 1 is current, a blue circle with "1"; levels 2 to 5 are outlined, each with a lock;
   last, in the centre, the checkpoint's flag, "Checkpoint: 2-minute new topic". Beside Fillers
   level 3 sits its crown, "Sudden death, optional", and beside Pace level 3 "180 wpm ladder,
   optional", both locked. Each unit's level 1 card is open from the start with its short goal
   and Start: "4 slips or fewer" for Restarts, "Halfway to 8 /min" for Fillers, "15 s clean"
   for Long pauses and "150 wpm, twice" for Pace. Only the first unit's Start is the blue
   primary button.

3. Tap Fillers level 2: its card, "Clear level 1 first.", opens beside it, and level 1's card
   closes, since a unit opens one card at a time; tap level 2 again to close it. The crown's
   card, "Clear level 3 first.", opens and closes on its own, so the crown never moves under the
   finger, and the checkpoint's reads "Clear level 5 first.". With a keyboard, Enter on a node
   opens its card and Escape closes it; Escape pressed inside a card also moves focus back to
   its node.

4. With a screen reader each node is one button named for what its circle and label show:
   "Fillers level 1, Name it, current", "Fillers level 2, Spot it, locked", "Fillers crown,
   Sudden death, optional, locked" and "Fillers checkpoint: 2-minute new topic, locked". Each
   Start names its play ("Start Fillers, level 1"), and each source link ends with ", opens in
   a new tab".

5. States from the store: empty the store, run one of the Path records snippets, then open
   `#/path` again. The dates are for a store set up on Wednesday, Oct 14.
   - Cleared today: Fillers level 1 is a green circle with a check, the line from it to level 2
     turns green, and level 2 is current, its card open on "8 or fewer /min". Tap level 1:
     "Cleared Oct 14." and "Check-back 1 is due Friday, Oct 16.", with no Start.
   - Check-back 1 due today: after the week line, a chip "Due today: 1 check-back: Fillers 1"
     with a clock, and a small clock badge on level 1's check, the node named "Fillers level 1,
     Name it, cleared, check-back due". Its card reads "Cleared Oct 12." and "Check-back 1 is
     due today." over a Start named "Start Fillers, level 1 check-back"; the chip starts the
     same check-back.
   - Locked in: the node wears a full gold ring and is named "Fillers level 1, Name it,
     cleared, locked in"; its card reads "Cleared Oct 14." and "Locked in Oct 14.". Without
     `'fillers-1_cb2'` the gold is an arc over the top half of the edge, the node named
     "Fillers level 1, Name it, cleared, check-back 1 passed" and its card "Check-back 2 is due
     Wednesday, Oct 21.".
   - Three misses today: the node shows a moon with "Back tomorrow" under its label and is
     named "Fillers level 1, Name it, back tomorrow"; its card reads "This level opens again
     tomorrow." with no Start.

6. The week line counts this week's days with a take, Monday to Sunday: "This week: 1 of 4
   days" after a take today, and "This week: 4 days, goal met" from the fourth day. After a
   benchmark sitting (Start benchmark, then its read and its talk) the benchmark card gives way
   to one line naming the next sitting, 14 days on, such as "Next benchmark: Wed, Oct 28"; from
   a second sitting a line under it compares the latest with the first, such as "Since your
   first: read slips 6 → 2, fillers 5.1 → 2.4 a minute".

7. Narrow the window to 320px: the steps still wind, every card inside the column, with no
   sideways scroll. At 200% zoom on a phone (DevTools at 187 x 333) each step stacks its node
   over its card at the left, and the lines between nodes are left out. Switch the theme:
   cleared nodes stay green, the current one blue and the gold rings rust orange, all visible
   in both themes.

**Level (about five minutes).** One Fillers level 1 run, with a microphone. Start the server as
under Manual checks, empty the store, tap "Start practicing", open the Path and tap Start on
Fillers level 1, whose card is open from the start.

1. Goal: the hash becomes `#/level/fillers-1`, the Path nav item stays highlighted and the tab
   reads "Fillers, level 1 · Speech Coach". The h1 reads "Fillers, level 1", under a "Path"
   link with a chevron that leads back to `#/path`; under the h1, "Name it", then the stepper
   Goal · Take 1 · Review · Take 2 · Result, Goal current and the others numbered. Under the
   "Goal" heading the target card reads "8 or fewer" in large type, then "fillers a minute, or
   halfway there from take 1" (with no takes there is no usual rate yet, so take 1 sets one)
   and "60 s, two takes"; a check before "Close your lips and pause. The plan costs less." and
   a cross before "Um, so, the plan, uh, costs less.", its "Um" and "uh" highlighted as
   fillers; then the unit's why line and "Source:" with its link. "Your top fillers" reads "No
   fillers counted yet. Take 1 will find yours." (with earlier takes it lists up to three, such
   as "um 12 times"). Last comes the primary "Record take 1".

2. Take 1: tap "Record take 1". Practice opens in level mode, its own nav item highlighted. In
   the place of the Talk / Read switch and the chips, a banner reads "Path: Fillers, level 1",
   "Take 1 of 2", "Talk for 60 s. Take 2 counts: 8 or fewer fillers a minute, or halfway there
   from take 1." and "Leave level"; New topic, the script box and "See a sample result" are
   gone. The card shows "Your day", "Target 140 to 160 wpm" and a topic, and the clock's limit
   reads "/ 1:00". Tap Record, talk for a minute with "um" at least three times (the nav and
   "Leave level" hide while it records) and tap Stop: "Analyzing your speech" shows as usual,
   but Results never opens. At 320 x 568 the banner tightens, "Leave level" beside its first
   line, and the record button still sits above the nav with no page scroll.

3. Feedback: the hash is back on `#/level/fillers-1`. The stepper shows Goal and Take 1 done,
   with checks, and Review current (a screen reader hears ", done" after each done step);
   focus is on the "Take 1" heading, and the live region says "Step 3 of 5: Review. Take 1".
   Take 1 set the target, halfway from its rate down to 8 (8 itself when take 1 had 8 or
   fewer a minute): after a take 1 at 12.0 fillers a minute the target card reads "10 or
   fewer" and "fillers a minute". The "Take 1" card shows "12.0", "fillers a minute" and
   "target 10", then "Three moments to look at": take 1's first three fillers, each its time
   and the two words either side, the filler highlighted, such as "0:12" and "so the, um, the
   plan". A speaker with an earlier talk also gets a change line, such as "1.0 fewer than
   yesterday", green after a down triangle when better, muted when not. Then the level's tip
   card, a lightbulb before the research library's advice and "Source:" with its link, and
   the primary "Review 3 moments (30 s)" ("Go to take 2" when take 1 had no filler).

4. Review: tap it. The heading "Look at 3 moments" has "about 30 s" beside it, and the live
   region says "Step 3 of 5: Review. Look at 3 moments". Each moment card holds its time, its
   words, "Play 3 s" and "What happened?" over four chips, "Lost my point", "Searching for a
   word", "Nerves" and "Planned breath". Tap "Play 3 s": take 1 plays from a second before the
   moment, for three seconds, and the button reads "Stop" with a square until it ends; a screen
   reader names it "Play 3 s at 0:12", then "Stop playing 0:12". While one clip plays, tap
   another moment's "Play 3 s": the first stops, so one clip plays at a time. Tap a chip to
   choose it, and again to clear it. Under the moments, "Your fix for take 2" offers "Pause
   instead of um", "Jot 3 points first", "Slow the first 3 words" and "Finish the sentence,
   don't restart", all optional. Then a lock before "Take 1's audio stays in this phone's
   memory for this level only, then it is deleted. It is never saved." and the primary "Say it
   again".

5. Take 2: choose "Pause instead of um" and tap "Say it again". Practice's banner reads "Take 2
   of 2" and "Your fix: Pause instead of um. Take 2 counts: 10 or fewer fillers a minute.",
   with take 1's target, over the same topic as take 1; with no fix chosen it reads "Talk for
   60 s. Take 2 counts: 10 or fewer fillers a minute.". Record a minute with fewer fillers and
   tap Stop.

6. Result: the stepper reaches Result, focus moves to its heading and the live region says
   "Step 5 of 5: Result. Level cleared". A green card under a big check reads "Level cleared",
   the verdict, such as "9.0 fillers a minute on take 2. The target was 10.", and the guard
   lines, each after a check, such as "Talked 58.3 s of 60", "141 wpm" and "Other slips
   steady". A take 2 at 8 or fewer a minute also clears level 2, and the card adds "Your take
   also cleared level 2.". Then "Check back": "A level counts when it sticks. One quick take on
   a new topic:" and two rows after calendar icons, check-back 1 two days on and check-back 2 a
   week on, such as "Friday, Oct 16: check-back 1" and "Wednesday, Oct 21: check-back 2, turns
   the node gold", "gold" in rust orange. Last, "Next" names "Fillers, level 2" and "Spot it, 8
   or fewer fillers a minute" (level 3 when level 2 was cleared too) over a primary "Start
   level 2" and "Back to path". A take 2 over its target shows "Not yet" instead: the verdict,
   such as "12.0 fillers a minute on take 2. The target is 10.", any failed guard in rust after
   the alert icon, "The one fix: Pause instead of um." and "Try take 3" beside "Back to path";
   the third miss in a day ends with "This level opens again tomorrow.".

7. Back to the Path: tap "Back to path". Fillers level 1 is a green check, the line from it to
   level 2 is green, and level 2 is current, its card open on "8 or fewer /min" (level 3, when
   take 2 cleared level 2 too). Tap level 1: "Cleared Oct 14." and "Check-back 1 is due
   Friday, Oct 16.", the day the Result named. The week line reads "This week: 1 of 4 days",
   and Fillers may now lead the Path: the units follow your latest takes, the one furthest from
   its target first. History lists both takes as "Your day" rows, and Progress and the rank
   card count them like any other take.

8. Leaving a level: start the Fillers level that is now current and record its take 1, then,
   on the Review, tap the Path nav item and Start it again: the level opens at a fresh Goal,
   since leaving ended the run and let take 1's audio go. A reload on any step does the same,
   and so does "Leave level" on Practice.

9. Narrow the window to 320px: the stepper's five steps share one row, and the cards, chips and
   buttons fit with no sideways scroll. At 200% zoom on a phone (DevTools at 187 x 333) the
   stepper wraps onto a second row.

**Account (about three minutes).** Accounts need a database. Locally a SQLite file does:
`DATABASE_URL=sqlite:///./accounts-dev.db .venv/bin/uvicorn backend.app:app --reload` (delete
the file afterwards). Use http://localhost:8000, where browsers keep the Secure session cookie
over plain http. Save two sessions as a guest first (store round trip), then open
http://localhost:8000/#/history.

1. Tap "Account" at the right of the History heading. The screen reads "An account keeps your
   takes on every device you use. Without one, they stay on this device.", then a "Sign up" /
   "Log in" switch (Sign up selected), Email and Password fields with "At least 10
   characters." under the password, a full-width "Create account" and, last, the line "Your
   account keeps each take's metrics and transcript on our server, never audio. Deleting the
   account here erases them." No nav item is highlighted.
2. Type an email and a 9-character password, then tap Create account: a rust line with the
   warning icon reads "Use a password of 10 to 256 characters." and nothing is sent (Network
   tab). Fix the password and send: "Signed in as" and the email, then a blue card "This
   device has 2 takes from before you signed in. Add them to your account?" with "Add to
   account" and "Keep on this device".
3. Tap "Add to account": the card reads "Added 2 takes to your account." In the Network tab
   one `POST /api/sessions/import` carried both. Open History: the same two rows. Reload and
   come back to Account: the card is gone for good (asked once per account).
4. Record a take (or save one with the store round trip): a `POST /api/sessions` follows the
   save, and History lists it. With DevTools offline, save another: History still lists it;
   go back online and the queued `POST /api/sessions` goes out by itself.
5. Tap "Log out": while takes queued on this device go up first (10 seconds at most) the button
   reads "Logging out", dimmed and still focused. Then the form comes back empty, on "Log
   in", focus on its first line. History
   now shows no rows: the account's takes show only to the account. Log in again: the rows
   are back. A wrong password reads "Email or password is wrong.", for an unknown email
   too; six wrong tries in a row read "Too many tries. Wait 15 minutes, then try again."
6. Tap "Delete account": it turns into "Delete your account and every take it keeps on our
   server? Takes recorded on this device stay here, for anyone who uses it." with a red
   "Delete account" and "Cancel", focus on Cancel. Cancel brings the button back. Confirm: the
   empty sign-up form comes back and the live region says "Account deleted". History lists
   the takes recorded on this device, as a guest's; copies of takes from other devices are
   gone from it, and nothing more is sent.
7. At 320px wide, light and dark: the fields and buttons fit with no sideways scroll, a long
   email after "Signed in as" wraps, and the History heading keeps its height with the
   Account link beside it.
8. Type a wrong password and press Enter on the focused "Log in" button: the warning line
   shows and focus stays on the button, so the next Tab goes on from there.
