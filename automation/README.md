# Automation: how to run it

## Modes
| Mode | When | Command |
|---|---|---|
| Night (automatic) | 00:30 daily via launchd | installed by `automation/install-launchd.sh` |
| Day batch (manual) | weekends, between hands-on blocks | `MAX_TASKS=2 TASK_TIMEOUT=1800 bash automation/night.sh` |
| Single task | testing or a quick fix | `MAX_TASKS=1 bash automation/night.sh` |

Every run gets a unique id `<date>-<HHMM>` (for example `2026-10-10-0030`): its own branch `night/<id>`, worktree, PR, report `nights/<id>.md` and log.
Approve or reject each run before starting the next so the next one branches from updated main:

```bash
automation/approve.sh                    # merges today's latest run
automation/approve.sh 2026-10-11         # latest run on that date
automation/approve.sh 2026-10-11-0030    # one specific run
automation/reject.sh 2026-10-11-1038 "results screen crashes on empty transcript"
```


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
- `nights/<id>.md`: report for one run. `nights/<id>/`: raw agent output, test logs, failed patches.
- `logs/`: script and launchd logs.
- `tasks/queue.json`: task status and notes. Edit tasks by hand; the script flips status.
