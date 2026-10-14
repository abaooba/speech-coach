#!/bin/bash
# PreToolUse hook: block edits to human-owned paths and to existing test files.
# Exit 2 = block the tool call and show the message to the agent.
# It sees only the file tools (Edit, Write, MultiEdit, NotebookEdit); night.sh fails a task whose
# commits change these paths any other way, such as a Bash edit or a git rm.
set -u
# Only enforce for the unattended night agent; interactive sessions are the human.
[ "${NIGHT_RUN:-}" = "1" ] || exit 0
input=$(cat)
path=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path") or d.get("tool_input",{}).get("notebook_path") or "")' 2>/dev/null)
[ -z "$path" ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# Lock files that existed when the task started, so the agent can keep editing its own new tests.
base="${NIGHT_BASE_SHA:-HEAD}"
case "$path" in
  /*) rel="${path#"$root"/}" ;;
  *)  rel="$path" ;;
esac
# frontend/DESIGN.md is the spec every screen is built from; frontend/pauses.js is human-owned (T08).
protected='^(docs/PLAN\.md|docs/challenge-notes\.md|CLAUDE\.md|tasks/queue\.json|\.env.*|automation/.*|\.claude/.*|docs/superpowers/.*|frontend/DESIGN\.md|frontend/pauses\.js)$'
if printf '%s' "$rel" | grep -Eq "$protected"; then
  echo "Blocked: $rel is human-owned. Do not edit it; note what you wanted in your report." >&2
  exit 2
fi
# Every existing file under either tests folder: test files, helpers such as fake-dom.js, fixtures.
if printf '%s' "$rel" | grep -Eq '^(backend|frontend)/tests/'; then
  if git -C "$root" cat-file -e "$base:$rel" 2>/dev/null; then
    echo "Blocked: $rel is an existing test file. Existing tests are read-only; add a new test file instead." >&2
    exit 2
  fi
fi
exit 0
