"""Check a deploy answers as the demo needs: health, accounts on, coach notes written by Claude.

Manual and online, like check_advice_links.py: the owner runs it by hand after setting the
Render environment, and before a demo. The tests run it against fake servers.

Usage: .venv/bin/python scripts/smoke_deploy.py https://speech-coach-xz8c.onrender.com

Three checks, each PASS or FAIL with one line of detail, exit code 1 when any fails:
  health       GET /api/health answers 200 {"status": "ok"}
  accounts     GET /api/me answers 401 (accounts on, nobody signed in); 503 means DATABASE_URL
               is unset or unusable
  coach notes  POST /api/advice answers 200 with source "ai"; "library" means no
               ANTHROPIC_API_KEY, or the hour's budget of AI calls is spent
"""

import argparse
import sys
from collections.abc import Sequence

import httpx

Check = tuple[str, bool, str]

# A cold start on Render's free plan can take a minute before the first byte.
TIMEOUT_SECONDS = 90.0

# A valid POST /api/advice body (backend/advice/coach.py AdviceRequest): an everyday take.
ADVICE_BODY = {
    "session_id": "00000000-0000-4000-8000-00000000c0de",
    "tier": "Novice",
    "summary": {
        "duration_seconds": 60,
        "words_per_minute": 150,
        "filler_count": 6,
        "restart_count": 1,
        "mid_sentence_pause_count": 2,
        "long_pause_count": 0,
        "target_wpm": [140, 160],
        "transcript_excerpt": "Today I want to explain how I plan my week, um, so I start on Sunday.",
    },
}


def run(base_url: str, client: httpx.Client) -> list[Check]:
    """The three checks against `base_url`, in order; a request that raises fails its check."""
    base = base_url.rstrip("/")
    return [
        check_health(base, client),
        check_accounts(base, client),
        check_coach_notes(base, client),
    ]


def body_json(reply: httpx.Response) -> dict | None:
    """The reply's JSON object, or None when the body is not JSON or not an object."""
    try:
        body = reply.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def check_health(base: str, client: httpx.Client) -> Check:
    try:
        reply = client.get(f"{base}/api/health", timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as error:
        return ("health", False, f"GET /api/health failed: {type(error).__name__}")
    if reply.status_code != 200:
        return ("health", False, f"GET /api/health answered {reply.status_code}")
    body = body_json(reply)
    if body is None:
        return ("health", False, f"GET /api/health answered {reply.status_code} with a non-JSON body")
    if body.get("status") != "ok":
        return (
            "health",
            False,
            f"GET /api/health answered {reply.status_code} with an unexpected body",
        )
    return ("health", True, f"GET /api/health answered {reply.status_code}")


def check_accounts(base: str, client: httpx.Client) -> Check:
    try:
        reply = client.get(f"{base}/api/me", timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as error:
        return ("accounts", False, f"GET /api/me failed: {type(error).__name__}")
    if reply.status_code == 401:
        return ("accounts", True, "GET /api/me answered 401: accounts are on, nobody signed in")
    if reply.status_code == 503:
        return (
            "accounts",
            False,
            "GET /api/me answered 503: accounts are off (DATABASE_URL unset?)",
        )
    return ("accounts", False, f"GET /api/me answered {reply.status_code}")


def check_coach_notes(base: str, client: httpx.Client) -> Check:
    try:
        reply = client.post(f"{base}/api/advice", json=ADVICE_BODY, timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as error:
        return ("coach notes", False, f"POST /api/advice failed: {type(error).__name__}")
    if reply.status_code != 200:
        return ("coach notes", False, f"POST /api/advice answered {reply.status_code}")
    body = body_json(reply)
    if body is None:
        return ("coach notes", False, "POST /api/advice answered 200 with a non-JSON body")
    source = body.get("source")
    if source == "ai":
        return (
            "coach notes",
            True,
            "POST /api/advice answered with source 'ai': Claude wrote the notes",
        )
    return (
        "coach notes",
        False,
        (
            f"POST /api/advice answered with source '{source}': no ANTHROPIC_API_KEY, "
            "or the hour's budget is spent"
        ),
    )


def main(argv: Sequence[str] | None = None, client: httpx.Client | None = None) -> int:
    parser = argparse.ArgumentParser(description="Smoke-check a Speech Coach deploy.")
    parser.add_argument("base_url", help="https://speech-coach-xz8c.onrender.com")
    args = parser.parse_args(argv)
    checks = run(args.base_url, client or httpx.Client())
    for name, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")
    return 0 if all(ok for _, ok, _ in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
