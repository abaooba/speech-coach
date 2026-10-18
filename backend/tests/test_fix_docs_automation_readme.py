"""The README's API and Stack sections say what the backend does.

They had fallen behind it: the Stack line called Deepgram the primary provider with AssemblyAI as
a fallback, and the API section gave /api/analyze one field and named no other route. Each check
here reads the fact from the code, so the README cannot drift from it again unnoticed.
"""

import re
from pathlib import Path

from backend import app as backend_app
from backend import providers

README = (Path(__file__).resolve().parents[2] / "README.md").read_text(encoding="utf-8")

PROVIDER_NAMES = {"assemblyai": "AssemblyAI", "deepgram": "Deepgram"}
# Path parameters are written {id} in the README, whatever the route names them.
PATH_PARAMETER = re.compile(r"\{[^}]+\}")


def section(heading: str) -> str:
    """The README text under `heading`, up to the next heading of any level."""
    start = README.index("\n" + heading + "\n")
    following = re.search(r"\n#{1,6} ", README[start + 1 :])
    return README[start : start + 1 + following.start()] if following else README[start:]


def flat(text: str) -> str:
    """`text` with its line breaks as spaces, so a phrase can wrap anywhere."""
    return " ".join(text.split())


def stack_item(topic: str) -> str:
    """The Stack list item that starts with `topic`, its wrapped lines joined."""
    item = re.search(re.escape(topic) + r".*(?:\n  .*)*", section("### Stack"))
    assert item, f"the Stack section has a {topic!r} item"
    return flat(item.group(0))


def test_the_stack_names_the_default_provider_and_the_switch() -> None:
    line = stack_item("- Speech-to-text:")
    default = PROVIDER_NAMES[providers.DEFAULT_PROVIDER]
    other = next(name for key, name in PROVIDER_NAMES.items() if key != providers.DEFAULT_PROVIDER)
    assert f"{default} by default" in line, line
    assert other in line, line
    assert "`STT_PROVIDER`" in line, line
    assert "no automatic fallback" in line, line
    assert "primary" not in line, line


def test_the_api_section_names_the_optional_script_field_and_its_400() -> None:
    api = flat(section("### API"))
    assert "an optional field `script`" in api
    too_long = f"a `script` over {backend_app.MAX_SCRIPT_CHARACTERS:,} characters"
    row = next(line for line in section("### API").splitlines() if line.startswith("| 400 |"))
    assert too_long in row, row


def test_the_api_section_lists_every_api_route() -> None:
    api = section("### API")
    # The OpenAPI schema lists every route, no route here
    # leaves the schema (include_in_schema).
    routes = [
        f"{method.upper()} {path}"
        for path, operations in backend_app.app.openapi()["paths"].items()
        for method in operations
    ]
    assert {"POST /api/analyze", "POST /api/advice", "GET /api/health"} <= set(routes)
    missing = [route for route in routes if f"`{PATH_PARAMETER.sub('{id}', route)}`" not in api]
    assert missing == [], f"README.md's API section does not list {missing}"


def test_the_api_section_lists_no_account_route_and_says_there_are_none() -> None:
    api = flat(section("### API"))
    assert "There are no accounts" in api
    assert "/api/auth" not in api and "/api/me" not in api and "DATABASE_URL" not in api
