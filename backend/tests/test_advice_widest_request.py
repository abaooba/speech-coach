"""The widest /api/advice request the frontend can build fits the body limit and is answered.

frontend/tips.js adviceRequest sends at most 40 moments (each text cut to 120 characters, its
context to 60 a side and a misread's expected word to 40), a 1,500-character excerpt, the newest
600 shown library ids and the take's numbers. backend/limits.py refuses an /api/advice body over
MAX_SMALL_BODY_BYTES (64,000) with a 413 before the route runs, so the widest body the frontend
can build must stay under it: every field full of the widest characters JSON can carry as UTF-8.
An emoji is 4 bytes; a C0 control character would be written as a 6-byte \\u00XX escape, which is
why tips.js drops them (as it drops NUL, which the server refuses). The body is built by the real
tips.js through node, as test_advice_frontend_body.py does, and sent with no API key, so the
library's own words answer and nothing opens a socket. Skips when node is not installed.
"""

import json
import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.advice import coach, load_library
from backend.limits import MAX_SMALL_BODY_BYTES

REPO_ROOT = Path(__file__).resolve().parents[2]
HOMEBREW_NODE = Path("/opt/homebrew/bin/node")
JSON_HEADERS = {"content-type": "application/json"}

# Builds the widest body: 40 moments of 8 kinds, each text field over its cap with the
# character in argv[1], the clock and times at their widest, 2,000 shown ids as long as argv[2] (the store keeps 2,000; a request
# sends the newest 600), a 36-character take id (a UUID, as app.store gives) and a tier. The
# transcript is one word of 3,000 three-byte characters, so the excerpt is 1,500 of them.
BUILD_SCRIPT = """
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join("frontend", file), "utf8");
const context = { app: { screens: {}, ui: {}, store: {}, router: {} } };
["passages.js", "delivery.js", "tips.js"].forEach((file) =>
  vm.runInNewContext(read(file), context, { filename: file }),
);
const fill = (count) => process.argv[1].repeat(count);
const idLength = Number(process.argv[2]);
const kinds = ["restart", "filler", "pause", "long-pause", "misread", "skip", "stumble", "unclear"];
const moments = Array.from({ length: 40 }, (_, index) => {
  const kind = kinds[index % kinds.length];
  return {
    id: kind + "-" + (900 + index),
    kind,
    at: 86399.987654 - index,
    clock: "999:59",
    seconds: 86399.987654,
    text: fill(500),
    before: fill(500),
    after: fill(500),
    expected: fill(500),
    hint: true,
  };
});
const transcript = [{ text: "\\u4e2d".repeat(3000), start: 0, end: 60 }];
const ids = Array.from({ length: 2000 }, (_, index) => String(index).padStart(idLength, "x"));
const session = { id: "8b1f6c2e-4a1d-4c3b-9e8f-0123456789ab", transcript };
const report = {
  fillerCount: 99999,
  repeatCount: 99999,
  midSentencePauseCount: 99999,
  longPauseCount: 99999,
  speakingSeconds: 86399.987654,
  wordsPerMinute: 999.987654,
};
const body = context.app.tips.adviceRequest(
  session, report, [140.987654, 160.987654], "Champion", ids, moments,
);
process.stdout.write(JSON.stringify(body));
"""


def node_binary() -> str:
    found = shutil.which("node") or (str(HOMEBREW_NODE) if HOMEBREW_NODE.exists() else None)
    if found is None:
        pytest.skip("node is not installed (not on PATH and not at /opt/homebrew/bin/node)")
    return found


def widest_body(character: str) -> bytes:
    """The body tips.js builds with every text field full of `character`, as UTF-8 JSON."""
    longest_id = max(len(entry.id) for entry in load_library())
    result = subprocess.run(
        [node_binary(), "--input-type=commonjs", "-e", BUILD_SCRIPT, character, str(longest_id)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.encode("utf-8")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The app with no API key, so the library's own words answer."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    coach.client_for_key.cache_clear()
    yield TestClient(app_module.app)
    coach.client_for_key.cache_clear()


def full(body: dict[str, Any]) -> None:
    """The body really is the widest: every list and text field at its cap."""
    assert len(body["moments"]) == coach.MAX_MOMENTS
    # The newest 600 at most; the oldest give way only when the moments leave no room for them.
    assert 500 <= len(body["shown_ids"]) <= 600
    assert body["shown_ids"][-1] == "1999".rjust(len(body["shown_ids"][-1]), "x")
    first = body["moments"][0]
    assert len(first["before"]) == coach.MAX_MOMENT_CONTEXT_CHARACTERS
    assert len(first["after"]) == coach.MAX_MOMENT_CONTEXT_CHARACTERS


@pytest.mark.parametrize("character", ["\N{GRINNING FACE}", '"', "\\"])
def test_the_widest_request_with_40_full_moments_fits_and_is_answered(
    client: TestClient, character: str
) -> None:
    raw = widest_body(character)
    body = json.loads(raw)
    full(body)
    first = body["moments"][0]
    assert len(first["text"]) == coach.MAX_MOMENT_TEXT_CHARACTERS
    assert len(first["expected"]) == coach.MAX_EXPECTED_CHARACTERS
    assert len(body["summary"]["transcript_excerpt"]) == coach.MAX_EXCERPT_CHARACTERS

    assert len(raw) <= MAX_SMALL_BODY_BYTES, f"{len(raw):,} bytes"
    response = client.post("/api/advice", content=raw, headers=JSON_HEADERS)
    assert response.status_code == 200, response.text
    assert set(response.json()) == {"headline", "tips", "source"}


@pytest.mark.parametrize("character", ["\x01", "\x1f", "\t", "\n"])
def test_control_characters_are_dropped_so_the_body_never_grows_past_the_limit(
    client: TestClient, character: str
) -> None:
    raw = widest_body(character)
    body = json.loads(raw)
    assert character not in raw.decode("utf-8")
    assert character not in json.dumps(body, ensure_ascii=False)
    moment = body["moments"][0]
    assert moment["text"] == "" and moment["before"] == "" and moment["after"] == ""
    assert len(raw) <= MAX_SMALL_BODY_BYTES, f"{len(raw):,} bytes"
    response = client.post("/api/advice", content=raw, headers=JSON_HEADERS)
    assert response.status_code == 200, response.text
