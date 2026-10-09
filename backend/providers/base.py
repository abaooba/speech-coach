"""Shared types for speech-to-text providers.

Every provider turns raw audio into the same list of timed words so the
metrics code never has to know which service produced them.
"""

from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass(frozen=True, slots=True)
class Word:
    """One spoken token with its start and end time in seconds from the clip start."""

    text: str
    start: float
    end: float


class ProviderError(Exception):
    """A provider could not produce a transcript (bad key, rejected audio, failed job)."""


class Transcriber(Protocol):
    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        """Send one audio clip and return its words in time order."""
        ...


def raise_for_status(response: httpx.Response, provider_name: str) -> None:
    """Turn a non-2xx response into a ProviderError that names the provider and status."""
    if response.is_success:
        return
    raise ProviderError(
        f"{provider_name} returned HTTP {response.status_code}: {response.text[:200]}"
    )
