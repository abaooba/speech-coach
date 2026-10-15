"""Build the seed history the README screenshots are taken with.

Two real takes: the owner's 2026-10-11 everyday take from backend/tests/fixtures (its words from
AssemblyAI, with a cut-off restart) and the bundled sample's words and timings, each scored by
backend.metrics.analyze as /api/analyze scores a take. Dated three days apart, so Progress has
its two sessions and a trend. With --analyze, each audio file is posted to a running backend
instead (needs a provider key in .env and the network; pytest never does this).

Usage:
  .venv/bin/python scripts/screenshot_seed.py --out /tmp/seed.json
  .venv/bin/python scripts/screenshot_seed.py --out /tmp/seed.json \
      --analyze samples/take1.m4a samples/take2.m4a --base http://127.0.0.1:8766
"""

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

import httpx

from backend import metrics
from backend.providers.assemblyai import to_word
from backend.providers.base import Word

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "backend" / "tests" / "fixtures"
SAMPLE = ROOT / "frontend" / "sample-session.json"

# The 2026-10-11 take and the sample, three days apart, newest last.
NERVOUS_AT = "2026-10-08T22:15:00.000Z"
EXPLAIN_AT = "2026-10-11T19:07:00.000Z"
ANALYZE_TIMEOUT_SECONDS = 180.0


def sessions_from_fixtures() -> list[dict]:
    """The two seed sessions, oldest first."""
    fixture = FIXTURES / "take_2026_10_11_nervous.json"
    nervous = json.loads(fixture.read_text(encoding="utf-8"))
    words = [to_word(raw) for raw in nervous["words"]]
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    sample_words = [Word(**entry) for entry in sample["transcript"]]
    return [
        session(NERVOUS_AT, "free-talk", "Your day", words, metrics.analyze(words), topic=None),
        session(
            EXPLAIN_AT,
            sample["passageId"],
            "Explain something",
            sample_words,
            metrics.analyze(sample_words),
            topic=None,
        ),
    ]


def session(
    created_at: str,
    passage_id: str,
    title: str,
    words: Sequence[Word],
    take_metrics: dict,
    topic: str | None,
) -> dict:
    """One session in the shape frontend/store.js save() accepts (no id: the store assigns one)."""
    return {
        "createdAt": created_at,
        "passageId": passage_id,
        "passageTitle": title,
        "durationSeconds": round(words[-1].end, 1) if words else 0,
        "metrics": take_metrics,
        "transcript": [asdict(word) for word in words],
        "topic": topic,
    }


def sessions_from_audio(paths: Sequence[Path], base_url: str, client: httpx.Client) -> list[dict]:
    """Post each audio file to a running backend and keep its answer as a session."""
    sessions = []
    for index, path in enumerate(paths):
        with path.open("rb") as audio:
            reply = client.post(
                f"{base_url.rstrip('/')}/api/analyze",
                files={"audio": (path.name, audio, "application/octet-stream")},
                timeout=ANALYZE_TIMEOUT_SECONDS,
            )
        reply.raise_for_status()
        answer = reply.json()
        words = [Word(**entry) for entry in answer["transcript"]]
        created_at = f"2026-10-{5 + 2 * index:02d}T18:00:00.000Z"
        sessions.append(
            {
                **session(created_at, "free-talk", "Your day", words, answer["metrics"], None),
                "durationSeconds": answer["metrics"].get("duration", 0),
            }
        )
    return sessions


def main(argv: Sequence[str] | None = None, client: httpx.Client | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the screenshot seed history as JSON.")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--analyze", nargs="*", type=Path, default=[])
    parser.add_argument("--base", default="http://127.0.0.1:8766")
    args = parser.parse_args(argv)
    sessions = sessions_from_fixtures()
    if args.analyze:
        sessions += sessions_from_audio(args.analyze, args.base, client or httpx.Client())
    args.out.write_text(json.dumps(sessions, indent=1), encoding="utf-8")
    print(f"{len(sessions)} sessions written to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
