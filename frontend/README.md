# Speech Coach frontend

Plain HTML, CSS and JavaScript served by the FastAPI backend. The design spec is
`DESIGN.md`; automated checks live in `tests/` and run with `node --test frontend/tests`
from the repository root.

## Module responsibilities

Each script `index.html` loads is an IIFE that assigns exactly one `app.<name>`. Every script
opens with a short comment saying what it owns and what it must not do: two to four lines, five
in the human-owned `pauses.js`. `DESIGN.md` section 2 holds the full contracts; this table is
the map.

| File | Export | Owns and promises |
|---|---|---|
| `app.js` | `app.router` | Creates `window.app` (with an empty `app.screens`) and owns the hash router. `go(name, params)` sets the hash to `#/<name>` or `#/<name>/<id>`; `current()` returns `{name, params}` for the hash, and Practice for an unknown one. At boot it applies the saved theme, mounts every registered screen once, then routes, to Onboarding on a first launch. |
| `ui.js` | `app.ui` | The DOM helpers every screen builds from. `el(tag, attrs, children)` builds nodes, never markup; `renderState(root, {kind, title, body, actionLabel, onAction, icon, secondaryLabel, onSecondary})` is the only builder of the empty, error and loading blocks; `clear(root)` empties a node; `announce(text)` writes the live region; `formatClock(seconds)` gives "1:05" and `formatDate(iso)` "Oct 9, 10:21 PM". Also `formatDay`, `icon` and the theme helpers `getTheme`, `applyTheme`, `setTheme`, `nextTheme`. |
| `auth.js` | `app.auth` | The optional account (docs/PLAN.md T49). `signUp(email, password)` and `logIn(email, password)` resolve the account's email and sign this device in; `logOut()`, `deleteAccount()` and `me()` (the email, or null for a guest) talk to `/api/auth/*` and `/api/me`. A failure rejects with an `Error` whose `.kind` names it and whose `.message` is the matching sentence in `messages`: one uniform "Email or password is wrong.", "Too many tries. Wait 15 minutes, then try again." for a 429 and "Accounts are not available right now." for a 503. `request(method, url, body)` is the one way the account's routes are called: the session cookie goes along (same origin) and every change is sent as JSON. It reads as no reply when the server says nothing for 20 seconds, but a reply whose body keeps arriving is read whole, and a request that sends a big body (an import batch is up to 1.9 MB) gets a millisecond more for every 8 bytes, a 64 kbit/s uplink. `logOut()` sends the queued writes first, waiting 10 seconds at most; the rest wait for the account's next sign in on this device. A log out the server could not record (a 503 while accounts are off) still signs the device out, and `me()` later ends that session rather than sign the account back in from its cookie, until someone logs in here. `guestImportOffer()`, `importGuestTakes()` and `declineGuestImport()` ask an account once about each guest take on this device. `syncStatus()` resolves `{endedSession, takesNotKept}` for the account screen and History: `endedSession` is `{email, takesHere}` once the server has ended this device's session (any 401) and until someone signs in, and `takesNotKept` counts the signed-in account's takes the server refused. `keepEndedTakesHere()` lets that ended account go, for a speaker who cannot log in again. It loads before `store.js`, which connects its sync here (`connectStore`). |
| `store.js` | `app.store` | IndexedDB on the device. `save(session)` resolves with the new id, `list()` is newest first, then `get(id)` and `remove(id)`; `getFlag(key)` and `setFlag(key, value)` keep small settings such as `onboarded`; `markLevelCleared(levelId)` and `listClearedLevels()` keep the skill path's cleared levels. A session holds metrics and transcript, never audio. For a guest nothing else happens and nothing is sent. Signed in through `auth.js`, the same eight functions also sync with the server (backend/sessions_api.py): saves, deletes and cleared levels go through to it, with IndexedDB as the offline copy; `list()`, `get(id)` and `listClearedLevels()` merge the server's, and fall back to the device's own with no reply; a write the server misses waits in a queue (in the flags store) and goes up on the next load or when the device is back online. Each account's copies on the device, and the levels it clears, show to that account alone, never to a guest or another account; a take the server refuses (409 once the account is full) stays the account's, on this device only. Signing out keeps them for the next sign in. When the server ends the session (a 401: 30 days have passed, `SESSION_SECRET` changed, or the account was deleted elsewhere) the device is a guest's and sends nothing, but the account's takes still show until someone signs in, so a take recorded just before still opens; guest takes recorded meanwhile are offered to the account when it logs back in. The first list after a log in may come from an account made again under the same email, so when that list holds none of the takes recorded here, the ones it leaves out stay, as the device's own; otherwise they were deleted on another device, and go. Deleting the account keeps the takes recorded here (sent or not) and its levels as the device's own, and removes the copies of takes from other devices. Signed in, `list()` waits at most a second for the server's list (20 seconds on a device that has never listed the account) and otherwise answers with the device's copy, which the server's list updates for the next one. |
| `api.js` | `app.api` | The one call to the backend. `analyze(blob, contentType, script)` posts to `POST /api/analyze` and resolves with `{transcript, metrics}`; a `script` with words goes along as the form field `script`, and `metrics.script` then lists restarts, skipped and misread script words (the backend drops a script the take does not follow and scores it as free talk). A failure rejects with an `Error` whose `.kind` is one of four: `network` (no reply, or still open after three minutes), `too_short` (400), `provider` (502) or `unknown` (any other failure). `messages` holds the fixed sentences for the first three; `unknown` reads as `provider`. |
| `passages.js` | `app.passages` | The fixed practice material, `[{id, kind, title, text, targetWpm: [lo, hi], source?, format?, timeLimitSeconds?, topics?}]`: timed prompts (the Talk tab) first, then passages (the Read tab). `coldReads()` returns a new list of the cold reads (`coldRead: true`), original passages for the skill path's cold-read mode that no tab lists. No DOM. |
| `delivery.js` | `app.delivery` | The filler rules. `analyze(words, metrics)` re-scores a stored take into the delivery report that Results, tips and Progress read; `classify(words)` labels each word `"hesitation"`, `"habit"` or null; `isHesitation(text)` tests one word. Also the `HESITATION`, `HABIT` and `HABIT_WORDS` constants. Pure: no DOM, no store. |
| `path.js` | `app.path` | The skill path (docs/PLAN.md T42): `UNITS`, four units of five challenge levels. `evaluate(level, report)` passes or fails a take with a sentence saying why, `order(history)` puts the weakest unit first, `isUnlocked`, `statusOf` and `currentLevel` read the cleared levels, and `pickColdRead(history, random)` picks a cold read the speaker has never read. Pure: no DOM, no store. |
| `tips.js` | `app.tips` | `select(report, options)` returns at most two `{id, text}` rule tips in priority order; pure. `coachNotes(session, report, targetWpm, tier)` is the one request to `POST /api/advice` (docs/PLAN.md T41): it resolves `{tips: [{entryId, text, drill, citation: {label, url, type}}], source}` (`source` is `"ai"` when Claude wrote the notes for the take, `"library"` when the library's own words stand in) or null, and never rejects. It asks through `app.auth.request`, so a signed-in speaker's cookie goes along and the server keeps their shown entries; for everyone it keeps a reply Claude wrote under the flag `coachNotes:<id>`, so that take is asked about once (the library's own words are shown but not kept, so a later visit asks again), and the entry ids shown under `coachNotesShown`, oldest first and at most 2,000, which the next request sends so a guest sees each entry once while new ones remain. That list is read again when a reply lands and written one reply at a time, so two takes answered together both add their ids, and a take asked about again while its request is open gets that request's promise instead of a second request. `adviceRequest` and `parseCoachNotes` are the pure halves: the request body with whole counts, a real pace band and a 1,500-character excerpt, and the reply checked so only web links are drawn. |
| `pauses.js` | `app.pauses` | Human-owned (T08); agents never edit it. `start(stream)` samples the microphone's loudness while a take records, `stop()` hands the samples back, and `reconcile(metrics, samples)` folds the quiet stretches into the backend's pauses. |
| `screens/practice.js` | `app.screens.practice` | `mount`, `show`, `hide`, plus `render(state, detail)` (the one function that repaints the screen), the `state` string (`idle`, `recording`, `uploading` or `error`), `STATES`, `viewFor` and `selectedPassage`. Records a take, uploads it through `app.api` and saves it through `app.store`. |
| `screens/results.js` | `app.screens.results` | `mount`, `show({id})`, `hide`, plus the pure helpers `summarize`, `buildTranscriptPlan`, `headlineFor`, `compareWithPrevious`, `timelineSegments` and `isSample`, which touch no DOM. `show` draws the take at once with its rule tips, again with the "vs last take" lines once `app.store.list()` answers, and a third time with the "Coach notes" from `app.tips.coachNotes` in the tips' place when they arrive; the one list also gives the speaker's tier for that request (from `app.rank` when rank.js is loaded, else Novice). That third draw says "Coach notes ready." through `app.ui.announce` and, when keyboard focus was inside the body it rebuilds, moves focus to the Coach notes heading (`tabindex="-1"`). `hide` drops any draw still on its way, so a screen the speaker has left is never redrawn and never speaks. |
| `screens/history.js` | `app.screens.history` | `mount`, `show`, `hide`, plus `formatStats(session)` and the pure `statusFor(summary)`. Once the server has ended this device's account session (`app.auth.syncStatus`), a small line above the rows says to log in again from Account. |
| `screens/progress.js` | `app.screens.progress` | `mount`, `show`, `hide`, plus the pure `series`, `scale` and `summaryFor`. |
| `screens/account.js` | `app.screens.account` | `#/account`, reached from the "Account" link in History's header (the nav keeps its three items). `mount`, `show`, `hide`, plus `COPY`, every string on the screen. A guest signs up or logs in; signed in, the speaker sees who they are, how many takes the server did not keep, the offer to add this device's takes (asked once about each), Log out, and Delete account behind a second tap. Once the server has ended this device's session, the form opens on Log in with that email filled in, and a card offers to keep the account's takes recorded here on the device instead. One line says what the server keeps: each take's metrics and transcript, never audio, until the account is deleted. It talks only to `app.auth`. |
| `screens/onboarding.js` | `app.screens.onboarding` | `mount`, `show`, `hide`, plus `COPY`, every string on the screen. |
| `sw.js` | none | The service worker, which runs in its own scope with no `app`. It caches the app shell (`SHELL`) so the app opens offline, and never touches `/api/`. |
| `how.html` | none | The static "How we measure" page, with no script, linked from the Results transcript legend. |

**Screens.** Every screen registers `app.screens[name] = { mount(root), show(params), hide() }`.
`app.js` calls `mount(root)` once at boot with the screen's `<section id="screen-<name>"
class="screen">`, then `show(params)` each time a route lands on it (`params.id` is the session
id on Results) and `hide()` when a route leaves it. The `screen__body` rule: each section holds
exactly one `div.screen__body` (`backend/tests/test_frontend_shell.py` checks it), and the screen
draws its content, state blocks included, inside it, so the `h1` above it (and Practice's header)
stays put. A screen touches nothing outside its own section; shared data goes through `app.store`
(the account through `app.auth`) and route params.

**Script load order.** `index.html` loads classic `<script>` tags (no modules, no build step, no
CDN) in this order, fixed by `backend/tests/test_frontend_shell.py`: `app.js`, `ui.js`,
`auth.js`, `store.js`, `api.js`, `passages.js`, `delivery.js`, `path.js`, `tips.js`, `pauses.js`,
then `screens/practice.js`, `screens/results.js`, `screens/history.js`, `screens/progress.js`,
`screens/account.js` and `screens/onboarding.js`. `app.js` comes first because it creates
`window.app`; `auth.js` comes before `store.js`, which connects its sync to it as it loads.
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
`div.screen__body`, so the screen's h1 stays above it. On Practice the block takes the record
zone under the card: the timer, the record button and its "Record" label hide, and an error
block's red title takes keyboard focus (press Tab once to reach its button). On Results,
History and Progress the block sits centered between the heading and the nav, its button as
wide as the block. "Empty the store" is the first DevTools snippet under the table.

| Screen | State | How to trigger | Expected copy |
|---|---|---|---|
| Practice | Uploading | Tap Record, allow the microphone, speak about 10 seconds, tap Stop. DevTools network throttling ("Slow 4G") holds the state longer. | Spinner, "Analyzing your speech" / "Usually 5 to 15 seconds." No button. Results opens when the reply arrives. |
| Practice | Microphone blocked | Click the lock icon in the address bar, set Microphone to Block, reload, tap Record. | "Microphone blocked" / "Microphone is blocked. Allow it in your browser settings, then try again." Button "Try again". |
| Practice | Too short | Tap Record, then Stop before 5 seconds; the Network tab shows no request to `/api/analyze`. Or record 8 seconds and speak only in the first 2: the backend answers 400. | "Too short" / "That was under 5 seconds. Try again." Button "Record again", never "Retry upload". |
| Practice | Upload failed, network | Tap Record, stop uvicorn (Ctrl-C) while recording, tap Stop. | "Upload failed" / "Could not reach the server. Your recording is still here." Button "Retry upload", then a ghost "Record a new take". |
| Practice | Upload failed, provider | Set `STT_PROVIDER=bogus` in `.env`, restart uvicorn, record 10 seconds, tap Stop. Restore `STT_PROVIDER` and restart afterwards. | "Upload failed" / "Analysis failed on our side. Your recording is still here." Button "Retry upload", then a ghost "Record a new take". |
| Practice | Sample unavailable | In DevTools tick Application > Service workers > "Bypass for network", block the URL pattern `sample-session.json` under More tools > Network request blocking, tap "See a sample result". | "Sample unavailable" / "Could not load the sample. Try again." Button "Try again". |
| Results | Session not found | Open `#/results/nope`. The same block shows for `#/results` with no id and for a deleted session's id. | Magnifying glass, "Session not found" / "It may have been deleted." Button "History", which opens `#/history`. |
| History | No sessions yet | Empty the store, tap "Start practicing", open `#/history`. Deleting the last session in History shows it too. | Microphone, "No sessions yet" / "Your first recording will show up here." Button "Record", which opens Practice. |
| Progress | Need two sessions, one take | Empty the store, tap "Start practicing", save one session (store round trip, step 1), open `#/progress`. A sample is not a take: tap "See a sample result" on Practice, come back, and the same block shows. | Chart, "Need two sessions" / "Record one more to see a trend." Button "Record", which opens Practice. |
| Progress | Need two sessions, no take | Empty the store, tap "Start practicing", open `#/progress`. | Chart, "Need two sessions" / "Record two sessions to see a trend." Button "Record". |
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

   It prints `10`: four timed prompts, then six passages. `app.passages.coldReads().length`
   prints `15`, the cold reads, which no tab lists.

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
  delete "Session deleted". An error block logs nothing: its alert role speaks it.
- Reduced motion: DevTools > Rendering > "Emulate CSS media feature prefers-reduced-motion:
  reduce". The red dot beside the clock stops pulsing while recording and the uploading
  spinner stops turning.
- Keyboard: press Tab from the top of each screen. Focus moves top to bottom, the nav comes
  last, and every focused control shows a blue ring.
- Console: no errors on any screen, including `#/results/nope` and an empty History. One
  network line is expected: a guest's visit to `#/account` asks `GET /api/me`, which answers
  401 (503 with accounts off), and Chrome logs every 4xx and 5xx reply as "Failed to load
  resource". That is the server saying "not signed in", not an error in the page.
- Two devices (needs the deployed app with `DATABASE_URL` set): sign up on the phone, record a
  take, then log in on a laptop. History, Progress and the take's Results match the phone's.
  Delete the account on the laptop: at its next sync the phone is a guest's but still lists
  its takes, History says the session has ended, and Account offers Log in or "Keep on this
  device". Guest mode still records and saves with the network off.

## Screen walkthroughs

**Onboarding (about one minute).** Empty the store and reload.

1. The Onboarding screen shows under its "Speech Coach" heading, with no nav: the line
   "Record a practice speech. Get your pace, pauses and filler words in seconds.", three
   items, each after an icon (a microphone, a magnifying glass, a chart), the muted line
   "Audio is deleted right after analysis. Transcripts stay on this device." and a full-width
   "Start practicing" button. The tab reads "Speech Coach" and nothing has focus.

2. Tap "Start practicing": Practice shows with the nav. Reload: Practice opens directly, and
   the onboarding flag snippet prints `true`.

**Practice (about one minute).** Start the server as under Manual checks.

1. Talk and Read: Practice opens on the Talk tab with "Your day 1:00" selected. The chips
   read "Your day 1:00", "Impromptu 2:00", "Congress speech 3:00" and "PF constructive 4:00",
   and the card shows "Talk about the best part of your day and why it stood out." Tap "New
   topic" at the card's top right: the next topic shows, and after the eighth the first comes
   back. Tap "Read": the chips become the six passages (no times), the card shows the passage
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

   returns one session whose `metrics.words_per_minute` is a number and whose `passageTitle`
   is the chip's title ("Your day"), not the topic.

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
sample result", which opens a real sample take on this screen.

1. Under the "Results" heading: a muted line with the passage title and the date (for a timed
   preset such as Congress speech it ends with "· m:ss of 3:00"). Then a headline card with
   two sentences: a green check before one strength and a blue arrow before one focus, such
   as "Your longest clean stretch is 4.9 seconds." and "Next take, cut fillers under 3 a
   minute." Then exactly four cards, two per row, in this order: "Pace", "Fillers",
   "Pauses", "Clean stretch". Hesitation sounds (um, uh) are not counted as
   words. The Pace hint reads "Target lo to hi" in green with a check when the pace is inside
   the passage's range, or "Slow down" / "Speed up" in rust with a warning triangle outside
   it; the numbers come from the passage you recorded (Gettysburg and Patrick Henry are 130 to
   150, the rebuttal 150 to 170, Your day 140 to 160). The Fillers card shows "/min" and its
   hint reads "Target under 3" in green at 3 or less and "Aim for under 3" in rust above. The
   pauses card has no hint. The clean stretch card shows seconds and has no hint. No nav item
   is highlighted.

2. Compare with the last take: record a second take (the Practice happy path again), or run
   the Progress seed snippet and open the newest row in History. Every card ends with a small
   grey line, a triangle or a dash and words such as "12 faster", "1.2 fewer" or "No change",
   and "Arrows compare with your last take." sits under the cards. The very first session in
   the store shows neither. A take saved without words (the store round trip, or the seed)
   has no clean-stretch line. The sample is never compared: tap "See a sample result" after
   your takes, even twice, and its Results shows no grey lines, no note and no "Fillers are
   down" headline. The next take you record compares with your take before the sample.

3. "History" and "Record again" sit in one bar stuck above the nav while the page scrolls under
   it. Tap "Record again": Practice opens in idle. Use the browser's back button to return,
   then tap "History": the hash becomes `#/history`. With a keyboard, press Tab from the top
   of the page: the "How we count" link scrolls up above the bar with its whole focus ring in
   view, and the next Tab moves to "History" without moving the page. In landscape
   (568 x 320) or at 200% zoom on a phone (DevTools at 187 x 333 or 160 x 284) the bar is not
   stuck: the transcript and tips read through the whole window above the nav, and the bar
   sits at the end of the page. At 187px it wraps: "History" on one line, "Record again"
   under it, both inside the screen. Tabbing through the page there keeps every focused
   control, the bar's two included, with its whole ring clear of the nav.

4. Speech timeline: under the cards, a "Speech timeline" heading and a strip from the first
   word to the last: amber ticks for fillers, purple blocks for mid-sentence pauses, a taller
   pink block for each pause of 5 s or more, even after a period, and a pale green band with a
   darker green base line for the longest clean stretch. Under it, the first word's time, the
   midpoint and the last word's time (the same clock as the tips), then a legend, which adds
   "Long pause (5 s+)" when the strip has one. A screen reader reads the strip as one image,
   "Speech timeline from 0:01 to 0:32: 11 fillers, 3 mid-sentence pauses, 1 restart, a 4.9
   second clean stretch", with "1 long pause" after the mid-sentence count when there is one,
   and then a list of every moment, a restart included ("Restart “and I” at 0:16"). End a
   sentence and stay silent for 6 seconds: the strip draws the pink block, and the list reads
   "Long pause at 0:04, 6.0 seconds". A session saved with an empty transcript shows no
   timeline.

5. Transcript: under the timeline, a "Transcript" heading, a small legend and every word of the
   take. The legend reads "Highlighted words are hesitations: um, uh, mhm. Underlined words
   are verbal habits.", names the most-used habit (for example "Most used: “like”, 4 times.")
   and ends with a "How we count" link to `how.html`. Hesitations ("um", "uh", "er", "ah",
   "hm", and "mhm", "uh-huh", "mm-hmm") get an amber highlight. Verbal habits ("like", "so",
   "you know", "actually", "basically") get a dotted underline, and only where the context
   rules count them: "I like this plan" is not marked. Each mid-sentence pause of 1.5 s or
   more is a purple pill such as "2.1 s pause" right after the word before the gap. A pause
   of 5 s or more is marked wherever it falls, even after a period, as an outlined pink pill
   such as "6.0 s long pause". A shorter pause after a period is not marked, so the
   transcript, the Pauses card and the timeline always show the same pauses.
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
   writes) the "Tips" heading becomes "Coach notes" and the cards are replaced by two or three
   notes, each a card with the note, "Drill:" and an exercise when the entry has one, and
   "Source:" with the citation as a link ("Lisa B. Marshall, Um, How Do I Stop, Ya Know, Using
   Um and Ah? (2017)") that opens in a new tab; a peer-reviewed source adds a green "Peer
   reviewed" pill. The line under the heading reads "Written for this take by Claude, from the
   research library." when the key is set and the hour's budget of AI calls lasts, and "The
   research library's own words, picked for this take." otherwise. The Network tab shows one
   `POST /api/advice`; with the key set, open the same take again from History and there is
   none: Claude's notes are kept on the device. The library's words are not kept, so without the
   key that take asks again and shows entries it has not shown before. Record another take:
   none of its notes repeats an entry shown before. With VoiceOver on, Tab to "How we count"
   before the notes arrive: when they do, focus moves to the "Coach notes" heading and
   VoiceOver says "Coach notes ready."; leave for History first and nothing is said.
   Stop uvicorn and reopen a take without kept notes (a fresh id): the Tips stay, with no error.

7. Narrow the window to 320px (DevTools device toolbar): two cards per row with each number
   and its unit on one line, the date in the meta line never split, the timeline and its
   legend inside the column, the transcript wrapping with the pause pills staying on their
   line, no horizontal scroll, no console errors. At 1024px the cards are still two per row
   and "Record again" is at most 320px wide. Switch the OS theme (or DevTools "Emulate CSS
   prefers-color-scheme: dark", or the theme toggle): the rust warnings, amber
   and purple marks and the green band stay readable on both backgrounds.

**History (about one minute).** Needs two saved sessions: run the Practice happy path twice,
or save two with the store round trip. Then open http://127.0.0.1:8000/#/history.

1. At the right of the "History" heading, a small "Account" link opens `#/account`; the nav
   keeps Practice, History and Progress. Under the heading, one row per session, newest first:
   the passage title over
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

1. Under the "Progress" heading: a segmented control of four options, "Pace" (selected),
   "Fillers", "Pauses" and "Clean", all on one row at 320px; then the heading "Words per
   minute", three summary cells and the chart. The cells read "Latest" 158 wpm, "Best" 158
   wpm (the most recent take inside the 140 to 160 band) and "From your average" "19
   faster" with an up triangle. The chart has five blue dots joined by a line, gridlines at
   the round values 100, 120, 140 and 160, and a short date such as "Oct 5" under every dot,
   oldest on the left, the last one ending at the right edge. The best take wears a ring and a
   small "Best" label that does not touch the line. The Progress nav item is highlighted.

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
   come back: History lists the sample, but the chart gains no dot and the cells do not change.

5. Narrow the window to 320px: the four options fit on one row, "Latest" and "Best" sit side
   by side with "From your average" across the row under them, every value bold at the heading
   size on one line, and nothing scrolls sideways; the chart fills the width with readable
   labels. From 600px the three cells share one row, and at 640px the chart scales up with the
   column. Zoom to 200% on a phone (or narrow the window to 160px): the options form two rows
   of two, the cells stack, a long change such as "4.9 s longer" may wrap after the number, and
   still nothing scrolls sideways. Switch the theme with the toggle on Practice, or the OS
   setting: gridlines, labels, the band, the ring and all four line colors stay visible in both
   themes.

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
