"""AssemblyAI provider: upload the clip, create a transcript job, poll until it completes.

AssemblyAI reports word times in milliseconds; this module converts them to seconds. The whole
exchange, from the upload to the finished transcript, is held to TRANSCRIBE_DEADLINE_SECONDS.
"""

import time
from collections.abc import Callable

import httpx

from backend.providers.base import (
    ProviderError,
    Word,
    checked_word,
    raise_for_status,
    reading_reply,
)

BASE_URL = "https://api.assemblyai.com/v2"
DEFAULT_POLL_INTERVAL_SECONDS = 2.0
REQUEST_TIMEOUT_SECONDS = 120.0
# The longest one transcription may take, counted from the start of the upload. The browser
# gives up on /api/analyze after 180 s (frontend/api.js ANALYZE_TIMEOUT_MS); stopping 30 s sooner
# leaves time for the recording to arrive and the answer to go back, so the speaker is told the
# provider failed rather than that the server could not be reached.
TRANSCRIBE_DEADLINE_SECONDS = 150.0


class AssemblyAIProvider:
    """Transcriber backed by AssemblyAI. Tests pass a client and sleep to skip network and waits.

    `clock` gives the time in seconds. It is time.monotonic unless a test gives its own: a change
    to the system clock cannot move it, so it can neither cut a transcription short nor stretch it.
    """

    def __init__(
        self,
        api_key: str,
        client: httpx.Client | None = None,
        poll_interval: float = DEFAULT_POLL_INTERVAL_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client or httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS)
        self._headers = {"authorization": api_key}
        self._poll_interval = poll_interval
        self._sleep = sleep
        self._clock = clock

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        """Upload, start the job, wait for it, return its words; content_type is unused here.

        Raises ProviderError when any request fails, a reply is not the shape AssemblyAI
        documents, the job ends in status "error", or the job is still unfinished
        TRANSCRIBE_DEADLINE_SECONDS after the upload began. Each request's timeout is the time
        left, REQUEST_TIMEOUT_SECONDS at most, and no wait between polls runs past the deadline.
        """
        deadline = self._clock() + TRANSCRIBE_DEADLINE_SECONDS
        audio_url = self._upload(audio_bytes, deadline)
        transcript_id = self._create_transcript(audio_url, deadline)
        completed = self._wait_for_completion(transcript_id, deadline)
        with reading_reply("AssemblyAI poll"):
            return [to_word(w) for w in completed["words"]]

    def _upload(self, audio_bytes: bytes, deadline: float) -> str:
        response = self._client.post(
            f"{BASE_URL}/upload",
            headers=self._headers,
            content=audio_bytes,
            timeout=self._time_left(deadline),
        )
        raise_for_status(response, "AssemblyAI upload")
        with reading_reply("AssemblyAI upload"):
            return response.json()["upload_url"]

    def _create_transcript(self, audio_url: str, deadline: float) -> str:
        response = self._client.post(
            f"{BASE_URL}/transcript",
            headers=self._headers,
            json={"audio_url": audio_url, "disfluencies": True},
            timeout=self._time_left(deadline),
        )
        raise_for_status(response, "AssemblyAI transcript")
        with reading_reply("AssemblyAI transcript"):
            return response.json()["id"]

    def _wait_for_completion(self, transcript_id: str, deadline: float) -> dict:
        while True:
            response = self._client.get(
                f"{BASE_URL}/transcript/{transcript_id}",
                headers=self._headers,
                timeout=self._time_left(deadline),
            )
            raise_for_status(response, "AssemblyAI poll")
            with reading_reply("AssemblyAI poll"):
                transcript = response.json()
                status = transcript["status"]
            if status == "completed":
                return transcript
            if status == "error":
                raise ProviderError(f"AssemblyAI transcript failed: {transcript.get('error')}")
            self._sleep(min(self._poll_interval, self._time_left(deadline)))

    def _time_left(self, deadline: float) -> float:
        """Seconds left before `deadline`, REQUEST_TIMEOUT_SECONDS at most; ProviderError at 0."""
        left = deadline - self._clock()
        if left <= 0:
            raise ProviderError(
                f"AssemblyAI did not finish within {TRANSCRIBE_DEADLINE_SECONDS:g} s"
            )
        return min(left, REQUEST_TIMEOUT_SECONDS)


def to_word(raw: dict) -> Word:
    """Map one AssemblyAI word (times in ms) to a Word (times in seconds).

    Raises KeyError, TypeError or ValueError for a word of another shape (checked_word).
    """
    return checked_word(raw["text"], raw["start"] / 1000, raw["end"] / 1000)
