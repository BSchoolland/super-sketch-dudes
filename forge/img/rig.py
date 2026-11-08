#!/usr/bin/env python3
"""The drawing cut into parts and posed nine ways, as a sheet for normalize.py: the fallback when the image
model can't draw a character that still has limbs to move.

Usage: rig.py <drawing.png> <rig.json> <sheet.png> [<parts.png>]

rig.json, every coordinate in the drawing's own pixels:
  {
    "parts": {
      "armFront": { "poly": [[x, y], ...], "pivot": [x, y], "parent": "head?", "behind": false },
      ...
    },
    "poses": {
      "idle": { "armFront": 10, "body": { "rot": 0, "dx": 0, "dy": 0 } },
      "walk": { ... }, ... one per cell (idle walk jump atk-fwd atk-up atk-down hit launched block)
    }
  }
A part is the drawing inside its polygon; it turns about its pivot (the joint), carried along by its parent's
turn (default: the body). "body" is everything no part claims. In a pose a part's number is degrees, positive
counter-clockwise on screen; the body takes { rot, dx, dy } (turning about the middle of the drawing; dx, dy in
drawing pixels, +y down). A part a
pose leaves out stays as drawn. "behind": true draws it under the body (the far arm or leg).
<parts.png> shows the cut: each part tinted, its pivot ringed, so the outline can be checked before posing.
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
from normalize import key_paper, CELLS

SIZE = 1024

def affine(rot_deg, pivot, then=None):
    """Matrix (3x3) turning rot_deg counter-clockwise on screen about pivot, followed by `then`."""
    a = -math.radians(rot_deg)  # screen y is down: counter-clockwise on screen is a negative angle
    c, s = math.cos(a), math.sin(a)
    px, py = pivot
    m = np.array([[c, -s, px - c * px + s * py], [s, c, py - s * px - c * py], [0, 0, 1]])
    return m if then is None else then @ m

def place(img, m, size):
    """img transformed by m onto a transparent canvas of `size`."""
    inv = np.linalg.inv(m)
    return img.transform(size, Image.AFFINE, tuple(inv[:2].flatten()), resample=Image.BICUBIC)

def main():
    drawing, rig_path, out = sys.argv[1:4]
    parts_out = sys.argv[4] if len(sys.argv) > 4 else None
    rig = json.load(open(rig_path))
    parts, poses = rig.get("parts") or {}, rig.get("poses") or {}
    if not parts: sys.exit("rig.json has no parts: outline at least one limb")
    missing = [c for c in CELLS if c not in poses]
    if missing: sys.exit(f"rig.json poses is missing {', '.join(missing)}")
    for name, p in parts.items():
        if len(p.get("poly", [])) < 3: sys.exit(f"part {name}: poly needs at least three points")
        if len(p.get("pivot", [])) != 2: sys.exit(f"part {name}: pivot must be [x, y]")
        parent = p.get("parent", "body")
        if parent != "body" and parent not in parts: sys.exit(f"part {name}: parent {parent} is not a part")
    for cell, pose in poses.items():
        for k in pose:
            if k != "body" and k not in parts: sys.exit(f"poses.{cell}.{k} is not a part")

    keyed = key_paper(Image.open(drawing).convert("RGB"))
    # the paper's faint leftovers would turn with the body and show as a grey box
    k = np.asarray(keyed).copy()
    k[..., 3] = np.where(k[..., 3] < 40, 0, k[..., 3])
    keyed = Image.fromarray(k, "RGBA")
    W, H = keyed.size
    ink = keyed.getbbox()
    if not ink: sys.exit("the drawing is empty after keying")
    masks, claimed = {}, Image.new("L", keyed.size, 0)
    for name, p in parts.items():
        m = Image.new("L", keyed.size, 0)
        ImageDraw.Draw(m).polygon([tuple(v) for v in p["poly"]], fill=255)
        masks[name] = m
        claimed.paste(255, mask=m)
    def cut(mask):
        a = np.asarray(keyed).copy()
        a[..., 3] = (a[..., 3].astype(np.uint16) * np.asarray(mask) // 255).astype(np.uint8)
        return Image.fromarray(a, "RGBA")
    body = cut(Image.fromarray(255 - np.asarray(claimed)))
    pieces = {name: cut(m) for name, m in masks.items()}

    if parts_out:
        sheet = Image.new("RGBA", keyed.size, (255, 255, 255, 255))
        sheet.alpha_composite(body)
        tints = [(230, 60, 60), (60, 120, 230), (40, 170, 80), (200, 120, 20), (150, 60, 200), (20, 160, 170)]
        d = ImageDraw.Draw(sheet)
        for i, (name, piece) in enumerate(pieces.items()):
            t = Image.new("RGBA", keyed.size, tints[i % len(tints)] + (90,))
            t.putalpha(Image.fromarray((np.asarray(masks[name]) * 0.35).astype(np.uint8)))
            sheet.alpha_composite(piece); sheet.alpha_composite(t)
            px, py = parts[name]["pivot"]
            d.ellipse([px - 7, py - 7, px + 7, py + 7], outline=tints[i % len(tints)] + (255,), width=3)
            d.text((px + 9, py - 6), name, fill=(0, 0, 0, 255))
        sheet.convert("RGB").save(parts_out)

    # each pose drawn at the drawing's own size on a canvas with room to swing
    pad = max(W, H) // 2
    canvas = (W + 2 * pad, H + 2 * pad)
    shift = np.array([[1, 0, pad], [0, 1, pad], [0, 0, 1]], dtype=float)
    figures = []
    for cell in CELLS:
        pose = poses[cell]
        b = pose.get("body", {}) or {}
        cx, cy = (ink[0] + ink[2]) / 2, (ink[1] + ink[3]) / 2
        body_m = affine(b.get("rot", 0), (cx, cy), np.array([[1, 0, b.get("dx", 0)], [0, 1, b.get("dy", 0)], [0, 0, 1]]))
        mats = {"body": shift @ body_m}
        def matrix(name):
            if name in mats: return mats[name]
            p = parts[name]
            parent = matrix(p.get("parent", "body"))
            mats[name] = parent @ affine(pose.get(name, 0), p["pivot"])
            return mats[name]
        fig = Image.new("RGBA", canvas, (0, 0, 0, 0))
        order = [n for n in parts if parts[n].get("behind")] + ["body"] + [n for n in parts if not parts[n].get("behind")]
        for name in order:
            fig.alpha_composite(place(body if name == "body" else pieces[name], matrix(name), canvas))
        box = fig.getbbox()
        if not box: sys.exit(f"pose {cell} came out empty")
        figures.append(fig.crop(box))

    cell_px = SIZE // 3
    scale = (cell_px - 48) / max(max(f.width, f.height) for f in figures)
    sheet = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
    for i, f in enumerate(figures):
        f = f.resize((max(1, round(f.width * scale)), max(1, round(f.height * scale))), Image.LANCZOS)
        r, c = divmod(i, 3)
        sheet.paste(f, (c * cell_px + (cell_px - f.width) // 2, r * cell_px + (cell_px - f.height) // 2), f)
    sheet.save(out)

if __name__ == "__main__":
    main()
