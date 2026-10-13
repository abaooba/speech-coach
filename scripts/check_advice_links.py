"""Check every source link in the advice library and print the ones that look dead.

Manual and online: the owner runs it by hand, and pytest never does (the tests run its pieces
against fake servers). Each unique URL gets one HEAD request, or a GET when the server answers
HEAD with 405 Method Not Allowed, with redirects followed and a short timeout. A link looks dead
when the request fails or times out, or when the page it ends on answers with an error status
(400 or above). Each dead link is printed with the ids of the entries that cite it, and the exit
code is 1 when there is at least one.

A 401, 403 or 429 can mean the site turned away a script rather than that the page is gone, so
open each dead link in a browser before fixing its entries in library.json by hand.

Usage: .venv/bin/python scripts/check_advice_links.py [library.json]
(default: backend/advice/library.json)
"""

import argparse
import json
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]
# The file backend/advice/__init__.py loads. Read as plain JSON, so the script runs on its own.
DEFAULT_LIBRARY = REPO_ROOT / "backend" / "advice" / "library.json"
# Long enough for a slow university server, short enough that a few hundred links finish in
# minutes even when some never answer.
TIMEOUT_SECONDS = 10.0
# Says what is asking; some sites turn away requests that carry only a library's default agent.
USER_AGENT = "speech-coach-link-check/1.0"


def entry_ids_by_url(entries: Iterable[Mapping[str, Any]]) -> dict[str, list[str]]:
    """Each unique source URL, in the order first cited, with the ids of the entries citing it."""
    ids_by_url: dict[str, list[str]] = {}
    for entry in entries:
        ids_by_url.setdefault(entry["source"]["url"], []).append(entry["id"])
    return ids_by_url


def open_client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    """The client every check uses: a short timeout, redirects followed, this tool's agent.

    `transport` stands in for the network, so tests can answer with fake servers.
    """
    return httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
        transport=transport,
    )


def check_link(client: httpx.Client, url: str) -> str | None:
    """Why `url` looks dead ("HTTP 404", "ConnectTimeout: timed out"), or None if it answers."""
    try:
        status = _final_status(client, url)
    except (httpx.HTTPError, httpx.InvalidURL) as error:
        detail = str(error)
        return f"{type(error).__name__}: {detail}" if detail else type(error).__name__
    return f"HTTP {status}" if httpx.codes.is_error(status) else None


def _final_status(client: httpx.Client, url: str) -> int:
    """The status of the page `url` ends on: HEAD, or GET when HEAD is not allowed."""
    status = client.head(url).status_code
    if status != httpx.codes.METHOD_NOT_ALLOWED:
        return status
    # Only the status is needed, so the GET is streamed and closed without reading the page.
    with client.stream("GET", url) as response:
        return response.status_code


def dead_link_line(url: str, reason: str, entry_ids: Sequence[str]) -> str:
    """One line of the report: why the link looks dead, the link, and the entries citing it."""
    return f"{reason}  {url}  ({', '.join(entry_ids)})"


def main(argv: Sequence[str] | None = None, transport: httpx.BaseTransport | None = None) -> int:
    """Check every link the library cites and print the dead ones; 1 when any is dead, else 0."""
    parser = argparse.ArgumentParser(description="Print the advice library's dead source links.")
    parser.add_argument(
        "library",
        nargs="?",
        type=Path,
        default=DEFAULT_LIBRARY,
        help="the library JSON to check (default: backend/advice/library.json)",
    )
    library: Path = parser.parse_args(argv).library
    ids_by_url = entry_ids_by_url(json.loads(library.read_text(encoding="utf-8")))
    print(f"Checking {len(ids_by_url)} links cited in {library}")

    dead_count = 0
    with open_client(transport) as client:
        for url, entry_ids in ids_by_url.items():
            reason = check_link(client, url)
            if reason is not None:
                dead_count += 1
                print(dead_link_line(url, reason, entry_ids))

    if dead_count == 0:
        print(f"All {len(ids_by_url)} links answered.")
        return 0
    print(
        f"{dead_count} of {len(ids_by_url)} links look dead. Open each in a browser before"
        " editing library.json: a 401, 403 or 429 may only mean the site turned away a script."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
