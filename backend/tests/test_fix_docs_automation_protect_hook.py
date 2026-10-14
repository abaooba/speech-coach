"""automation/hooks/protect.sh, the night agent's PreToolUse hook, run against a scratch repo.

The hook reads the tool call as JSON on stdin and exits 2 to refuse it. During a night run
(NIGHT_RUN=1) it refuses Edit and Write on human-owned paths, on frontend/DESIGN.md and
frontend/pauses.js, and on every file under backend/tests or frontend/tests that the task's base
commit (NIGHT_BASE_SHA) already holds; a new test file is allowed. The scratch repo stands in for
the night worktree, so the real repo is never touched.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
HOOK = REPO_ROOT / "automation" / "hooks" / "protect.sh"
# launchd runs the night job with /bin/bash (automation/com.speechcoach.night.plist).
BASH = "/bin/bash"
# The exit code that makes Claude Code refuse the tool call and show the hook's message.
REFUSED = 2

# What the task's base commit holds.
BASE_FILES = {
    "backend/tests/test_api.py": "def test_ok():\n    assert True\n",
    "backend/tests/fixtures/clip.json": "{}\n",
    "frontend/tests/api.test.js": "// an existing frontend test\n",
    "frontend/tests/fake-dom.js": "// an existing frontend test helper\n",
    "frontend/DESIGN.md": "# Speech Coach frontend design spec\n",
    "frontend/pauses.js": "// human-owned (T08)\n",
    "frontend/app.js": "// the router\n",
}

REFUSED_PATHS = [
    "frontend/tests/api.test.js",
    "frontend/tests/fake-dom.js",
    "frontend/DESIGN.md",
    "frontend/pauses.js",
    "backend/tests/test_api.py",
    "backend/tests/fixtures/clip.json",
    "docs/PLAN.md",
    "automation/night.sh",
]
ALLOWED_PATHS = [
    "frontend/tests/new_feature.test.js",
    "backend/tests/test_new_feature.py",
    "frontend/app.js",
    "frontend/screens/practice.js",
]


def git_env() -> dict[str, str]:
    """This environment for git on a scratch repo: no GIT_* variable from outside (a hook's
    GIT_DIR would point git at another repo), no user or system config (hooks, signing), and a
    stand-in author."""
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_CONFIG_NOSYSTEM="1",
        GIT_AUTHOR_NAME="Night test",
        GIT_AUTHOR_EMAIL="night-test@example.com",
        GIT_COMMITTER_NAME="Night test",
        GIT_COMMITTER_EMAIL="night-test@example.com",
    )
    return env


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args], env=git_env(), capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


@pytest.fixture(scope="module")
def worktree(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, str]:
    """A scratch repo holding BASE_FILES in one commit, and that commit's sha."""
    root = tmp_path_factory.mktemp("night-worktree")
    for rel, text in BASE_FILES.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    git(root, "init", "--quiet")
    git(root, "add", ".")
    git(root, "commit", "--quiet", "--message", "base")
    return root, git(root, "rev-parse", "HEAD")


def run_hook(
    worktree: tuple[Path, str], rel: str, *, night_run: bool = True
) -> subprocess.CompletedProcess[str]:
    """Ask the hook about an Edit of `rel`, given as the absolute path the Edit tool sends."""
    root, base_sha = worktree
    env = git_env()
    env.pop("NIGHT_RUN", None)
    # The hook reads its input with python3: this interpreter's directory comes first.
    env["PATH"] = f"{Path(sys.executable).parent}{os.pathsep}{env.get('PATH', '')}"
    env["CLAUDE_PROJECT_DIR"] = str(root)
    env["NIGHT_BASE_SHA"] = base_sha
    if night_run:
        env["NIGHT_RUN"] = "1"
    call = {"tool_name": "Edit", "tool_input": {"file_path": str(root / rel)}}
    return subprocess.run(
        [BASH, str(HOOK)],
        input=json.dumps(call),
        env=env,
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("rel", REFUSED_PATHS)
def test_the_night_agent_may_not_edit(worktree: tuple[Path, str], rel: str) -> None:
    result = run_hook(worktree, rel)
    assert result.returncode == REFUSED, f"{rel} was let through"
    assert rel in result.stderr, "the message names the file"


@pytest.mark.parametrize("rel", ALLOWED_PATHS)
def test_the_night_agent_may_edit(worktree: tuple[Path, str], rel: str) -> None:
    result = run_hook(worktree, rel)
    assert result.returncode == 0, result.stderr


def test_an_existing_frontend_test_says_to_add_a_new_file(worktree: tuple[Path, str]) -> None:
    result = run_hook(worktree, "frontend/tests/api.test.js")
    assert "add a new test file instead" in result.stderr


@pytest.mark.parametrize("rel", ["frontend/DESIGN.md", "frontend/tests/api.test.js"])
def test_an_interactive_session_is_never_refused(worktree: tuple[Path, str], rel: str) -> None:
    assert run_hook(worktree, rel, night_run=False).returncode == 0


@pytest.mark.parametrize(
    "script", ["hooks/protect.sh", "night.sh", "approve.sh", "reject.sh", "install-launchd.sh"]
)
def test_every_automation_script_parses(script: str) -> None:
    result = subprocess.run(
        [BASH, "-n", str(REPO_ROOT / "automation" / script)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
