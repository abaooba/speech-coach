"""/api/analyze asks the provider to discard its copy of the take once the words are in hand,
whether the take is then accepted or refused as too short, and leaves a provider that keeps no
copy alone."""

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.providers.base import Word

LONG_ENOUGH = [Word("Hey", 0.5, 0.8), Word("there", 1.0, 1.4), Word("everyone", 5.2, 6.0)]
TOO_SHORT = [Word("Hey", 0.5, 0.8)]


class KeepsACopy:
    """A provider shaped like AssemblyAIProvider: words, then a copy to discard."""

    def __init__(self, words: list[Word]) -> None:
        self.words = words
        self.calls: list[str] = []
        self.last_transcript_id = "t1"

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        self.calls.append("transcribe")
        return self.words

    def delete_last_transcript(self) -> None:
        self.calls.append("delete")
        self.last_transcript_id = None


class KeepsNoCopy:
    def __init__(self, words: list[Word]) -> None:
        self.words = words
        self.calls: list[str] = []

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        self.calls.append("transcribe")
        return self.words


def post(client: TestClient) -> object:
    return client.post("/api/analyze", files={"audio": ("take.webm", b"fake-audio", "audio/webm")})


@pytest.mark.parametrize("words, status", [(LONG_ENOUGH, 200), (TOO_SHORT, 400)])
def test_the_copy_is_discarded_after_transcribe_whatever_the_answer(
    monkeypatch: pytest.MonkeyPatch, words: list[Word], status: int
) -> None:
    provider = KeepsACopy(words)
    monkeypatch.setattr(app_module, "get_provider", lambda: provider)

    reply = post(TestClient(app_module.app))

    assert reply.status_code == status
    assert provider.calls == ["transcribe", "delete"]


def test_a_provider_without_a_copy_is_left_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = KeepsNoCopy(LONG_ENOUGH)
    monkeypatch.setattr(app_module, "get_provider", lambda: provider)

    reply = post(TestClient(app_module.app))

    assert reply.status_code == 200
    assert provider.calls == ["transcribe"]


def test_discard_provider_copy_is_a_plain_function_on_the_provider() -> None:
    provider = KeepsACopy(LONG_ENOUGH)
    app_module.discard_provider_copy(provider)
    assert provider.calls == ["delete"]
    app_module.discard_provider_copy(KeepsNoCopy(LONG_ENOUGH))
