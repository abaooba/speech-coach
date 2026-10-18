"""FastAPI entry point. Serves the API and the static frontend."""

import logging
import os
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
from backend.advice.budget import ADVICE_CALL_BUDGET, AICallBudget
from backend.language import check
from backend.limits import RequestBodyLimit
from backend.providers import ProviderError, get_provider
from backend.providers.base import Word
from backend.script_align import alignment_cells, analyze_reading

load_dotenv()

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

MIN_RECORDING_SECONDS = 5.0
DEFAULT_CONTENT_TYPE = "application/octet-stream"
# Room for a long constructive (about 3,000 words). The alignment grows with script words
# times spoken words; at this length against a 4-minute take it takes under a second and
# about 10 MB, and it runs off the event loop as the transcription does.
MAX_SCRIPT_CHARACTERS = 20_000
# Lining a take up against its script fills a 4-byte cell for each spoken word and script word
# pair (backend/script_align.py). 25 million is about 115 MB, a safe share of the 512 MB on
# Render's free plan, and over ten times a 4-minute take against the longest script.
MAX_ALIGNMENT_CELLS = 25_000_000

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

# Every request body is held to its route's limit, 413 past it (backend/limits.py). Added before
# the cache headers below, so it runs inside them and its 413 is never stored, as no API answer is.
app.add_middleware(RequestBodyLimit)


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
    MAX_SCRIPT_CHARACTERS is turned down before the provider is called. A take and script too
    large to line up against each other (MAX_ALIGNMENT_CELLS) are scored as free talk instead,
    with no script block.

    The audio bytes are held in memory for this request only and handed straight to
    the speech-to-text provider; nothing is written by this code, and the provider is asked to
    delete its copy as soon as the words are back (discard_provider_copy). Starlette spools
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
    provider = None
    try:
        provider = get_provider()
        # Providers block on HTTP; a worker thread keeps the event loop free.
        words = await run_in_threadpool(provider.transcribe, audio_bytes, content_type)
    except (ProviderError, httpx.HTTPError) as exc:
        logger.warning("Transcription failed: %s", exc)
        # A failed or timed-out job may still have left a transcript at the provider.
        if provider is not None:
            await run_in_threadpool(discard_provider_copy, provider)
        raise HTTPException(status_code=502, detail=PROVIDER_FAILED_MESSAGE) from exc
    # The provider's copy is deleted the moment the words are here, before the take is judged:
    # a take refused as too short has a copy to delete too. Off the event loop, as the upload was.
    await run_in_threadpool(discard_provider_copy, provider)
    if speech_end_seconds(words) < MIN_RECORDING_SECONDS:
        raise HTTPException(status_code=400, detail=TOO_SHORT_MESSAGE)
    if script and alignment_cells(words, script) <= MAX_ALIGNMENT_CELLS:
        take_metrics = await run_in_threadpool(analyze_reading, words, script)
    else:
        take_metrics = metrics.analyze(words)
    return {"transcript": [_transcript_entry(word) for word in words], "metrics": take_metrics}


def _transcript_entry(word: Word) -> dict:
    """A word as the browser gets it: text and times, plus confidence when the provider gave one."""
    entry = {"text": word.text, "start": word.start, "end": word.end}
    if word.confidence is not None:
        entry["confidence"] = word.confidence
    return entry


def speech_end_seconds(words: list[Word]) -> float:
    """When the last word ended, in seconds from the clip start; 0.0 when nothing was said."""
    return words[-1].end if words else 0.0


def discard_provider_copy(provider: object) -> None:
    """Ask the provider to delete its copy of the take, when it keeps one.

    AssemblyAI keeps the transcript and the uploaded audio until asked (its provider's
    delete_last_transcript); Deepgram keeps nothing this code can delete. A provider without the
    method, the tests' fakes included, is left alone. The call never raises: the take is already
    in hand (or the job already failed), so a delete that goes wrong must not cost the speaker
    the answer. Only the error's class is logged, because its message can hold the speaker's words.
    """
    delete = getattr(provider, "delete_last_transcript", None)
    if callable(delete):
        try:
            delete()
        except Exception as error:  # noqa: BLE001 - best effort, see the docstring
            logger.warning("Could not discard the provider's copy (%s)", type(error).__name__)


def advice_client() -> AsyncAnthropic | None:
    """The client /api/advice asks Claude with, or None when ANTHROPIC_API_KEY is unset or blank.

    Without a key no client is built and the speaker gets the library's tips. The key is read
    from the environment only and never logged. Tests replace this dependency with a fake.
    """
    api_key = os.environ.get(ANTHROPIC_API_KEY_VARIABLE, "").strip()
    return coach.client_for_key(api_key) if api_key else None


def advice_call_budget() -> AICallBudget:
    """The AI calls /api/advice may still make this hour: the server's one budget (budget.py).

    Every visitor spends from it, whatever their address. Tests replace it with their own.
    """
    return ADVICE_CALL_BUDGET


@app.post("/api/advice")
async def advice(
    advice_request: coach.AdviceRequest,
    client: Annotated[AsyncAnthropic | None, Depends(advice_client)],
    budget: Annotated[AICallBudget, Depends(advice_call_budget)],
) -> coach.Advice:
    """Coach notes for one take: 2-3 tips, each with its library entry's drill and citation.

    The body is the take's numbers with a transcript excerpt, the take's moments when the
    frontend sends them, the speaker's tier and the ids of the advice already shown
    (coach.AdviceRequest). Claude Haiku writes the tips from library advice, each pointing at
    the moments it quotes, and a headline quoting one moment, when a key is set, the hour's
    budget of calls for the whole server is not spent (backend/advice/budget.py) and its reply
    keeps the rules; otherwise they are the library's own words with no headline. `source` says
    which ("ai" or "library"), and the shape, {headline, tips, source}, is the same either way.

    Everyone is served the same way: the advice already shown is the `shown_ids` the request
    sends, and nothing is recorded on the server. No cookie or header changes the answer.
    """
    return await coach.advise(advice_request, load_library(), client, budget)


@app.post("/api/language-check")
async def language_check(
    check_request: check.LanguageCheckRequest,
    client: Annotated[AsyncAnthropic | None, Depends(advice_client)],
    budget: Annotated[AICallBudget, Depends(advice_call_budget)],
) -> check.LanguageCheck | check.Unavailable:
    """Grammar fixes, stronger words and sentence rewrites for one take's transcript.

    The speaker asks for it with a button; nothing is saved. A transcript over 8,000 characters
    is refused with 400. Claude Haiku writes the suggestions while a key is set and the hour's
    budget of AI calls, shared with /api/advice, is not spent; every `said` it quotes is checked
    against the transcript (backend/language/check.py). The answer is {status: "ok", fixes, words,
    rewrites, praise}, or {status: "unavailable"} when the check could not be made.
    """
    if len(check_request.transcript) > check.MAX_TRANSCRIPT_CHARACTERS:
        raise HTTPException(status_code=400, detail=check.TRANSCRIPT_TOO_LONG)
    return await check.check_language(check_request, client, budget)


# Mounted last so /api routes take priority.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
