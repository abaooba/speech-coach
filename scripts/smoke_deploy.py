"""Check a deploy answers as the demo needs: health, coach notes, moments and the grammar check.

Manual and online, like check_advice_links.py: the owner runs it by hand after setting the
Render environment, and before a demo. The tests run it against fake servers.

Usage: .venv/bin/python scripts/smoke_deploy.py https://speech-coach-xz8c.onrender.com

Four checks, each PASS or FAIL with one line of detail, exit code 1 when any fails:
  health          GET /api/health answers 200 {"status": "ok"}
  coach notes     POST /api/advice answers 200 with source "ai"; "library" means no
                  ANTHROPIC_API_KEY, or the hour's budget of AI calls is spent
  coach moments   POST /api/advice with a take's moments answers 200 with a "headline" key (null
                  or not): the guided coach's reply shape
  language check  POST /api/language-check answers 200 with status "ok", or "unavailable" (no
                  key or a spent budget, which the coach notes check already fails on)
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


# The same take with three of its moments (coach.py Moment), as frontend/tips.js sends them.
MOMENTS_ADVICE_BODY = {
    **ADVICE_BODY,
    "moments": [
        {
            "id": "filler-1",
            "kind": "filler",
            "at": 4.2,
            "clock": "0:04",
            "seconds": None,
            "text": "um",
            "before": "how I plan my week,",
            "after": "so I start",
            "expected": None,
            "hint": False,
        },
        {
            "id": "restart-1",
            "kind": "restart",
            "at": 21.5,
            "clock": "0:21",
            "seconds": None,
            "text": "I start, I start",
            "before": "so",
            "after": "on Sunday",
            "expected": None,
            "hint": False,
        },
        {
            "id": "long-pause-1",
            "kind": "long-pause",
            "at": 30.1,
            "clock": "0:30",
            "seconds": 5.4,
            "text": "",
            "before": "on Sunday.",
            "after": "Then I",
            "expected": None,
            "hint": False,
        },
    ],
}

# A valid POST /api/language-check body (backend/language/check.py LanguageCheckRequest).
LANGUAGE_BODY = {
    "session_id": "00000000-0000-4000-8000-00000000c0de",
    "transcript": (
        "Yesterday I go to the market with my sister and we buy many vegetable for the dinner. "
        "It was very nice day and the seller was friendly with us."
    ),
}
LANGUAGE_STATUSES = ("ok", "unavailable")


def run(base_url: str, client: httpx.Client) -> list[Check]:
    """The four checks against `base_url`, in order; a request that raises fails its check."""
    base = base_url.rstrip("/")
    return [
        check_health(base, client),
        check_coach_notes(base, client),
        check_coach_moments(base, client),
        check_language(base, client),
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


def check_coach_moments(base: str, client: httpx.Client) -> Check:
    name = "coach moments"
    try:
        reply = client.post(
            f"{base}/api/advice", json=MOMENTS_ADVICE_BODY, timeout=TIMEOUT_SECONDS
        )
    except httpx.HTTPError as error:
        return (name, False, f"POST /api/advice failed: {type(error).__name__}")
    if reply.status_code != 200:
        return (name, False, f"POST /api/advice with moments answered {reply.status_code}")
    body = body_json(reply)
    if body is None:
        return (name, False, "POST /api/advice with moments answered 200 with a non-JSON body")
    if "headline" not in body or not isinstance(body.get("tips"), list):
        return (
            name,
            False,
            (
                "POST /api/advice with moments answered without a headline: the deploy runs "
                "code from before the guided coach"
            ),
        )
    return (name, True, "POST /api/advice with moments answered with a headline key")


def check_language(base: str, client: httpx.Client) -> Check:
    name = "language check"
    try:
        reply = client.post(
            f"{base}/api/language-check", json=LANGUAGE_BODY, timeout=TIMEOUT_SECONDS
        )
    except httpx.HTTPError as error:
        return (name, False, f"POST /api/language-check failed: {type(error).__name__}")
    if reply.status_code != 200:
        return (name, False, f"POST /api/language-check answered {reply.status_code}")
    body = body_json(reply)
    if body is None:
        return (name, False, "POST /api/language-check answered 200 with a non-JSON body")
    status = body.get("status")
    detail = f"POST /api/language-check answered with status '{status}'"
    if status == "unavailable":
        detail += ": no ANTHROPIC_API_KEY, or the hour's budget is spent"
    return (name, status in LANGUAGE_STATUSES, detail)


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
