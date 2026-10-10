# Speech Coach (working title)

A practice tool for debaters and speech students. Record a short practice
speech on your phone or laptop, get back words per minute, long pauses,
filler words and repeated words, and watch those numbers improve over days.

Built for the 2026 Congressional App Challenge (IL-06) by Ares Cajas.

## How it works

1. The browser records audio with `MediaRecorder` and measures loudness
   with the Web Audio API to find pauses locally.
2. The audio is sent to a small FastAPI backend, which forwards it to a
   speech-to-text provider (Deepgram or AssemblyAI) with filler words kept.
3. The backend computes the metrics from the word timestamps and returns
   them with the transcript. Audio is discarded after analysis (see
   Privacy below for exactly what that means).
4. The browser saves the session in IndexedDB on the device and draws a
   progress chart. No accounts, nothing stored on the server.

## API

`POST /api/analyze` takes a multipart form with one field, `audio`, holding
the recording. It returns `{"transcript": [...], "metrics": {...}}` where
each transcript entry is `{"text", "start", "end"}` in seconds and
`metrics` is the dict from `backend/metrics.py`.

| Status | When | Body |
| --- | --- | --- |
| 200 | Transcribed and measured | transcript and metrics |
| 400 | Empty upload, or the last word ends before 5 s | `{"detail": message}` |
| 422 | The `audio` field is missing | FastAPI validation error |
| 502 | The speech-to-text provider is misconfigured, unreachable or failed | `{"detail": message}` |

## Privacy

- The backend keeps each recording in memory only for the duration of its
  request. It never saves audio under its own name, and it never logs it.
- The web framework (Starlette) parses uploads into a spooled temporary
  file: recordings up to 1 MB stay in memory, larger ones are spooled to
  the operating system's temp directory while the request runs, and the
  file is deleted when the request ends. A long recording may therefore
  touch disk for a few seconds.
- The audio is forwarded once to the speech-to-text provider you configure
  (Deepgram or AssemblyAI) and is subject to that provider's retention
  policy.
- Transcripts and metrics are returned to the browser and stored only in
  IndexedDB on the device.

## Stack

- Backend: Python 3.13, FastAPI, httpx, pytest
- Frontend: plain HTML, CSS and JavaScript (PWA), no framework
- Speech-to-text: Deepgram (primary) or AssemblyAI (fallback)
- Hosting: Render free tier (backend + static files)

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env   # then paste your API keys into .env
uvicorn backend.app:app --reload
```

Open http://127.0.0.1:8000 in a browser.

Run the tests:

```bash
pytest
```

Frontend tests (plain `node:test`, no dependencies; pytest also runs them when
`node` is installed):

```bash
node --test frontend/tests
```

## Deploy to Render

The app runs as one free web service on [Render](https://render.com): the
FastAPI backend serves both the API and the static frontend, so there is
nothing else to host. `render.yaml` at the repo root describes the service.

1. Push the repo to GitHub.
2. In the Render dashboard choose **New** then **Blueprint** and connect the
   repo. Render reads `render.yaml` and proposes a web service named
   `speech-coach` (Python runtime, free plan, build `pip install -r
   requirements.txt`, start `uvicorn backend.app:app`).
3. Before you apply the Blueprint, Render asks for the two secrets that
   `render.yaml` marks `sync: false`: `ASSEMBLYAI_API_KEY` and
   `DEEPGRAM_API_KEY`. Paste both. You can change them later under the
   service's **Environment** tab. `STT_PROVIDER` is preset to `assemblyai`;
   switch it to `deepgram` there if you want the other provider.
4. Apply. The first build takes a few minutes. Render polls the health check
   path `/api/health` and marks the deploy live once it answers 200.
5. Open the service URL (`https://speech-coach.onrender.com` or whatever the
   dashboard shows). Every later push to the connected branch redeploys
   automatically.

Things to know before testing or demoing on the deploy:

- **Phones need the Render URL.** Browsers only allow the microphone on
  secure origins, so `getUserMedia` works on `localhost` and on `https://`
  pages but not on a laptop's LAN address. Test on a phone by opening the
  Render URL, which is HTTPS out of the box.
- **Cold start.** The free tier spins the service down after about fifteen
  minutes without traffic, and the first open after that can take up to a
  minute while Render restarts it. Open the URL a minute before a demo, and
  say so before the demo if someone else is clicking.
- **Caching.** The backend sends `Cache-Control: no-cache` for the PWA shell
  (`/`, `/index.html`, `/sw.js`, `/manifest.json`) so a new deploy shows up
  on the next open, `public, max-age=3600` for the other static files, and
  `no-store` for everything under `/api`.
- **Privacy on the deploy** is the same as described above: each recording is
  held in memory for the duration of its request only, plus Starlette's
  transient spool file for uploads over 1 MB, which is deleted when the
  request ends. Nothing is written to the Render disk by the app, and the
  free tier's filesystem is wiped on every restart anyway.

## Repo layout

```
backend/        FastAPI app, provider clients, metrics
backend/tests/  pytest suite (network blocked)
frontend/       static PWA files served by the backend
docs/           design spec and planning notes
```

## AI disclosure

Speech-to-text is provided by a third-party API. All metric calculations,
pause detection, the user interface and the backend are hand-written.
AI coding assistants were used during development; see
`docs/ai-disclosure.md` for details.
