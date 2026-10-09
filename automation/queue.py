"""Tiny CLI over tasks/queue.json used by night.sh. Humans edit the file directly.

  queue.py next            -> prints id of first task with status todo and owner agent
  queue.py set ID STATUS [NOTE]
  queue.py get ID          -> prints the task as JSON
  queue.py reset-doing NOTE -> any task left in 'doing' goes back to 'todo'
  queue.py show
"""

import json
import sys
from datetime import datetime
from pathlib import Path

QUEUE = Path(__file__).resolve().parent.parent / "tasks" / "queue.json"


def load() -> dict:
    return json.loads(QUEUE.read_text())


def save(q: dict) -> None:
    QUEUE.write_text(json.dumps(q, indent=1) + "\n")


def find(q: dict, tid: str) -> dict:
    for t in q["tasks"]:
        if t["id"] == tid:
            return t
    sys.exit(f"no task {tid}")


def main(argv: list[str]) -> None:
    cmd = argv[0] if argv else "show"
    q = load()
    if cmd == "next":
        for t in q["tasks"]:
            if t["status"] == "todo" and t.get("owner", "agent") == "agent":
                print(t["id"])
                return
        return
    if cmd == "get":
        print(json.dumps(find(q, argv[1]), indent=1))
        return
    if cmd == "set":
        t = find(q, argv[1])
        t["status"] = argv[2]
        if len(argv) > 3 and argv[3]:
            t["notes"].append(f"{datetime.now().astimezone().date().isoformat()}: {argv[3]}")
        save(q)
        return
    if cmd == "reset-doing":
        note = argv[1] if len(argv) > 1 else "reset"
        for t in q["tasks"]:
            if t["status"] == "doing":
                t["status"] = "todo"
                t["notes"].append(f"{datetime.now().astimezone().date().isoformat()}: {note}")
        save(q)
        return
    for t in q["tasks"]:
        print(f"{t['id']}  {t['status']:<8} {t.get('owner','agent'):<6} {t['title']}")


if __name__ == "__main__":
    main(sys.argv[1:])
