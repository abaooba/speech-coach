"""FastAPI entry point. Serves the API and the static frontend."""

import logging
from dataclasses import asdict
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles

from backend import metrics
from backend.providers import ProviderError, get_provider
from backend.providers.base import Word

load_dotenv()

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

MIN_RECORDING_SECONDS = 5.0
DEFAULT_CONTENT_TYPE = "application/octet-stream"

EMPTY_UPLOAD_MESSAGE = "The upload was empty. Record again and resend."
TOO_SHORT_MESSAGE = "That recording had under 5 seconds of speech. Try again."
PROVIDER_FAILED_MESSAGE = "Speech-to-text failed on our side. Your recording is safe; try again."

app = FastAPI(title="Speech Coach")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze(audio: UploadFile) -> dict[str, object]:
    """Transcribe one uploaded recording and return its words with their metrics.

    The audio bytes are held in memory for this request only and handed straight to
    the speech-to-text provider; nothing is written by this code. Starlette spools
    multipart uploads over 1 MB to a temporary file that it deletes when the request
    ends (see the README privacy note).
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail=EMPTY_UPLOAD_MESSAGE)
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
    return {"transcript": [asdict(word) for word in words], "metrics": metrics.analyze(words)}


def speech_end_seconds(words: list[Word]) -> float:
    """When the last word ended, in seconds from the clip start; 0.0 when nothing was said."""
    return words[-1].end if words else 0.0


# Mounted last so /api routes take priority.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
