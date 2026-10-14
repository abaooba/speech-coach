"""AssemblyAI is held to one deadline for the whole transcription (backend/providers/assemblyai.py).

A job that stayed queued or processing was polled forever: each request had a 120 s timeout, but
nothing bounded the whole. Now TRANSCRIBE_DEADLINE_SECONDS (150 s), counted from the start of
transcribe(), ends it with a ProviderError, so /api/analyze answers 502 "provider" before the
browser gives up on the request at 180 s (frontend/api.js ANALYZE_TIMEOUT_MS). Each request is
given at most the time left.

Time is a fake monotonic clock that moves only when the provider sleeps or a request is made to
take time. All HTTP goes through httpx.MockTransport; pytest-socket blocks the network.
"""

import inspect
import re
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.providers import assemblyai
from backend.providers.assemblyai import AssemblyAIProvider
from backend.providers.base import ProviderError, Word

API_JS = Path(__file__).resolve().parents[2] / "frontend" / "api.js"

AUDIO = b"fake-audio-bytes"
CONTENT_TYPE = "audio/webm"
TRANSCRIPT_ID = "t-slow"
UPLOAD_URL = "https://cdn.assemblyai.com/upload/fake-upload-token"
COMPLETED = {
    "id": TRANSCRIPT_ID,
    "status": "completed",
    "words": [
        {"text": "Hello,", "start": 0, "end": 400},
        {"text": "judges.", "start": 450, "end": 900},
    ],
}

# The deadline the fix sets, and the request timeout the provider already had. It polls every 2 s.
DEADLINE_SECONDS = 150.0
REQUEST_TIMEOUT_SECONDS = 120.0
# Room the browser leaves around the backend's deadline: the recording has to arrive first, and
# the answer has to get back.
UPLOAD_AND_REPLY_SECONDS = 30
# Without a deadline the provider polls forever; the fake clock stops it after this many sleeps
# (over half an hour of fake time), so a failing test ends instead of hanging the run.
MAX_SLEEPS = 1_000


class FakeClock:
    """A monotonic clock that moves only when the provider sleeps or a request takes time."""

    def __init__(self) -> None:
        # Any start will do: only differences count.
        self.now = 5_000.0
        self.sleeps = 0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps += 1
        if self.sleeps > MAX_SLEEPS:
            raise RuntimeError("still polling long after the deadline")
        self.now += seconds


class SlowJob:
    """AssemblyAI with a job that stays "processing" until poll `done_after` + 1 (never: None).

    The upload takes `upload_seconds` on the fake clock. Each request's read timeout is kept.
    """

    def __init__(
        self, clock: FakeClock, done_after: int | None = None, upload_seconds: float = 0.0
    ) -> None:
        self.clock = clock
        self.done_after = done_after
        self.upload_seconds = upload_seconds
        self.polls = 0
        self.timeouts: list[float] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.timeouts.append(request.extensions["timeout"]["read"])
        path = request.url.path
        if request.method == "POST" and path == "/v2/upload":
            self.clock.now += self.upload_seconds
            return httpx.Response(200, json={"upload_url": UPLOAD_URL})
        if request.method == "POST" and path == "/v2/transcript":
            return httpx.Response(200, json={"id": TRANSCRIPT_ID, "status": "queued"})
        if request.method == "GET" and path == f"/v2/transcript/{TRANSCRIPT_ID}":
            self.polls += 1
            if self.done_after is not None and self.polls > self.done_after:
                return httpx.Response(200, json=COMPLETED)
            return httpx.Response(200, json={"id": TRANSCRIPT_ID, "status": "processing"})
        return httpx.Response(404, json={"error": f"unexpected {request.method} {path}"})


def provider_for(job: SlowJob, clock: FakeClock) -> AssemblyAIProvider:
    return AssemblyAIProvider(
        api_key="test-key",
        client=httpx.Client(transport=httpx.MockTransport(job)),
        sleep=clock.sleep,
        clock=clock,
    )


# --- the deadline ----------------------------------------------------------------------------


def test_the_deadline_is_150_seconds_on_a_monotonic_clock() -> None:
    clock = inspect.signature(AssemblyAIProvider).parameters["clock"]

    assert assemblyai.TRANSCRIBE_DEADLINE_SECONDS == DEADLINE_SECONDS
    # A change to the system clock cannot move time.monotonic, as in backend/advice/budget.py.
    assert clock.default is time.monotonic


def test_a_job_that_never_finishes_fails_when_the_deadline_passes() -> None:
    clock = FakeClock()
    job = SlowJob(clock)
    started = clock.now

    with pytest.raises(ProviderError, match="150 s"):
        provider_for(job, clock).transcribe(AUDIO, CONTENT_TYPE)

    assert clock.now - started == DEADLINE_SECONDS
    # A poll every 2 s from 0 s to 148 s; at 150 s it stops rather than polling again.
    assert job.polls == 75


def test_time_spent_uploading_counts_against_the_deadline() -> None:
    clock = FakeClock()
    job = SlowJob(clock, upload_seconds=140.0)

    with pytest.raises(ProviderError):
        provider_for(job, clock).transcribe(AUDIO, CONTENT_TYPE)

    # Polls at 140, 142, 144, 146 and 148 s.
    assert job.polls == 5


def test_the_last_wait_ends_at_the_deadline_not_a_poll_later() -> None:
    clock = FakeClock()
    # Created and first polled at 149 s: 1 s is left, less than the 2 s between polls.
    job = SlowJob(clock, upload_seconds=149.0)
    started = clock.now

    with pytest.raises(ProviderError):
        provider_for(job, clock).transcribe(AUDIO, CONTENT_TYPE)

    assert clock.now - started == DEADLINE_SECONDS
    assert job.polls == 1


def test_each_request_waits_no_longer_than_the_time_left() -> None:
    clock = FakeClock()
    job = SlowJob(clock, upload_seconds=100.0)

    with pytest.raises(ProviderError):
        provider_for(job, clock).transcribe(AUDIO, CONTENT_TYPE)

    upload, create, *polls = job.timeouts
    # 150 s were left for the upload, more than one request is ever given.
    assert upload == REQUEST_TIMEOUT_SECONDS
    # The upload took 100 s; the job is created at 100 s and polled from 100 s to 148 s.
    assert create == DEADLINE_SECONDS - 100
    assert polls == [DEADLINE_SECONDS - at for at in range(100, 150, 2)]


def test_a_job_that_finishes_just_before_the_deadline_gives_its_words() -> None:
    clock = FakeClock()
    # The 75th poll, at 148 s, finds the job completed.
    job = SlowJob(clock, done_after=74)

    words = provider_for(job, clock).transcribe(AUDIO, CONTENT_TYPE)

    assert words == [Word(text="Hello,", start=0.0, end=0.4), Word("judges.", 0.45, 0.9)]
    assert job.polls == 75


# --- what the speaker sees -------------------------------------------------------------------


def test_the_api_answers_502_with_the_provider_message_when_the_job_never_finishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = FakeClock()
    provider = provider_for(SlowJob(clock), clock)
    monkeypatch.setattr(app_module, "get_provider", lambda: provider)

    response = TestClient(app_module.app).post(
        "/api/analyze", files={"audio": ("recording.webm", AUDIO, CONTENT_TYPE)}
    )

    # frontend/api.js reads a 502 as kind "provider".
    assert response.status_code == 502
    assert response.json() == {"detail": app_module.PROVIDER_FAILED_MESSAGE}


def test_the_browser_gives_up_only_after_the_backend_has_with_room_to_spare() -> None:
    source = API_JS.read_text(encoding="utf-8")
    [timeout_ms] = re.findall(r"const ANALYZE_TIMEOUT_MS = (\d+);", source)
    browser_seconds = int(timeout_ms) / 1000

    room = browser_seconds - assemblyai.TRANSCRIBE_DEADLINE_SECONDS

    assert room >= UPLOAD_AND_REPLY_SECONDS
    assert "TRANSCRIBE_DEADLINE_SECONDS" in source, "api.js names the deadline it relies on"
