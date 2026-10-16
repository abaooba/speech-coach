"""Every screenshot the README shows exists, is a PNG at phone width, and is small enough to
load on GitHub without a wait. The README says the history is seeded."""

import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
README = (ROOT / "README.md").read_text(encoding="utf-8")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 800_000
PHONE_WIDTH_AT_2X = 750


def referenced_images() -> list[Path]:
    return [ROOT / path for path in re.findall(r"!\[[^\]]*\]\((docs/screenshots/[^)]+)\)", README)]


def png_width(data: bytes) -> int:
    return struct.unpack(">I", data[16:20])[0]


def test_readme_references_the_five_screens_in_both_themes() -> None:
    names = sorted(path.name for path in referenced_images())
    assert names == sorted(
        f"{screen}-{theme}.png"
        for screen in ("onboarding", "practice", "results", "history", "progress")
        for theme in ("light", "dark")
    )


def test_every_referenced_screenshot_exists_as_a_small_phone_png() -> None:
    for path in referenced_images():
        assert path.is_file(), f"{path} is missing"
        data = path.read_bytes()
        assert data.startswith(PNG_MAGIC), f"{path} is not a PNG"
        assert len(data) <= MAX_BYTES, f"{path} is {len(data)} bytes"
        assert png_width(data) == PHONE_WIDTH_AT_2X, f"{path} is {png_width(data)} px wide"


def test_readme_says_the_history_is_seeded() -> None:
    start = README.index("## Screenshots")
    end = README.index("## How it works")
    assert "seeded" in README[start:end]
