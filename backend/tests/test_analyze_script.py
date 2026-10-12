"""API tests for the optional `script` field of POST /api/analyze: a take read from a script is
lined up against it (backend/script_align.py), and its restarts replace the free-talk repeats.
The provider is a fake; pytest-socket blocks the network."""

import json
from dataclasses import asdict
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import metrics
from backend.providers.assemblyai import to_word
from backend.providers.base import Word
from backend.script_align import analyze_reading

FIXTURES = Path(__file__).parent / "fixtures"
AUDIO = b"fake-webm-bytes"
CONTENT_TYPE = "audio/webm"

# The "Rebuttal: school uniforms" passage, copied from frontend/passages.js (REBUTTAL_UNIFORMS).
UNIFORMS_PASSAGE = (
    "My opponents claim that uniforms erase bullying, but the evidence says otherwise. "
    "Students who want to single someone out will find a reason, whether it is shoes, "
    "a backpack, or a phone. The real problem is school culture, and a dress code does "
    "not change culture. Second, they argue that uniforms save families money. In "
    "practice, parents still buy everyday clothes for evenings and weekends, which makes "
    "the uniform an added cost, not a replacement. Consider what we lose. "
    "Choosing how to present yourself is one of the few decisions a student makes every "
    "day. Taking that away teaches compliance, not confidence. The proposal fails on "
    "its own terms."
)

# A script that says one word twice on purpose. Read as written, free talk would count
# 'that that' as a repeat; against the script it is no slip at all.
DOUBLED_WORD_SCRIPT = "We know that that nation can long endure, and we say so today."

MAX_SCRIPT = app_module.MAX_SCRIPT_CHARACTERS


def load_uniforms_take() -> list[Word]:
    """The owner's real 2026-10-11 uniforms take: 'makes' read as 'make', and a restart."""
    raw = json.loads((FIXTURES / "take_2026_10_11_uniforms.json").read_text())
    return [to_word(word) for word in raw["words"]]


def words_from(spec: str, gap: float = 0.25, length: float = 0.25) -> list[Word]:
    """Words every half second from a sentence; ten or more pass the 5-second floor."""
    words: list[Word] = []
    at = 0.0
    for text in spec.split():
        words.append(Word(text=text, start=at, end=at + length))
        at += length + gap
    return words


class FakeTranscriber:
    """Stands in for a provider: returns scripted words and records what it was sent."""

    def __init__(self, words: list[Word]) -> None:
        self.words = words
        self.calls: list[tuple[bytes, str]] = []

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        self.calls.append((audio_bytes, content_type))
        return self.words


@pytest.fixture
def client() -> TestClient:
    return TestClient(app_module.app)


def install_provider(monkeypatch: pytest.MonkeyPatch, words: list[Word]) -> FakeTranscriber:
    fake = FakeTranscriber(words)
    monkeypatch.setattr(app_module, "get_provider", lambda: fake)
    return fake


def post_take(client: TestClient, script: str | None = None) -> httpx.Response:
    files = {"audio": ("recording.webm", AUDIO, CONTENT_TYPE)}
    data = {} if script is None else {"script": script}
    return client.post("/api/analyze", files=files, data=data)


# --- with a script ------------------------------------------------------------


def test_a_take_sent_with_its_script_gains_a_script_block(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_provider(monkeypatch, load_uniforms_take())

    response = post_take(client, script=UNIFORMS_PASSAGE)

    assert response.status_code == 200
    assert response.json()["metrics"]["script"] == {
        "restarts": [{"text": "the few decisions a", "at": 33.41}],
        "skipped": [],
        "misread": [{"word": "makes", "index": 66, "at": 26.492, "said": "make"}],
    }


def test_with_a_script_repeats_are_the_script_restarts_counted_once(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_provider(monkeypatch, load_uniforms_take())

    body = post_take(client, script=UNIFORMS_PASSAGE).json()

    assert body["metrics"]["repeats"] == [{"text": "the few decisions a", "at": 33.41}]
    assert body["metrics"]["repeats"] == body["metrics"]["script"]["restarts"]


def test_a_word_the_script_doubles_is_not_a_repeat_when_read_as_written(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    words = words_from(DOUBLED_WORD_SCRIPT)
    install_provider(monkeypatch, words)
    assert metrics.find_repeats(words) == [{"text": "that", "at": 1.0}], "free talk counts it"

    body = post_take(client, script=DOUBLED_WORD_SCRIPT).json()

    assert body["metrics"]["repeats"] == []
    assert body["metrics"]["script"] == {"restarts": [], "skipped": [], "misread": []}


def test_a_skipped_script_word_is_listed_without_a_said_field(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_provider(monkeypatch, words_from("We know that nation can long endure, and we say so"))

    body = post_take(client, script=DOUBLED_WORD_SCRIPT).json()

    assert body["metrics"]["script"]["skipped"] == [
        {"word": "that", "index": 2, "at": 0.75},
        {"word": "today", "index": 12, "at": 5.25},
    ]


def test_the_rest_of_the_metrics_are_the_free_talk_ones(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    words = load_uniforms_take()
    install_provider(monkeypatch, words)

    body = post_take(client, script=UNIFORMS_PASSAGE).json()

    free_talk = json.loads(json.dumps(metrics.analyze(words)))
    assert set(body["metrics"]) == set(free_talk) | {"script"}
    for key in free_talk.keys() - {"repeats"}:
        assert body["metrics"][key] == free_talk[key], key
    assert body["transcript"] == [asdict(word) for word in words]


def test_analyze_reading_is_the_pure_function_behind_the_endpoint() -> None:
    words = load_uniforms_take()

    result = analyze_reading(words, UNIFORMS_PASSAGE)

    assert result["repeats"] == [{"text": "the few decisions a", "at": 33.41}]
    assert result["script"] == {
        "restarts": [{"text": "the few decisions a", "at": 33.41}],
        "skipped": [],
        "misread": [{"word": "makes", "index": 66, "at": 26.492, "said": "make"}],
    }


# --- without a script ---------------------------------------------------------


def test_a_take_sent_without_a_script_has_no_script_block(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    words = load_uniforms_take()
    install_provider(monkeypatch, words)

    body = post_take(client).json()

    assert "script" not in body["metrics"]
    assert body["metrics"] == json.loads(json.dumps(metrics.analyze(words)))


@pytest.mark.parametrize("script", ["", "   \n\t  ", "— , . !"])
def test_a_script_with_no_words_counts_as_no_script(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, script: str
) -> None:
    words = words_from(DOUBLED_WORD_SCRIPT)
    install_provider(monkeypatch, words)

    body = post_take(client, script=script).json()

    assert body["metrics"] == json.loads(json.dumps(metrics.analyze(words)))


# --- too long -----------------------------------------------------------------


def test_a_script_over_the_limit_is_a_400_before_the_provider_is_called(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = install_provider(monkeypatch, load_uniforms_take())

    response = post_take(client, script="a" * (MAX_SCRIPT + 1))

    assert response.status_code == 400
    assert response.json() == {"detail": app_module.SCRIPT_TOO_LONG_MESSAGE}
    assert fake.calls == []


def test_the_limit_is_twenty_thousand_characters_and_says_so() -> None:
    assert MAX_SCRIPT == 20_000
    assert "20,000 characters" in app_module.SCRIPT_TOO_LONG_MESSAGE


def test_a_script_of_exactly_the_limit_is_accepted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_provider(monkeypatch, load_uniforms_take())
    script = (UNIFORMS_PASSAGE + " ") * (MAX_SCRIPT // (len(UNIFORMS_PASSAGE) + 1))
    script += "x" * (MAX_SCRIPT - len(script))

    response = post_take(client, script=script)

    assert len(script) == MAX_SCRIPT
    assert response.status_code == 200
    assert "script" in response.json()["metrics"]


def test_a_line_break_counts_as_one_character_even_when_sent_as_crlf(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A browser sends a textarea's line breaks as CRLF, so a script that fits the box's
    # 20,000 characters arrives longer than that.
    install_provider(monkeypatch, load_uniforms_take())
    line = "Choosing how to present yourself\r\n"
    script = line * (MAX_SCRIPT // (len(line) - 1))
    assert len(script) > MAX_SCRIPT >= len(script.replace("\r\n", "\n"))

    response = post_take(client, script=script)

    assert response.status_code == 200
