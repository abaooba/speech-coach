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
   them with the transcript. Audio is discarded after analysis.
4. The browser saves the session in IndexedDB on the device and draws a
   progress chart. No accounts, nothing stored on the server.

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
