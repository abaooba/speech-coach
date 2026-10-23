# Live pace estimator: validation (2026-10-22)

Spec: docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 7. The estimator is
`app.delivery.livePace` in frontend/delivery.js. It was checked against speech of known pace
before the live row was built. This note keeps the method, the numbers and the verdict.

## Verdict

- **Uncalibrated, the median whole-clip error is 22.0%**, over the spec's 15% bar. That is on 76
  macOS `say` clips: 8 English voices, 121 to 247 wpm. The estimate reads low (bias -22.0%), and
  only 33% of clips are within 15%.
- **Calibrated, it holds up near the speaker's usual pace.** Leave-one-out on the same voice
  gives a 6.3% median whole-clip error (p90 20.2%) and 8.3% (13.0 wpm) over 15 s windows.
  Tuning in sequence, as the app does (start at 0.69, halfway to each take's own ratio), gives
  12.6% on a mode's 2nd take, 8.3% on its 3rd and 6.6% after.
- **After tuning, a slow take reads fast, so Speed up comes late or not at all.** Words a peak
  falls as speech slows (about 10% per 50 wpm within a voice), so a factor tuned at one pace
  pulls the number toward that pace. End to end, a 121 wpm take read 137 on average after tuning
  at 149, and Speed up never showed (End to end in the app, below). Slow speakers are the ones
  this misses. It is TTS only: check with real slow takes before relying on Speed up. Open
  item: a factor that depends on pace (words a peak as a function of the peak rate) would follow
  a speaker who slows down; it is not built.
- **The owner's two real takes are within 7%**: read -6.4%, talk +4.4%. The start factor 0.69
  came from these same two takes, so this is in-sample. They are the only human speech here.
- **So the row waits for the factor** (spec section 7, Validation result). Until a mode, Talk or
  Read, has one take of 20 seconds and 30 words, its row says "Live pace starts after a 30 s
  talk." or "Live pace starts after a 30 s read." and shows no number and no cue, because in the
  app the untuned cue was right on only 1 of 4 first takes (End to end in the app, below). After
  that it shows "About 150 wpm" and the cue.
- Noise: white noise at 20 and 10 dB SNR changes nothing that matters. A continuous second voice
  adds peaks: at -12 dB, +1% on the real read and +8% on the real talk; at -6 dB, +14% and +20%.
- CPU on a Mac (2026-10-23, the owner's two real takes joined, 67 s, each push timed): a
  1024-sample block costs 0.05 ms on average in node and 0.10 to 0.18 ms in headless Chrome on
  the Practice page, under 1% of its 21.3 ms at 48 kHz. The slowest 5% take up to 0.3 ms in
  node and 0.9 ms in Chrome, the worst block 2.3 ms and 4.1 ms. 44.1 kHz costs about the same.
  A 10-minute take's tracker grows only by its list of peaks, some 17 kB from the first minute
  to the tenth. Not measured on a phone.

## Method

- **Estimator.** `livePace(48000)` loaded as the tests load it, fed 1024-sample blocks like the
  ScriptProcessor the app uses, with the spec's settings: 100 to 5000 Hz band-pass; 32 ms windows
  every 8 ms; a peak 2 dB over the running median (kept as a histogram of 0.05 dB bins), with a
  1.5 dB dip and a 3-hop look-ahead; voiced at a normalized autocorrelation of 0.45 or more at 75
  to 400 Hz. Factor 0.69, a trailing 15 s window, nothing before 5 s of speech, rounded to 5, a
  10 wpm cue margin held 3 s.
- **Speech.** `say -r <wpm> -v <voice>`, 48 kHz 16-bit. Voices: Samantha, Daniel, Karen, Moira,
  Tessa, Rishi, Reed and Flo. Text: the app's everyday passages (the 15 cold reads, the explainer
  and the story). Rates 120, 150, 180 and 200, two passages each, gave 64 clips. `say -r` is
  loose: Samantha, Karen, Daniel and Moira never go under about 156 to 169 wpm. So Reed, Flo,
  Tessa and Rishi read 12 slower clips (121 to 150 wpm) of passages they had not read. In all: 76
  clips, over 52 minutes, 105 to 164 words each, true pace median 181 wpm.
- **Truth, whole clip.** The passage's words over the time from the first to the last speech
  (any 10 ms frame within 40 dB of the clip's loudest).
- **Truth, 15 s windows.** Each sentence was rendered on its own, trimmed and joined with the
  passage's average sentence gap; words are placed in a sentence by syllables. Windows run once a
  second. On these joined renders the whole-clip error is 18.1% against 22.0%, so the window
  figures lean about 4 points optimistic.
- **Real takes.** samples/sample-take.m4a (a read) and samples/test-clip.m4a (a talk). Truth by
  Results' rule from the stored word times (frontend/sample-session.json,
  backend/tests/fixtures/test_clip_assemblyai.json): 146.3 and 75.7 wpm.
- **Noise.** White noise 20 and 10 dB under the active speech level. A second voice: another
  `say` voice reading another passage, continuous, at -12 and -6 dB.
- **Calibration.** Uncalibrated is 0.69. Same-voice leave-one-out uses the mean words a peak of
  the voice's other clips, like a speaker's earlier takes. Leave-one-voice-out uses the other 7
  voices. Sequential runs the module's own update (`paceFactorAfter`) over each voice's clips in
  200 seeded orders.
- **The row.** Each window clip was replayed through `livePaceAt` and `nextLiveReading` once a
  second, against the passage's band. A *wrong cue* is Slow down or Speed up while the truth is in
  the band, or pointing the other way. *The wrong way* is Slow down under the band or Speed up
  over it. *Missed* is On target while the truth is more than 10 wpm outside.

## Results

### `say` clips, whole clip (76 clips), median absolute error

| Condition | Uncalibrated (0.69) | Same-voice LOO | Leave-one-voice-out |
|---|---|---|---|
| Clean | **22.0%** (bias -22.0%, p90 39.8%) | 6.3% (bias +0.7%, p90 20.2%) | 15.9% (p90 36.3%) |
| White noise 20 dB | 22.0% | 5.9% | 16.8% |
| White noise 10 dB | 22.0% | 6.1% | 17.2% |
| Second voice -12 dB | 20.5% | 7.8% | 14.5% |
| Second voice -6 dB | 16.8% | 8.6% | 12.9% |

With the second voice the uncalibrated error falls only because its extra peaks offset the
undercount.

### `say` clips, 15 s windows (2881 windows)

| Condition | Uncalibrated | Same-voice LOO | Leave-one-voice-out |
|---|---|---|---|
| Clean | 15.2% (24.5 wpm, p90 32.5%) | 8.3% (13.0 wpm, p90 21.4%) | 12.5% |
| White noise 20 dB | 15.4% | 8.3% (13.0 wpm) | 12.5% |
| White noise 10 dB | 15.9% | 8.2% (13.2 wpm) | 12.8% |
| Second voice -12 dB | 14.1% | 7.9% (12.5 wpm) | 10.5% |
| Second voice -6 dB | 13.0% | 8.6% (13.8 wpm) | 10.5% |

### Clean, by true pace

| True pace | Clips | Uncalibrated | Same-voice LOO |
|---|---|---|---|
| under 150 | 17 | 11.2% (bias -11.2%) | 3.4% (+3.4%) |
| 150 to 175 | 17 | 17.0% (-17.0%) | 4.0% (+1.9%) |
| 175 to 200 | 26 | 29.6% (-29.6%) | 6.2% (+0.7%) |
| 200 and up | 16 | 29.0% (-29.0%) | 12.8% (-8.8%) |

- The `say` voices average 0.885 words a peak (median), against 0.66 to 0.74 for the owner. That
  gap is the uncalibrated error.
- Their loudness inside speech is 2 to 5 times more compressed than the phone takes (2.7 to 5.9
  dB from median to p90, against 10.3 and 15.5 dB), so "median + 2 dB" drops many syllables.
- Within a voice, words a peak rises about 10% per +50 wpm. A calibrated estimate under-states
  how far a speaker drifts from their usual pace (about 200 reads as 180 after tuning at 150),
  so cues err toward missing, not toward the wrong way.

### Sequential calibration (clean, 200 orders a voice)

| Weight | Take 1 | Take 2 | Take 3 | Takes 4+ (p90) |
|---|---|---|---|---|
| 0.3 | 23.8% | 16.7% | 11.3% | 6.0% (20.0%) |
| **0.5 (built)** | 23.8% | 12.6% | 8.3% | 6.6% (19.9%) |
| 0.7 | 23.8% | 9.2% | 8.0% | 7.2% (21.1%) |

Noise gives the same picture (take 2: 11.7 to 12.6%; takes 4+: 6.5 to 8.3%).

### The row, simulated (clean, 3641 reads with a number)

| Factor | Wrong cue | The wrong way | Missed | Shown vs truth |
|---|---|---|---|---|
| Uncalibrated | 595 (16.3%) | 380 (10.4%) | 1373 (37.7%) | 26 wpm median |
| Same-voice LOO | 194 (5.3%) | 49 (1.3%) | 891 (24.5%) | 13 wpm median |

The first number shows 5.5 s after the first word (median).

### Real takes

| Take | Condition | Estimate vs truth | 15 s windows | Row (band 140 to 160) |
|---|---|---|---|---|
| Read, 146.3 wpm | clean | 137 (-6.4%); with the talk's factor 0.661: 131 (-10.3%) | 7.0% (9.7 wpm) | 0 of 24 wrong; 3 of 24 with the talk's factor |
| Talk, 75.7 wpm | clean | 79 (+4.4%); with the read's factor 0.737: 84 (+11.5%) | 6.7% (4.4 wpm) | 0 of 26 wrong |
| Read | white noise 20 / 10 dB | -7.3% / -10.3% | 7.0% / 4.6% | 0 wrong before the later fixes; 1 of 24 after, at each level |
| Talk | white noise 20 / 10 dB | +4.4% / -0.9% | 6.7% / 5.1% | 0 wrong |
| Read | second voice -12 / -6 dB | -5.4% / +6.5% | 5.0% / 8.4% | 0 wrong |
| Talk | second voice -12 / -6 dB | +13.2% / +25.6% | 9.1% / 6.3% | 0 wrong |

Words a peak: read 0.737, talk 0.661. That 12% gap is why Talk and Read keep separate factors.

## What the data changed

- **Threshold: 2 dB over the median, kept.** At +1 dB the `say` clips would clear the bar
  (14.1% uncalibrated), but the gain is all on the three most compressed voices. On the real
  takes +1 dB is worse: the talk reads +13.2% against +4.4%, and the read under a -6 dB second
  voice reads +26.2% with 22 of 25 reads wrong. Real takes from other speakers should decide it;
  it is one constant (`LIVE_ABOVE_MEDIAN_DB`).
- **Factor weight 0.5, start factor 0.69, kept.** 0.7 tunes faster only because the TTS voices
  start far from 0.69. The TTS median (0.885) would miss the owner's read by +20% and talk by +34%.
- **Speech start, changed.** The real read has a faint thump and a breath 1.6 s before the first
  word, and starting the clock there pulled the first numbers about 28% low. Speech now starts
  at the first peak that two more follow within 1.5 s; that take went from 1 wrong cue to none.
- **Histogram bins, 0.25 dB changed to 0.05 dB.** In dense speech many peaks sit within a few
  hundredths of a dB of the threshold; with 0.05 dB bins the module finds an exact median's
  peaks in every case checked.

## Later fixes, re-validated

Two rules changed after the first validation:

- The first number shows the cue it calls for; it used to start On target.
- The 15 s window and the 5 s before the first number count speech time: a silence counts only
  up to 1.5 s, so a pause at a full stop never drags the number down for long.

Re-run from the stored peaks with the fixed module. The `say` clips have no gap over 0.55 s, so
only the first-cue rule moves their cues:

| Cues, `say` clips | Before | After |
|---|---|---|
| Calibrated: wrong cue | 5.3% | 5.5% |
| Calibrated: the wrong way (reads) | 49 | 41 |
| Calibrated: missed | 24.5% | 21.1% |
| Uncalibrated: wrong cue | 16.3% | 18.0% |
| Uncalibrated: the wrong way | 10.4% | 11.6% |
| Uncalibrated: missed | 37.7% | 34.7% |

- Real read take: still 0 of 24 wrong; with the talk's factor, 1 of 24 (was 3). Under white
  noise at 20 and 10 dB: 1 of 24 at each level (was 0).
- Real talk take: misses fell from 3 to 0. Its first 3 s used to show On target at 95 wpm.
- The talk take's pauses of 1.6 to 3.0 s now read higher afterwards: the median gap between the
  shown number and Results' pace went from +1.5 to +4.7 wpm.
- The whole-clip and window error figures are unchanged.
- Before a mode is tuned, the row showed the cue alone, so the uncalibrated cue figures above
  applied to it. It now shows no cue until then (End to end in the app, below).
- Since this re-run, the cue hold allows half a read of slack (`LIVE_CUE_HOLD_SLACK_SECONDS`).
  The audio at each once-a-second read comes in whole blocks, so 3 clock seconds often held
  2.98 s of audio, and a new cue waited a fourth second. The replay reads at whole seconds, so
  none of its figures move.

## End to end in the app

Six takes from the live row's build and review (2026-10-22): `say` clips at 48 kHz played into
headless Chrome as its microphone, through the app with blank keys and the backend's answer
faked from each clip's word times. The truth is the clip's words over the trailing 15 s. The
factor is the mode's kept one when the take began.

| Take | Band | Factor | True pace | Row | Cue |
|---|---|---|---|---|---|
| Talk, first | 140 to 160 | none | 149 | On target throughout (cue alone) | right |
| Talk, first, another voice | 140 to 160 | none | 185 | On target throughout (cue alone) | missed: Slow down was due |
| Read, first, that voice | 150 to 170 | none | 185 | On target throughout (cue alone) | missed: Slow down was due |
| Read, first | 150 to 170 | none | 165 | Speed up from 0:30 to 0:35, while the trailing pace was 148 to 168 | wrong |
| Talk, tuned at 149 | 140 to 160 | 0.735 | 121 | 125 to 155 (mean 137, +13%), On target to the end | missed: Speed up never showed |
| Talk, tuned again | 140 to 160 | 0.703 | 108 | 105 to 135 (mean 120, +11%), Speed up from 0:22 | late: called from 0:18 |

- The untuned cue was right on 1 of 4 first takes, in line with the uncalibrated figures above.
  So the app no longer shows it: until a mode is tuned, the row says "Live pace starts after a
  30 s talk." or "Live pace starts after a 30 s read." for the whole take, with no number and
  no cue. The Row column is what these takes showed before that change.
- After tuning, the number was pulled toward the pace the factor was tuned at. That limit stays
  open: a slow take still reads fast after tuning (121 wpm showed as 137 on average, and Speed
  up never appeared). A factor that depends on pace is the follow-up.
- The Speed up first called at 0:18 waited for 0:22, a fourth second; with the hold's slack it
  shows at 0:21.

## Caveats

- The only human speech is one speaker's two takes, and 0.69 came from them. A new speaker's
  uncalibrated error is unknown: somewhere between these takes' 5% or so and the TTS voices' 22%.
- TTS differs from people where it matters here: compressed loudness, no hesitations and regular
  syllables. The second voice is continuous TTS, harsher than a real talker who pauses.
- `say` truth comes from the audio, not word times; window truth places words by syllables.
- Not measured: echoey rooms, music or TV, phone microphones and their processing, and CPU on a
  phone. Takes from other people on the target phones would settle the threshold too.
