"""Speech-to-text providers. get_provider() picks one from the STT_PROVIDER env var."""

import os

from backend.providers.assemblyai import AssemblyAIProvider
from backend.providers.base import ProviderError, Transcriber, Word
from backend.providers.deepgram import DeepgramProvider

DEFAULT_PROVIDER = "assemblyai"

__all__ = ["AssemblyAIProvider", "DeepgramProvider", "ProviderError", "Transcriber", "Word"]


def get_provider() -> Transcriber:
    """Build the provider named by STT_PROVIDER (default assemblyai) using its API key."""
    name = os.environ.get("STT_PROVIDER", DEFAULT_PROVIDER).strip().lower()
    if name == "assemblyai":
        return AssemblyAIProvider(api_key=_require_env("ASSEMBLYAI_API_KEY"))
    if name == "deepgram":
        return DeepgramProvider(api_key=_require_env("DEEPGRAM_API_KEY"))
    raise ProviderError(f"Unknown STT_PROVIDER {name!r}; expected 'assemblyai' or 'deepgram'")


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ProviderError(f"{name} is not set; add it to .env")
    return value
