"""A provider's 2xx reply of an unexpected shape is a ProviderError, never a 500.

A reply that was not JSON, lacked a field or had one of the wrong type raised JSONDecodeError,
KeyError, IndexError, TypeError or AttributeError inside the provider, or let a word with no text,
or a time that is not a finite number, through to the metrics and the answer. /api/analyze
catches only ProviderError and httpx errors, so the speaker got a 500. Now each such reply is a
ProviderError that names the provider, and the route answers 502 with the provider message.

All HTTP goes through httpx.MockTransport; pytest-socket blocks the network.
"""

import logging
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.providers.assemblyai import AssemblyAIProvider
from backend.providers.base import ProviderError, Transcriber
from backend.providers.deepgram import DeepgramProvider

AUDIO = b"fake-audio-bytes"
CONTENT_TYPE = "audio/webm"
TRANSCRIPT_ID = "t1"
UPLOAD_URL = "https://cdn.assemblyai.com/upload/fake-upload-token"
# What a gateway in front of a provider may send with a 200: a page, not JSON.
HTML_PAGE = b"<html><body>Service temporarily unavailable</body></html>"
# A word the speaker said. A log line that holds it has leaked the transcript.
SPOKEN_MARKER = "my-secret-rebuttal"


def mock_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def reply(body: object) -> httpx.Response:
    """A 200 with `body`: as JSON, or as it is when it is bytes.

    Bytes carry what json= cannot write: a body that is not JSON, and NaN or 1e999, which
    Python's JSON reader takes as a number that is not finite.
    """
    if isinstance(body, bytes):
        return httpx.Response(200, content=body, headers={"content-type": "application/json"})
    return httpx.Response(200, json=body)


# --- AssemblyAI ------------------------------------------------------------------------------


def completed_with(words: object) -> dict:
    return {"id": TRANSCRIPT_ID, "status": "completed", "words": words}


def assemblyai_answering(step: str, body: object) -> AssemblyAIProvider:
    """AssemblyAI that answers its `step` ("upload", "create" or "poll") with `body`.

    The other steps answer as AssemblyAI documents, and the job is completed on the first poll.
    """
    bodies: dict[str, object] = {
        "upload": {"upload_url": UPLOAD_URL},
        "create": {"id": TRANSCRIPT_ID, "status": "queued"},
        "poll": completed_with([{"text": "Hello,", "start": 0, "end": 9_500}]),
    }
    bodies[step] = body

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/upload":
            return reply(bodies["upload"])
        if request.method == "POST":
            return reply(bodies["create"])
        return reply(bodies["poll"])

    return AssemblyAIProvider(api_key="test-key", client=mock_client(handler), sleep=lambda _: None)


ASSEMBLYAI_ODD_REPLIES = [
    pytest.param("upload", HTML_PAGE, id="upload-a-page-not-json"),
    pytest.param("upload", {}, id="upload-no-upload-url"),
    pytest.param("upload", [UPLOAD_URL], id="upload-a-list"),
    pytest.param("create", b"null", id="create-null"),
    pytest.param("create", {"status": "queued"}, id="create-no-id"),
    pytest.param("poll", b"", id="poll-empty"),
    pytest.param("poll", {"id": TRANSCRIPT_ID}, id="poll-no-status"),
    pytest.param("poll", {"id": TRANSCRIPT_ID, "status": "completed"}, id="completed-no-words"),
    pytest.param("poll", completed_with(None), id="words-null"),
    pytest.param("poll", completed_with(["Hello,"]), id="a-word-not-an-object"),
    pytest.param("poll", completed_with([{"text": "Hello,", "end": 400}]), id="a-word-no-start"),
    pytest.param(
        "poll", completed_with([{"text": "Hello,", "start": "0", "end": 400}]), id="start-as-text"
    ),
    pytest.param(
        "poll", completed_with([{"text": None, "start": 0, "end": 400}]), id="a-word-no-text"
    ),
    pytest.param(
        "poll", completed_with([{"text": 7, "start": 0, "end": 400}]), id="text-a-number"
    ),
    pytest.param(
        "poll",
        b'{"status":"completed","words":[{"text":"Hello,","start":NaN,"end":400}]}',
        id="start-nan",
    ),
    pytest.param(
        "poll",
        b'{"status":"completed","words":[{"text":"Hello,","start":0,"end":1e999}]}',
        id="end-not-finite",
    ),
]


@pytest.mark.parametrize(("step", "body"), ASSEMBLYAI_ODD_REPLIES)
def test_an_assemblyai_reply_of_another_shape_is_a_provider_error(step: str, body: object) -> None:
    provider = assemblyai_answering(step, body)

    with pytest.raises(ProviderError, match="AssemblyAI"):
        provider.transcribe(AUDIO, CONTENT_TYPE)


# --- Deepgram --------------------------------------------------------------------------------


def deepgram_words(words: object) -> dict:
    return {"results": {"channels": [{"alternatives": [{"words": words}]}]}}


def deepgram_answering(body: object) -> DeepgramProvider:
    """Deepgram that answers its one request with `body`."""
    return DeepgramProvider(api_key="dg-key", client=mock_client(lambda request: reply(body)))


DEEPGRAM_ODD_REPLIES = [
    pytest.param(HTML_PAGE, id="a-page-not-json"),
    pytest.param({}, id="no-results"),
    pytest.param({"results": {"channels": []}}, id="no-channel"),
    pytest.param({"results": {"channels": [{}]}}, id="no-alternatives"),
    pytest.param({"results": {"channels": [{"alternatives": [{}]}]}}, id="no-words"),
    pytest.param(deepgram_words(["Hello,"]), id="a-word-not-an-object"),
    pytest.param(deepgram_words([{"start": 0, "end": 0.4}]), id="a-word-no-text"),
    pytest.param(
        deepgram_words([{"word": "hello", "punctuated_word": None, "start": 0, "end": 0.4}]),
        id="punctuated-word-null",
    ),
    pytest.param(
        deepgram_words([{"word": "hello", "start": "0", "end": 0.4}]), id="start-as-text"
    ),
    pytest.param(
        b'{"results":{"channels":[{"alternatives":[{"words":'
        b'[{"word":"hello","start":NaN,"end":0.4}]}]}]}}',
        id="start-nan",
    ),
]


@pytest.mark.parametrize("body", DEEPGRAM_ODD_REPLIES)
def test_a_deepgram_reply_of_another_shape_is_a_provider_error(body: object) -> None:
    provider = deepgram_answering(body)

    with pytest.raises(ProviderError, match="Deepgram"):
        provider.transcribe(AUDIO, CONTENT_TYPE)


# --- what the speaker sees -------------------------------------------------------------------


@pytest.fixture
def client() -> TestClient:
    """The app; a 500 comes back as the browser would get it rather than as an exception."""
    return TestClient(app_module.app, raise_server_exceptions=False)


def post_take(client: TestClient) -> httpx.Response:
    return client.post("/api/analyze", files={"audio": ("recording.webm", AUDIO, CONTENT_TYPE)})


# Each reached the route: a crash in the provider, or a word whose text or start broke the metrics.
# Every word ends at 9.5 s, past the 5 s a take needs, so none is turned down as too short.
ROUTE_CASES = [
    pytest.param(lambda: assemblyai_answering("upload", HTML_PAGE), id="assemblyai-a-page"),
    pytest.param(
        lambda: assemblyai_answering(
            "poll", completed_with([{"text": None, "start": 0, "end": 9_500}])
        ),
        id="assemblyai-a-word-no-text",
    ),
    pytest.param(
        lambda: deepgram_answering({"results": {"channels": []}}), id="deepgram-no-channel"
    ),
    pytest.param(
        lambda: deepgram_answering(deepgram_words([{"word": "hello", "start": "0", "end": 9.5}])),
        id="deepgram-start-as-text",
    ),
]


@pytest.mark.parametrize("build", ROUTE_CASES)
def test_the_api_answers_502_with_the_provider_message(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, build: Callable[[], Transcriber]
) -> None:
    monkeypatch.setattr(app_module, "get_provider", build)

    response = post_take(client)

    # frontend/api.js reads a 502 as kind "provider".
    assert response.status_code == 502
    assert response.json() == {"detail": app_module.PROVIDER_FAILED_MESSAGE}


def test_the_log_names_the_provider_and_the_kind_of_error_never_the_words(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    word = {"text": SPOKEN_MARKER, "start": "0", "end": 9_500}
    provider = assemblyai_answering("poll", completed_with([word]))
    monkeypatch.setattr(app_module, "get_provider", lambda: provider)

    with caplog.at_level(logging.DEBUG):
        response = post_take(client)

    assert response.status_code == 502
    assert "AssemblyAI" in caplog.text
    assert "TypeError" in caplog.text
    assert SPOKEN_MARKER not in caplog.text
