"""docs/ARCHITECTURE.md names every module that exists and no module that does not, its diagram
is well-formed SVG, and the README links it."""

import re
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs" / "ARCHITECTURE.md"
SVG = ROOT / "docs" / "architecture.svg"
README = (ROOT / "README.md").read_text(encoding="utf-8")


def modules_section() -> str:
    text = DOC.read_text(encoding="utf-8")
    start = text.index("## Modules")
    end = text.index("## ", start + 3)
    return text[start:end]


def listed_paths() -> list[str]:
    return re.findall(r"^\| `([^`]+)` \|", modules_section(), re.MULTILINE)


def test_every_listed_module_exists() -> None:
    missing = [path for path in listed_paths() if not (ROOT / path).exists()]
    assert missing == [], missing


def test_every_backend_module_and_frontend_script_is_listed() -> None:
    listed = set(listed_paths())
    backend = {
        f"backend/{p.name}" for p in (ROOT / "backend").glob("*.py") if p.name != "__init__.py"
    }
    frontend = {f"frontend/{p.name}" for p in (ROOT / "frontend").glob("*.js") if p.name != "sw.js"}
    screens = {f"frontend/screens/{p.name}" for p in (ROOT / "frontend" / "screens").glob("*.js")}
    expected = (
        backend | frontend | screens | {"backend/providers/", "backend/advice/", "frontend/sw.js"}
    )
    assert expected <= listed, sorted(expected - listed)


def test_the_diagram_is_well_formed_svg_naming_the_four_parties() -> None:
    root = ElementTree.fromstring(SVG.read_bytes())
    assert root.tag.endswith("svg")
    text = " ".join(t.text or "" for t in root.iter() if t.text)
    for party in ("Phone", "FastAPI", "AssemblyAI", "Anthropic"):
        assert party in text, party
    assert "Neon" not in text
    assert "Postgres" not in text


def test_the_doc_embeds_the_diagram_and_the_readme_links_the_doc() -> None:
    assert "![Architecture](architecture.svg)" in DOC.read_text(encoding="utf-8")
    assert "[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)" in README
