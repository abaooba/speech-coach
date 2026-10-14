"""A take and script too large to line up against each other are scored as free talk.

Script alignment (backend/script_align.py) fills a cell for every pair of a spoken word and a
script word, and nothing capped how many: 9,000 spoken words against a 19,999-character script
took a 485 MB peak, and Render's free plan has 512 MB. Past MAX_ALIGNMENT_CELLS (25 million),
/api/analyze now skips the alignment and analyzes the take as free talk, with no script block.

No test here builds anything large: they lower the cap instead. The provider is a fake;
pytest-socket blocks the network.
"""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import metrics, script_align
from backend.providers.base import Word

AUDIO = b"fake-webm-bytes"
CONTENT_TYPE = "audio/webm"
# Read exactly as written: 8 spoken words against 8 script words, 64 cells.
SCRIPT = "we know that this nation can long endure"
CELLS = 8 * 8
# The same words joined by dashes: one word to str.split(), but eight to the alignment, which
# compares the two halves of 'bullying—the' or 'well-known' as two words.
DASH_JOINED_SCRIPT = "-".join(SCRIPT.split())
NOTHING_MISSED = {"restarts": [], "skipped": [], "misread": []}


def words_from(spec: str) -> list[Word]:
    """A word every second from a sentence; six or more pass the 5-second floor."""
    return [Word(text=text, start=float(at), end=at + 0.5) for at, text in enumerate(spec.split())]


class FakeTranscriber:
    """Stands in for a provider: returns scripted words."""

    def __init__(self, words: list[Word]) -> None:
        self.words = words

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        return self.words


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The app, transcribing every take as SCRIPT read exactly as written."""
    fake = FakeTranscriber(words_from(SCRIPT))
    monkeypatch.setattr(app_module, "get_provider", lambda: fake)
    return TestClient(app_module.app)


def post_take(client: TestClient, script: str) -> httpx.Response:
    files = {"audio": ("recording.webm", AUDIO, CONTENT_TYPE)}
    return client.post("/api/analyze", files=files, data={"script": script})


# --- the cap ---------------------------------------------------------------------------------


def test_the_cap_is_25_million_cells() -> None:
    assert app_module.MAX_ALIGNMENT_CELLS == 25_000_000


def test_a_take_past_the_cap_is_free_talk_with_no_script_block(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_module, "MAX_ALIGNMENT_CELLS", CELLS - 1)

    response = post_take(client, SCRIPT)

    assert response.status_code == 200
    body = response.json()
    assert "script" not in body["metrics"]
    assert body["metrics"] == json.loads(json.dumps(metrics.analyze(words_from(SCRIPT))))
    assert len(body["transcript"]) == 8


def test_past_the_cap_the_alignment_never_runs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_module, "MAX_ALIGNMENT_CELLS", CELLS - 1)
    aligned: list[str] = []
    analyze_reading = app_module.analyze_reading

    def record_alignment(words: list[Word], script: str) -> dict[str, object]:
        aligned.append(script)
        return analyze_reading(words, script)

    monkeypatch.setattr(app_module, "analyze_reading", record_alignment)

    post_take(client, SCRIPT)

    assert aligned == []


def test_a_take_at_the_cap_is_still_lined_up(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_module, "MAX_ALIGNMENT_CELLS", CELLS)

    response = post_take(client, SCRIPT)

    assert response.json()["metrics"]["script"] == NOTHING_MISSED


# --- counting cells as the alignment does ----------------------------------------------------


def test_a_dash_joined_script_counts_every_word_it_joins(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Counted by str.split(), the script would be one word: 8 cells, well under this cap.
    monkeypatch.setattr(app_module, "MAX_ALIGNMENT_CELLS", CELLS - 1)

    response = post_take(client, DASH_JOINED_SCRIPT)

    assert response.status_code == 200
    assert "script" not in response.json()["metrics"]


def test_a_dash_joined_script_within_the_cap_is_lined_up_word_by_word(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_module, "MAX_ALIGNMENT_CELLS", CELLS)

    response = post_take(client, DASH_JOINED_SCRIPT)

    assert response.json()["metrics"]["script"] == NOTHING_MISSED


def test_cells_are_spoken_words_times_script_words_as_the_alignment_splits_them() -> None:
    # 'well-known' and 'we-know' are two words each, 'um' is a spoken word all the same, and a
    # lone dash is no word: um we well known nation (5) against we know that nation (4).
    words = words_from("um we well-known — nation")

    assert script_align.alignment_cells(words, "we-know that — nation") == 5 * 4


def test_a_script_with_no_words_fills_no_cells() -> None:
    assert script_align.alignment_cells(words_from(SCRIPT), "— , . !") == 0
