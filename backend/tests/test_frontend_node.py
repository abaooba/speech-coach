"""Runs the frontend's node:test suite (frontend/tests) under pytest so one command covers both.

Skips when node is not installed; otherwise the JS tests must all pass.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_TESTS_DIR = "frontend/tests"
HOMEBREW_NODE = Path("/opt/homebrew/bin/node")


def node_binary() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    return str(HOMEBREW_NODE) if HOMEBREW_NODE.exists() else None


def test_frontend_node_suite_passes() -> None:
    node = node_binary()
    if node is None:
        pytest.skip("node is not installed (not on PATH and not at /opt/homebrew/bin/node)")
    result = subprocess.run(
        [node, "--test", FRONTEND_TESTS_DIR],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
    assert result.returncode == 0, f"node --test {FRONTEND_TESTS_DIR} failed; see output above"
