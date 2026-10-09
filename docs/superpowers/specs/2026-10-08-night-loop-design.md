# Night loop design

Date: 2026-10-08. Approved in chat.

## Goal

A nightly, bounded, unattended build run on the Mac Studio that lands
reviewable pull requests, so that a 30-minute school-day morning keeps the
project moving and the author stays the author of the code.

## Shape

- launchd fires `automation/night.sh` at 00:30 daily.
- The script creates a worktree on branch `night/<date>`, then runs up to
  `MAX_TASKS` (default 3) tasks. Each task is one fresh `claude -p` session
  with a wall-clock timeout (default 40 min) and a dollar cap.
- After each task the script, not the agent, verifies: pytest and ruff pass
  in the worktree and at least one new commit exists. Pass marks the task
  done; fail marks it blocked with a note.
- Circuit breakers: two consecutive failures, the same task failing twice,
  a `STOP` file in the repo, or a usage-limit message from Claude end the run.
- At the end the script pushes the branch, opens one PR, and writes
  `nights/<date>.md` in the fixed morning-report format.

## Ownership

| Path | Owner | Agent may |
|---|---|---|
| docs/PLAN.md, CLAUDE.md, docs/challenge-notes.md | human | read |
| tasks/queue.json | human writes tasks; script flips status | read |
| existing files under backend/tests/ | human | read (hook blocks edits) |
| new test files | agent | create |
| automation/, .claude/, .env | human | read (hook blocks .env) |
| main branch | GitHub protection | open PRs |

## Morning report format (nights/<date>.md)

1. Status line: tasks done / blocked / skipped, turns and cost per task.
2. Up to three curated diff hunks with one sentence each.
3. Three study questions with answers folded in `<details>`.
4. At most two yes/no decisions.
5. Local reviewer notes (added later, advisory only).

If the report is not in this format, reject without reading further.

## Morning commands

- `automation/approve.sh` merges the PR (squash), deletes the branch, removes the worktree.
- `automation/reject.sh "reason"` closes the PR, resets the night's tasks to todo with the reason as a note, removes the worktree.

## Guardrails, outermost first

1. GitHub branch protection on main (done 2026-10-08).
2. Worktree per night; push only to night/*.
3. `.claude/settings.json` allowlist and denylist for headless runs.
4. PreToolUse hook blocking edits to protected paths.
5. Prompt rules and the circuit breakers above.
6. Kill switch: `touch STOP` in the repo, or `launchctl unload` the plist.

## Local models

Not in the build loop. Added later as post-run advisory jobs (diff review,
feedback triage, content drafting) once two nights have run cleanly.

## Budget

Three tasks a night, 40 minutes each, is the starting dial. The Saturday
review lowers it if the week is burning more than half the Max cap, to keep
headroom for video week (Oct 21 to 24).
