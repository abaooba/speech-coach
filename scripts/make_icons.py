"""Draw the Speech Coach app icon as icon.svg, icon-192.png and icon-512.png, stdlib only.

The icon is a short list of rounded rectangles in a 512-unit square: a blue tile, a white mic
capsule and a white stand (a stem on a base line). The same list is written out as SVG and
painted pixel by pixel into RGBA PNGs, so the three files always show the same picture.
There is no anti-aliasing, no randomness and no timestamp, so every run is byte-identical.

Usage: .venv/bin/python scripts/make_icons.py [output_dir]   (default: frontend/icons)
"""

import argparse
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "frontend" / "icons"

VIEWBOX_SIZE = 512
PNG_SIZES = (192, 512)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
BIT_DEPTH_8 = 8
COLOR_TYPE_RGBA = 6
COMPRESSION_DEFLATE = 0
FILTER_METHOD_STANDARD = 0
INTERLACE_NONE = 0
FILTER_TYPE_NONE = b"\x00"
ZLIB_LEVEL_SMALLEST = 9

type Rgba = tuple[int, int, int, int]

ACCENT_BLUE: Rgba = (0x24, 0x57, 0xF5, 0xFF)
WHITE: Rgba = (0xFF, 0xFF, 0xFF, 0xFF)
TRANSPARENT: Rgba = (0x00, 0x00, 0x00, 0x00)


@dataclass(frozen=True)
class RoundedRect:
    """An axis-aligned rectangle in viewBox units; a radius of 0 gives square corners."""

    x: int
    y: int
    width: int
    height: int
    radius: int
    color: Rgba

    def contains(self, u: float, v: float) -> bool:
        """True when the point (u, v) is inside the shape or on its edge.

        Shrinking the rectangle by the radius on every side leaves an inner rectangle; the
        shape is every point within one radius of it. Clamping (u, v) into the inner
        rectangle finds the nearest inner point, so one distance check covers sides and corners.
        """
        nearest_u = min(max(u, self.x + self.radius), self.x + self.width - self.radius)
        nearest_v = min(max(v, self.y + self.radius), self.y + self.height - self.radius)
        du = u - nearest_u
        dv = v - nearest_v
        return du * du + dv * dv <= self.radius * self.radius


TILE = RoundedRect(x=0, y=0, width=512, height=512, radius=112, color=ACCENT_BLUE)
MIC_CAPSULE = RoundedRect(x=192, y=104, width=128, height=208, radius=64, color=WHITE)
STAND_STEM = RoundedRect(x=240, y=312, width=32, height=64, radius=0, color=WHITE)
STAND_BASE = RoundedRect(x=160, y=376, width=192, height=32, radius=0, color=WHITE)

# Painted in this order, so a later shape covers an earlier one.
ICON_SHAPES = (TILE, MIC_CAPSULE, STAND_STEM, STAND_BASE)


def hex_color(color: Rgba) -> str:
    red, green, blue, _alpha = color
    return f"#{red:02X}{green:02X}{blue:02X}"


def icon_svg(shapes: tuple[RoundedRect, ...]) -> str:
    """The shapes as an SVG document, one <rect> each, in painting order."""
    rects = [
        f'  <rect x="{shape.x}" y="{shape.y}" width="{shape.width}" height="{shape.height}" '
        f'rx="{shape.radius}" fill="{hex_color(shape.color)}"/>'
        for shape in shapes
    ]
    opening_tag = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEWBOX_SIZE} {VIEWBOX_SIZE}" '
        f'width="{VIEWBOX_SIZE}" height="{VIEWBOX_SIZE}">'
    )
    return "\n".join([opening_tag, *rects, "</svg>", ""])


def color_at(shapes: tuple[RoundedRect, ...], u: float, v: float) -> Rgba:
    """The color of the topmost shape covering (u, v), or transparent when none does."""
    for shape in reversed(shapes):
        if shape.contains(u, v):
            return shape.color
    return TRANSPARENT


def rasterize(shapes: tuple[RoundedRect, ...], size: int) -> list[bytes]:
    """Paints the shapes onto a size x size canvas: one RGBA row of bytes per pixel row.

    Each pixel takes the color found at its center, scaled from pixels to viewBox units.
    """
    units_per_pixel = VIEWBOX_SIZE / size
    rows = []
    for row_index in range(size):
        v = (row_index + 0.5) * units_per_pixel
        row = bytearray()
        for column_index in range(size):
            u = (column_index + 0.5) * units_per_pixel
            row.extend(color_at(shapes, u, v))
        rows.append(bytes(row))
    return rows


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """One PNG chunk: data length, type, data, then the CRC32 of type and data."""
    crc = zlib.crc32(chunk_type + data)
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def encode_png(rows: list[bytes], width: int, height: int) -> bytes:
    """A complete 8-bit RGBA PNG: signature, IHDR, one IDAT and IEND.

    Every row gets filter type 0 (stored as is) before the whole image is deflated.
    """
    header = struct.pack(
        ">IIBBBBB",
        width,
        height,
        BIT_DEPTH_8,
        COLOR_TYPE_RGBA,
        COMPRESSION_DEFLATE,
        FILTER_METHOD_STANDARD,
        INTERLACE_NONE,
    )
    scanlines = b"".join(FILTER_TYPE_NONE + row for row in rows)
    return b"".join(
        [
            PNG_SIGNATURE,
            png_chunk(b"IHDR", header),
            png_chunk(b"IDAT", zlib.compress(scanlines, level=ZLIB_LEVEL_SMALLEST)),
            png_chunk(b"IEND", b""),
        ]
    )


def icon_files() -> dict[str, bytes]:
    """Every icon file name mapped to its exact contents."""
    files = {"icon.svg": icon_svg(ICON_SHAPES).encode("utf-8")}
    for size in PNG_SIZES:
        files[f"icon-{size}.png"] = encode_png(rasterize(ICON_SHAPES, size), size, size)
    return files


def write_icons(output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, contents in icon_files().items():
        path = output_dir / name
        path.write_bytes(contents)
        written.append(path)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Write icon.svg, icon-192.png and icon-512.png.")
    parser.add_argument(
        "output_dir",
        nargs="?",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="directory to write into (default: frontend/icons)",
    )
    arguments = parser.parse_args()
    for path in write_icons(arguments.output_dir):
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
