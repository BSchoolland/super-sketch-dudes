#!/usr/bin/env python3
"""Turn a generated 3x3 sheet into nine normalised cells.

Usage: normalize.py <sheet.png> <outdir> [--px 512 --feet 448 --height 360] [--prefix car-] [--names a,b,c,...]

`--prefix` names the cells <prefix><cell> (a second form's sheet into the same folder); `--names`
replaces the nine cell names outright (a transformation strip). The scale comes from the first
cell either way.

Each cell: paper keyed to alpha, the drawing scaled by ONE factor (chosen so the first (idle) cell's
content is `height` px tall) so all cells share a world scale, horizontally centred on its
alpha centroid, and rested with the bottom of its content on row `feet`. Writes
<outdir>/<cell>.png and <outdir>/cells.json with the content box of every cell in cell pixels
(the hitbox placer reads those).
"""
import json, sys, os
from PIL import Image, ImageFilter
import numpy as np

CELLS = ["idle", "walk", "jump", "atk-fwd", "atk-up", "atk-down", "hit", "launched", "block"]

def key_paper(im):
    """Paper -> transparent. Paper is near-white and low saturation; ink and marker stay."""
    a = np.asarray(im.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = (r + g + b) / 3
    sat = a.max(axis=2) - a.min(axis=2)
    # alpha ramps from paper (lum>=228, sat<18) to ink; keeps pencil greys and coloured marker
    alpha = np.clip((236 - lum) / 40, 0, 1)
    alpha = np.maximum(alpha, np.clip((sat - 14) / 30, 0, 1))
    out = np.dstack([np.clip(a, 0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    return Image.fromarray(out, "RGBA")

def content_box(im, thresh=40):
    al = np.asarray(im)[..., 3]
    ys, xs = np.where(al > thresh)
    if not len(xs): return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

def centroid_x(im, thresh=40):
    al = np.asarray(im)[..., 3].astype(np.float64)
    m = al > thresh
    w = al * m
    xs = np.arange(im.width)[None, :]
    return float((w * xs).sum() / max(1.0, w.sum()))

def main():
    args = sys.argv[1:]
    sheet, out = args[0], args[1]
    opts = {"px": 512, "feet": 448, "height": 300, "prefix": "", "names": ""}
    for i, a in enumerate(args):
        if a.startswith("--"): opts[a[2:]] = args[i + 1] if a in ("--prefix", "--names") else int(args[i + 1])
    px, feet, height = opts["px"], opts["feet"], opts["height"]
    names = opts["names"].split(",") if opts["names"] else [opts["prefix"] + c for c in CELLS]
    if len(names) != 9: sys.exit("--names needs nine names")
    os.makedirs(out, exist_ok=True)
    im = Image.open(sheet).convert("RGB")
    W, H = im.size
    cw, ch = W // 3, H // 3
    pad = int(cw * 0.03)  # skip the grid lines
    cells = {}
    for i, name in enumerate(names):
        r, c = divmod(i, 3)
        crop = im.crop((c * cw + pad, r * ch + pad, (c + 1) * cw - pad, (r + 1) * ch - pad))
        cells[name] = key_paper(crop)
    idle_box = content_box(cells[names[0]])
    if not idle_box: sys.exit("first cell is empty after keying")
    scale = height / (idle_box[3] - idle_box[1])
    meta = {"px": px, "feetPx": feet, "heightPx": height, "cells": {}}
    for name, cim in cells.items():
        box = content_box(cim)
        if not box: sys.exit(f"cell {name} is empty after keying")
        cx = centroid_x(cim)
        sw, sh = max(1, round(cim.width * scale)), max(1, round(cim.height * scale))
        scaled = cim.resize((sw, sh), Image.LANCZOS)
        bx0, by0, bx1, by1 = [v * scale for v in box]
        # place: centroid at px/2, content bottom on `feet`; clamp so nothing leaves the cell
        ox = px / 2 - cx * scale
        oy = feet - by1
        ox = min(max(ox, -bx0), px - bx1)
        oy = min(max(oy, -by0), px - by1)
        canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        canvas.alpha_composite(scaled, (int(round(ox)), int(round(oy))))
        canvas.save(os.path.join(out, f"{name}.png"))
        fb = content_box(canvas)
        meta["cells"][name] = {"box": fb}
    meta_path = os.path.join(out, "cells.json")
    if os.path.exists(meta_path):
        prev = json.load(open(meta_path))
        if (prev["px"], prev["feetPx"]) != (px, feet): sys.exit("cells.json in the out dir has a different px/feet")
        prev["cells"].update(meta["cells"]); meta = prev
    json.dump(meta, open(meta_path, "w"), indent=1)
    print(json.dumps({"scale": round(scale, 3), "idleBox": idle_box}))

if __name__ == "__main__":
    main()
