"""Did a usage or rate limit stop this night task? Exit 0 when the claude CLI says so, else 1.

  python3 automation/usage_limit.py OUT_JSON ERR_LOG

night.sh ends the run on a limit, so only the CLI's own words count: its stderr log, and the
error fields of its JSON result. Those are an HTTP 429 in `api_error_status`, and `result` and
`errors` when the run ended in error (`is_error`, or an "error_..." subtype). A run that ended
well carries the agent's final message in `result`, and a task about rate limiting may well
mention one there, so that message is never searched. Output that is not JSON at all is the
CLI's own message, so it is searched whole.
"""

import json
import re
import sys
from pathlib import Path

# How the CLI words a usage or rate limit that stopped a run.
LIMIT_WORDS = re.compile(r"usage limit|rate limit|hit your limit|out of extra usage", re.IGNORECASE)
# HTTP 429 Too Many Requests: the API turned the run away over a rate or usage limit.
TOO_MANY_REQUESTS = "429"
HIT = 0
NOT_HIT = 1


def read(path: str) -> str:
    """The file's text, or "" when there is none to read."""
    try:
        return Path(path).read_text(errors="replace")
    except OSError:
        return ""


def stopped_by_limit(output: str, error_log: str) -> bool:
    """Whether the CLI's stdout (`output`) or stderr (`error_log`) reports a limit."""
    if LIMIT_WORDS.search(error_log):
        return True
    try:
        result = json.loads(output)
    except ValueError:
        return bool(LIMIT_WORDS.search(output))
    if not isinstance(result, dict):
        return False
    if str(result.get("api_error_status")) == TOO_MANY_REQUESTS:
        return True
    subtype = str(result.get("subtype", ""))
    if result.get("is_error") is not True and not subtype.startswith("error"):
        return False
    errors = result.get("errors")
    texts = [result.get("result"), *(errors if isinstance(errors, list) else [errors])]
    return any(LIMIT_WORDS.search(str(text)) for text in texts if text)


def main(argv: list[str]) -> int:
    out_json, err_log = argv
    return HIT if stopped_by_limit(read(out_json), read(err_log)) else NOT_HIT


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
