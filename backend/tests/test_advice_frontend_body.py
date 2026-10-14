"""The frontend's advice request and the backend's /api/advice agree, end to end (PLAN T41).

frontend/tips.js builds the request body from a take's app.delivery report (adviceRequest) and
checks the reply (parseCoachNotes); backend/advice/coach.py validates that body and writes the
reply. The two are tested apart in frontend/tests/coach_notes.test.js and test_advice_api.py;
this test runs them together on the bundled sample take (frontend/sample-session.json), through
node, so a field renamed on one side fails here. No key is set, so the library tips answer, and
nothing opens a socket. Skips when node is not installed, as test_frontend_node.py does.
"""

import json
import shutil
import subprocess
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.advice import coach

REPO_ROOT = Path(__file__).resolve().parents[2]
HOMEBREW_NODE = Path("/opt/homebrew/bin/node")

# Loads the real frontend modules into a bare `app`, as the browser does, and prints the body
# adviceRequest builds for the sample take, with the shown ids given as a JSON list in the first
# argument; with a reply on stdin, prints what parseCoachNotes makes of it instead.
# results.js summarize() gives the report and the band, as Results does.
BUILD_SCRIPT = """
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join("frontend", file), "utf8");
const context = { app: { screens: {}, ui: {}, store: {}, router: {} } };
["passages.js", "delivery.js", "tips.js", path.join("screens", "results.js")].forEach((file) =>
  vm.runInNewContext(read(file), context, { filename: file }),
);
const input = fs.readFileSync(0, "utf8");
if (input.trim() !== "") {
  process.stdout.write(JSON.stringify(context.app.tips.parseCoachNotes(JSON.parse(input))));
} else {
  const shownIds = JSON.parse(process.argv[1]);
  const session = { ...JSON.parse(read("sample-session.json")), id: "sample-check" };
  const summary = context.app.screens.results.summarize(session);
  const body = context.app.tips.adviceRequest(
    session, summary.report, summary.target, "Novice", shownIds,
  );
  process.stdout.write(JSON.stringify(body));
}
"""


def node_binary() -> str:
    found = shutil.which("node") or (str(HOMEBREW_NODE) if HOMEBREW_NODE.exists() else None)
    if found is None:
        pytest.skip("node is not installed (not on PATH and not at /opt/homebrew/bin/node)")
    return found


def run_frontend(stdin: str, shown_ids: Sequence[str] = ()) -> Any:
    """Run BUILD_SCRIPT with `stdin` and `shown_ids`, and return the JSON it prints."""
    result = subprocess.run(
        [node_binary(), "--input-type=commonjs", "-e", BUILD_SCRIPT, json.dumps(list(shown_ids))],
        cwd=REPO_ROOT,
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def entry_ids(reply: dict[str, Any]) -> list[str]:
    """The library entry ids a reply of /api/advice shows, in order."""
    return [tip["entry_id"] for tip in reply["tips"]]


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The app with no API key, so the library's own words answer."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    coach.client_for_key.cache_clear()
    yield TestClient(app_module.app)
    coach.client_for_key.cache_clear()


def test_the_body_the_frontend_builds_for_the_sample_take_is_valid(client: TestClient) -> None:
    body = run_frontend("", ["filler-001"])

    assert body["session_id"] == "sample-check"
    assert body["tier"] == "Novice"
    assert body["shown_ids"] == ["filler-001"]
    summary = body["summary"]
    assert set(summary) == {
        "duration_seconds",
        "words_per_minute",
        "filler_count",
        "restart_count",
        "mid_sentence_pause_count",
        "long_pause_count",
        "target_wpm",
        "transcript_excerpt",
    }
    # The sample is a Congress speech, 130 to 160 wpm, about 146 wpm and 10.5 fillers a minute.
    assert summary["target_wpm"] == [130, 160]
    assert 140 < summary["words_per_minute"] < 150
    assert summary["filler_count"] > 0
    assert 0 < len(summary["transcript_excerpt"]) <= coach.MAX_EXCERPT_CHARACTERS

    # The server's own validation accepts it as it is.
    coach.AdviceRequest.model_validate(body)
    response = client.post("/api/advice", json=body)
    assert response.status_code == 200, response.text


def test_an_entry_the_take_is_offered_is_left_out_once_the_frontend_sends_it_shown(
    client: TestClient,
) -> None:
    # Asked with nothing shown, the server offers this take a first entry. The order is fixed
    # for the take (select.py seeds it with the session id), so asked again it would offer that
    # entry again, unless the shown ids the frontend sends keep it out.
    offered = entry_ids(client.post("/api/advice", json=run_frontend("")).json())[0]

    reply = client.post("/api/advice", json=run_frontend("", [offered])).json()

    assert coach.MIN_TIPS <= len(reply["tips"]) <= coach.MAX_TIPS
    assert offered not in entry_ids(reply), "a shown id is left out"


def test_the_reply_round_trips_through_the_frontend_parser(client: TestClient) -> None:
    reply = client.post("/api/advice", json=run_frontend("")).json()

    assert reply["source"] == "library"
    assert coach.MIN_TIPS <= len(reply["tips"]) <= coach.MAX_TIPS

    notes = run_frontend(json.dumps(reply))

    assert notes is not None, "the frontend must accept what the server sends"
    assert notes["source"] == "library"
    assert [note["entryId"] for note in notes["tips"]] == entry_ids(reply)
    for note, tip in zip(notes["tips"], reply["tips"], strict=True):
        assert note["text"] == tip["text"].strip()
        assert note["drill"] == tip["drill"].strip()
        assert note["citation"]["label"] == tip["citation"]["label"]
        assert note["citation"]["type"] == tip["citation"]["type"]
        # Every library url is http(s), so every source is drawn as a link.
        assert note["citation"]["url"] == tip["citation"]["url"]
        assert note["citation"]["url"].startswith(("http://", "https://"))
