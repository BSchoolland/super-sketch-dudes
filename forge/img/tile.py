#!/usr/bin/env python3
"""The drawing itself as a sheet: nine copies of it on a 3x3 grid, for normalize.py to cut, when the image
model can't draw this character. The fighter's pose tracks do all the moving.

Usage: tile.py <drawing.png> <sheet.png>
"""
import sys
from PIL import Image
from normalize import key_paper, content_box

SIZE, MARGIN = 1024, 24

def main():
    drawing, out = sys.argv[1], sys.argv[2]
    im = Image.open(drawing).convert("RGB")
    box = content_box(key_paper(im))
    if not box: sys.exit("the drawing is empty after keying")
    ink = im.crop(box)
    cell = SIZE // 3
    scale = (cell - 2 * MARGIN) / max(ink.width, ink.height)
    ink = ink.resize((max(1, round(ink.width * scale)), max(1, round(ink.height * scale))), Image.LANCZOS)
    sheet = Image.new("RGB", (SIZE, SIZE), im.getpixel((0, 0)))
    for i in range(9):
        r, c = divmod(i, 3)
        sheet.paste(ink, (c * cell + (cell - ink.width) // 2, r * cell + (cell - ink.height) // 2))
    sheet.save(out)

if __name__ == "__main__":
    main()
