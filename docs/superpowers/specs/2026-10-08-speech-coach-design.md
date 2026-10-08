# Speech Coach design spec

Date: 2026-10-08
Status: approved in chat, scope frozen on 2026-10-14

## Purpose

A practice tool for high school debaters and speech students. The user
records a short speech, gets objective numbers on pace, pauses, filler
words and repetition, and sees those numbers improve across sessions.

## Users and success

- Primary user: a debater practicing speeches on a phone or laptop.
- Success: a first-time user can record, see results and find their
  history without help. The author has two weeks of real sessions in the
  chart by video day.

## Features (frozen)

1. Practice: pick a reading passage or free-talk prompt, record with a
   timer, submit, see results.
2. Results: transcript with fillers highlighted, pause markers, metrics,
   one or two rule-based tips.
3. History and progress: list of past sessions and a chart of words per
   minute, fillers per minute and long pauses over time.

Stretch (only if everything above is done by Oct 18): LLM-written tip.

## Out of scope

Accounts, server-side storage of sessions or audio, native apps,
multi-language support, live real-time feedback during recording.

## Architecture

- Frontend: plain HTML/CSS/JS progressive web app in `frontend/`.
  `MediaRecorder` captures audio. The Web Audio API samples loudness
  (RMS energy) during recording to detect pauses locally.
  Sessions are stored in IndexedDB on the device.
- Backend: FastAPI in `backend/`. One analysis endpoint accepts the audio
  file, forwards it to the speech-to-text provider with filler words kept,
  computes metrics from the returned word timestamps, and returns
  transcript plus metrics. Audio is never written to disk.
- Provider abstraction: `backend/providers/` with one module per provider
  (Deepgram, AssemblyAI) returning the same `Word(text, start, end)` list,
  selected by the `STT_PROVIDER` env var.
- Hosting: Render free tier serving both API and static files over HTTPS,
  which the microphone permission requires on phones.

## Data flow

record (browser) -> energy samples (browser) -> POST /api/analyze (audio)
-> provider -> words with timestamps -> metrics (backend) -> JSON
-> results screen -> save to IndexedDB -> history and chart.

## Metrics (backend, pure functions, unit tested)

- Words per minute: word count / speaking duration.
- Pauses: gaps between consecutive word end and next word start longer
  than 1.5 s; count, longest, positions. Reconciled with browser energy
  pauses when both are available.
- Fillers: count of um, uh, like, you know, so, basically, actually,
  by word; fillers per minute.
- Repeated words: immediate repeats ("the the") and stutter restarts.
- Pace variance: words per minute per 10 s window, reported as a range.

## Error handling

- Microphone denied: explain how to allow it, keep the page usable.
- Network or provider failure: keep the recording in memory, offer retry.
- Empty or too-short recording (< 5 s): ask to re-record.
- Provider returns no fillers: metrics still compute; a note says fillers
  may be undercounted.

## Testing

- pytest with network blocked. Fixtures are saved provider JSON
  responses for a known clip, plus hand-made word lists with known
  pauses, fillers and repeats.
- Unit tests per metric. One API test with the provider mocked.
- Manual checklist on iPhone Safari and Android Chrome before video day.

## Privacy

Audio is deleted after analysis. Transcripts and metrics live only on the
user's device. The app states this on the first screen.
