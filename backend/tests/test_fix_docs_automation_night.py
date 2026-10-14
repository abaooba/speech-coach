"""automation/night.sh run end to end in a scratch copy of the repo, never against the real one.

The scratch repo holds a copy of automation/, a tasks/queue.json and a tiny project whose own
pytest and ruff pass, and a bare repo beside it is its origin. A stand-in `claude`, first on PATH,
plays the agent: for each task it writes, deletes and commits what its plan says, as a Bash edit
or a git rm would, and prints the JSON result the CLI prints. A stand-in `gh` answers
`pr create`. HOME is a scratch folder too, so the step that trusts the worktree writes a scratch
~/.claude.json, and git reads no user or system config.

One night covers three rules. A task whose commits change, delete or rename an existing test or
a protected file fails, though its own checks pass; new test files are fine. A failed task's
dependents wait as todo rather than being blocked for good. A task whose last message names a
rate limit does not end the night; a limit the CLI itself reports does (a second, short night).
"""

import dataclasses
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
# launchd runs the night job with /bin/bash (automation/com.speechcoach.night.plist).
BASH = "/bin/bash"
RUN_ID = "test-run"
# A night of four stand-in tasks takes a few seconds; this only stops a hung run.
NIGHT_TIMEOUT_SECONDS = 300

PASSING_TEST = "def test_passes():\n    assert True\n"
FAILING_TEST = 'def test_fails():\n    assert False, "fails on purpose"\n'
FRONTEND_TEST = "// an existing frontend test\n"
DESIGN_SPEC = "# Speech Coach frontend design spec\n"

# The tiny project each night builds on. Its .gitignore keeps the checks' caches out of
# `git status`, as the real one does, so a passing task is not counted dirty.
PROJECT_FILES = {
    ".gitignore": ".venv\nnights/\nlogs/\n.night.lock\n__pycache__/\n.pytest_cache/\n.ruff_cache/\n",
    "pyproject.toml": (
        '[tool.pytest.ini_options]\ntestpaths = ["backend/tests"]\n\n'
        "[tool.ruff]\nline-length = 100\n"
    ),
    "backend/tests/test_base.py": PASSING_TEST,
    "frontend/tests/practice.test.js": FRONTEND_TEST,
    "frontend/DESIGN.md": DESIGN_SPEC,
}

# A run that ended well, as `claude -p --output-format json` reports it.
FINISHED = {
    "type": "result",
    "subtype": "success",
    "is_error": False,
    "api_error_status": None,
    "num_turns": 12,
    "total_cost_usd": 0.5,
    "result": "Done.",
}

# The stand-in agent. night.sh runs it in the worktree as `claude -p PROMPT ...`; the prompt
# names the report file nights/<task id>.md, which says which plan to follow.
STAND_IN_AGENT = r"""
import json, os, re, subprocess, sys
from pathlib import Path

prompt = sys.argv[sys.argv.index("-p") + 1]
task_id = re.search(r"nights/([A-Za-z0-9_-]+)\.md", prompt).group(1)
with open(os.environ["NIGHT_TEST_CALLS"], "a") as calls:
    calls.write(task_id + "\n")
plan = json.loads(Path(os.environ["NIGHT_TEST_PLANS"]).read_text())[task_id]
for rel, text in plan.get("write", {}).items():
    Path(rel).parent.mkdir(parents=True, exist_ok=True)
    Path(rel).write_text(text)
    subprocess.run(["git", "add", "--", rel], check=True)
for rel in plan.get("delete", []):
    subprocess.run(["git", "rm", "--quiet", "--", rel], check=True)
if plan.get("write") or plan.get("delete"):
    subprocess.run(["git", "commit", "--quiet", "--message", task_id + ": stand-in"], check=True)
sys.stderr.write(plan.get("stderr", ""))
print(json.dumps(plan["result"]))
sys.exit(plan.get("exit", 0))
"""
STAND_IN_GH = "#!/bin/bash\necho https://github.com/example/speech-coach/pull/1\n"


@dataclasses.dataclass
class Night:
    """What one scratch night left behind."""

    returncode: int
    output: str
    tasks: dict[str, dict]
    calls: list[str]
    report: str
    worktree: Path

    def protected_lines(self) -> str:
        """The log lines naming the protected paths a task changed, joined."""
        lines = [line for line in self.output.splitlines() if "protected paths changed" in line]
        return "\n".join(lines)

    def committed(self, rel: str) -> str | None:
        """The text of `rel` on the night branch, or None when the branch has no such file."""
        result = subprocess.run(
            ["git", "-C", str(self.worktree), "show", f"HEAD:{rel}"],
            env=git_env(),
            capture_output=True,
            text=True,
            check=False,
        )
        return result.stdout if result.returncode == 0 else None


def git_env() -> dict[str, str]:
    """This environment for git on a scratch repo: no GIT_* variable from outside (a hook's
    GIT_DIR would point git at another repo), no user or system config (hooks, signing), and a
    stand-in author."""
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.pop("XDG_CONFIG_HOME", None)
    env.update(
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_CONFIG_NOSYSTEM="1",
        GIT_AUTHOR_NAME="Night test",
        GIT_AUTHOR_EMAIL="night-test@example.com",
        GIT_COMMITTER_NAME="Night test",
        GIT_COMMITTER_EMAIL="night-test@example.com",
    )
    return env


def git(root: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(root), *args], env=git_env(), capture_output=True, text=True, check=True
    )


def task(tid: str, title: str, depends_on: list[str] | None = None) -> dict:
    entry = {"id": tid, "title": title, "status": "todo", "owner": "agent", "notes": []}
    if depends_on:
        entry["depends_on"] = depends_on
    return entry


def run_night(scratch: Path, tasks: list[dict], plans: dict[str, dict], max_tasks: int) -> Night:
    """Build the scratch repo, its origin and the stand-ins, then run night.sh once."""
    root = scratch / "speech-coach"
    for rel, text in PROJECT_FILES.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    shutil.copytree(REPO_ROOT / "automation", root / "automation")
    (root / "tasks").mkdir()
    (root / "tasks" / "queue.json").write_text(json.dumps({"tasks": tasks}, indent=1) + "\n")
    # night.sh links each worktree's .venv to the repo's; this one is the venv running the tests.
    (root / ".venv").symlink_to(sys.prefix, target_is_directory=True)

    origin = scratch / "origin.git"
    git(scratch, "init", "--quiet", "--bare", str(origin))
    git(root, "init", "--quiet", "--initial-branch", "main")
    git(root, "add", ".")
    git(root, "commit", "--quiet", "--message", "base")
    git(root, "remote", "add", "origin", str(origin))
    git(root, "push", "--quiet", "origin", "main")

    bin_dir = scratch / "bin"
    bin_dir.mkdir()
    (bin_dir / "agent.py").write_text(STAND_IN_AGENT)
    (bin_dir / "claude").write_text(f'#!/bin/bash\nexec "{sys.executable}" "{bin_dir}/agent.py" "$@"\n')
    (bin_dir / "gh").write_text(STAND_IN_GH)
    for stand_in in ("claude", "gh"):
        (bin_dir / stand_in).chmod(0o755)
    finished_plans = {
        tid: {**plan, "result": {**FINISHED, **plan.get("result", {})}}
        for tid, plan in plans.items()
    }
    plans_path = scratch / "plans.json"
    plans_path.write_text(json.dumps(finished_plans))
    calls_path = scratch / "calls.txt"
    calls_path.write_text("")
    home = scratch / "home"
    home.mkdir()

    env = git_env()
    for name in ("NIGHT_RUN", "NIGHT_BASE_SHA", "PYTEST_ADDOPTS"):
        env.pop(name, None)
    env.update(
        HOME=str(home),
        PATH=os.pathsep.join([str(bin_dir), str(Path(sys.executable).parent), env["PATH"]]),
        MAX_TASKS=str(max_tasks),
        TASK_TIMEOUT="120",
        BUDGET_USD="1",
        RUN=RUN_ID,
        NIGHT_TEST_PLANS=str(plans_path),
        NIGHT_TEST_CALLS=str(calls_path),
    )
    result = subprocess.run(
        [BASH, str(root / "automation" / "night.sh")],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        timeout=NIGHT_TIMEOUT_SECONDS,
        check=False,
    )
    queue = json.loads((root / "tasks" / "queue.json").read_text())
    report = root / "nights" / f"{RUN_ID}.md"
    return Night(
        returncode=result.returncode,
        output=result.stdout + result.stderr,
        tasks={entry["id"]: entry for entry in queue["tasks"]},
        calls=calls_path.read_text().split(),
        report=report.read_text() if report.exists() else "",
        worktree=scratch / ".night-worktrees" / RUN_ID,
    )


@pytest.fixture(scope="module")
def night(tmp_path_factory: pytest.TempPathFactory) -> Night:
    tasks = [
        task("T1", "commits a failing test"),
        task("T2", "builds on T1", depends_on=["T1"]),
        task("T3", "adds tests and names a rate limit in its last message"),
        task("T4", "rewrites an existing frontend test and deletes the spec, by hand"),
        task("T5", "adds a test"),
    ]
    plans = {
        "T1": {"write": {"backend/tests/test_t1.py": FAILING_TEST}},
        "T3": {
            "write": {
                "backend/tests/test_t3.py": PASSING_TEST,
                "frontend/tests/t3.test.js": "// a new frontend test\n",
            },
            "result": {
                "result": "Added a rate limit to /api/advice; past the usage limit it says so."
            },
        },
        "T4": {
            "write": {
                "frontend/tests/practice.test.js": "// rewritten so it passes\n",
                "backend/tests/test_t4.py": PASSING_TEST,
            },
            "delete": ["frontend/DESIGN.md"],
        },
        "T5": {"write": {"backend/tests/test_t5.py": PASSING_TEST}},
    }
    return run_night(tmp_path_factory.mktemp("night"), tasks, plans, max_tasks=4)


@pytest.fixture(scope="module")
def night_on_a_limit(tmp_path_factory: pytest.TempPathFactory) -> Night:
    tasks = [task("U1", "meets the usage limit"), task("U2", "adds a test")]
    plans = {
        "U1": {
            "result": {"is_error": True, "result": "You've hit your limit · resets 3am"},
            "exit": 1,
        },
        "U2": {"write": {"backend/tests/test_u2.py": PASSING_TEST}},
    }
    return run_night(tmp_path_factory.mktemp("night-limit"), tasks, plans, max_tasks=3)


def test_the_night_runs_to_its_end(night: Night) -> None:
    assert night.returncode == 0, night.output
    assert "=== night.sh end" in night.output, night.output


def test_the_agent_gets_every_task_it_may_start(night: Night) -> None:
    assert night.calls == ["T1", "T3", "T4", "T5"], night.output


def test_a_task_whose_commits_change_protected_paths_fails(night: Night) -> None:
    assert night.tasks["T4"]["status"] == "blocked", night.output
    assert "protected=1" in night.tasks["T4"]["notes"][-1]
    lines = night.protected_lines()
    assert "frontend/tests/practice.test.js" in lines, night.output
    assert "frontend/DESIGN.md" in lines, night.output


def test_a_failed_tasks_commits_are_left_out_of_the_branch(night: Night) -> None:
    assert night.committed("frontend/tests/practice.test.js") == FRONTEND_TEST
    assert night.committed("frontend/DESIGN.md") == DESIGN_SPEC
    assert night.committed("backend/tests/test_t4.py") is None


def test_new_test_files_are_fine(night: Night) -> None:
    assert night.tasks["T3"]["status"] == "done", night.output
    assert night.tasks["T5"]["status"] == "done", night.output
    assert night.committed("frontend/tests/t3.test.js") is not None
    assert night.committed("backend/tests/test_t5.py") == PASSING_TEST
    for added in ("frontend/tests/t3.test.js", "backend/tests/test_t3.py", "test_t5.py"):
        assert added not in night.protected_lines()


def test_a_failed_tasks_dependents_wait_as_todo(night: Night) -> None:
    assert night.tasks["T1"]["status"] == "blocked"
    assert night.tasks["T2"]["status"] == "todo"
    assert any("T1 failed" in note for note in night.tasks["T2"]["notes"])


def test_a_last_message_naming_a_rate_limit_does_not_end_the_night(night: Night) -> None:
    assert "usage limit detected" not in night.output
    assert "Usage limit hit: 0." in night.report


def test_a_limit_the_cli_reports_ends_the_night(night_on_a_limit: Night) -> None:
    assert night_on_a_limit.returncode == 0, night_on_a_limit.output
    assert night_on_a_limit.calls == ["U1"], night_on_a_limit.output
    assert "usage limit detected; ending loop" in night_on_a_limit.output
    assert "Usage limit hit: 1." in night_on_a_limit.report
    assert night_on_a_limit.tasks["U2"]["status"] == "todo"
