#!/usr/bin/env python3
"""Draw simple high-contrast HammondCare icons. No third-party packages."""

import pathlib
import struct
import zlib


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png(size: int) -> bytes:
    def pixel(x: int, y: int) -> bytes:
        center = size / 2
        arm = size * 0.09
        span = size * 0.26
        if (abs(x - center) <= span and abs(y - center) <= arm) or (
            abs(y - center) <= span and abs(x - center) <= arm
        ):
            return bytes((255, 255, 255, 255))
        return bytes((122, 41, 72, 255))

    raw = b"".join(b"\x00" + b"".join(pixel(x, y) for x in range(size)) for y in range(size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main() -> None:
    root = pathlib.Path("public/icons")
    root.mkdir(parents=True, exist_ok=True)
    (root / "icon-192.png").write_bytes(png(192))
    (root / "icon-512.png").write_bytes(png(512))
    (root / "apple-touch-icon.png").write_bytes(png(180))


if __name__ == "__main__":
    main()
