#!/bin/bash
# Merge tonight's PR (squash), delete the branch, remove the worktree, update main.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"; DATE="${1:-$(date +%Y-%m-%d)}"
BRANCH="$(cat "$REPO/nights/$DATE/branch.txt")"; WT="$(cat "$REPO/nights/$DATE/worktree.txt")"
num="$(gh pr list --repo abaooba/speech-coach --head "$BRANCH" --json number --jq '.[0].number')"
[ -z "$num" ] && { echo "no open PR for $BRANCH"; exit 1; }
gh pr merge "$num" --repo abaooba/speech-coach --squash --delete-branch
git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true
git -C "$REPO" branch -D "$BRANCH" 2>/dev/null || true
git -C "$REPO" checkout -q main && git -C "$REPO" pull -q
echo "merged PR #$num and updated main"
