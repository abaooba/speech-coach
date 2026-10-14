"""automation/usage_limit.py: the night run stops on a limit the CLI reports, not one the agent names.

night.sh used to grep the task's whole JSON result for "rate limit" and the like, and that
result's `result` field is the agent's final message, so a task about rate limiting ended the
night. Only the CLI's own words count now: its stderr log, and the error fields of its JSON
result. Exit 0 means a limit stopped the task, 1 that none did.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
USAGE_LIMIT = REPO_ROOT / "automation" / "usage_limit.py"

# A run that ended well, as `claude -p --output-format json` reports it (fields of a real night).
FINISHED = {
    "type": "result",
    "subtype": "success",
    "is_error": False,
    "api_error_status": None,
    "stop_reason": "end_turn",
    "terminal_reason": "completed",
    "num_turns": 31,
    "total_cost_usd": 1.33,
    "result": "Done: the timeline draws each restart.",
}


def result_json(**fields: object) -> str:
    return json.dumps({**FINISHED, **fields}) + "\n"


def stopped_by_limit(tmp_path: Path, out: str | None, err: str = "") -> bool:
    """Run the check on a task's stdout (None: no file at all) and stderr log."""
    out_path = tmp_path / "T1.out.json"
    err_path = tmp_path / "T1.err.log"
    if out is not None:
        out_path.write_text(out)
    err_path.write_text(err)
    result = subprocess.run(
        [sys.executable, str(USAGE_LIMIT), str(out_path), str(err_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode in (0, 1), result.stderr
    return result.returncode == 0


@pytest.mark.parametrize(
    "message",
    [
        "Added a rate limit to /api/advice: 300 AI calls an hour for the whole server.",
        "The usage limit copy now says when the limit resets.",
        "Tests cover what a speaker sees when they hit your limit page.",
        "Refused with 429 once you are out of extra usage.",
    ],
)
def test_a_finished_task_that_mentions_a_limit_did_not_hit_one(
    tmp_path: Path, message: str
) -> None:
    assert not stopped_by_limit(tmp_path, result_json(result=message))


@pytest.mark.parametrize(
    "fields",
    [
        {"is_error": True, "result": "Claude AI usage limit reached|1760320800"},
        {"is_error": True, "result": "You've hit your limit · resets 3am (America/Chicago)"},
        {"is_error": True, "result": "You're out of extra usage · resets Oct 14"},
        {"is_error": True, "result": "API Error: Rate limit reached for requests"},
        {"subtype": "error_during_execution", "errors": ["Usage limit reached for this week"]},
    ],
)
def test_a_task_that_ended_on_a_limit_error_hit_one(tmp_path: Path, fields: dict) -> None:
    assert stopped_by_limit(tmp_path, result_json(**fields))


def test_an_http_429_from_the_api_is_a_limit_whatever_the_message(tmp_path: Path) -> None:
    out = result_json(
        is_error=True,
        api_error_status=429,
        result='API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
    )
    assert stopped_by_limit(tmp_path, out)


def test_a_limit_in_the_stderr_log_is_one(tmp_path: Path) -> None:
    assert stopped_by_limit(tmp_path, "", err="Error: rate limit exceeded, try again later\n")


def test_plain_text_output_is_the_clis_own_message(tmp_path: Path) -> None:
    assert stopped_by_limit(tmp_path, "Claude AI usage limit reached|1760320800\n")


@pytest.mark.parametrize(
    "fields",
    [
        {"is_error": True, "result": "API Error: 500 Internal server error"},
        {"is_error": True, "subtype": "error_max_budget_usd", "result": None},
        {"subtype": "error_max_turns", "errors": ["Reached the maximum number of turns"]},
    ],
)
def test_a_task_that_failed_for_another_reason_did_not_hit_one(
    tmp_path: Path, fields: dict
) -> None:
    assert not stopped_by_limit(tmp_path, result_json(**fields))


def test_a_task_killed_before_it_wrote_anything_did_not_hit_one(tmp_path: Path) -> None:
    assert not stopped_by_limit(tmp_path, "", err="TIMEOUT after 2400s\n")
    assert not stopped_by_limit(tmp_path, None)
