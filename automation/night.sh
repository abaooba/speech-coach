#!/bin/bash
# Nightly bounded build loop. See docs/superpowers/specs/2026-10-08-night-loop-design.md
# Usage: automation/night.sh            (env: MAX_TASKS=3 TASK_TIMEOUT=2400 BUDGET_USD=15)
set -u
set -m   # job control: each task runs in its own process group so a timeout kills the whole agent
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATE="${DATE:-$(date +%Y-%m-%d)}"
MAX_TASKS="${MAX_TASKS:-3}"
EFFORT="${EFFORT:-high}"
TASK_TIMEOUT="${TASK_TIMEOUT:-2400}"
BUDGET_USD="${BUDGET_USD:-30}"
WT_ROOT="$(dirname "$REPO")/.night-worktrees"
BRANCH="night/$DATE"
WT="$WT_ROOT/$DATE"
NIGHT_DIR="$REPO/nights/$DATE"
LOG="$REPO/logs/night-$DATE.log"
mkdir -p "$REPO/logs" "$NIGHT_DIR" "$WT_ROOT"
exec > >(tee -a "$LOG") 2>&1
echo "=== night.sh start $(date) repo=$REPO max_tasks=$MAX_TASKS effort=$EFFORT timeout=${TASK_TIMEOUT}s budget=\$$BUDGET_USD"

Q() { python3 "$REPO/automation/queue.py" "$@"; }
LOCK="$REPO/.night.lock"
cleanup() { Q reset-doing "run ended while task was in progress"; rmdir "$LOCK" 2>/dev/null; }

if [ -f "$REPO/STOP" ]; then echo "STOP file present; exiting"; exit 0; fi
if ! mkdir "$LOCK" 2>/dev/null; then echo "another night.sh is running (remove $LOCK if stale); exiting"; exit 0; fi
trap cleanup EXIT
cd "$REPO" || exit 1
git fetch -q origin main || { echo "fetch failed"; exit 1; }

# Fresh worktree from origin/main. If today's branch already exists, add a suffix.
n=1
while git show-ref --quiet "refs/heads/$BRANCH" || [ -d "$WT" ]; do
  n=$((n+1)); BRANCH="night/$DATE-$n"; WT="$WT_ROOT/$DATE-$n"
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
  base_sha="$(git -C "$WT" rev-parse HEAD)"
  OUT="$NIGHT_DIR/$TID.out.json"; ERR="$NIGHT_DIR/$TID.err.log"
  start=$(date +%s)
  ( cd "$WT" && exec env NIGHT_RUN=1 NIGHT_BASE_SHA="$base_sha" claude -p "$PROMPT" \
      --settings "$REPO/automation/night-settings.json" --effort "$EFFORT" \
      --permission-mode dontAsk --permission-prompts none --max-budget-usd "$BUDGET_USD" \
      --output-format json --no-session-persistence --strict-mcp-config --disable-slash-commands ) > "$OUT" 2> "$ERR" &
  pid=$!
  ( sleep "$TASK_TIMEOUT"; kill -TERM -- -"$pid" 2>/dev/null && echo "TIMEOUT after ${TASK_TIMEOUT}s" >> "$ERR"; sleep 20; kill -KILL -- -"$pid" 2>/dev/null ) & wd=$!
  wait "$pid"; rc=$?
  kill -- -"$wd" 2>/dev/null; wait "$wd" 2>/dev/null
  elapsed=$(( $(date +%s) - start ))
  turns="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('num_turns','?'))" "$OUT" 2>/dev/null || echo '?')"
  cost="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(round(d.get('total_cost_usd',0),2))" "$OUT" 2>/dev/null || echo '?')"
  subtype="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('subtype','?'))" "$OUT" 2>/dev/null || echo '?')"
  if grep -qiE "usage limit|rate limit|hit your limit|out of extra usage" "$OUT" "$ERR"; then usage_limit=1; fi

  # Verification is done by this script, never by the agent.
  commits="$(git -C "$WT" rev-list --count "$base_sha..HEAD")"
  dirty="$(git -C "$WT" status --porcelain | grep -vE '^\?\? (nights/|\.venv)' | wc -l | tr -d ' ')"
  (cd "$WT" && .venv/bin/pytest -q > "$NIGHT_DIR/$TID.pytest.log" 2>&1); t_rc=$?
  (cd "$WT" && .venv/bin/ruff check . > "$NIGHT_DIR/$TID.ruff.log" 2>&1); r_rc=$?
  [ -f "$WT/nights/$TID.md" ] && mv "$WT/nights/$TID.md" "$NIGHT_DIR/$TID.md"
  echo "rc=$rc subtype=$subtype elapsed=${elapsed}s turns=$turns cost=\$$cost commits=$commits dirty=$dirty pytest=$t_rc ruff=$r_rc"

  # Uncommitted leftovers but passing checks: discard the leftovers and re-verify the committed state.
  # (rc is deliberately ignored: a timeout or budget stop still keeps committed, verified work.)
  if [ "$commits" -gt 0 ] && [ "$t_rc" -eq 0 ] && [ "$r_rc" -eq 0 ] && [ "$dirty" -gt 0 ]; then
    git -C "$WT" status --porcelain > "$NIGHT_DIR/$TID.leftovers.txt"
    git -C "$WT" checkout -q -- . ; git -C "$WT" clean -qfd -e nights
    (cd "$WT" && .venv/bin/pytest -q > "$NIGHT_DIR/$TID.pytest.log" 2>&1); t_rc=$?
    (cd "$WT" && .venv/bin/ruff check . > "$NIGHT_DIR/$TID.ruff.log" 2>&1); r_rc=$?
    echo "discarded $dirty uncommitted paths; re-verify pytest=$t_rc ruff=$r_rc"
    [ "$t_rc" -eq 0 ] && [ "$r_rc" -eq 0 ] && dirty=0
  fi
  if [ "$commits" -gt 0 ] && [ "$t_rc" -eq 0 ] && [ "$r_rc" -eq 0 ] && [ "$dirty" -eq 0 ]; then
    status_word=done; [ "$rc" -ne 0 ] && status_word="partial ($subtype)"
    Q set "$TID" done "night $DATE: $commits commits, $turns turns, \$$cost, rc=$rc $status_word"
    done_ids+=("$TID"); consecutive_fail=0
    summary_rows+="| $TID | $status_word | $commits | $turns | \$$cost | ${elapsed}s |\n"
  else
    reason="rc=$rc subtype=$subtype commits=$commits pytest=$t_rc ruff=$r_rc dirty=$dirty"
    git -C "$WT" diff "$base_sha" > "$NIGHT_DIR/$TID.failed.patch"
    git -C "$WT" reset -q --hard "$base_sha"; git -C "$WT" clean -qfd -e nights
    Q set "$TID" blocked "night $DATE failed: $reason"
    Q block-dependents "$TID"
    blocked_ids+=("$TID"); consecutive_fail=$((consecutive_fail+1))
    summary_rows+="| $TID | FAILED ($reason) | $commits | $turns | \$$cost | ${elapsed}s |\n"
  fi
  [ "$usage_limit" -eq 1 ] && { echo "usage limit detected; ending loop"; break; }
  [ "$consecutive_fail" -ge 2 ] && { echo "two consecutive failures; ending loop"; break; }
done

# Push and open one PR if anything landed.
total="$(git -C "$WT" rev-list --count "origin/main..HEAD")"
pr_url="(no PR: no commits)"
if [ "$total" -gt 0 ]; then
  git -C "$WT" push -q -u origin "$BRANCH" && \
  pr_url="$(cd "$WT" && gh pr create --base main --head "$BRANCH" --title "Night $DATE: ${done_ids[*]:-nothing}" \
    --body "Automated overnight build. Review nights/$DATE.md locally before merging." 2>&1 | tail -1)"
fi

# Morning report.
REPORT="$REPO/nights/$DATE.md"
{
  echo "# Night $DATE"
  echo
  echo "Done: ${done_ids[*]:-none}. Blocked: ${blocked_ids[*]:-none}. Usage limit hit: $usage_limit."
  echo "PR: $pr_url"
  echo "Approve: \`automation/approve.sh $DATE\`   Reject: \`automation/reject.sh $DATE \"reason\"\`"
  echo
  echo "| task | result | commits | turns | cost | time |"; echo "|---|---|---|---|---|---|"
  printf "%b" "$summary_rows"
  for TID in $(cat "$NIGHT_DIR/tasks.txt"); do
    echo; echo "---"; echo "# $TID"; echo
    if [ -f "$NIGHT_DIR/$TID.md" ]; then cat "$NIGHT_DIR/$TID.md"; else echo "(agent wrote no report; see $NIGHT_DIR/$TID.err.log)"; fi
  done
} > "$REPORT"
echo "$BRANCH" > "$NIGHT_DIR/branch.txt"; echo "$WT" > "$NIGHT_DIR/worktree.txt"
echo "=== night.sh end $(date). Report: $REPORT"
