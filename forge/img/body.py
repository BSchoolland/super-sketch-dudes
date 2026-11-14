#!/usr/bin/env python3
"""Draw the body line on the idle cell: body.py <idle.png> <out.png> <feetPx> <topPx>.

The band from `topPx` to `feetPx` is what `stats.height` measures; anything drawn above it is a prop.
"""
import sys
from PIL import Image, ImageDraw

src, out, feet, top = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
cell = Image.open(src).convert("RGBA")
im = Image.new("RGBA", cell.size, (244, 239, 228, 255))
d = ImageDraw.Draw(im)
d.rectangle([0, top, cell.width, feet], fill=(120, 200, 140, 70))
im.alpha_composite(cell)
d = ImageDraw.Draw(im)
for y, c in ((top, (220, 40, 30, 255)), (feet, (40, 40, 40, 255))):
    d.line([(0, y), (cell.width, y)], fill=c, width=2)
d.text((6, max(0, top - 14)), f"top of body, row {top}", fill=(220, 40, 30, 255))
d.text((6, min(cell.height - 14, feet + 4)), f"feet, row {feet}  (body {feet - top}px = stats.height)", fill=(40, 40, 40, 255))
im.convert("RGB").save(out)
