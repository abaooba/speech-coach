#!/bin/bash
# Close tonight's PR, put its tasks back to todo with your reason, remove the worktree.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
REASON="${2:-rejected without reason}"
# Resolve which run: an exact run id (2026-10-10-0030), a date (latest run that day), or nothing (latest today).
ARG="${1:-$(date +%Y-%m-%d)}"
if [ -d "$REPO/nights/$ARG" ]; then RUN="$ARG"; else RUN="$(ls -d "$REPO"/nights/"$ARG"* 2>/dev/null | grep -v '\.md$' | sort | tail -1 | xargs -I{} basename {})"; fi
[ -z "$RUN" ] && { echo "no run found for $ARG"; exit 1; }
echo "run: $RUN"
BRANCH="$(cat "$REPO/nights/$RUN/branch.txt")"; WT="$(cat "$REPO/nights/$RUN/worktree.txt")"
num="$(gh pr list --repo abaooba/speech-coach --head "$BRANCH" --json number --jq '.[0].number' || true)"
[ -n "$num" ] && gh pr close "$num" --repo abaooba/speech-coach --delete-branch
for TID in $(cat "$REPO/nights/$RUN/tasks.txt"); do
  python3 "$REPO/automation/queue.py" set "$TID" todo "run $RUN rejected: $REASON"
done
git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true
git -C "$REPO" branch -D "$BRANCH" 2>/dev/null || true
echo "rejected $BRANCH; tasks reset to todo"
