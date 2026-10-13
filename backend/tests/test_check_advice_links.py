"""scripts/check_advice_links.py, run offline: httpx.MockTransport stands in for every website.

The owner runs the script by hand because it makes real requests. Here its pieces answer to
fake servers, so no test opens a socket.
"""

import json
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from backend.advice import load_library
from scripts import check_advice_links as links

type Handler = Callable[[httpx.Request], httpx.Response]


def fake_web(handler: Handler, seen: list[str] | None = None) -> httpx.MockTransport:
    """A transport that answers every request with `handler`, noting "METHOD url" in `seen`."""

    def answer(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(f"{request.method} {request.url}")
        return handler(request)

    return httpx.MockTransport(answer)


def library_entry(entry_id: str, url: str) -> dict:
    """A library entry as library.json holds it, cut down to what the script reads."""
    return {"id": entry_id, "source": {"url": url}}


def write_library(folder: Path, entries: list[dict]) -> Path:
    """Save `entries` as a library.json in `folder` and return its path."""
    path = folder / "library.json"
    path.write_text(json.dumps(entries), encoding="utf-8")
    return path


def test_each_url_is_listed_once_with_every_entry_that_cites_it() -> None:
    entries = [
        library_entry("pace-001", "https://a.example/one"),
        library_entry("filler-004", "https://b.example/two"),
        library_entry("pace-002", "https://a.example/one"),
    ]

    assert links.entry_ids_by_url(entries) == {
        "https://a.example/one": ["pace-001", "pace-002"],
        "https://b.example/two": ["filler-004"],
    }


def test_a_link_that_answers_head_is_alive_and_nothing_else_is_sent() -> None:
    seen: list[str] = []
    with links.open_client(fake_web(lambda request: httpx.Response(200), seen)) as client:
        assert links.check_link(client, "https://a.example/one") is None

    assert seen == ["HEAD https://a.example/one"]


def test_a_head_refused_with_405_is_tried_again_with_get() -> None:
    def no_head(request: httpx.Request) -> httpx.Response:
        return httpx.Response(405 if request.method == "HEAD" else 200)

    seen: list[str] = []
    with links.open_client(fake_web(no_head, seen)) as client:
        assert links.check_link(client, "https://a.example/one") is None

    assert seen == ["HEAD https://a.example/one", "GET https://a.example/one"]


def test_a_get_after_a_405_can_still_find_the_link_dead() -> None:
    def gone(request: httpx.Request) -> httpx.Response:
        return httpx.Response(405 if request.method == "HEAD" else 404)

    with links.open_client(fake_web(gone)) as client:
        assert links.check_link(client, "https://a.example/one") == "HTTP 404"


@pytest.mark.parametrize(("final_status", "expected"), [(200, None), (404, "HTTP 404")])
def test_redirects_are_followed_to_the_page_they_end_on(
    final_status: int, expected: str | None
) -> None:
    def moved(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old":
            return httpx.Response(301, headers={"Location": "https://a.example/new"})
        return httpx.Response(final_status)

    seen: list[str] = []
    with links.open_client(fake_web(moved, seen)) as client:
        assert links.check_link(client, "https://a.example/old") == expected

    assert seen == ["HEAD https://a.example/old", "HEAD https://a.example/new"]


@pytest.mark.parametrize("status", [403, 404, 410, 500, 503])
def test_an_error_status_marks_the_link_dead(status: int) -> None:
    with links.open_client(fake_web(lambda request: httpx.Response(status))) as client:
        assert links.check_link(client, "https://a.example/one") == f"HTTP {status}"


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (httpx.ConnectTimeout("timed out"), "ConnectTimeout: timed out"),
        (httpx.ReadTimeout("timed out"), "ReadTimeout: timed out"),
        (httpx.ConnectError("name not known"), "ConnectError: name not known"),
    ],
)
def test_a_timeout_or_failed_connection_marks_the_link_dead(
    error: httpx.HTTPError, expected: str
) -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        raise error

    with links.open_client(fake_web(broken)) as client:
        assert links.check_link(client, "https://a.example/one") == expected


def test_a_dead_link_line_gives_the_reason_the_url_and_the_entries_that_cite_it() -> None:
    line = links.dead_link_line("https://a.example/one", "HTTP 404", ["pace-001", "pace-002"])

    assert line == "HTTP 404  https://a.example/one  (pace-001, pace-002)"


def test_main_prints_each_dead_link_once_with_its_entries_and_exits_1(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    library = write_library(
        tmp_path,
        [
            library_entry("pace-001", "https://alive.example/page"),
            library_entry("pace-002", "https://gone.example/page"),
            library_entry("restart-007", "https://gone.example/page"),
        ],
    )

    def gone_host(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404 if request.url.host == "gone.example" else 200)

    seen: list[str] = []
    exit_code = links.main([str(library)], transport=fake_web(gone_host, seen))
    output = capsys.readouterr().out

    assert exit_code == 1
    assert seen == ["HEAD https://alive.example/page", "HEAD https://gone.example/page"]
    assert "HTTP 404  https://gone.example/page  (pace-002, restart-007)" in output.splitlines()
    assert "alive.example" not in output
    assert "1 of 2 links look dead" in output


def test_main_exits_0_when_every_link_answers(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    library = write_library(
        tmp_path,
        [
            library_entry("pace-001", "https://a.example/one"),
            library_entry("pace-002", "https://b.example/two"),
        ],
    )

    exit_code = links.main([str(library)], transport=fake_web(lambda request: httpx.Response(200)))

    assert exit_code == 0
    assert "All 2 links answered" in capsys.readouterr().out


def test_by_default_main_checks_every_url_in_the_app_library_once(
    capsys: pytest.CaptureFixture[str],
) -> None:
    seen: list[str] = []

    exit_code = links.main([], transport=fake_web(lambda request: httpx.Response(200), seen))

    library_urls = {entry.source.url for entry in load_library()}
    assert exit_code == 0
    assert len(seen) == len(library_urls)
    assert f"All {len(library_urls)} links answered" in capsys.readouterr().out
