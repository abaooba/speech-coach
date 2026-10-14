#!/bin/bash
# Nightly bounded build loop. See docs/superpowers/specs/2026-10-08-night-loop-design.md
# Usage: automation/night.sh            (env: MAX_TASKS=3 TASK_TIMEOUT=2400 BUDGET_USD=15)
# With nothing queued, one orchestrator agent researches, picks and builds the best next feature,
# drafting through the local models (ORCHESTRATE=0 turns that off; see automation/README.md).
set -u
set -m   # job control: each task runs in its own process group so a timeout kills the whole agent
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATE="${DATE:-$(date +%Y-%m-%d)}"
RUN="${RUN:-$DATE-$(date +%H%M)}"   # unique per run: one branch, worktree, report and log each
MAX_TASKS="${MAX_TASKS:-3}"
EFFORT="${EFFORT:-high}"
TASK_TIMEOUT="${TASK_TIMEOUT:-2400}"
BUDGET_USD="${BUDGET_USD:-30}"
ORCHESTRATE="${ORCHESTRATE:-1}"
ORCH_MODEL="${ORCH_MODEL:-claude-fable-5-1}"
ORCH_EFFORT="${ORCH_EFFORT:-high}"
# Four hours for research, a plan, the build and its checks; the budget bounds it too.
ORCH_TIMEOUT="${ORCH_TIMEOUT:-14400}"
ORCH_BUDGET_USD="${ORCH_BUDGET_USD:-30}"
WT_ROOT="$(dirname "$REPO")/.night-worktrees"
BRANCH="night/$RUN"
WT="$WT_ROOT/$RUN"
NIGHT_DIR="$REPO/nights/$RUN"
LOG="$REPO/logs/night-$RUN.log"
mkdir -p "$REPO/logs"
exec > >(tee -a "$LOG") 2>&1
echo "=== night.sh start $(date) repo=$REPO max_tasks=$MAX_TASKS effort=$EFFORT timeout=${TASK_TIMEOUT}s budget=\$$BUDGET_USD"
# Keep the Mac awake until this script ends: asleep, one task once took 6.7 hours of wall time.
if command -v caffeinate >/dev/null 2>&1; then caffeinate -i -w $$ >/dev/null 2>&1 & fi

Q() { python3 "$REPO/automation/queue.py" "$@"; }
LOCK="$REPO/.night.lock"
cleanup() { Q reset-doing "run ended while task was in progress"; rmdir "$LOCK" 2>/dev/null; }
# Where a task may add files but never change, delete or rename one: the same paths
# hooks/protect.sh guards (the test folders, the frontend spec, the human-owned pauses.js, the
# plan, notes and specs in docs, rules, queue, automation, .claude and every .env file). The hook
# stops the file tools there; checking each task's commits also catches a Bash edit or a git rm.
PROTECTED_PATHS=(backend/tests frontend/tests frontend/DESIGN.md frontend/pauses.js docs/PLAN.md
  docs/challenge-notes.md docs/superpowers CLAUDE.md tasks/queue.json automation .claude '.env*')

if [ -f "$REPO/STOP" ]; then echo "STOP file present; exiting"; exit 0; fi
if ! mkdir "$LOCK" 2>/dev/null; then echo "another night.sh is running (remove $LOCK if stale); exiting"; exit 0; fi
trap cleanup EXIT
cd "$REPO" || exit 1
# Tonight is the queue's next tasks, or, with nothing queued, one orchestrator run. With the
# orchestrator turned off, an empty queue leaves nothing behind: no branch, worktree or report.
MODE=queue
if [ -z "$(Q next)" ]; then
  if [ "$ORCHESTRATE" != "1" ]; then echo "queue empty; nothing to build"; exit 0; fi
  MODE=orchestrate
  echo "queue empty; orchestrator mode: $ORCH_MODEL researches, picks and builds one feature"
fi
mkdir -p "$NIGHT_DIR" "$WT_ROOT"
git fetch -q origin main || { echo "fetch failed"; exit 1; }

# Fresh worktree from origin/main. If today's branch already exists, add a suffix.
n=1
while git show-ref --quiet "refs/heads/$BRANCH" || [ -d "$WT" ]; do
  n=$((n+1)); BRANCH="night/$RUN-$n"; WT="$WT_ROOT/$RUN-$n"; NIGHT_DIR="$REPO/nights/$RUN-$n"; mkdir -p "$NIGHT_DIR"
done
git worktree add -q -b "$BRANCH" "$WT" origin/main || { echo "worktree add failed"; exit 1; }
ln -s "$REPO/.venv" "$WT/.venv"
# Claude Code ignores .claude/settings.json permissions in untrusted folders; trust this worktree.
python3 - "$WT" "$REPO" <<'PY'
import json, sys, pathlib
cfg = pathlib.Path.home() / ".claude.json"
d = json.loads(cfg.read_text()) if cfg.exists() else {}
for path in sys.argv[1:]:
    d.setdefault("projects", {}).setdefault(path, {})["hasTrustDialogAccepted"] = True
cfg.write_text(json.dumps(d, indent=2))
PY
mkdir -p "$WT/nights"
echo "worktree $WT on $BRANCH"

done_ids=(); blocked_ids=(); consecutive_fail=0; usage_limit=0
: > "$NIGHT_DIR/tasks.txt"
summary_rows=""

# Runs one agent in the worktree, then checks what it committed: pytest, ruff, the protected
# paths and uncommitted leftovers. Verification is done here, never by the agent. Arguments: the
# report id, the prompt, the timeout in seconds, then this kind of run's own claude options. Sets
# base_sha, rc, subtype, elapsed, turns, cost, commits, dirty, t_rc, r_rc, p_rc and passed (1 when
# the committed work passed every check).
run_agent() {
  local tid="$1" prompt="$2" timeout="$3"
  shift 3
  local out="$NIGHT_DIR/$tid.out.json" err="$NIGHT_DIR/$tid.err.log" start pid wd protected
  base_sha="$(git -C "$WT" rev-parse HEAD)"
  start=$(date +%s)
  ( cd "$WT" && exec env NIGHT_RUN=1 NIGHT_BASE_SHA="$base_sha" claude -p "$prompt" "$@" \
      --permission-mode dontAsk --permission-prompts none \
      --output-format json --no-session-persistence --disable-slash-commands ) > "$out" 2> "$err" < /dev/null &
  pid=$!
  ( sleep "$timeout"; kill -TERM -- -"$pid" 2>/dev/null && echo "TIMEOUT after ${timeout}s" >> "$err"; sleep 20; kill -KILL -- -"$pid" 2>/dev/null ) & wd=$!
  wait "$pid"; rc=$?
  kill -- -"$wd" 2>/dev/null; wait "$wd" 2>/dev/null
  elapsed=$(( $(date +%s) - start ))
  turns="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('num_turns','?'))" "$out" 2>/dev/null || echo '?')"
  cost="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(round(d.get('total_cost_usd',0),2))" "$out" 2>/dev/null || echo '?')"
  subtype="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('subtype','?'))" "$out" 2>/dev/null || echo '?')"
  # Only the CLI's own report of a limit counts, never the agent's final message (usage_limit.py).
  if python3 "$REPO/automation/usage_limit.py" "$out" "$err"; then usage_limit=1; fi

  commits="$(git -C "$WT" rev-list --count "$base_sha..HEAD")"
  dirty="$(git -C "$WT" status --porcelain | grep -vE '^\?\? (nights/|\.venv)' | wc -l | tr -d ' ')"
  (cd "$WT" && .venv/bin/pytest -q > "$NIGHT_DIR/$tid.pytest.log" 2>&1); t_rc=$?
  (cd "$WT" && .venv/bin/ruff check . > "$NIGHT_DIR/$tid.ruff.log" 2>&1); r_rc=$?
  # M changed, D deleted, R renamed, T turned into a link or back; a file the task added (A) is fine.
  protected="$(git -C "$WT" diff --name-only --diff-filter=MDRT "$base_sha" HEAD -- "${PROTECTED_PATHS[@]}")" \
    || protected="(git diff failed)"
  p_rc=0
  if [ -n "$protected" ]; then
    p_rc=1
    echo "protected paths changed: $(printf '%s' "$protected" | tr '\n' ' ')"
  fi
  [ -f "$WT/nights/$tid.md" ] && mv "$WT/nights/$tid.md" "$NIGHT_DIR/$tid.md"
  echo "rc=$rc subtype=$subtype elapsed=${elapsed}s turns=$turns cost=\$$cost commits=$commits dirty=$dirty pytest=$t_rc ruff=$r_rc protected=$p_rc"

  # Uncommitted leftovers but passing checks: discard the leftovers and re-verify the committed state.
  # (rc is deliberately ignored: a timeout or budget stop still keeps committed, verified work.)
  if [ "$commits" -gt 0 ] && [ "$t_rc" -eq 0 ] && [ "$r_rc" -eq 0 ] && [ "$p_rc" -eq 0 ] && [ "$dirty" -gt 0 ]; then
    git -C "$WT" status --porcelain > "$NIGHT_DIR/$tid.leftovers.txt"
    git -C "$WT" checkout -q -- . ; git -C "$WT" clean -qfd -e nights
    (cd "$WT" && .venv/bin/pytest -q > "$NIGHT_DIR/$tid.pytest.log" 2>&1); t_rc=$?
    (cd "$WT" && .venv/bin/ruff check . > "$NIGHT_DIR/$tid.ruff.log" 2>&1); r_rc=$?
    echo "discarded $dirty uncommitted paths; re-verify pytest=$t_rc ruff=$r_rc"
    [ "$t_rc" -eq 0 ] && [ "$r_rc" -eq 0 ] && dirty=0
  fi
  passed=0
  if [ "$commits" -gt 0 ] && [ "$t_rc" -eq 0 ] && [ "$r_rc" -eq 0 ] && [ "$p_rc" -eq 0 ] && [ "$dirty" -eq 0 ]; then
    passed=1
  fi
}

# Puts the worktree back where the failed agent started, keeping its work as a patch.
drop_work() {
  git -C "$WT" diff "$base_sha" > "$NIGHT_DIR/$1.failed.patch"
  git -C "$WT" reset -q --hard "$base_sha"; git -C "$WT" clean -qfd -e nights
}

if [ "$MODE" = queue ]; then
  for i in $(seq 1 "$MAX_TASKS"); do
    [ -f "$REPO/STOP" ] && { echo "STOP file appeared; ending loop"; break; }
    TID="$(Q next)"
    [ -z "$TID" ] && { echo "queue empty"; break; }
    echo "--- task $i: $TID  $(date +%H:%M)"
    Q set "$TID" doing
    echo "$TID" >> "$NIGHT_DIR/tasks.txt"
    TASK_JSON="$(Q get "$TID")"
    PROMPT="$(python3 - "$REPO/automation/task-prompt.md" "$DATE" "$BRANCH" "$TID" "$TASK_JSON" <<'PY'
import sys
tpl, date, branch, tid, task = sys.argv[1:6]
s = open(tpl).read()
for k, v in {"{{DATE}}": date, "{{BRANCH}}": branch, "{{TASK_ID}}": tid, "{{TASK_JSON}}": task}.items():
    s = s.replace(k, v)
print(s)
PY
)"
    run_agent "$TID" "$PROMPT" "$TASK_TIMEOUT" --settings "$REPO/automation/night-settings.json" \
      --effort "$EFFORT" --max-budget-usd "$BUDGET_USD" --strict-mcp-config
    if [ "$passed" -eq 1 ]; then
      status_word=done; [ "$rc" -ne 0 ] && status_word="partial ($subtype)"
      Q set "$TID" done "run $RUN: $commits commits, $turns turns, \$$cost, rc=$rc $status_word"
      done_ids+=("$TID"); consecutive_fail=0
      summary_rows+="| $TID | $status_word | $commits | $turns | \$$cost | ${elapsed}s |\n"
    else
      reason="rc=$rc subtype=$subtype commits=$commits pytest=$t_rc ruff=$r_rc protected=$p_rc dirty=$dirty"
      drop_work "$TID"
      Q set "$TID" blocked "run $RUN failed: $reason"
      Q note-dependents "$TID"
      blocked_ids+=("$TID"); consecutive_fail=$((consecutive_fail+1))
      summary_rows+="| $TID | FAILED ($reason) | $commits | $turns | \$$cost | ${elapsed}s |\n"
    fi
    [ "$usage_limit" -eq 1 ] && { echo "usage limit detected; ending loop"; break; }
    [ "$consecutive_fail" -ge 2 ] && { echo "two consecutive failures; ending loop"; break; }
  done
else
  TID=orchestrator
  echo "--- orchestrator: $ORCH_MODEL effort=$ORCH_EFFORT timeout=${ORCH_TIMEOUT}s budget=\$$ORCH_BUDGET_USD  $(date +%H:%M)"
  PROMPT="$(python3 - "$REPO/automation/orchestrator-prompt.md" "$DATE" "$BRANCH" "$RUN" <<'PY'
import sys
tpl, date, branch, run = sys.argv[1:5]
s = open(tpl).read()
for k, v in {"{{DATE}}": date, "{{BRANCH}}": branch, "{{RUN}}": run}.items():
    s = s.replace(k, v)
print(s)
PY
)"
  # The local models reach the orchestrator through the owner's own local-llm MCP server entry,
  # copied at run time into this run's git-ignored folder; nothing about it lives in the repo.
  MCP_ARGS=(--strict-mcp-config)
  if python3 - "$NIGHT_DIR/mcp-local.json" <<'PY'
import json, os, pathlib, sys
cfg_path = pathlib.Path.home() / ".claude.json"
servers = json.loads(cfg_path.read_text()).get("mcpServers", {}) if cfg_path.exists() else {}
if "local-llm" not in servers:
    sys.exit(1)
out = pathlib.Path(sys.argv[1])
out.write_text(json.dumps({"mcpServers": {"local-llm": servers["local-llm"]}}))
os.chmod(out, 0o600)
PY
  then
    MCP_ARGS+=(--mcp-config "$NIGHT_DIR/mcp-local.json")
    echo "local models: on (the local-llm server from ~/.claude.json)"
  else
    echo "local models: off (no local-llm server in ~/.claude.json); the orchestrator works alone"
  fi
  run_agent "$TID" "$PROMPT" "$ORCH_TIMEOUT" --settings "$REPO/automation/orchestrator-settings.json" \
    --model "$ORCH_MODEL" --effort "$ORCH_EFFORT" --max-budget-usd "$ORCH_BUDGET_USD" "${MCP_ARGS[@]}"
  [ -f "$WT/nights/orchestrator-plan.md" ] && mv "$WT/nights/orchestrator-plan.md" "$NIGHT_DIR/orchestrator-plan.md"
  status_word=done; [ "$rc" -ne 0 ] && status_word="partial ($subtype)"
  if [ "$passed" -eq 1 ]; then
    done_ids+=("$TID")
    summary_rows+="| $TID | $status_word | $commits | $turns | \$$cost | ${elapsed}s |\n"
  else
    reason="rc=$rc subtype=$subtype commits=$commits pytest=$t_rc ruff=$r_rc protected=$p_rc dirty=$dirty"
    drop_work "$TID"
    blocked_ids+=("$TID")
    summary_rows+="| $TID | FAILED ($reason) | $commits | $turns | \$$cost | ${elapsed}s |\n"
  fi
fi

# Push and open one PR if anything landed.
total="$(git -C "$WT" rev-list --count "origin/main..HEAD")"
pr_url="(no PR: no commits)"
if [ "$total" -gt 0 ]; then
  title="${done_ids[*]:-nothing}"
  if [ "$MODE" = orchestrate ]; then
    feature="$(sed -n 's/^# //p' "$NIGHT_DIR/orchestrator-plan.md" 2>/dev/null | head -1)"
    title="orchestrator, ${feature:-one feature}"
  fi
  git -C "$WT" push -q -u origin "$BRANCH" && \
  pr_url="$(cd "$WT" && gh pr create --base main --head "$BRANCH" --title "Run $RUN: $title" \
    --body "Automated overnight build. Review nights/$RUN.md locally before merging." 2>&1 | tail -1)"
fi

# Morning report.
REPORT="$REPO/nights/$RUN.md"
{
  echo "# Run $RUN"
  echo
  echo "Done: ${done_ids[*]:-none}. Blocked: ${blocked_ids[*]:-none}. Usage limit hit: $usage_limit."
  echo "PR: $pr_url"
  echo "Approve: \`automation/approve.sh $RUN\`   Reject: \`automation/reject.sh $RUN \"reason\"\`"
  echo
  echo "| task | result | commits | turns | cost | time |"; echo "|---|---|---|---|---|---|"
  printf "%b" "$summary_rows"
  for TID in $(cat "$NIGHT_DIR/tasks.txt"); do
    echo; echo "---"; echo "# $TID"; echo
    if [ -f "$NIGHT_DIR/$TID.md" ]; then cat "$NIGHT_DIR/$TID.md"; else echo "(agent wrote no report; see $NIGHT_DIR/$TID.err.log)"; fi
  done
  if [ "$MODE" = orchestrate ]; then
    for part in orchestrator-plan orchestrator; do
      echo; echo "---"; echo "# $part"; echo
      if [ -f "$NIGHT_DIR/$part.md" ]; then cat "$NIGHT_DIR/$part.md"; else echo "(no $part.md; see $NIGHT_DIR/orchestrator.err.log)"; fi
    done
  fi
} > "$REPORT"
echo "$BRANCH" > "$NIGHT_DIR/branch.txt"; echo "$WT" > "$NIGHT_DIR/worktree.txt"
echo "=== night.sh end $(date). Report: $REPORT"
