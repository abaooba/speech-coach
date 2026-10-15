"""The repo carries an MIT license naming the author, and the README points to it."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_license_is_mit_and_names_the_author() -> None:
    text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert text.startswith("MIT License")
    assert "Copyright (c) 2026 Ares Cajas" in text
    assert "THE SOFTWARE IS PROVIDED \"AS IS\"" in text


def test_readme_has_a_license_section() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "## License" in readme
    assert "[MIT](LICENSE)" in readme
