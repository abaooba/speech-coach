"""Provider tests. All HTTP goes through httpx.MockTransport; pytest-socket blocks the network."""

import json
from pathlib import Path

import httpx
import pytest

from backend.providers import get_provider
from backend.providers.assemblyai import AssemblyAIProvider
from backend.providers.base import ProviderError, Word
from backend.providers.deepgram import DeepgramProvider

FIXTURES = Path(__file__).parent / "fixtures"
AUDIO = b"fake-audio-bytes"
CONTENT_TYPE = "audio/webm"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


# --- Word -------------------------------------------------------------------


def test_word_is_an_immutable_record_of_text_and_seconds() -> None:
    word = Word(text="um,", start=2.417, end=2.724)
    assert (word.text, word.start, word.end) == ("um,", 2.417, 2.724)
    with pytest.raises(AttributeError):
        word.text = "uh"  # type: ignore[misc]


# --- AssemblyAI -------------------------------------------------------------


class AssemblyAIFake:
    """Scripted AssemblyAI server: upload, create transcript, then poll until completed."""

    def __init__(self, completed: dict, polls_before_done: int = 2) -> None:
        self.completed = completed
        self.polls_before_done = polls_before_done
        self.requests: list[httpx.Request] = []
        self.polls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if request.method == "POST" and path == "/v2/upload":
            return httpx.Response(200, json={"upload_url": self.completed["audio_url"]})
        if request.method == "POST" and path == "/v2/transcript":
            return httpx.Response(200, json={"id": self.completed["id"], "status": "queued"})
        if request.method == "GET" and path == f"/v2/transcript/{self.completed['id']}":
            self.polls += 1
            if self.polls <= self.polls_before_done:
                return httpx.Response(
                    200, json={"id": self.completed["id"], "status": "processing"}
                )
            return httpx.Response(200, json=self.completed)
        return httpx.Response(404, json={"error": f"unexpected {request.method} {path}"})


def test_assemblyai_returns_words_in_seconds_from_recorded_response() -> None:
    fake = AssemblyAIFake(load_fixture("assemblyai_transcript_completed.json"))
    provider = AssemblyAIProvider(
        api_key="test-key", client=mock_client(fake), sleep=lambda _: None
    )

    words = provider.transcribe(AUDIO, CONTENT_TYPE)

    assert all(isinstance(w, Word) for w in words)
    assert words[0] == Word(text="Hey,", start=1.287, end=1.497)
    assert words[2] == Word(text="um,", start=2.417, end=2.724)
    assert len(words) == 8


def test_assemblyai_uploads_audio_then_requests_disfluencies_then_polls() -> None:
    fake = AssemblyAIFake(load_fixture("assemblyai_transcript_completed.json"), polls_before_done=2)
    slept: list[float] = []
    provider = AssemblyAIProvider(
        api_key="test-key", client=mock_client(fake), poll_interval=0.5, sleep=slept.append
    )

    provider.transcribe(AUDIO, CONTENT_TYPE)

    upload, create, *polls = fake.requests
    assert upload.content == AUDIO
    assert upload.headers["authorization"] == "test-key"
    body = json.loads(create.content)
    assert body["disfluencies"] is True
    assert body["audio_url"] == "https://cdn.assemblyai.com/upload/fake-upload-token"
    assert len(polls) == 3  # processing, processing, completed
    assert slept == [0.5, 0.5]


def test_assemblyai_raises_provider_error_when_transcript_fails() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/upload":
            return httpx.Response(200, json={"upload_url": "https://cdn/fake"})
        if request.method == "POST":
            return httpx.Response(200, json={"id": "t1", "status": "queued"})
        return httpx.Response(200, json={"id": "t1", "status": "error", "error": "bad audio"})

    provider = AssemblyAIProvider(api_key="k", client=mock_client(handler), sleep=lambda _: None)

    with pytest.raises(ProviderError, match="bad audio"):
        provider.transcribe(AUDIO, CONTENT_TYPE)


def test_assemblyai_raises_provider_error_on_http_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Unauthorized"})

    provider = AssemblyAIProvider(api_key="bad", client=mock_client(handler), sleep=lambda _: None)

    with pytest.raises(ProviderError, match="401"):
        provider.transcribe(AUDIO, CONTENT_TYPE)


# --- Deepgram ---------------------------------------------------------------


def test_deepgram_returns_words_from_recorded_response() -> None:
    fixture = load_fixture("deepgram_listen.json")
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=fixture)

    provider = DeepgramProvider(api_key="dg-key", client=mock_client(handler))

    words = provider.transcribe(AUDIO, CONTENT_TYPE)

    assert all(isinstance(w, Word) for w in words)
    assert words[0] == Word(text="Hey,", start=1.28, end=1.52)
    assert words[2] == Word(text="um,", start=2.4, end=2.72)
    assert len(words) == 6


def test_deepgram_sends_nova3_with_filler_words_and_content_type() -> None:
    fixture = load_fixture("deepgram_listen.json")
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=fixture)

    DeepgramProvider(api_key="dg-key", client=mock_client(handler)).transcribe(AUDIO, CONTENT_TYPE)

    (request,) = requests
    assert request.url.path == "/v1/listen"
    assert request.url.params["model"] == "nova-3"
    assert request.url.params["filler_words"] == "true"
    assert request.headers["authorization"] == "Token dg-key"
    assert request.headers["content-type"] == CONTENT_TYPE
    assert request.content == AUDIO


def test_deepgram_raises_provider_error_on_http_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"err_msg": "Forbidden"})

    provider = DeepgramProvider(api_key="bad", client=mock_client(handler))

    with pytest.raises(ProviderError, match="403"):
        provider.transcribe(AUDIO, CONTENT_TYPE)


# --- get_provider -----------------------------------------------------------


def test_get_provider_defaults_to_assemblyai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STT_PROVIDER", raising=False)
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "aai-key")

    assert isinstance(get_provider(), AssemblyAIProvider)


def test_get_provider_selects_deepgram_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STT_PROVIDER", "deepgram")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")

    assert isinstance(get_provider(), DeepgramProvider)


def test_get_provider_rejects_unknown_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STT_PROVIDER", "whisper")

    with pytest.raises(ProviderError, match="whisper"):
        get_provider()


def test_get_provider_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STT_PROVIDER", "assemblyai")
    monkeypatch.delenv("ASSEMBLYAI_API_KEY", raising=False)

    with pytest.raises(ProviderError, match="ASSEMBLYAI_API_KEY"):
        get_provider()
