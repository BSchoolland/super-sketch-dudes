#!/usr/bin/env python3
"""Turn a generated 3x3 sheet into nine normalised cells.

Usage: normalize.py <sheet.png> <outdir> [--px 512 --feet 448 --height 360 --mirror 1] [--prefix car-] [--names a,b,c,...]

`--prefix` names the cells <prefix><cell> (a second form's sheet into the same folder, merged into
its cells.json); `--names` replaces the nine cell names outright (a transformation strip). The
scale comes from the first cell either way.

The sheet is cut by ink, not by a fixed grid (see cut_cells): a pose reaching across a grid line keeps
all of itself. Each cell: paper keyed to alpha, the drawing scaled by ONE factor (chosen so the first (idle) cell's
content is `height` px tall, or less if some cell wouldn't fit; cells.json heightPx is the idle
height actually used) so all cells share a world scale, horizontally centred on its alpha centroid, and rested with the bottom of its content on row `feet`. Writes
<outdir>/<cell>.png and <outdir>/cells.json with the content box of every cell in cell pixels
(the hitbox placer reads those). --mirror 1 flips every cell left-right first.
"""
import json, sys, os
from PIL import Image
import numpy as np
from scipy import ndimage

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

def grid_lines(thin, frac=0.3):
    """The sheet's drawn grid lines along one axis: runs of rows (or columns) where more than `frac`
    of the pixels are thin ink. Returns (first, last) index pairs."""
    hot = thin.sum(axis=1) > frac * thin.shape[1]
    lines, start = [], None
    for i, h in enumerate(np.append(hot, False)):
        if h and start is None: start = i
        if not h and start is not None: lines.append((start, i - 1)); start = None
    return lines

def cuts(lines, size):
    """The two interior cell boundaries: the drawn line nearest each third, or the third itself where the
    sheet drew none. The image model draws them up to ~20px off the thirds."""
    out = []
    for third in (size / 3, 2 * size / 3):
        near = [(a + b) / 2 for a, b in lines if abs((a + b) / 2 - third) < size / 12]
        out.append(round(min(near, key=lambda c: abs(c - third))) if near else round(third))
    return out

def strip_grid(al, thresh=40):
    """Hard ink mask with the grid removed. Grid pixels are thin (gone under a 5x5 opening; a grid line
    is ~3px with its antialiasing, the thinnest stroke the image model draws is ~6px): drop thin
    pixels on a detected grid line, blobs lying on the lines (where two cross they are thick), then any
    thin blob spanning a quarter of a cell (slanted leftovers). Returns (mask, row cuts, column cuts)."""
    mask = al > thresh
    thin = mask & ~ndimage.binary_opening(mask, structure=np.ones((5, 5)))
    rows, cols = grid_lines(thin), grid_lines(thin.T)
    band = np.zeros_like(mask)
    for a, b in rows: band[max(0, a - 3):b + 4, :] = True
    for a, b in cols: band[:, max(0, a - 3):b + 4] = True
    mask &= ~(thin & band)
    labels, n = ndimage.label(mask)
    span = 0.25 * min(mask.shape) / 3
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        blob = labels[sl] == i
        if band[sl][blob].mean() > 0.9: mask[sl][blob] = False; continue
        ys, xs = sl
        if ys.stop - ys.start < span and xs.stop - xs.start < span: continue
        if ndimage.binary_erosion(blob, structure=np.ones((5, 5))).any(): continue
        mask[labels == i] = False
    drop_specks(mask)
    return mask, cuts(rows, mask.shape[0]), cuts(cols, mask.shape[1])

def drop_specks(mask, area=60, reach=15):
    """Blobs under `area` px more than `reach` px from any bigger blob are dust, not drawing: one speck
    above a head sets the idle box, and so the whole fighter's scale."""
    labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if not n: return
    sizes = np.bincount(labels.ravel())
    small = sizes < area
    small[0] = False
    dist = ndimage.distance_transform_edt(~(mask & ~small[labels]))
    for i in np.nonzero(small)[0]:
        if dist[labels == i].min() > reach: mask[labels == i] = False

def cut_cells(im, thresh=40):
    """The keyed sheet split into nine RGBA cells, by ink rather than by a fixed grid: every connected
    blob belongs to the cell holding most of it, so a limb reaching across a grid line stays with its
    body. A blob with a quarter of itself in a second cell is two poses touching: it is split at the
    grid line. Returns the cells in sheet order."""
    rgba = np.asarray(key_paper(im)).copy()
    mask, (r1, r2), (c1, c2) = strip_grid(rgba[..., 3], thresh)
    H, W = mask.shape
    cell_of = (np.digitize(np.arange(H), [r1, r2])[:, None] * 3 + np.digitize(np.arange(W), [c1, c2])[None, :])
    owner = np.full(mask.shape, -1)
    labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        blob = labels[sl] == i
        cs = cell_of[sl][blob]
        count = np.bincount(cs, minlength=9)
        home = int(count.argmax())
        rest = count.sum() - count[home]
        if rest >= 0.25 * count.sum() and rest >= 500:
            owner[sl][blob] = cs
        else:
            owner[sl][blob] = home
    # the soft antialiased edge (alpha under thresh) goes with the nearest hard ink within 3px
    dist, (iy, ix) = ndimage.distance_transform_edt(owner < 0, return_indices=True)
    near = owner[iy, ix]
    near[(dist > 3) | (rgba[..., 3] == 0)] = -1
    near[(rgba[..., 3] > thresh) & (owner < 0)] = -1  # stripped grid stays stripped
    cells = []
    for c in range(9):
        ys, xs = np.nonzero(near == c)
        if not len(xs): cells.append(None); continue
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        a = rgba[y0:y1, x0:x1].copy()
        a[..., 3] = np.where(near[y0:y1, x0:x1] == c, a[..., 3], 0)
        cells.append(Image.fromarray(a, "RGBA"))
    return cells

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
    opts = {"px": 512, "feet": 448, "height": 300, "mirror": 0, "prefix": "", "names": ""}
    for i, a in enumerate(args):
        if a.startswith("--"): opts[a[2:]] = args[i + 1] if a in ("--prefix", "--names") else int(args[i + 1])
    px, feet, height = opts["px"], opts["feet"], opts["height"]
    names = opts["names"].split(",") if opts["names"] else [opts["prefix"] + c for c in CELLS]
    if len(names) != 9: sys.exit("--names needs nine names")
    os.makedirs(out, exist_ok=True)
    cut = cut_cells(Image.open(sheet).convert("RGB"))
    cells = {}
    for name, cim in zip(names, cut):
        if cim is None: sys.exit(f"cell {name} is empty after keying")
        cells[name] = cim.transpose(Image.FLIP_LEFT_RIGHT) if opts["mirror"] else cim
    boxes = {name: content_box(cim) for name, cim in cells.items()}
    for name, box in boxes.items():
        if not box: sys.exit(f"cell {name} is empty after keying")
    idle_box = boxes[names[0]]
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
    meta_path = os.path.join(out, "cells.json")
    if os.path.exists(meta_path):
        prev = json.load(open(meta_path))
        if (prev["px"], prev["feetPx"]) != (px, feet): sys.exit("cells.json in the out dir has a different px/feet")
        prev["cells"].update(meta["cells"]); meta = prev
    json.dump(meta, open(meta_path, "w"), indent=1)
    print(json.dumps({"scale": round(scale, 3), "idleBox": idle_box}))

if __name__ == "__main__":
    main()
