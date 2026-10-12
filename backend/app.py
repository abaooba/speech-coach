"""FastAPI entry point. Serves the API and the static frontend."""

import logging
from dataclasses import asdict
from pathlib import Path
from typing import Annotated

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import RequestResponseEndpoint

from backend import metrics
from backend.providers import ProviderError, get_provider
from backend.providers.base import Word
from backend.script_align import analyze_reading

load_dotenv()

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

MIN_RECORDING_SECONDS = 5.0
DEFAULT_CONTENT_TYPE = "application/octet-stream"
# Room for a long constructive (about 3,000 words). The alignment grows with script words
# times spoken words; at this length against a 4-minute take it still takes under a second.
MAX_SCRIPT_CHARACTERS = 20_000

EMPTY_UPLOAD_MESSAGE = "The upload was empty. Record again and resend."
TOO_SHORT_MESSAGE = "That recording had under 5 seconds of speech. Try again."
PROVIDER_FAILED_MESSAGE = "Speech-to-text failed on our side. Your recording is safe; try again."
SCRIPT_TOO_LONG_MESSAGE = "The script is over 20,000 characters. Shorten it and resend."

# The PWA shell: the browser must revalidate these on every open so a deploy shows up.
SHELL_PATHS = frozenset({"/", "/index.html", "/sw.js", "/manifest.json"})
SHELL_CACHE_CONTROL = "no-cache"
ASSET_CACHE_CONTROL = "public, max-age=3600"
API_CACHE_CONTROL = "no-store"

app = FastAPI(title="Speech Coach")


@app.middleware("http")
async def add_cache_headers(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Tell the browser how long each response may be reused.

    API responses are never stored. Static files that were served (status 200) get a
    header by path: the shell files revalidate every time, everything else is good for an
    hour. Errors such as a 404 pass through untouched.
    """
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = API_CACHE_CONTROL
    elif response.status_code == 200:
        is_shell = path in SHELL_PATHS
        response.headers["Cache-Control"] = SHELL_CACHE_CONTROL if is_shell else ASSET_CACHE_CONTROL
    return response


@app.get("/api/health")
def health() -> dict[str, str]:
    """Liveness check: Render's health check (render.yaml) polls this and expects a 200."""
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze(
    audio: UploadFile, script: Annotated[str | None, Form()] = None
) -> dict[str, object]:
    """Transcribe one uploaded recording and return its words with their metrics.

    `script` is the text the take was read from, if any: the metrics then gain a `script`
    block and its restarts stand in for the repeats (backend/script_align.py). A script over
    MAX_SCRIPT_CHARACTERS is turned down before the provider is called.

    The audio bytes are held in memory for this request only and handed straight to
    the speech-to-text provider; nothing is written by this code. Starlette spools
    multipart uploads over 1 MB to a temporary file that it deletes when the request
    ends (see the README privacy note).
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail=EMPTY_UPLOAD_MESSAGE)
    # A browser sends a textarea's line breaks as CRLF; each still counts as one character.
    script = (script or "").replace("\r\n", "\n")
    if len(script) > MAX_SCRIPT_CHARACTERS:
        raise HTTPException(status_code=400, detail=SCRIPT_TOO_LONG_MESSAGE)
    content_type = audio.content_type or DEFAULT_CONTENT_TYPE
    try:
        provider = get_provider()
        # Providers block on HTTP; a worker thread keeps the event loop free.
        words = await run_in_threadpool(provider.transcribe, audio_bytes, content_type)
    except (ProviderError, httpx.HTTPError) as exc:
        logger.warning("Transcription failed: %s", exc)
        raise HTTPException(status_code=502, detail=PROVIDER_FAILED_MESSAGE) from exc
    if speech_end_seconds(words) < MIN_RECORDING_SECONDS:
        raise HTTPException(status_code=400, detail=TOO_SHORT_MESSAGE)
    take_metrics = analyze_reading(words, script) if script else metrics.analyze(words)
    return {"transcript": [asdict(word) for word in words], "metrics": take_metrics}


def speech_end_seconds(words: list[Word]) -> float:
    """When the last word ended, in seconds from the clip start; 0.0 when nothing was said."""
    return words[-1].end if words else 0.0


# Mounted last so /api routes take priority.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
