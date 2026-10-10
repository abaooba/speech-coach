"""API tests for POST /api/analyze. The provider is a fake; pytest-socket blocks the network."""

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import metrics
from backend.providers.base import ProviderError, Word

FIXTURES = Path(__file__).parent / "fixtures"
AUDIO = b"fake-webm-bytes"
CONTENT_TYPE = "audio/webm"


def load_clip() -> list[Word]:
    """The 32 s test clip: 48 words, times already in seconds."""
    raw = json.loads((FIXTURES / "test_clip_assemblyai.json").read_text())
    return [Word(text=w["text"], start=w["start"], end=w["end"]) for w in raw["words"]]


class FakeTranscriber:
    """Stands in for a provider: returns scripted words or raises, and records what it was sent."""

    def __init__(self, words: list[Word] | None = None, error: Exception | None = None) -> None:
        self.words = words or []
        self.error = error
        self.calls: list[tuple[bytes, str]] = []

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        self.calls.append((audio_bytes, content_type))
        if self.error is not None:
            raise self.error
        return self.words


@pytest.fixture
def client() -> TestClient:
    return TestClient(app_module.app)


def install_provider(monkeypatch: pytest.MonkeyPatch, fake: FakeTranscriber) -> FakeTranscriber:
    monkeypatch.setattr(app_module, "get_provider", lambda: fake)
    return fake


def post_audio(
    client: TestClient, data: bytes = AUDIO, content_type: str = CONTENT_TYPE
) -> httpx.Response:
    return client.post("/api/analyze", files={"audio": ("recording.webm", data, content_type)})


# --- success ----------------------------------------------------------------


def test_analyze_returns_transcript_and_metrics_for_the_clip(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    words = load_clip()
    install_provider(monkeypatch, FakeTranscriber(words))

    response = post_audio(client)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"transcript", "metrics"}
    assert body["transcript"][0] == {"text": "Hey,", "start": 1.287, "end": 1.497}
    assert len(body["transcript"]) == 48
    assert body["metrics"] == json.loads(json.dumps(metrics.analyze(words)))
    assert body["metrics"]["fillers"]["um"] == 6
    assert len(body["metrics"]["pauses"]) == 3


def test_analyze_sends_the_uploaded_bytes_and_content_type_to_the_provider(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = install_provider(monkeypatch, FakeTranscriber(load_clip()))

    post_audio(client, data=b"opus-frames", content_type="audio/mp4")

    assert fake.calls == [(b"opus-frames", "audio/mp4")]


def test_analyze_handles_an_upload_larger_than_starlettes_1_mb_spool_threshold(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = install_provider(monkeypatch, FakeTranscriber(load_clip()))
    big_audio = bytes(range(256)) * 6000  # 1.5 MB, so Starlette spools it to a temp file

    response = post_audio(client, data=big_audio)

    assert response.status_code == 200
    assert fake.calls == [(big_audio, CONTENT_TYPE)]


def test_analyze_accepts_a_recording_of_exactly_five_seconds(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    words = [Word(text="hello", start=0.5, end=1.0), Word(text="there", start=4.5, end=5.0)]
    install_provider(monkeypatch, FakeTranscriber(words))

    response = post_audio(client)

    assert response.status_code == 200
    assert response.json()["metrics"]["word_count"] == 2


# --- client errors (400) ----------------------------------------------------


def test_analyze_rejects_an_empty_upload_before_calling_the_provider(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = install_provider(monkeypatch, FakeTranscriber(load_clip()))

    response = post_audio(client, data=b"")

    assert response.status_code == 400
    assert response.json() == {"detail": app_module.EMPTY_UPLOAD_MESSAGE}
    assert fake.calls == []


def test_analyze_rejects_a_recording_whose_last_word_ends_before_five_seconds(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    words = [Word(text="hello", start=0.5, end=1.0), Word(text="there", start=4.4, end=4.9)]
    install_provider(monkeypatch, FakeTranscriber(words))

    response = post_audio(client)

    assert response.status_code == 400
    assert response.json() == {"detail": app_module.TOO_SHORT_MESSAGE}


def test_analyze_rejects_a_recording_with_no_words(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_provider(monkeypatch, FakeTranscriber([]))

    response = post_audio(client)

    assert response.status_code == 400
    assert response.json() == {"detail": app_module.TOO_SHORT_MESSAGE}


def test_analyze_requires_the_audio_field(client: TestClient) -> None:
    response = client.post("/api/analyze", files={"clip": ("x.webm", AUDIO, CONTENT_TYPE)})

    assert response.status_code == 422


# --- provider failures (502) ------------------------------------------------


def test_analyze_maps_a_provider_error_to_502_without_leaking_details(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    error = ProviderError("AssemblyAI upload returned HTTP 401: Unauthorized")
    install_provider(monkeypatch, FakeTranscriber(error=error))

    response = post_audio(client)

    assert response.status_code == 502
    assert response.json() == {"detail": app_module.PROVIDER_FAILED_MESSAGE}
    assert "401" not in response.text


def test_analyze_maps_a_network_failure_to_502(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_provider(monkeypatch, FakeTranscriber(error=httpx.ConnectError("name not resolved")))

    response = post_audio(client)

    assert response.status_code == 502
    assert response.json() == {"detail": app_module.PROVIDER_FAILED_MESSAGE}


def test_analyze_maps_a_misconfigured_provider_to_502(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STT_PROVIDER", "bogus")

    response = post_audio(client)

    assert response.status_code == 502
    assert response.json() == {"detail": app_module.PROVIDER_FAILED_MESSAGE}
