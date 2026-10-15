"""scripts/screenshot_seed.py turns real fixture takes into sessions the browser store accepts.

The optional audio path posts to a running backend; here it goes through MockTransport.
"""

import json
from datetime import datetime
from pathlib import Path

import httpx

from scripts import screenshot_seed as seed

SESSION_FIELDS = {
    "createdAt",
    "passageId",
    "passageTitle",
    "durationSeconds",
    "metrics",
    "transcript",
    "topic",
}


def test_fixture_sessions_have_the_store_fields_and_real_timings() -> None:
    sessions = seed.sessions_from_fixtures()
    assert len(sessions) == 2
    for session in sessions:
        assert set(session) == SESSION_FIELDS
        datetime.fromisoformat(session["createdAt"])
        assert session["durationSeconds"] > 20
        assert session["transcript"][0].keys() == {"text", "start", "end"}
        assert "words_per_minute" in session["metrics"]
    assert sessions[0]["createdAt"] < sessions[1]["createdAt"]


def test_the_real_take_keeps_its_restart() -> None:
    nervous = next(s for s in seed.sessions_from_fixtures() if s["passageId"] == "free-talk")
    assert nervous["metrics"]["repeats"], "the 2026-10-11 take restarts 'I'm kinda nervous'"


def test_no_seed_title_is_a_sample_or_names_debate() -> None:
    for session in seed.sessions_from_fixtures():
        assert not session["passageTitle"].startswith("Sample: ")
        text = json.dumps(session).lower()
        for word in ("debate", "rebuttal", "resolution", "judge"):
            assert word not in text, word


def test_sessions_from_audio_posts_each_file_and_reads_the_answer(tmp_path: Path) -> None:
    clip = tmp_path / "take.webm"
    clip.write_bytes(b"fake-audio")
    posted: list[httpx.Request] = []

    def backend(request: httpx.Request) -> httpx.Response:
        posted.append(request)
        return httpx.Response(
            200,
            json={
                "transcript": [{"text": "Hello", "start": 0.5, "end": 0.9}],
                "metrics": {"words_per_minute": 120, "duration": 30, "repeats": [], "pauses": []},
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(backend))
    sessions = seed.sessions_from_audio([clip], "http://127.0.0.1:8766", client)

    assert len(posted) == 1
    assert posted[0].url.path == "/api/analyze"
    assert sessions[0]["durationSeconds"] == 30
    assert set(sessions[0]) == SESSION_FIELDS


def test_main_writes_the_json_file(tmp_path: Path) -> None:
    out = tmp_path / "seed.json"
    assert seed.main(["--out", str(out)]) == 0
    assert len(json.loads(out.read_text())) == 2
