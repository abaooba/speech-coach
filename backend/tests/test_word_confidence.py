"""Word confidence: both providers carry the service's per-word confidence into Word, and
/api/analyze sends it on when there is one. It never reaches the metrics, a score or a rank."""

import json
import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import metrics
from backend.providers import assemblyai, deepgram
from backend.providers.base import Word

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def test_word_confidence_defaults_to_none() -> None:
    assert Word(text="hi", start=0.0, end=0.1).confidence is None


def test_assemblyai_words_carry_the_recorded_confidence() -> None:
    raw = fixture("assemblyai_transcript_completed.json")["words"]

    words = [assemblyai.to_word(w) for w in raw]

    assert [w.confidence for w in words] == [w["confidence"] for w in raw]
    assert words[0].confidence == 0.98


def test_deepgram_words_carry_the_confidence_of_a_small_payload() -> None:
    payload = fixture("deepgram_listen.json")
    words = [
        deepgram.to_word(w) for w in payload["results"]["channels"][0]["alternatives"][0]["words"]
    ]
    assert words[0] == Word(text="Hey,", start=1.28, end=1.52, confidence=0.98)

    built = deepgram.to_word({"word": "ok", "start": 0.0, "end": 0.5, "confidence": 0.8765})
    assert built.confidence == 0.88


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        (0.987, 0.99),
        (1.4, 1.0),
        (-0.2, 0.0),
        (1, 1.0),
        (math.nan, None),
        (math.inf, None),
        ("0.9", None),
        (True, None),
        (None, None),
    ],
)
def test_both_providers_clean_the_confidence(given: object, expected: float | None) -> None:
    ai = assemblyai.to_word({"text": "a", "start": 0, "end": 500, "confidence": given})
    dg = deepgram.to_word({"word": "a", "start": 0.0, "end": 0.5, "confidence": given})
    assert ai.confidence == expected
    assert dg.confidence == expected


def test_a_word_without_a_confidence_key_has_none() -> None:
    assert assemblyai.to_word({"text": "a", "start": 0, "end": 500}).confidence is None
    assert deepgram.to_word({"word": "a", "start": 0.0, "end": 0.5}).confidence is None


class FakeTranscriber:
    def __init__(self, words: list[Word]) -> None:
        self.words = words

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        return self.words


def analyze(monkeypatch: pytest.MonkeyPatch, words: list[Word]) -> dict:
    monkeypatch.setattr(app_module, "get_provider", lambda: FakeTranscriber(words))
    response = TestClient(app_module.app).post(
        "/api/analyze", files={"audio": ("take.webm", b"audio", "audio/webm")}
    )
    assert response.status_code == 200
    return response.json()


def spoken(confidences: list[float | None]) -> list[Word]:
    return [
        Word(text=f"word{i}", start=i * 0.6, end=i * 0.6 + 0.4, confidence=c)
        for i, c in enumerate(confidences)
    ]


def test_analyze_adds_confidence_only_where_there_is_one(monkeypatch: pytest.MonkeyPatch) -> None:
    body = analyze(monkeypatch, spoken([0.91, None] * 6))

    assert body["transcript"][0] == {"text": "word0", "start": 0.0, "end": 0.4, "confidence": 0.91}
    assert body["transcript"][1] == {"text": "word1", "start": 0.6, "end": 1.0}


def test_confidence_changes_no_metric(monkeypatch: pytest.MonkeyPatch) -> None:
    low = analyze(monkeypatch, spoken([0.05] * 12))
    high = analyze(monkeypatch, spoken([0.99] * 12))
    none = analyze(monkeypatch, spoken([None] * 12))

    assert low["metrics"] == high["metrics"] == none["metrics"]
    assert "confidence" not in json.dumps(none["metrics"])
    assert low["metrics"] == json.loads(json.dumps(metrics.analyze(spoken([None] * 12))))
