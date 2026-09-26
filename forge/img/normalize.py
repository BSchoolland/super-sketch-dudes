#!/usr/bin/env python3
"""Turn a generated 3x3 sheet into nine normalised cells.

Usage: normalize.py <sheet.png> <outdir> [--px 512 --feet 448 --height 360 --mirror 1]

Each cell: paper keyed to alpha, the drawing scaled by ONE factor (chosen so the idle cell's
content is `height` px tall, or less if some cell wouldn't fit; cells.json heightPx is the idle
height actually used) so all cells share a world scale, horizontally centred on its alpha centroid, and rested with the bottom of its content on row `feet`. Writes
<outdir>/<cell>.png and <outdir>/cells.json with the content box of every cell in cell pixels
(the hitbox placer reads those). --mirror 1 flips every cell left-right first.
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
    opts = {"px": 512, "feet": 448, "height": 300, "mirror": 0}
    for i, a in enumerate(args):
        if a.startswith("--"): opts[a[2:]] = int(args[i + 1])
    px, feet, height = opts["px"], opts["feet"], opts["height"]
    os.makedirs(out, exist_ok=True)
    im = Image.open(sheet).convert("RGB")
    W, H = im.size
    cw, ch = W // 3, H // 3
    pad = int(cw * 0.03)  # skip the grid lines
    cells = {}
    for i, name in enumerate(CELLS):
        r, c = divmod(i, 3)
        crop = im.crop((c * cw + pad, r * ch + pad, (c + 1) * cw - pad, (r + 1) * ch - pad))
        if opts["mirror"]: crop = crop.transpose(Image.FLIP_LEFT_RIGHT)
        cells[name] = key_paper(crop)
    boxes = {name: content_box(cim) for name, cim in cells.items()}
    for name, box in boxes.items():
        if not box: sys.exit(f"cell {name} is empty after keying")
    idle_box = boxes["idle"]
    # idle content `height` px tall, unless some cell would then not fit the canvas (wide or tall drawings)
    fit = min((px - 16) / max(b[2] - b[0], b[3] - b[1]) for b in boxes.values())
    scale = min(height / (idle_box[3] - idle_box[1]), fit)
    meta = {"px": px, "feetPx": feet, "heightPx": round((idle_box[3] - idle_box[1]) * scale), "cells": {}}
    for name, cim in cells.items():
        box = boxes[name]
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
    json.dump(meta, open(os.path.join(out, "cells.json"), "w"), indent=1)
    print(json.dumps({"scale": round(scale, 3), "idleBox": idle_box}))

if __name__ == "__main__":
    main()
