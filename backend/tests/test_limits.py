"""How large a request body each API route takes (backend/limits.py).

Every route reads its body whole before its own checks run: FastAPI parses a JSON body, and
/api/analyze reads the recording. So a body over its route's limit is refused with 413 and
{"detail": message}, the shape of the app's other errors, before it is read in full: at once
when its Content-Length says it is over, and as its bytes arrive when it comes with no length.

/api/analyze takes 40,000,000 bytes: room for 3 minutes of even uncompressed 16-bit stereo audio
at 48 kHz, with the longest script. /api/sessions, /api/sessions/import and /api/progress take
3,000,000, the T48 cap (test_sessions_api_limits.py). Every other API route, /api/advice and
/api/auth/* among them, takes 64,000: the largest advice request the app sends is under 45,000.
The static frontend has no limit, as it never reads a body.

No test opens a socket: /api/analyze gets a fake provider and /api/advice no model.
"""

import asyncio
import json
from collections.abc import Iterable, Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import limits
from backend.advice import coach, load_library
from backend.providers.base import Word

MAX_RECORDING_BYTES = 40_000_000
MAX_ACCOUNT_DATA_BYTES = 3_000_000
MAX_SMALL_BODY_BYTES = 64_000
RECORDING_TOO_LARGE = {"detail": "That recording is over 40 MB. Record a shorter take and resend."}
ACCOUNT_DATA_TOO_LARGE = {
    "detail": "send at most 3,000,000 bytes in one request: import a long history in parts"
}
SMALL_BODY_TOO_LARGE = {"detail": "send at most 64,000 bytes in one request"}

# Three minutes of the largest audio a phone could send: uncompressed 16-bit stereo at 48 kHz.
THREE_MINUTES_UNCOMPRESSED = 3 * 60 * 48_000 * 2 * 2
JSON_HEADERS = {"content-type": "application/json"}
# What the fake provider hears in any recording: speech that ends past the 5 s minimum.
WORDS = [Word(text="Good", start=0.5, end=0.9), Word(text="evening.", start=31.0, end=31.6)]


class FakeTranscriber:
    """Stands in for the speech-to-text provider: notes how many bytes each call was sent."""

    def __init__(self) -> None:
        self.sizes: list[int] = []

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        self.sizes.append(len(audio_bytes))
        return WORDS


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> FakeTranscriber:
    fake = FakeTranscriber()
    monkeypatch.setattr(app_module, "get_provider", lambda: fake)
    return fake


@pytest.fixture
def client() -> Iterator[TestClient]:
    """The app with accounts off (conftest.py) and no model: advice is the library's own."""
    overrides = app_module.app.dependency_overrides
    overrides[app_module.advice_client] = lambda: None
    yield TestClient(app_module.app, base_url="https://testserver")
    overrides.pop(app_module.advice_client, None)


def stating_length(length: int, headers: dict[str, str] | None = None) -> dict[str, str]:
    """`headers` with a Content-Length that states `length`, whatever the body is."""
    return {**(headers or {}), "content-length": str(length)}


# --- which limit each path has -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "max_bytes"),
    [
        ("/api/analyze", MAX_RECORDING_BYTES),
        ("/api/analyze/", MAX_RECORDING_BYTES),
        ("/api/sessions", MAX_ACCOUNT_DATA_BYTES),
        ("/api/sessions/import", MAX_ACCOUNT_DATA_BYTES),
        ("/api/sessions/8b1f6c2e-take-one", MAX_ACCOUNT_DATA_BYTES),
        ("/api/progress", MAX_ACCOUNT_DATA_BYTES),
        ("/api/advice", MAX_SMALL_BODY_BYTES),
        ("/api/auth/signup", MAX_SMALL_BODY_BYTES),
        ("/api/auth/login", MAX_SMALL_BODY_BYTES),
        ("/api/auth/logout", MAX_SMALL_BODY_BYTES),
        ("/api/me", MAX_SMALL_BODY_BYTES),
        ("/api/health", MAX_SMALL_BODY_BYTES),
        ("/api", MAX_SMALL_BODY_BYTES),
        # A route's limit covers the paths under it, not every path that starts with its letters.
        ("/api/analyzer", MAX_SMALL_BODY_BYTES),
        ("/api/sessions-archive", MAX_SMALL_BODY_BYTES),
    ],
)
def test_each_api_path_has_its_routes_limit(path: str, max_bytes: int) -> None:
    limit = limits.limit_for(path)

    assert limit is not None
    assert limit.max_bytes == max_bytes


@pytest.mark.parametrize("path", ["/", "/index.html", "/screens/results.js", "/apiary", "/how"])
def test_a_path_outside_the_api_has_no_limit(path: str) -> None:
    assert limits.limit_for(path) is None


def test_each_limit_says_what_its_413_says() -> None:
    assert limits.limit_for("/api/analyze").message == RECORDING_TOO_LARGE["detail"]
    assert limits.limit_for("/api/sessions").message == ACCOUNT_DATA_TOO_LARGE["detail"]
    assert limits.limit_for("/api/advice").message == SMALL_BODY_TOO_LARGE["detail"]


# --- /api/analyze ---------------------------------------------------------------------------------


def test_three_minutes_of_uncompressed_stereo_with_the_longest_script_are_analyzed(
    client: TestClient, provider: FakeTranscriber
) -> None:
    # Browsers record compressed audio, a few MB for 3 minutes; this is the most a phone could
    # send for that long. The script is 20,000 characters of 4 bytes each in UTF-8.
    audio = bytes(THREE_MINUTES_UNCOMPRESSED)
    script = "\N{MICROPHONE}" * 20_000

    response = client.post(
        "/api/analyze",
        files={"audio": ("recording.webm", audio, "audio/webm")},
        data={"script": script},
    )

    assert response.status_code == 200, response.text
    assert provider.sizes == [THREE_MINUTES_UNCOMPRESSED]
    assert len(response.request.content) < MAX_RECORDING_BYTES


MULTIPART_HEADERS = {"content-type": "multipart/form-data; boundary=speech-coach-test-boundary"}


def multipart_in_chunks(audio_bytes: int, chunk_bytes: int = 1_000_000) -> Iterator[bytes]:
    """A form with one `audio` file of `audio_bytes` zeros, as a stream with no stated length."""
    boundary = b"speech-coach-test-boundary"
    yield (
        b"--" + boundary + b"\r\n"
        b'Content-Disposition: form-data; name="audio"; filename="recording.webm"\r\n'
        b"Content-Type: audio/webm\r\n\r\n"
    )
    left = audio_bytes
    while left > 0:
        size = min(chunk_bytes, left)
        yield bytes(size)
        left -= size
    yield b"\r\n--" + boundary + b"--\r\n"


def test_a_recording_stated_over_40_mb_is_refused_before_it_is_read(
    client: TestClient, provider: FakeTranscriber
) -> None:
    # The form itself is small and would be analyzed: only its stated length is refused.
    form = b"".join(multipart_in_chunks(1_000))
    headers = stating_length(MAX_RECORDING_BYTES + 1, MULTIPART_HEADERS)

    response = client.post("/api/analyze", content=form, headers=headers)

    assert response.status_code == 413
    assert response.json() == RECORDING_TOO_LARGE
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"] == "no-store"
    assert provider.sizes == []


def test_a_recording_sent_in_chunks_is_refused_once_past_40_mb(
    client: TestClient, provider: FakeTranscriber
) -> None:
    body = multipart_in_chunks(MAX_RECORDING_BYTES)

    response = client.post("/api/analyze", content=body, headers=MULTIPART_HEADERS)

    assert "content-length" not in response.request.headers
    assert response.status_code == 413
    assert response.json() == RECORDING_TOO_LARGE
    assert response.headers["cache-control"] == "no-store"
    assert provider.sizes == []


def test_a_recording_sent_in_chunks_within_40_mb_is_analyzed(
    client: TestClient, provider: FakeTranscriber
) -> None:
    body = multipart_in_chunks(5_000_000)

    response = client.post("/api/analyze", content=body, headers=MULTIPART_HEADERS)

    assert response.status_code == 200, response.text
    assert provider.sizes == [5_000_000]


# --- /api/advice and the account routes ----------------------------------------------------------


def advice_body(**changes: object) -> dict[str, Any]:
    """A request for a 2-minute take at 150 wpm, changed by `changes`."""
    summary = {
        "duration_seconds": 120.0,
        "words_per_minute": 150.0,
        "filler_count": 2,
        "restart_count": 1,
        "mid_sentence_pause_count": 0,
        "long_pause_count": 0,
        "target_wpm": [140, 160],
        "transcript_excerpt": "We should adopt the plan because it works.",
    }
    body = {"session_id": "take-1", "summary": summary, "tier": "Contender", "shown_ids": []}
    return {**body, **changes}


def padded_to(body: object, size: int) -> bytes:
    """`body` as JSON, followed by as many spaces as make it `size` bytes long."""
    text = json.dumps(body).encode()
    assert len(text) <= size
    return text + b" " * (size - len(text))


def test_an_advice_request_of_64_000_bytes_is_answered(client: TestClient) -> None:
    response = client.post(
        "/api/advice", content=padded_to(advice_body(), MAX_SMALL_BODY_BYTES), headers=JSON_HEADERS
    )

    assert response.status_code == 200, response.text
    assert response.json()["source"] == "library"


def test_an_advice_request_of_a_byte_more_is_refused(client: TestClient) -> None:
    response = client.post(
        "/api/advice",
        content=padded_to(advice_body(), MAX_SMALL_BODY_BYTES + 1),
        headers=JSON_HEADERS,
    )

    assert response.status_code == 413
    assert response.json() == SMALL_BODY_TOO_LARGE
    assert response.headers["cache-control"] == "no-store"


def test_an_advice_request_sent_in_chunks_is_refused_once_past_64_000_bytes(
    client: TestClient,
) -> None:
    body = padded_to(advice_body(), MAX_SMALL_BODY_BYTES + 1)
    chunks = iter([body[:1_000], body[1_000:]])

    response = client.post("/api/advice", content=chunks, headers=JSON_HEADERS)

    assert "content-length" not in response.request.headers
    assert response.status_code == 413
    assert response.json() == SMALL_BODY_TOO_LARGE


def test_the_largest_advice_request_the_app_sends_fits_and_is_answered(
    client: TestClient,
) -> None:
    # Every shown id it may send is a library id, as long as the longest; the excerpt is as long
    # as allowed, in the characters JSON.stringify writes longest (\u0001: 6 bytes each).
    longest_id = max((entry.id for entry in load_library()), key=len)
    body = advice_body(
        session_id="8b1f6c2e-5d4a-4f1e-9c3b-2a7d6e0f1a2b",
        shown_ids=[longest_id] * coach.MAX_SHOWN_IDS,
    )
    body["summary"]["transcript_excerpt"] = "\x01" * coach.MAX_EXCERPT_CHARACTERS
    sent = json.dumps(body, separators=(",", ":")).encode()

    response = client.post("/api/advice", content=sent, headers=JSON_HEADERS)

    assert len(sent) < 45_000
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/auth/signup"),
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/logout"),
        ("DELETE", "/api/me"),
        ("POST", "/api/advice"),
    ],
)
def test_a_body_stated_over_64_000_bytes_is_refused_before_the_route_runs(
    client: TestClient, method: str, path: str
) -> None:
    # Accounts are off, so each account route would answer 503 if it ran.
    headers = stating_length(MAX_SMALL_BODY_BYTES + 1, JSON_HEADERS)

    response = client.request(method, path, content=b"{}", headers=headers)

    assert response.status_code == 413
    assert response.json() == SMALL_BODY_TOO_LARGE


def test_a_login_sent_in_chunks_is_refused_once_past_64_000_bytes(client: TestClient) -> None:
    body = padded_to({"email": "ann@example.com", "password": "x" * 100}, MAX_SMALL_BODY_BYTES + 1)

    response = client.post("/api/auth/login", content=iter([body]), headers=JSON_HEADERS)

    assert response.status_code == 413
    assert response.json() == SMALL_BODY_TOO_LARGE


def test_a_small_body_still_reaches_its_route(client: TestClient) -> None:
    login = {"email": "ann@example.com", "password": "correct horse battery staple"}

    response = client.post("/api/auth/login", content=padded_to(login, 1_000), headers=JSON_HEADERS)

    assert response.status_code == 503
    assert response.json() == {"detail": "accounts are not configured"}


# --- the static frontend -------------------------------------------------------------------------


def test_a_static_file_is_served_whatever_body_comes_with_it(client: TestClient) -> None:
    big = bytes(MAX_SMALL_BODY_BYTES + 1)

    stated = client.request(
        "GET", "/index.html", headers=stating_length(MAX_RECORDING_BYTES + 1), content=b""
    )
    sent = client.request("GET", "/index.html", content=big)

    assert stated.status_code == sent.status_code == 200
    assert "<html" in sent.text.lower()


# --- the middleware itself, chunk by chunk -------------------------------------------------------
# A small app with a 10-byte limit on /echo, driven through ASGI by hand, so a test can see each
# chunk of the body as the app asks for it.

TEN_BYTES = limits.BodyLimit(max_bytes=10, message="send at most 10 bytes")


def echo_app() -> FastAPI:
    """An app whose one route sends back the JSON object it was sent, behind a 10-byte limit."""
    echo = FastAPI()
    echo.add_middleware(limits.RequestBodyLimit, limits=(("/echo", TEN_BYTES),))

    @echo.post("/echo")
    async def send_back(body: dict[str, Any]) -> dict[str, Any]:
        return body

    return echo


class Exchange:
    """One request driven through ASGI: the chunks the app asked for, and what it sent back.

    The chunks are made only as the app asks for them, so a long body is never held whole.
    """

    def __init__(
        self,
        chunks: Iterable[bytes],
        headers: list[tuple[bytes, bytes]],
        content_type: bytes = b"application/json",
    ) -> None:
        self.unsent = iter(chunks)
        self.next_chunk = next(self.unsent, None)
        self.headers = [(b"content-type", content_type), *headers]
        self.chunks_read: list[bytes] = []
        self.sent: list[dict[str, Any]] = []

    async def receive(self) -> dict[str, Any]:
        chunk = self.next_chunk
        if chunk is None:
            return {"type": "http.disconnect"}
        self.next_chunk = next(self.unsent, None)
        self.chunks_read.append(chunk)
        return {"type": "http.request", "body": chunk, "more_body": self.next_chunk is not None}

    async def send(self, message: dict[str, Any]) -> None:
        self.sent.append(message)

    def run(self, app: FastAPI, path: str = "/echo") -> None:
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": path,
            "raw_path": path.encode(),
            "root_path": "",
            "query_string": b"",
            "headers": [(b"host", b"testserver"), *self.headers],
            "client": ("198.51.100.7", 50000),
            "server": ("testserver", 443),
        }
        asyncio.run(app(scope, self.receive, self.send))

    @property
    def status(self) -> int:
        return next(m["status"] for m in self.sent if m["type"] == "http.response.start")

    @property
    def response_headers(self) -> dict[str, str]:
        start = next(m for m in self.sent if m["type"] == "http.response.start")
        return {name.decode(): value.decode() for name, value in start["headers"]}

    @property
    def body(self) -> Any:
        return json.loads(b"".join(m.get("body", b"") for m in self.sent if "body" in m))


def test_chunks_are_read_until_the_limit_is_passed_and_no_further() -> None:
    exchange = Exchange([b'{"a":', b'"bcdef', b'ghij"}', b"never read"], headers=[])

    exchange.run(echo_app())

    assert exchange.status == 413
    assert exchange.body == {"detail": "send at most 10 bytes"}
    assert exchange.chunks_read == [b'{"a":', b'"bcdef']


def test_chunks_that_come_to_the_limit_are_read_in_full() -> None:
    exchange = Exchange([b'{"a"', b':"bc', b'"}'], headers=[])

    exchange.run(echo_app())

    assert exchange.status == 200
    assert exchange.body == {"a": "bc"}
    assert exchange.chunks_read == [b'{"a"', b':"bc', b'"}']


def test_a_stated_length_over_the_limit_is_refused_before_a_chunk_is_read() -> None:
    exchange = Exchange([b"{}"], headers=[(b"content-length", b"11")])

    exchange.run(echo_app())

    assert exchange.status == 413
    assert exchange.body == {"detail": "send at most 10 bytes"}
    assert exchange.chunks_read == []


@pytest.mark.parametrize("stated", [b"2", b"not a number"])
def test_a_stated_length_within_the_limit_or_unreadable_leaves_the_counting_to_the_bytes(
    stated: bytes,
) -> None:
    exchange = Exchange([b'{"a":"bcdefghij"}'], headers=[(b"content-length", stated)])

    exchange.run(echo_app())

    assert exchange.status == 413


def test_a_path_the_limits_do_not_cover_is_passed_through_untouched() -> None:
    exchange = Exchange([b'{"a":"bcdefghijklmnop"}'], headers=[])

    exchange.run(echo_app(), path="/elsewhere")

    # No route there: the app answers 404, having never been held to a limit.
    assert exchange.status == 404


def test_a_recording_is_cut_off_at_the_chunk_that_passes_40_mb(provider: FakeTranscriber) -> None:
    # The form's opening, then 1 MB chunks of audio: the 40th of them passes the limit, and the
    # form's closing chunk is never asked for.
    content_type = b"multipart/form-data; boundary=speech-coach-test-boundary"
    exchange = Exchange(multipart_in_chunks(MAX_RECORDING_BYTES), [], content_type)

    exchange.run(app_module.app, path="/api/analyze")

    assert exchange.status == 413
    assert exchange.body == RECORDING_TOO_LARGE
    assert exchange.response_headers["cache-control"] == "no-store"
    assert len(exchange.chunks_read) == 1 + MAX_RECORDING_BYTES // 1_000_000
    assert exchange.next_chunk is not None
    assert provider.sizes == []
