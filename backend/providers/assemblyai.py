"""AssemblyAI provider: upload the clip, create a transcript job, poll until it completes.

AssemblyAI reports word times in milliseconds; this module converts them to seconds.
"""

import time
from collections.abc import Callable

import httpx

from backend.providers.base import ProviderError, Word, raise_for_status

BASE_URL = "https://api.assemblyai.com/v2"
DEFAULT_POLL_INTERVAL_SECONDS = 2.0
REQUEST_TIMEOUT_SECONDS = 120.0


class AssemblyAIProvider:
    def __init__(
        self,
        api_key: str,
        client: httpx.Client | None = None,
        poll_interval: float = DEFAULT_POLL_INTERVAL_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client = client or httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS)
        self._headers = {"authorization": api_key}
        self._poll_interval = poll_interval
        self._sleep = sleep

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        audio_url = self._upload(audio_bytes)
        transcript_id = self._create_transcript(audio_url)
        completed = self._wait_for_completion(transcript_id)
        return [to_word(w) for w in completed["words"]]

    def _upload(self, audio_bytes: bytes) -> str:
        response = self._client.post(
            f"{BASE_URL}/upload", headers=self._headers, content=audio_bytes
        )
        raise_for_status(response, "AssemblyAI upload")
        return response.json()["upload_url"]

    def _create_transcript(self, audio_url: str) -> str:
        response = self._client.post(
            f"{BASE_URL}/transcript",
            headers=self._headers,
            json={"audio_url": audio_url, "disfluencies": True},
        )
        raise_for_status(response, "AssemblyAI transcript")
        return response.json()["id"]

    def _wait_for_completion(self, transcript_id: str) -> dict:
        while True:
            response = self._client.get(
                f"{BASE_URL}/transcript/{transcript_id}", headers=self._headers
            )
            raise_for_status(response, "AssemblyAI poll")
            transcript = response.json()
            status = transcript["status"]
            if status == "completed":
                return transcript
            if status == "error":
                raise ProviderError(f"AssemblyAI transcript failed: {transcript.get('error')}")
            self._sleep(self._poll_interval)


def to_word(raw: dict) -> Word:
    """Map one AssemblyAI word (times in ms) to a Word (times in seconds)."""
    return Word(text=raw["text"], start=raw["start"] / 1000, end=raw["end"] / 1000)
