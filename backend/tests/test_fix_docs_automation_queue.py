"""automation/queue.py on a scratch copy: a failed task's dependents are noted, never blocked.

night.sh marks a failed task "blocked". Its dependents used to be marked "blocked" too, and
nothing ever set them back, so once the failed task was fixed the queue stalled with work left.
`next` already holds a task back until every task it depends on is done, so the dependents keep
"todo" and get a note saying what they wait for. queue.py finds tasks/queue.json beside its own
folder, so a copy in a scratch folder works on a scratch queue, never the real one.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
QUEUE_PY = REPO_ROOT / "automation" / "queue.py"

TASKS = [
    {"id": "T1", "title": "fails tonight", "status": "todo", "owner": "agent", "notes": []},
    {
        "id": "T2",
        "title": "needs T1",
        "status": "todo",
        "owner": "agent",
        "depends_on": ["T1"],
        "notes": [],
    },
    {
        "id": "T3",
        "title": "needs T2",
        "status": "todo",
        "owner": "agent",
        "depends_on": ["T2"],
        "notes": [],
    },
    {"id": "T4", "title": "needs nothing", "status": "todo", "owner": "agent", "notes": []},
]


@pytest.fixture
def scratch(tmp_path: Path) -> Path:
    """automation/queue.py beside tasks/queue.json, as in the repo."""
    (tmp_path / "automation").mkdir()
    shutil.copy(QUEUE_PY, tmp_path / "automation" / "queue.py")
    (tmp_path / "tasks").mkdir()
    (tmp_path / "tasks" / "queue.json").write_text(json.dumps({"tasks": TASKS}, indent=1) + "\n")
    return tmp_path


def queue(root: Path, *args: str) -> str:
    result = subprocess.run(
        [sys.executable, str(root / "automation" / "queue.py"), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def tasks(root: Path) -> dict[str, dict]:
    saved = json.loads((root / "tasks" / "queue.json").read_text())
    return {task["id"]: task for task in saved["tasks"]}


def fail_t1(root: Path) -> None:
    """What night.sh does when T1 fails."""
    queue(root, "set", "T1", "blocked", "run 2026-10-13-0030 failed: pytest=1")
    queue(root, "note-dependents", "T1")


def test_the_dependents_of_a_failed_task_keep_status_todo(scratch: Path) -> None:
    fail_t1(scratch)
    statuses = {tid: task["status"] for tid, task in tasks(scratch).items()}
    assert statuses == {"T1": "blocked", "T2": "todo", "T3": "todo", "T4": "todo"}


def test_each_dependent_gets_one_note_naming_the_failed_task(scratch: Path) -> None:
    fail_t1(scratch)
    after = tasks(scratch)
    for tid in ("T2", "T3"):
        assert len(after[tid]["notes"]) == 1, after[tid]["notes"]
        assert "T1 failed" in after[tid]["notes"][0]
    assert after["T4"]["notes"] == []


def test_the_queue_moves_on_once_the_failed_task_is_done(scratch: Path) -> None:
    fail_t1(scratch)
    assert queue(scratch, "next") == "T4"
    queue(scratch, "set", "T4", "done")
    assert queue(scratch, "next") == "", "T2 and T3 wait for T1"
    queue(scratch, "set", "T1", "done", "fixed by hand")
    assert queue(scratch, "next") == "T2"
    queue(scratch, "set", "T2", "done")
    assert queue(scratch, "next") == "T3"
