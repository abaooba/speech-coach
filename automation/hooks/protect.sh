#!/bin/bash
# PreToolUse hook: block edits to human-owned paths and to existing test files.
# Exit 2 = block the tool call and show the message to the agent.
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
protected='^(docs/PLAN\.md|docs/challenge-notes\.md|CLAUDE\.md|tasks/queue\.json|\.env.*|automation/.*|\.claude/.*|docs/superpowers/.*)$'
if printf '%s' "$rel" | grep -Eq "$protected"; then
  echo "Blocked: $rel is human-owned. Do not edit it; note what you wanted in your report." >&2
  exit 2
fi
if printf '%s' "$rel" | grep -Eq '^backend/tests/.*\.py$'; then
  if git -C "$root" cat-file -e "$base:$rel" 2>/dev/null; then
    echo "Blocked: $rel is an existing test file. Existing tests are read-only; add a new test file instead." >&2
    exit 2
  fi
fi
if printf '%s' "$rel" | grep -Eq '^backend/tests/fixtures/'; then
  if git -C "$root" cat-file -e "$base:$rel" 2>/dev/null; then
    echo "Blocked: $rel is an existing fixture and is read-only." >&2
    exit 2
  fi
fi
exit 0
