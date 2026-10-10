"""Static checks on the frontend shell: index.html structure, script order, token discipline.

Stdlib only: the HTML is read with html.parser, the CSS and JS with regular expressions,
and every script is syntax-checked with ``node --check`` when node is installed.
"""

import re
import shutil
import subprocess
from html.parser import HTMLParser
from itertools import pairwise
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
INDEX_HTML = FRONTEND_DIR / "index.html"
STYLES_CSS = FRONTEND_DIR / "styles.css"
HUMAN_OWNED_JS = FRONTEND_DIR / "pauses.js"

SCREEN_IDS = [
    "screen-onboarding",
    "screen-practice",
    "screen-results",
    "screen-history",
    "screen-progress",
]

# The fixed load order. index.html may include any subset, but never out of order.
SCRIPT_LOAD_ORDER = [
    "app.js",
    "ui.js",
    "store.js",
    "api.js",
    "passages.js",
    "tips.js",
    "pauses.js",
    "screens/practice.js",
    "screens/results.js",
    "screens/history.js",
    "screens/progress.js",
    "screens/onboarding.js",
]

END_OF_TOKENS_MARKER = "/* end tokens */"

# "#FFF", "#2457F5" or "#RRGGBBAA", but not id selectors such as "#screen-practice" or "#add".
HEX_COLOR_LITERAL = re.compile(r"#[0-9A-Fa-f]{3,8}(?![\w-])")

# "window.app = ..." but not "window.app.ui = ..." and not "window.x == y".
WINDOW_ASSIGNMENT = re.compile(r"\bwindow\.(\w+)\s*=(?!=)")


class ShellParser(HTMLParser):
    """Collects the <section> ids, their .screen__body counts and the <script src> values."""

    def __init__(self) -> None:
        super().__init__()
        self.open_sections: list[str] = []
        self.body_count_by_section: dict[str, int] = {}
        self.script_sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = (attributes.get("class") or "").split()
        if tag == "section":
            section_id = attributes.get("id") or ""
            self.open_sections.append(section_id)
            self.body_count_by_section.setdefault(section_id, 0)
        elif tag == "div" and "screen__body" in classes and self.open_sections:
            self.body_count_by_section[self.open_sections[-1]] += 1
        elif tag == "script" and attributes.get("src"):
            self.script_sources.append(attributes["src"])

    def handle_endtag(self, tag: str) -> None:
        if tag == "section" and self.open_sections:
            self.open_sections.pop()


def parse_index() -> ShellParser:
    parser = ShellParser()
    parser.feed(INDEX_HTML.read_text(encoding="utf-8"))
    parser.close()
    return parser


def agent_owned_scripts() -> list[Path]:
    """Every frontend/**/*.js except the human-owned pauses.js."""
    return sorted(path for path in FRONTEND_DIR.rglob("*.js") if path != HUMAN_OWNED_JS)


def node_binary() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    homebrew_node = Path("/opt/homebrew/bin/node")
    return str(homebrew_node) if homebrew_node.exists() else None


def test_five_screens_each_with_one_body() -> None:
    parser = parse_index()
    for screen_id in SCREEN_IDS:
        assert screen_id in parser.body_count_by_section, f"missing <section id={screen_id!r}>"
        count = parser.body_count_by_section[screen_id]
        assert count == 1, f"{screen_id} has {count} div.screen__body, expected exactly one"


def test_scripts_follow_the_fixed_load_order() -> None:
    sources = parse_index().script_sources
    assert sources, "index.html has no <script src> tags"
    unknown = [src for src in sources if src not in SCRIPT_LOAD_ORDER]
    assert not unknown, f"scripts outside the fixed list: {unknown}"
    positions = [SCRIPT_LOAD_ORDER.index(src) for src in sources]
    in_order = all(earlier < later for earlier, later in pairwise(positions))
    assert in_order, f"scripts out of order: {sources}"


def test_no_innerhtml_or_outerhtml_in_agent_scripts() -> None:
    offenders = [
        path.relative_to(REPO_ROOT)
        for path in agent_owned_scripts()
        for needle in ("innerHTML", "outerHTML")
        if needle in path.read_text(encoding="utf-8")
    ]
    assert offenders == [], f"files using innerHTML/outerHTML: {offenders}"


def test_hex_colors_only_in_the_token_block() -> None:
    css = STYLES_CSS.read_text(encoding="utf-8")
    assert css.count(END_OF_TOKENS_MARKER) == 1, f"expected one {END_OF_TOKENS_MARKER!r} line"
    marker_at = css.index(END_OF_TOKENS_MARKER)
    literals = list(HEX_COLOR_LITERAL.finditer(css))
    assert literals, "no hex color literals found in the token block"
    stray = [match.group() for match in literals if match.start() > marker_at]
    assert stray == [], f"hex literals after the token block: {stray}"


def test_window_app_is_the_only_global() -> None:
    assigned: set[str] = set()
    for path in agent_owned_scripts():
        assigned.update(WINDOW_ASSIGNMENT.findall(path.read_text(encoding="utf-8")))
    assert assigned == {"app"}, f"window.* assignments found: {sorted(assigned)}"


def test_every_agent_script_passes_node_check() -> None:
    node = node_binary()
    if node is None:
        pytest.skip("node is not installed (not on PATH and not at /opt/homebrew/bin/node)")
    for path in agent_owned_scripts():
        result = subprocess.run(
            [node, "--check", str(path)], capture_output=True, text=True, check=False
        )
        assert result.returncode == 0, f"node --check failed for {path.name}:\n{result.stderr}"
