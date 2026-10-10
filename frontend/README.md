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

3. Session not found: open http://127.0.0.1:8000/#/results/nope. The empty state built by
   `app.ui.renderState` shows "Session not found" / "It may have been deleted." with a
   "History" button that goes to `#/history`. The same block appears for `#/results` with
   no id, and for a session id that was deleted.

4. Narrow the window to 320px (DevTools device toolbar): two cards per row, no horizontal
   scroll, no console errors. At 640px the four cards share one row.
