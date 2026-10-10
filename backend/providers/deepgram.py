"""Deepgram provider: one synchronous request to the nova-3 model with filler words kept."""

import httpx

from backend.providers.base import Word, raise_for_status

LISTEN_URL = "https://api.deepgram.com/v1/listen"
REQUEST_TIMEOUT_SECONDS = 120.0
LISTEN_PARAMS = {"model": "nova-3", "filler_words": "true", "punctuate": "true"}


class DeepgramProvider:
    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS)
        self._api_key = api_key

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        response = self._client.post(
            LISTEN_URL,
            params=LISTEN_PARAMS,
            headers={"Authorization": f"Token {self._api_key}", "Content-Type": content_type},
            content=audio_bytes,
        )
        raise_for_status(response, "Deepgram")
        alternative = response.json()["results"]["channels"][0]["alternatives"][0]
        return [to_word(w) for w in alternative["words"]]


def to_word(raw: dict) -> Word:
    """Map one Deepgram word (times already in seconds) to a Word, keeping punctuation."""
    return Word(text=raw.get("punctuated_word", raw["word"]), start=raw["start"], end=raw["end"])
