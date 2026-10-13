"""Static checks on the PWA files: frontend/manifest.json, frontend/sw.js and the index.html head.

The service worker's SHELL array is read out of sw.js and checked against the files on disk and
the <script src> tags in index.html, so the precache list cannot drift from the page. How sw.js
behaves at run time is covered by frontend/tests/pwa.test.js.
"""

import json
import re
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
MANIFEST_JSON = FRONTEND_DIR / "manifest.json"
SERVICE_WORKER_JS = FRONTEND_DIR / "sw.js"
INDEX_HTML = FRONTEND_DIR / "index.html"

APP_NAME = "Speech Coach"
CACHE_NAME = "speech-coach-shell-v3"
HUMAN_OWNED_SCRIPT = "pauses.js"
PNG_ICON_SIZES = {"icons/icon-192.png": "192x192", "icons/icon-512.png": "512x512"}
SVG_ICON = "icons/icon.svg"
ICON_PATHS = [*PNG_ICON_SIZES, SVG_ICON]
API_PATH_PREFIX = "/api/"

# `const SHELL = [ ... ];` in sw.js, and each quoted entry inside it.
SHELL_ARRAY = re.compile(r"\bconst SHELL = \[(.*?)\];", re.DOTALL)
QUOTED_STRING = re.compile(r"""["']([^"']+)["']""")

# Every call that writes to a cache: cache.put(...), caches.put(...) or cache.addAll(...).
CACHE_WRITE_CALL = re.compile(r"\b(?:put|addAll)\(")


class HeadParser(HTMLParser):
    """Collects every <link rel> to href, every <meta name> to content and the <script src>s."""

    def __init__(self) -> None:
        super().__init__()
        self.links: dict[str, str] = {}
        self.metas: dict[str, str] = {}
        self.script_sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "link" and attributes.get("rel"):
            self.links[attributes["rel"]] = attributes.get("href") or ""
        elif tag == "meta" and attributes.get("name"):
            self.metas[attributes["name"]] = attributes.get("content") or ""
        elif tag == "script" and attributes.get("src"):
            self.script_sources.append(attributes["src"])


def parse_index() -> HeadParser:
    parser = HeadParser()
    parser.feed(INDEX_HTML.read_text(encoding="utf-8"))
    parser.close()
    return parser


def load_manifest() -> dict[str, object]:
    return json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))


def service_worker_source() -> str:
    return SERVICE_WORKER_JS.read_text(encoding="utf-8")


def shell_paths() -> list[str]:
    match = SHELL_ARRAY.search(service_worker_source())
    assert match, "sw.js has no `const SHELL = [...];` array literal"
    return QUOTED_STRING.findall(match.group(1))


def cache_write_arguments(source: str) -> list[str]:
    """The text between the parentheses of every put( or addAll( call, nested ones included."""
    arguments = []
    for call in CACHE_WRITE_CALL.finditer(source):
        open_at = call.end() - 1
        depth = 0
        for index in range(open_at, len(source)):
            if source[index] == "(":
                depth += 1
            elif source[index] == ")":
                depth -= 1
                if depth == 0:
                    arguments.append(source[open_at + 1 : index])
                    break
    return arguments


def test_manifest_names_the_app_and_opens_standalone_at_the_root() -> None:
    manifest = load_manifest()
    assert manifest["name"] == APP_NAME
    assert manifest["short_name"] == APP_NAME
    assert manifest["start_url"] == "/"
    assert manifest["scope"] == "/"
    assert manifest["display"] == "standalone"
    assert manifest["background_color"] == "#FFFFFF"
    assert manifest["theme_color"] == "#2457F5"


def test_manifest_lists_two_png_icons_that_exist_on_disk() -> None:
    icons = load_manifest()["icons"]
    png_icons = [icon for icon in icons if icon["type"] == "image/png"]
    assert len(png_icons) == 2
    assert {icon["src"]: icon["sizes"] for icon in png_icons} == PNG_ICON_SIZES
    for icon in png_icons:
        assert icon["purpose"] == "any"
        assert (FRONTEND_DIR / icon["src"]).is_file(), f"{icon['src']} is not on disk"


def test_manifest_also_lists_the_svg_icon() -> None:
    svg_icons = [icon for icon in load_manifest()["icons"] if icon["type"] == "image/svg+xml"]
    assert [icon["src"] for icon in svg_icons] == [SVG_ICON]
    assert (FRONTEND_DIR / SVG_ICON).is_file()


def test_index_head_links_the_manifest_and_the_icons() -> None:
    parser = parse_index()
    assert parser.links.get("manifest") == "manifest.json"
    assert parser.links.get("icon") == SVG_ICON
    assert parser.links.get("apple-touch-icon") == "icons/icon-192.png"


def test_index_head_has_the_ios_home_screen_metas() -> None:
    metas = parse_index().metas
    assert metas.get("apple-mobile-web-app-capable") == "yes"
    assert metas.get("apple-mobile-web-app-title") == APP_NAME


def test_service_worker_takes_over_at_once() -> None:
    source = service_worker_source()
    assert "skipWaiting" in source
    assert "clients.claim" in source


def test_service_worker_names_its_cache() -> None:
    assert f'const CACHE_NAME = "{CACHE_NAME}";' in service_worker_source()


def test_no_api_path_is_ever_written_to_the_cache() -> None:
    arguments = cache_write_arguments(service_worker_source())
    assert len(arguments) >= 2, "expected at least one addAll( and one put( call in sw.js"
    offenders = [text for text in arguments if API_PATH_PREFIX in text]
    assert offenders == [], f"cache writes mentioning {API_PATH_PREFIX}: {offenders}"


def test_every_shell_path_exists_under_frontend() -> None:
    paths = shell_paths()
    assert paths, "SHELL is empty"
    missing = [path for path in paths if not (FRONTEND_DIR / path).is_file()]
    assert missing == [], f"SHELL lists files that are not on disk: {missing}"


def test_shell_has_no_duplicates() -> None:
    paths = shell_paths()
    assert len(paths) == len(set(paths)), f"SHELL repeats an entry: {paths}"


def test_every_script_in_index_html_is_in_the_shell() -> None:
    shell = set(shell_paths())
    scripts = [src for src in parse_index().script_sources if src != HUMAN_OWNED_SCRIPT]
    assert scripts, "index.html has no <script src> tags"
    missing = [src for src in scripts if src not in shell]
    assert missing == [], f"<script src> tags missing from SHELL: {missing}"


def test_shell_has_the_page_its_styles_manifest_and_icons() -> None:
    shell = set(shell_paths())
    for path in ["index.html", "styles.css", "manifest.json", *ICON_PATHS]:
        assert path in shell, f"{path} is missing from SHELL"
