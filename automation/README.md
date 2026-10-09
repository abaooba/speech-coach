# Automation: how to run it

## Modes
| Mode | When | Command |
|---|---|---|
| Night (automatic) | 00:30 daily via launchd | installed by `automation/install-launchd.sh` |
| Day batch (manual) | weekends, between hands-on blocks | `MAX_TASKS=2 TASK_TIMEOUT=1800 bash automation/night.sh` |
| Single task | testing or a quick fix | `MAX_TASKS=1 bash automation/night.sh` |

Every run makes its own branch (`night/<date>`, `night/<date>-2`, ...) and its own PR.
Approve or reject each run before starting the next so the next one branches from updated main:

```bash
automation/approve.sh            # merges today's latest run
automation/reject.sh 2026-10-11 "results screen crashes on empty transcript"
```

Pass the date suffix when there were several runs that day, e.g. `approve.sh 2026-10-11-2`.

## Stop everything
```bash
touch STOP                       # loop exits at the next task boundary
launchctl unload ~/Library/LaunchAgents/com.speechcoach.night.plist   # disable nightly job
```
Remove the STOP file to resume.

## Budget rule
Before any day batch, open Claude Code and run `/usage`. If the weekly bar is over
50% on a Saturday or over 65% on a Sunday, skip day batches and work hands-on only.
Video week (Oct 21 to 24) must not start throttled.

## Where things land
- `nights/<date>.md`: morning report. `nights/<date>/`: raw agent output, test logs, failed patches.
- `logs/`: script and launchd logs.
- `tasks/queue.json`: task status and notes. Edit tasks by hand; the script flips status.
