"""Shared types for speech-to-text providers.

Every provider turns raw audio into the same list of timed words so the
metrics code never has to know which service produced them.
"""

import math
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Protocol, TypeIs

import httpx

# What reading a reply of the wrong shape raises: not JSON (ValueError), a field missing
# (KeyError, IndexError) or one of the wrong type (TypeError, AttributeError, ValueError).
UNREADABLE_REPLY_ERRORS = (ValueError, LookupError, TypeError, AttributeError)


@dataclass(frozen=True, slots=True)
class Word:
    """One spoken token with its start and end time in seconds from the clip start."""

    text: str
    start: float
    end: float
    # The service's own 0-1 confidence in this word, None when it sent none. It only marks words
    # that may have been unclear; no metric, score or rank reads it.
    confidence: float | None = None


class ProviderError(Exception):
    """A provider could not produce a transcript (bad key, rejected audio, failed job)."""


class Transcriber(Protocol):
    """Anything with a transcribe method; the API depends on this, never on one service."""

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


@contextmanager
def reading_reply(provider_name: str) -> Iterator[None]:
    """Turn a 2xx reply that is not the shape the provider documents into a ProviderError.

    Reading one raises one of UNREADABLE_REPLY_ERRORS, which /api/analyze does not catch, and
    the speaker would get a 500 instead of the provider message. The error is named by its class
    alone: the reply can hold the speaker's words.
    """
    try:
        yield
    except UNREADABLE_REPLY_ERRORS as error:
        raise ProviderError(
            f"{provider_name} sent a reply that could not be read ({type(error).__name__})"
        ) from error


def checked_word(text: object, start: object, end: object, confidence: object = None) -> Word:
    """A Word from the fields of a reply: its text must be a string, its times finite numbers.

    Otherwise ValueError. A word with no text, or a time that is text or not finite, would get
    past the provider and break the metrics or the answer; inside reading_reply it is a
    ProviderError instead. A confidence that is missing, not a finite number or a bool becomes
    None; any other is clamped to 0-1 and rounded to 2 decimals.
    """
    if isinstance(text, str) and _is_finite_number(start) and _is_finite_number(end):
        return Word(text=text, start=start, end=end, confidence=_clean_confidence(confidence))
    raise ValueError("a word needs its text as a string and its times as finite numbers")


def _is_finite_number(value: object) -> TypeIs[int | float]:
    return isinstance(value, int | float) and math.isfinite(value)


def _clean_confidence(value: object) -> float | None:
    if isinstance(value, bool) or not _is_finite_number(value):
        return None
    return round(min(1.0, max(0.0, float(value))), 2)
