# Speech Coach frontend

Plain HTML, CSS and JavaScript served by the FastAPI backend. The design spec is
`DESIGN.md`; automated checks live in `tests/` and run with `node --test frontend/tests`
from the repository root.

## Manual checks

**Store and passages (about one minute).** Open the app in a browser, open DevTools and run
each line in the console, waiting for it to resolve before the next.

1. Save one session:

   ```js
   await app.store.save({passageId:'free-talk', passageTitle:'Free talk', durationSeconds:12, metrics:{words_per_minute:150, duration:12, word_count:30, fillers:{um:1}, pauses:[], repeats:[], pace_windows:[]}, transcript:[]})
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

   It prints `4`.

**Practice (about one minute).** Start the server with a real speech-to-text key in `.env`
and open http://127.0.0.1:8000/ in Chrome:

```bash
.venv/bin/uvicorn backend.app:app --reload
```

`.env` is read when the server starts, so restart uvicorn after changing it. Every error
block below is built by `app.ui.renderState`; the timer keeps its last value through each one.

1. Happy path: tap Record. The microphone prompt appears now, not on page load. Allow it,
   speak for about 10 seconds (the timer counts, the red dot pulses, the nav disappears), then
   tap Stop. "Analyzing your speech" shows with a spinner and the record button is hidden.
   The hash becomes `#/results/<id>`, and in the console:

   ```js
   await app.store.list()
   ```

   returns one session whose `metrics.words_per_minute` is a number.

2. Microphone blocked: click the lock icon in the address bar, set Microphone to Block,
   reload and tap Record. The red block reads "Microphone is blocked. Allow it in your
   browser settings, then tap Record." with a "Try again" button that returns to idle. Set
   Microphone back to Ask, reload, and the next Record tap prompts again.

3. Too short: tap Record, then Stop before 5 seconds. The block reads "That was under
   5 seconds. Try again." with "Record again", and the Network tab shows no request to
   `/api/analyze`.

4. Network: tap Record, stop uvicorn (Ctrl-C) while recording, then tap Stop. The block
   reads "Could not reach the server. Your recording is still here." with "Retry upload".
   Start uvicorn again and tap Retry upload: the same take uploads and Results opens.

5. Provider (502): set `STT_PROVIDER=bogus` in `.env`, restart uvicorn, record 10 seconds
   and tap Stop. The block reads "Analysis failed on our side. Your recording is still here."
   with "Retry upload". Restore `STT_PROVIDER` and restart uvicorn afterwards.

Screen-reader users hear "Recording started", the clock every 30 seconds, "Recording
stopped, N seconds" and "Results ready" through the live region.

**Results (about one minute).** Needs one saved session, so run the Practice happy path
first; the hash is then `#/results/<id>`.

1. Under the "Results" heading: a muted line with the passage title and the date, then
   exactly four cards in this order: "Words per minute", "Fillers per minute", "Pauses over
   1.5 s", "Longest pause". The first card's hint reads "Target lo to hi" in green when the
   pace is inside the passage's range, or "Slow down" / "Speed up" in amber outside it; the
   numbers come from the passage you recorded (Gettysburg and Patrick Henry are 130 to 150,
   the rebuttal 150 to 170, Free talk 140 to 160). No nav item is highlighted.

2. Tap "Record again": Practice opens in idle. Use the browser's back button to return, then
   tap "History": the hash becomes `#/history`.

3. Transcript: under the cards, a "Transcript" heading and every word of the take. Fillers
   ("um", "uh", "hmm", "like", "so", "basically", "actually" and both words of "you know")
   are bold amber tokens; each gap of 1.5 s or more is a purple pill such as "2.1 s pause"
   right after the word before the gap. Record 10 seconds, say "um" five times and stop
   talking for 3 seconds mid-sentence: five amber "um" tokens and one "x.x s pause" pill.
   A session saved with an empty transcript (the store check above) shows no Transcript
   section at all.

4. Tips: a "Tips" heading with one or two cards, chosen in this order. Record 10 to 15
   seconds doing one thing at a time:

   - "You are above target pace." Read the passage faster than its top target plus 15 wpm
     (over 175 wpm on Free talk).
   - "You are under target pace." Read slower than the bottom target minus 15 wpm (under
     125 wpm on Free talk).
   - "Replace um with a silent beat." Say "um" five times in 10 seconds (more than 6 per
     minute).
   - "One pause ran past 3 seconds." Stop mid-sentence for 4 seconds, then keep talking;
     silence before the first word or after the last one is not a pause.
   - "You restarted phrases three times." Say a word twice in a row ("the the") on three
     separate occasions.
   - "Clean run." None of the above.

   Talking fast and full of "um" shows two cards, pace first; a third problem is dropped.

5. Session not found: open http://127.0.0.1:8000/#/results/nope. The empty state built by
   `app.ui.renderState` shows "Session not found" / "It may have been deleted." with a
   "History" button that goes to `#/history`. The same block appears for `#/results` with
   no id, and for a session id that was deleted.

6. Narrow the window to 320px (DevTools device toolbar): two cards per row, the transcript
   wraps with the pause pills staying on their line, the tip cards fit, no horizontal
   scroll, no console errors. At 640px the four cards share one row. Switch the OS theme
   (or DevTools "Emulate CSS prefers-color-scheme: dark"): amber and purple tokens stay
   readable on both backgrounds.

**History (about one minute).** Needs two saved sessions: run the Practice happy path twice,
or save two with the store check above. Then open http://127.0.0.1:8000/#/history.

1. Under the "History" heading, one row per session, newest first: the passage title over
   the date on the left, the stats on the right as `152 wpm · 3.1 per min` (the same numbers
   as that session's first two Results cards), and a "Delete" button. The History nav item
   is highlighted.

2. Tap a row: the hash becomes `#/results/<id>` and Results shows that session. Use the
   browser's back button to return.

3. Tap "Delete": it becomes "Delete?" with "Yes" and "No". Tap "No": "Delete" comes back and
   the row stays. Tap "Delete" on one row, then on another: the first row's "Delete" comes
   back on its own, so only one row asks at a time.

4. Tap "Delete", then "Yes": the row disappears and the others keep their order. In the
   console:

   ```js
   await app.store.list()
   ```

   no longer includes that session.

5. Empty state: delete the remaining sessions through the UI, or run
   `indexedDB.deleteDatabase('speech-coach')` in the console and reload. The empty state
   built by `app.ui.renderState` shows "No sessions yet" / "Your first recording will show
   up here." with a "Record" button that opens Practice.

6. Narrow the window to 320px: the stats move under the title and date, "Delete" and the
   "Delete? Yes / No" prompt stay on the row, no horizontal scroll, no console errors. At
   640px each row is a single line.

**Progress (about one minute).** Needs two saved sessions; a real trend needs more. Seed five
with varied numbers, one per day over the last five days: open DevTools on the app and paste
this loop into the console (each session lasts one minute, so the `um` count is also the
fillers-per-minute value, and `pauses` is the pause count):

```js
for (const [daysAgo, wpm, um, pauses] of [[5,128,4,1],[4,141,3,2],[3,137,2,2],[2,152,1,0],[1,158,1,1]]) {
  await app.store.save({createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString(), passageId:'free-talk', passageTitle:'Free talk', durationSeconds:60, metrics:{words_per_minute:wpm, duration:60, word_count:wpm, fillers:{um}, pauses:Array.from({length:pauses}, (_, k) => [10 + 10 * k, 2]), repeats:[], pace_windows:[]}, transcript:[]})
}
```

Then open http://127.0.0.1:8000/#/progress.

1. Under the "Progress" heading: three chips, "Words per minute" (selected), "Fillers per
   minute" and "Pauses", then the chart: five dots joined by a blue line, four grey gridlines
   with the labels 100, 120, 140, 160 on the left, and 1 to 5 under the dots. Session 1 is
   the oldest, on the left; the line climbs from 128 to 158 with a dip at 3. The Progress
   nav item is highlighted.

2. Tap "Fillers per minute": that chip is selected, the line and dots turn amber, the y labels
   read 0, 3, 7, 10 and the dots fall 4, 3, 2, 1, 1. Tap "Pauses": purple, dots at 1, 2, 2,
   0, 1. Tap "Words per minute": blue again. Open History and come back: the chip you chose
   is still selected.

3. In the Elements panel the `<svg class="chart">` has `role="img"` and an `aria-label` such
   as "Words per minute over 5 sessions, latest 158"; under it a visually hidden table lists
   one row per session (number, date, value). A screen reader reads the table.

4. Run the seed loop a second time (ten sessions): every session still gets a dot, but the
   x labels thin to 1, 3, 5, 7, 9.

5. Narrow the window to 320px: the chart fills the width with no horizontal scroll and the
   labels stay readable; at 640px it scales up with the column. Switch the OS theme (or
   DevTools "Emulate CSS prefers-color-scheme: dark"): gridlines, labels and all three line
   colors stay visible.

6. Empty state: delete sessions in History until one is left (or run
   `indexedDB.deleteDatabase('speech-coach')`, reload and save one session with the store
   check above), then open `#/progress`. The block built by `app.ui.renderState` shows "Need
   two sessions" / "Record one more to see a trend." with a "Record" button that opens
   Practice.
