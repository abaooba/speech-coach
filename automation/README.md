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


## Empty queue: the orchestrator
When `tasks/queue.json` has nothing to run, the night does not stop. It makes a new branch and
worktree as usual and runs one orchestrator agent (`automation/orchestrator-prompt.md`) on
`claude-fable-5-1`. The orchestrator researches what wins the Congressional App Challenge, picks
one compact feature, hands hyper-specific drafting briefs to the local models (the `local-llm`
MCP server from `~/.claude.json`, worker and quality tiers) and integrates, tests and commits the
result itself. The same checks as a queued task decide whether its commits are kept: pytest,
ruff and the protected paths. Its plan and report are in the morning report `nights/<id>.md`.

| Setting | Default | Meaning |
|---|---|---|
| `ORCHESTRATE` | `1` | `0` makes an empty queue end the night with nothing left behind |
| `ORCH_MODEL` | `claude-fable-5-1` | the orchestrator's model |
| `ORCH_EFFORT` | `high` | its effort |
| `ORCH_TIMEOUT` | `14400` | seconds before it is stopped (four hours) |
| `ORCH_BUDGET_USD` | `30` | its spend cap |

Its permissions are `automation/orchestrator-settings.json`: the night task's, plus WebSearch,
WebFetch and the local-llm tools. Smoke test, from a scratch folder (about $0.25):
`claude -p "Call mcp__local-llm__local_status, then one WebSearch; report both." --model
claude-fable-5-1 --settings automation/orchestrator-settings.json --strict-mcp-config
--mcp-config <a file holding only the local-llm server entry> --permission-mode dontAsk
--output-format json`.

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
