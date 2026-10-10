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
block below is built by `app.ui.renderState` and takes the record zone right under the card:
the timer, the record button and its "Record" label are hidden, and keyboard focus lands on
the block's red title (press Tab once to reach its button). On a short screen (320 x 568) the
block takes the card's place too, so the whole block, both actions included, sits above the
nav with no page scroll; the selected chip still names the option.

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

4. Microphone blocked: click the lock icon in the address bar, set Microphone to Block,
   reload and tap Record. The red block reads "Microphone is blocked. Allow it in your
   browser settings, then tap Record." with a "Try again" button that returns to idle. Set
   Microphone back to Ask, reload, and the next Record tap prompts again.

5. Too short: tap Record, then Stop before 5 seconds. The block reads "That was under
   5 seconds. Try again." with "Record again", and the Network tab shows no request to
   `/api/analyze`.

6. Network: tap Record, stop uvicorn (Ctrl-C) while recording, then tap Stop. The block
   reads "Could not reach the server. Your recording is still here." with "Retry upload" and,
   under it, a blue "Record a new take". Start uvicorn again and tap Retry upload: the same
   take uploads and Results opens. Repeat the failure and tap "Record a new take" instead:
   Practice returns to idle with the record button back, the clock at 0:00 and the bar empty,
   and nothing is uploaded. Coming back from Results also starts at 0:00 with an empty bar.

7. Provider (502): set `STT_PROVIDER=bogus` in `.env`, restart uvicorn, record 10 seconds
   and tap Stop. The block reads "Analysis failed on our side. Your recording is still here."
   with "Retry upload" and "Record a new take". Restore `STT_PROVIDER` and restart uvicorn
   afterwards.

8. Small phones: in the DevTools device toolbar at 375 x 667, idle shows the whole "Your day"
   topic, the record button, "Record", the hint and "See a sample result" above the nav with
   no page scroll. At 320 x 568 the card still shows the whole topic, two lines above its fade:
   the hint and the sample button hide, the record button shrinks and the gaps under the card
   tighten, so the button and its label sit above the nav with no page scroll. Tap Record: the
   nav hides and the card grows into its room. In landscape (667 x 375) or at 200% zoom the
   card keeps those two lines, the sample button stays, and the page scrolls.

9. Theme toggle: the icon right of "Speech Coach" is a half-filled circle for Auto, and a
   screen reader names it "Theme: Auto. Switch to dark." Tap it: the page turns dark whatever
   the device setting, the icon becomes a moon and the live region says "Theme: Dark". Tap
   again for Light (a sun, "Theme: Light"), and again for Auto (the device setting decides).
   Reload: the choice is kept. The header stays one line, as tall as the "Practice" heading.

Screen-reader users hear "Recording started", the clock every 30 seconds, "Recording
stopped, N seconds", "Results ready" and, after each theme tap, "Theme: Dark", "Theme: Light"
or "Theme: Auto" through the live region. Errors are not announced on top of their alert role.

**Results (about two minutes).** Needs one saved session, so run the Practice happy path
first; the hash is then `#/results/<id>`. Without a microphone, Practice in idle shows "See a
sample result", which opens a real sample take on this screen.

1. Under the "Results" heading: a muted line with the passage title and the date (for a timed
   preset such as Congress speech it ends with "· m:ss of 3:00"). Then a headline card with
   two sentences: a green check before one strength and a blue arrow before one focus, such
   as "Your longest clean stretch is 4.9 seconds." and "Next take, cut fillers under 3 a
   minute." Then exactly four cards, two per row, in this order: "Pace", "Fillers",
   "Mid-sentence pauses", "Clean stretch". Hesitation sounds (um, uh) are not counted as
   words. The Pace hint reads "Target lo to hi" in green with a check when the pace is inside
   the passage's range, or "Slow down" / "Speed up" in rust with a warning triangle outside
   it; the numbers come from the passage you recorded (Gettysburg and Patrick Henry are 130 to
   150, the rebuttal 150 to 170, Free talk 140 to 160). The Fillers card shows "/min" and its
   hint reads "Target under 3" in green at 3 or less and "Aim for under 3" in rust above. The
   pauses card has no hint. The clean stretch card shows seconds and has no hint. No nav item
   is highlighted.

2. Compare with the last take: tap "See a sample result" twice. The second time every card
   ends with a small grey line, a triangle or a dash and words such as "12 faster", "1.2
   fewer" or "No change", and "Arrows compare with your last take." sits under the cards.
   The very first session in the store shows neither. A take saved without words (the store
   check above) has no clean-stretch line.

3. "History" and "Record again" sit in one bar stuck above the nav while the page scrolls under
   it. Tap "Record again": Practice opens in idle. Use the browser's back button to return,
   then tap "History": the hash becomes `#/history`. With a keyboard, press Tab from the top
   of the page: the "How we count" link scrolls up above the bar with its whole focus ring in
   view, and the next Tab moves to "History" without moving the page. At 200% zoom on a phone
   (DevTools at 187px wide) the bar wraps: "History" on one line, "Record again" under it,
   both inside the screen.

4. Speech timeline: under the cards, a "Speech timeline" heading and a strip from the first
   word to the last: amber ticks for fillers, purple blocks for mid-sentence pauses and a pale
   green band with a darker green base line for the longest clean stretch. Under it, the
   first word's time, the midpoint and the last word's time (the same clock as the tips), then
   a legend. A screen reader reads the strip as one image, "Speech timeline from 0:01 to 0:32:
   11 fillers, 3 mid-sentence pauses, a 4.9 second clean stretch", and then a list of every
   moment. A session saved with an empty transcript shows no timeline.

5. Transcript: under the timeline, a "Transcript" heading, a small legend and every word of the
   take. The legend reads "Highlighted words are ums and uhs. Underlined words are verbal
   habits.", names the most-used habit (for example "Most used: “like”, 4 times.") and ends
   with a "How we count" link to `how.html`. Ums and uhs ("um", "uh", "er", "ah", "hm") get an
   amber highlight. Verbal habits ("like", "so", "you know", "actually", "basically") get a
   dotted underline, and only where the context rules count them: "I like this plan" is not
   marked. Each mid-sentence pause of 1.5 s or more is a purple pill such as "2.1 s pause"
   right after the word before the gap. A pause after a period is not marked, so the
   transcript, the Mid-sentence pauses card and the timeline always show the same pauses.
   Record 10 seconds, say "um" five times and stop talking for 3 seconds mid-sentence: five
   amber "um" tokens and one "x.x s pause" pill. A session saved with an empty transcript
   (the store check above) shows no Transcript section at all.

6. Tips: a "Tips" heading with one or two cards, chosen in this order. Tips that point at
   moments name them as m:ss, such as "0:42". Record 10 to 15 seconds doing one thing at a
   time:

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

7. Session not found: open http://127.0.0.1:8000/#/results/nope. The empty state built by
   `app.ui.renderState` shows a magnifying glass, "Session not found" / "It may have been
   deleted." and a "History" button that goes to `#/history`. The same block appears for
   `#/results` with no id, and for a session id that was deleted.

8. Narrow the window to 320px (DevTools device toolbar): two cards per row with each number
   and its unit on one line, the date in the meta line never split, the timeline and its
   legend inside the column, the transcript wrapping with the pause pills staying on their
   line, no horizontal scroll, no console errors. At 1024px the cards are still two per row
   and "Record again" is at most 320px wide. Switch the OS theme (or DevTools "Emulate CSS
   prefers-color-scheme: dark", or the theme toggle): the rust warnings, amber
   and purple marks and the green band stay readable on both backgrounds.

**History (about one minute).** Needs two saved sessions: run the Practice happy path twice,
or save two with the store check above. Then open http://127.0.0.1:8000/#/history.

1. Under the "History" heading, one row per session, newest first: the passage title over
   the date, then the stats as `152 wpm · 3.1 /min` (the same numbers as that session's
   first two Results cards) and a status word with its icon. A green check reads "On
   target"; a rust warning triangle reads "Too slow", "Too fast" or "Fillers over 3", and
   two misses read "Too slow · Fillers over 3". Pace is judged against that passage's
   target range, ends included; fillers miss above 3 a minute. The store check's session
   (150 wpm, one "um" in 12 seconds, so 5 a minute) reads "Fillers over 3". A muted trash
   icon sits at the right of each row. The History nav item is highlighted.

2. Tap a row: the hash becomes `#/results/<id>` and Results shows that session. Use the
   browser's back button to return.

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

6. Empty state: delete the remaining sessions through the UI, or run
   `indexedDB.deleteDatabase('speech-coach')` in the console and reload. The empty state
   built by `app.ui.renderState` shows a microphone icon, "No sessions yet" / "Your first
   recording will show up here." and a "Record" button that opens Practice.

7. Narrow the window to 320px: the stats and the status sit under the title and date,
   left-aligned, with the trash icon on the right. Open a prompt: "Delete? Yes / No" drops
   below the status, at the right, and nothing overlaps. No horizontal scroll, no console
   errors, even at 200% browser zoom, where the prompt wraps inside the row. From 480px the
   stats and the status move to the right of the title and date.
   Switch the OS theme (or DevTools "Emulate CSS prefers-color-scheme: dark"): the green
   and rust status words stay readable.

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
   Tap "Pauses": purple, the heading "Mid-sentence pauses", dots at 1, 2, 2, 0, 1, the ring on
   the 0, and "No change" with a dash. Tap "Clean": green, "Longest clean stretch"; these
   sessions have no words, so every value is 0.0 s. Open History and come back: the option you
   chose is still selected. Only the fillers chart has the band and the legend.

3. In the Elements panel the `<svg class="chart">` has `role="img"` and an `aria-label` such
   as "Words per minute over 5 sessions, latest 158"; under it a visually hidden table lists
   one row per session (number, date, value) with the caption "Words per minute by session".
   A screen reader reads the summary cells as text and then the table.

4. Run the seed loop a second time (ten sessions, two a day): every session still gets a dot,
   and the x axis shows five dates spread from the first take to the last. A second take on a
   day that already has a label gets none.

5. Narrow the window to 320px: the four options fit on one row, "Latest" and "Best" sit side
   by side with "From your average" across the row under them, every value bold at the heading
   size on one line, and nothing scrolls sideways; the chart fills the width with readable
   labels. From 600px the three cells share one row, and at 640px the chart scales up with the
   column. Zoom to 200% on a phone (or narrow the window to 160px): the options form two rows
   of two, the cells stack, a long change such as "4.9 s longer" may wrap after the number, and
   still nothing scrolls sideways. Switch the theme with the toggle on Practice, or the OS
   setting: gridlines, labels, the band, the ring and all four line colors stay visible in both
   themes.

6. Empty state: delete sessions in History until one is left (or run
   `indexedDB.deleteDatabase('speech-coach')`, reload and save one session with the store
   check above), then open `#/progress`. The block built by `app.ui.renderState` sits centered
   between the heading and the nav: a chart icon, "Need two sessions" / "Record one more to see
   a trend." and a "Record" button as wide as the words above it, which opens Practice. Open
   History: the Progress block does not show there.
