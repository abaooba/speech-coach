#!/bin/bash
# Close tonight's PR, put its tasks back to todo with your reason, remove the worktree.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"; DATE="${1:-$(date +%Y-%m-%d)}"; REASON="${2:-rejected without reason}"
BRANCH="$(cat "$REPO/nights/$DATE/branch.txt")"; WT="$(cat "$REPO/nights/$DATE/worktree.txt")"
num="$(gh pr list --repo abaooba/speech-coach --head "$BRANCH" --json number --jq '.[0].number' || true)"
[ -n "$num" ] && gh pr close "$num" --repo abaooba/speech-coach --delete-branch
for TID in $(cat "$REPO/nights/$DATE/tasks.txt"); do
  python3 "$REPO/automation/queue.py" set "$TID" todo "night $DATE rejected: $REASON"
done
git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true
git -C "$REPO" branch -D "$BRANCH" 2>/dev/null || true
echo "rejected $BRANCH; tasks reset to todo"
