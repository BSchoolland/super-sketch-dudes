from PIL import Image
import sys, os
src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
img = Image.open(src).convert("RGB")
W, H = img.size
cw, ch = W // 3, H // 3
names = ["idle","walk","jump","atk-fwd","atk-up","atk-down","hit","launched","block"]
pad = 14
for i, n in enumerate(names):
    r, c = divmod(i, 3)
    box = (c*cw+pad, r*ch+pad, (c+1)*cw-pad, (r+1)*ch-pad)
    img.crop(box).resize((512,512), Image.LANCZOS).save(f"{outdir}/{i}-{n}.png")
print("sliced", outdir)
