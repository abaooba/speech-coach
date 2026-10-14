"""automation/night.sh with nothing queued: one orchestrator run, in a scratch copy of the repo.

These reuse the scratch night of test_fix_docs_automation_night.py (a tiny project, a bare origin,
stand-in `claude` and `gh`), with every task in the queue already done. The stand-in agent also
logs the options night.sh hands it, so the tests can check the orchestrator gets its own model,
settings and MCP options. HOME is a scratch folder with no local-llm server, so the local models
are reported off; the smoke test in automation/README.md covers the real server.
"""

import json
from pathlib import Path

import pytest

from backend.tests import test_fix_docs_automation_night as night_harness

FAILING_TEST = night_harness.FAILING_TEST
PASSING_TEST = night_harness.PASSING_TEST
ORCHESTRATOR_MODEL = "claude-fable-5-1"

# The stand-in agent, logging its own command line first (one JSON list per call).
LOGGING_AGENT = (
    "import json as _json, os as _os, sys as _sys\n"
    "with open(_os.environ['NIGHT_TEST_ARGS'], 'a') as _log:\n"
    "    _log.write(_json.dumps(_sys.argv[1:]) + '\\n')\n"
) + night_harness.STAND_IN_AGENT


def finished_queue() -> list[dict]:
    """A queue whose only task is done, so `queue.py next` finds nothing."""
    return [{**night_harness.task("T1", "already built"), "status": "done"}]


def run_empty_night(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, plan: dict, orchestrate: str = "1"
) -> tuple[night_harness.Night, list[list[str]]]:
    args_log = tmp_path / "args.jsonl"
    args_log.write_text("")
    monkeypatch.setattr(night_harness, "STAND_IN_AGENT", LOGGING_AGENT)
    monkeypatch.setenv("NIGHT_TEST_ARGS", str(args_log))
    monkeypatch.setenv("ORCHESTRATE", orchestrate)
    night = night_harness.run_night(
        tmp_path / "scratch", finished_queue(), {"orchestrator": plan}, max_tasks=3
    )
    calls = [json.loads(line) for line in args_log.read_text().splitlines()]
    return night, calls


def option(args: list[str], name: str) -> str | None:
    """The value after `name` in a command line, or None when it is not there."""
    return args[args.index(name) + 1] if name in args else None


def test_an_empty_queue_runs_one_orchestrator_on_a_new_branch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan = {"write": {"backend/tests/test_orchestrated.py": PASSING_TEST}}
    night, _ = run_empty_night(tmp_path, monkeypatch, plan)
    assert night.returncode == 0, night.output
    assert "orchestrator mode" in night.output, night.output
    assert night.calls == ["orchestrator"], night.output
    assert night.committed("backend/tests/test_orchestrated.py") == PASSING_TEST
    assert "Done: orchestrator. Blocked: none." in night.report
    assert night.tasks["T1"]["status"] == "done"
    assert night.tasks["T1"]["notes"] == []


def test_the_orchestrator_gets_its_model_settings_and_only_the_local_mcp_server(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan = {"write": {"backend/tests/test_orchestrated.py": PASSING_TEST}}
    night, calls = run_empty_night(tmp_path, monkeypatch, plan)
    assert len(calls) == 1, night.output
    args = calls[0]
    assert option(args, "--model") == ORCHESTRATOR_MODEL
    assert option(args, "--settings").endswith("automation/orchestrator-settings.json")
    assert "--strict-mcp-config" in args
    # The scratch HOME has no local-llm server, so no MCP config is passed and the log says so.
    assert "--mcp-config" not in args
    assert "local models: off" in night.output, night.output
    assert option(args, "--permission-mode") == "dontAsk"


def test_a_failing_orchestrator_run_is_dropped_from_the_branch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan = {"write": {"backend/tests/test_orchestrated_fails.py": FAILING_TEST}}
    night, _ = run_empty_night(tmp_path, monkeypatch, plan)
    assert night.returncode == 0, night.output
    assert "Done: none. Blocked: orchestrator." in night.report
    assert night.committed("backend/tests/test_orchestrated_fails.py") is None
    assert "(no PR: no commits)" in night.report


def test_the_morning_report_has_the_orchestrator_sections(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan = {"write": {"backend/tests/test_orchestrated.py": PASSING_TEST}}
    night, _ = run_empty_night(tmp_path, monkeypatch, plan)
    assert "# orchestrator-plan" in night.report
    assert "# orchestrator\n" in night.report


def test_with_the_orchestrator_off_an_empty_queue_leaves_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    night, calls = run_empty_night(tmp_path, monkeypatch, {}, orchestrate="0")
    assert night.returncode == 0, night.output
    assert "queue empty; nothing to build" in night.output, night.output
    assert calls == []
    assert not night.worktree.exists()
    assert night.report == ""
