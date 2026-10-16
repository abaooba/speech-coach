"""AssemblyAI provider: upload the clip, create a transcript job, poll until it completes.

AssemblyAI reports word times in milliseconds; this module converts them to seconds. The whole
exchange, from the upload to the finished transcript, is held to TRANSCRIBE_DEADLINE_SECONDS.

transcribe() keeps the transcript's id, and delete_last_transcript() then asks AssemblyAI to
delete it (DELETE /v2/transcript/{id}), which its docs say removes the uploaded audio with it.
/api/analyze calls the second right after the first, also when the job failed or timed out. It is
best effort: a failure is logged and never costs the speaker the take.
"""

import logging
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

logger = logging.getLogger(__name__)

BASE_URL = "https://api.assemblyai.com/v2"
DEFAULT_POLL_INTERVAL_SECONDS = 2.0
REQUEST_TIMEOUT_SECONDS = 120.0
# The longest one transcription may take, counted from the start of the upload. The browser
# gives up on /api/analyze after 180 s (frontend/api.js ANALYZE_TIMEOUT_MS); stopping 30 s sooner
# leaves time for the recording to arrive and the answer to go back, so the speaker is told the
# provider failed rather than that the server could not be reached.
TRANSCRIBE_DEADLINE_SECONDS = 150.0
# The delete runs once the words are in hand and has its own short limit: a slow delete must not
# hold the speaker's answer, and a transcript that outlives it expires under the account's
# retention setting in AssemblyAI's dashboard.
DELETE_TIMEOUT_SECONDS = 10.0


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
        # The id of the transcript the last transcribe() read, until delete_last_transcript()
        # deletes it. get_provider() builds one provider per request, so no two takes share it.
        self.last_transcript_id: str | None = None

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        """Upload, start the job, wait for it, return its words; content_type is unused here.

        Raises ProviderError when any request fails, a reply is not the shape AssemblyAI
        documents, the job ends in status "error", or the job is still unfinished
        TRANSCRIBE_DEADLINE_SECONDS after the upload began. Each request's timeout is the time
        left, REQUEST_TIMEOUT_SECONDS at most, and no wait between polls runs past the deadline.
        The transcript's id is kept in last_transcript_id as soon as the job is created, success
        or not, for delete_last_transcript().
        """
        deadline = self._clock() + TRANSCRIBE_DEADLINE_SECONDS
        audio_url = self._upload(audio_bytes, deadline)
        transcript_id = self._create_transcript(audio_url, deadline)
        # Kept as soon as the job exists, so a job that fails or times out can still be deleted.
        self.last_transcript_id = transcript_id
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

    def delete_last_transcript(self) -> None:
        """Ask AssemblyAI to delete the last transcript read, and with it the audio uploaded for it.

        Nothing is sent when no transcript was read, or it was deleted already. Best effort: a
        failure is logged by its status code or error class alone, because the reply and the
        error can hold the speaker's words, and the log must not.
        """
        transcript_id = self.last_transcript_id
        if transcript_id is None:
            return
        self.last_transcript_id = None
        try:
            response = self._client.delete(
                f"{BASE_URL}/transcript/{transcript_id}",
                headers=self._headers,
                timeout=DELETE_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as error:
            logger.warning(
                "AssemblyAI delete failed (%s); the transcript stays until it expires",
                type(error).__name__,
            )
            return
        if not response.is_success:
            logger.warning(
                "AssemblyAI delete returned HTTP %d; the transcript stays until it expires",
                response.status_code,
            )

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
