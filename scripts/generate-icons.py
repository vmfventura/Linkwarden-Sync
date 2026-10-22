"""Generate the project's original arrow icons without external graphics or fonts."""
from pathlib import Path
import struct
import zlib

DESTINATION = Path(__file__).resolve().parents[1] / 'public' / 'icon'
DESTINATION.mkdir(parents=True, exist_ok=True)


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


for size in (16, 32, 48, 96, 128):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            u, v = (x + .5) / size, (y + .5) / size
            # An upward arrow on a dark tile, with generous padding at small sizes.
            shaft = .25 < u < .72 and abs(v - (1 - u)) < .085
            head = (.59 < u < .78 and .22 < v < .58) or (.42 < u < .78 and .22 < v < .41)
            rows.extend((91, 219, 192, 255) if shaft or head else (21, 35, 54, 255))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')
    (DESTINATION / f'{size}.png').write_bytes(png)
