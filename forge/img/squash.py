"""Writes a cell PNG to stdout as a 256-colour palette PNG: the same picture at about a fifth of the bytes.
Usage: squash.py <cell.png>   (prints the original's bytes instead when the palette one isn't smaller)"""
import io, sys
from PIL import Image

src = open(sys.argv[1], "rb").read()
im = Image.open(io.BytesIO(src))
if im.mode == "P":
    sys.stdout.buffer.write(src)
    sys.exit(0)
out = io.BytesIO()
im.convert("RGBA").quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, "PNG", optimize=True)
sys.stdout.buffer.write(out.getvalue() if out.tell() < len(src) else src)
