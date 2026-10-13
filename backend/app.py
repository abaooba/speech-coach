"""FastAPI entry point. Serves the API and the static frontend."""

import logging
import os
from dataclasses import asdict
from pathlib import Path
from typing import Annotated

import httpx
from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Form, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import RequestResponseEndpoint

from backend import metrics
from backend.advice import coach, load_library
from backend.providers import ProviderError, get_provider
from backend.providers.base import Word
from backend.script_align import analyze_reading

load_dotenv()

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

MIN_RECORDING_SECONDS = 5.0
DEFAULT_CONTENT_TYPE = "application/octet-stream"
# Room for a long constructive (about 3,000 words). The alignment grows with script words
# times spoken words; at this length against a 4-minute take it takes under a second and
# about 10 MB, and it runs off the event loop as the transcription does.
MAX_SCRIPT_CHARACTERS = 20_000

EMPTY_UPLOAD_MESSAGE = "The upload was empty. Record again and resend."
TOO_SHORT_MESSAGE = "That recording had under 5 seconds of speech. Try again."
PROVIDER_FAILED_MESSAGE = "Speech-to-text failed on our side. Your recording is safe; try again."
SCRIPT_TOO_LONG_MESSAGE = "The script is over 20,000 characters. Shorten it and resend."

# Where the server finds the Anthropic API key for coach notes: the environment only (the
# Render dashboard, or .env locally), never a file in the repo.
ANTHROPIC_API_KEY_VARIABLE = "ANTHROPIC_API_KEY"

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


@app.exception_handler(RequestValidationError)
async def refuse_invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
    """Answer a request that fails validation with a 422 naming each problem, not its value.

    FastAPI's own answer quotes each rejected value back. A value JSON cannot carry, such as NaN
    or half of a UTF-16 surrogate pair, then breaks that answer into a 500, and a rejected
    transcript excerpt is sent straight back. Each problem keeps its location, message and type.
    """
    problems = [
        {key: value for key, value in problem.items() if key != "input"}
        for problem in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(problems)})


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
    if script:
        take_metrics = await run_in_threadpool(analyze_reading, words, script)
    else:
        take_metrics = metrics.analyze(words)
    return {"transcript": [asdict(word) for word in words], "metrics": take_metrics}


def speech_end_seconds(words: list[Word]) -> float:
    """When the last word ended, in seconds from the clip start; 0.0 when nothing was said."""
    return words[-1].end if words else 0.0


def advice_client() -> AsyncAnthropic | None:
    """The client /api/advice asks Claude with, or None when ANTHROPIC_API_KEY is unset or blank.

    Without a key no client is built and the speaker gets the library's tips. The key is read
    from the environment only and never logged. Tests replace this dependency with a fake.
    """
    api_key = os.environ.get(ANTHROPIC_API_KEY_VARIABLE, "").strip()
    return coach.client_for_key(api_key) if api_key else None


@app.post("/api/advice")
async def advice(
    advice_request: coach.AdviceRequest,
    client: Annotated[AsyncAnthropic | None, Depends(advice_client)],
) -> coach.Advice:
    """Coach notes for one take: 2-3 tips, each with its library entry's drill and citation.

    The body is the take's numbers with a transcript excerpt, the speaker's tier and the ids of
    the advice already shown (coach.AdviceRequest). Claude Haiku writes the tips from library
    advice when a key is set and its reply keeps the rules; otherwise they are the library's
    own words. `source` says which ("ai" or "library"), and the shape is the same either way.
    """
    return await coach.advise(advice_request, load_library(), client)


# Mounted last so /api routes take priority.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
