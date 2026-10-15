"""After transcribe, delete_last_transcript asks AssemblyAI to delete the transcript, and the
uploaded audio with it (AssemblyAI's docs: a DELETE on /v2/transcript/{id} removes both). Best
effort: a failed delete is logged by its status or error class and never raises. All HTTP goes
through httpx.MockTransport."""

import json
import logging
from pathlib import Path

import httpx
import pytest

from backend.providers.assemblyai import (
    BASE_URL,
    DELETE_TIMEOUT_SECONDS,
    AssemblyAIProvider,
)
from backend.providers.base import ProviderError

FIXTURES = Path(__file__).parent / "fixtures"
COMPLETED = json.loads((FIXTURES / "assemblyai_transcript_completed.json").read_text())
AUDIO = b"fake-audio-bytes"
LOGGER = "backend.providers.assemblyai"


class AssemblyAIWithDelete:
    """Scripted server: upload, create, one poll that completes, then DELETE with a chosen reply."""

    def __init__(self, delete_reply: httpx.Response | Exception) -> None:
        self.delete_reply = delete_reply
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if request.method == "POST" and path == "/v2/upload":
            return httpx.Response(200, json={"upload_url": COMPLETED["audio_url"]})
        if request.method == "POST" and path == "/v2/transcript":
            return httpx.Response(200, json={"id": COMPLETED["id"], "status": "queued"})
        if request.method == "GET" and path == f"/v2/transcript/{COMPLETED['id']}":
            return httpx.Response(200, json=COMPLETED)
        if request.method == "DELETE" and path == f"/v2/transcript/{COMPLETED['id']}":
            if isinstance(self.delete_reply, Exception):
                raise self.delete_reply
            return self.delete_reply
        return httpx.Response(404, json={"error": f"unexpected {request.method} {path}"})


def provider_for(
    fake: AssemblyAIWithDelete, client: httpx.Client | None = None
) -> AssemblyAIProvider:
    client = client or httpx.Client(transport=httpx.MockTransport(fake))
    return AssemblyAIProvider(api_key="test-key", client=client, sleep=lambda _: None)


def test_transcribe_sends_nothing_new_and_remembers_the_transcript_id() -> None:
    fake = AssemblyAIWithDelete(httpx.Response(200, json={"status": "deleted"}))
    provider = provider_for(fake)

    words = provider.transcribe(AUDIO, "audio/webm")

    assert len(words) == 8
    assert [r.method for r in fake.requests] == ["POST", "POST", "GET"]
    assert provider.last_transcript_id == COMPLETED["id"]


def test_delete_last_transcript_sends_one_authorized_delete() -> None:
    fake = AssemblyAIWithDelete(httpx.Response(200, json={"status": "deleted"}))
    provider = provider_for(fake)
    provider.transcribe(AUDIO, "audio/webm")

    provider.delete_last_transcript()

    delete = fake.requests[-1]
    assert (delete.method, delete.url.path) == ("DELETE", f"/v2/transcript/{COMPLETED['id']}")
    assert delete.headers["authorization"] == "test-key"
    assert str(delete.url).startswith(BASE_URL)
    assert provider.last_transcript_id is None, "deleted once, never twice"


def test_a_delete_that_answers_500_is_logged_without_the_words(
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake = AssemblyAIWithDelete(httpx.Response(500, text="server error Hey um"))
    provider = provider_for(fake)
    provider.transcribe(AUDIO, "audio/webm")

    with caplog.at_level(logging.WARNING, logger=LOGGER):
        provider.delete_last_transcript()

    assert "AssemblyAI delete returned HTTP 500" in caplog.text
    assert "Hey" not in caplog.text


def test_a_delete_that_raises_is_logged_by_its_class(caplog: pytest.LogCaptureFixture) -> None:
    fake = AssemblyAIWithDelete(httpx.ConnectTimeout("slow"))
    provider = provider_for(fake)
    provider.transcribe(AUDIO, "audio/webm")

    with caplog.at_level(logging.WARNING, logger=LOGGER):
        provider.delete_last_transcript()

    assert "AssemblyAI delete failed (ConnectTimeout)" in caplog.text


def test_the_delete_has_its_own_short_timeout() -> None:
    fake = AssemblyAIWithDelete(httpx.Response(200, json={"status": "deleted"}))
    seen: list[object] = []

    class Spy(httpx.Client):
        def delete(self, *args, **kwargs):
            seen.append(kwargs.get("timeout"))
            return super().delete(*args, **kwargs)

    provider = provider_for(fake, Spy(transport=httpx.MockTransport(fake)))
    provider.transcribe(AUDIO, "audio/webm")
    provider.delete_last_transcript()

    assert seen == [DELETE_TIMEOUT_SECONDS]
    assert DELETE_TIMEOUT_SECONDS <= 10.0


def test_nothing_is_sent_when_there_is_no_transcript_to_delete() -> None:
    fake = AssemblyAIWithDelete(httpx.Response(200, json={"status": "deleted"}))
    provider = provider_for(fake)

    provider.delete_last_transcript()

    assert fake.requests == []


def test_a_failed_job_leaves_no_id_to_delete() -> None:
    def failing(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/upload":
            return httpx.Response(200, json={"upload_url": "https://cdn/fake"})
        if request.method == "POST":
            return httpx.Response(200, json={"id": "t1", "status": "queued"})
        return httpx.Response(200, json={"id": "t1", "status": "error", "error": "bad audio"})

    client = httpx.Client(transport=httpx.MockTransport(failing))
    provider = AssemblyAIProvider(api_key="k", client=client, sleep=lambda _: None)

    with pytest.raises(ProviderError, match="bad audio"):
        provider.transcribe(AUDIO, "audio/webm")
    assert provider.last_transcript_id is None
