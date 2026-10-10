#!/bin/bash
# Merge tonight's PR (squash), delete the branch, remove the worktree, update main.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Resolve which run: an exact run id (2026-10-10-0030), a date (latest run that day), or nothing (latest today).
ARG="${1:-$(date +%Y-%m-%d)}"
if [ -d "$REPO/nights/$ARG" ]; then RUN="$ARG"; else RUN="$(ls -d "$REPO"/nights/"$ARG"* 2>/dev/null | grep -v '\.md$' | sort | tail -1 | xargs -I{} basename {})"; fi
[ -z "$RUN" ] && { echo "no run found for $ARG"; exit 1; }
echo "run: $RUN"
BRANCH="$(cat "$REPO/nights/$RUN/branch.txt")"; WT="$(cat "$REPO/nights/$RUN/worktree.txt")"
num="$(gh pr list --repo abaooba/speech-coach --head "$BRANCH" --json number --jq '.[0].number')"
[ -z "$num" ] && { echo "no open PR for $BRANCH"; exit 1; }
gh pr merge "$num" --repo abaooba/speech-coach --squash --delete-branch
git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true
git -C "$REPO" branch -D "$BRANCH" 2>/dev/null || true
git -C "$REPO" checkout -q main && git -C "$REPO" pull -q
echo "merged PR #$num and updated main"
