"""Checks on the app icons in frontend/icons and on scripts/make_icons.py, which draws them.

Each PNG is parsed by hand with struct and zlib: the signature, the IHDR fields, the CRC32 of
every chunk, the filter byte of every row and a few pixels. The script is then run into a
temporary directory and must reproduce the committed files byte for byte.
"""

import struct
import subprocess
import sys
import zlib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
ICONS_DIR = REPO_ROOT / "frontend" / "icons"
MAKE_ICONS_SCRIPT = REPO_ROOT / "scripts" / "make_icons.py"

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_SIZES = [192, 512]
ICON_FILE_NAMES = ["icon.svg", "icon-192.png", "icon-512.png"]

BIT_DEPTH_8 = 8
COLOR_TYPE_RGBA = 6
BYTES_PER_RGBA_PIXEL = 4
FILTER_TYPE_NONE = 0

ACCENT_BLUE = (0x24, 0x57, 0xF5, 0xFF)
WHITE = (0xFF, 0xFF, 0xFF, 0xFF)
TRANSPARENT = (0, 0, 0, 0)


def png_path(size: int) -> Path:
    return ICONS_DIR / f"icon-{size}.png"


def read_chunks(png: bytes) -> list[tuple[bytes, bytes, int]]:
    """Splits the bytes after the signature into (chunk type, chunk data, stored CRC32)."""
    chunks = []
    offset = len(PNG_SIGNATURE)
    while offset < len(png):
        (length,) = struct.unpack(">I", png[offset : offset + 4])
        chunk_type = png[offset + 4 : offset + 8]
        data = png[offset + 8 : offset + 8 + length]
        (stored_crc,) = struct.unpack(">I", png[offset + 8 + length : offset + 12 + length])
        chunks.append((chunk_type, data, stored_crc))
        offset += 12 + length
    return chunks


def decode_rows(png: bytes) -> list[bytes]:
    """Returns the scanlines of a non-interlaced RGBA PNG, each still led by its filter byte."""
    chunks = read_chunks(png)
    width, height = struct.unpack(">II", chunks[0][1][:8])
    idat = b"".join(data for chunk_type, data, _ in chunks if chunk_type == b"IDAT")
    raw = zlib.decompress(idat)
    row_length = 1 + width * BYTES_PER_RGBA_PIXEL
    assert len(raw) == height * row_length, "IDAT does not hold exactly height full rows"
    return [raw[start : start + row_length] for start in range(0, len(raw), row_length)]


def pixel(rows: list[bytes], x: int, y: int) -> tuple[int, ...]:
    start = 1 + x * BYTES_PER_RGBA_PIXEL
    return tuple(rows[y][start : start + BYTES_PER_RGBA_PIXEL])


@pytest.mark.parametrize("size", PNG_SIZES)
def test_png_begins_with_the_png_signature(size: int) -> None:
    assert png_path(size).read_bytes()[:8] == PNG_SIGNATURE


@pytest.mark.parametrize("size", PNG_SIZES)
def test_png_header_matches_the_size_in_the_file_name(size: int) -> None:
    chunk_type, data, _ = read_chunks(png_path(size).read_bytes())[0]
    assert chunk_type == b"IHDR", "IHDR must be the first chunk"
    width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", data
    )
    assert (width, height) == (size, size)
    assert bit_depth == BIT_DEPTH_8
    assert color_type == COLOR_TYPE_RGBA
    assert (compression, filtering, interlace) == (0, 0, 0)


@pytest.mark.parametrize("size", PNG_SIZES)
def test_png_chunks_are_ihdr_idat_iend_each_with_a_correct_crc(size: int) -> None:
    chunks = read_chunks(png_path(size).read_bytes())
    assert [chunk_type for chunk_type, _, _ in chunks] == [b"IHDR", b"IDAT", b"IEND"]
    for chunk_type, data, stored_crc in chunks:
        assert stored_crc == zlib.crc32(chunk_type + data), f"bad CRC32 on {chunk_type!r}"


@pytest.mark.parametrize("size", PNG_SIZES)
def test_every_png_row_uses_filter_type_none(size: int) -> None:
    rows = decode_rows(png_path(size).read_bytes())
    assert len(rows) == size
    assert {row[0] for row in rows} == {FILTER_TYPE_NONE}


@pytest.mark.parametrize("size", PNG_SIZES)
def test_png_shows_a_white_mic_on_a_blue_rounded_square(size: int) -> None:
    rows = decode_rows(png_path(size).read_bytes())
    assert pixel(rows, 0, 0) == TRANSPARENT, "the top-left corner should be cut by the rounding"
    assert pixel(rows, size - 1, size - 1) == TRANSPARENT, "the bottom-right corner too"
    assert pixel(rows, size // 2, size // 16) == ACCENT_BLUE, "above the mic is the blue tile"
    assert pixel(rows, size // 16, size // 2) == ACCENT_BLUE, "left of the mic is the blue tile"
    assert pixel(rows, size // 2, size * 7 // 20) == WHITE, "the mic capsule sits at the center"


def test_svg_uses_the_512_viewbox_and_the_accent_blue() -> None:
    svg = (ICONS_DIR / "icon.svg").read_text(encoding="utf-8")
    assert 'viewBox="0 0 512 512"' in svg
    assert "#2457F5" in svg


def test_make_icons_reproduces_the_committed_files_byte_for_byte(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(MAKE_ICONS_SCRIPT), str(tmp_path)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"make_icons.py failed:\n{result.stderr}"
    for name in ICON_FILE_NAMES:
        fresh = (tmp_path / name).read_bytes()
        committed = (ICONS_DIR / name).read_bytes()
        assert fresh == committed, f"{name} differs from a fresh run of make_icons.py"
