from PIL import Image, ImageDraw, ImageFont
import os, math

W, H = 1280, 720
GROUND = 620
PAPER = (247, 244, 235)

def load(dirn):
    d = {}
    for f in sorted(os.listdir(dirn)):
        name = f.split("-", 1)[1].rsplit(".", 1)[0]
        im = Image.open(f"{dirn}/{f}").convert("RGBA")
        # knock the paper background out so sprites can overlap the shared paper
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if r > 225 and g > 220 and b > 205:
                    px[x, y] = (r, g, b, 0)
        d[name] = im
    return d

K = load("/tmp/fightsheet/cells-knight")
T = load("/tmp/fightsheet/cells-tank")

def bg():
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    for x in range(0, W, 40): d.line([(x,0),(x,H)], fill=(236,232,220))
    for y in range(0, H, 40): d.line([(0,y),(W,y)], fill=(236,232,220))
    pass
    return img

def paste(img, sprite, cx, feet, scale=1.0, flip=False, rot=0):
    s = sprite
    if rot: s = s.rotate(rot, expand=True, resample=Image.BICUBIC)
    if flip: s = s.transpose(Image.FLIP_LEFT_RIGHT)
    w = int(s.width * scale); h = int(s.height * scale)
    s = s.resize((w, h), Image.LANCZOS)
    img.paste(s, (int(cx - w/2), int(feet - h)), s)

# timeline: (frames, knight pose, knight x, tank pose, tank x, note)
def build():
    frames = []
    def add(kp, kx, tp, tx, ky=0, ty=0, krot=0, trot=0, label=""):
        img = bg()
        paste(img, T[tp], tx, GROUND + 40 - ty, 1.15, flip=True, rot=trot)
        paste(img, K[kp], kx, GROUND + 40 - ky, 1.0, rot=krot)
        d = ImageDraw.Draw(img)
        if label: d.text((30, 30), label, fill=(60,60,60))
        frames.append(img)

    # approach
    for i in range(30):
        add("walk" if i % 8 < 4 else "idle", 250 + i*7, "idle", 980, label="approach")
    x = 250 + 29*7
    # forward attack
    for i in range(10): add("atk-fwd", x, "idle", 980, label="attack forward")
    # tank hit + knockback
    for i in range(14):
        add("atk-fwd", x, "hit", 980 + i*9, label="hit")
    # tank launched
    tx = 980 + 13*9
    for i in range(18):
        add("idle", x, "launched", tx + i*14, ty=int(120*math.sin(math.pi*i/18)), trot=-i*2, label="launched")
    # tank recovers, fires back
    for i in range(12): add("block", x, "idle", 1150, label="tank recovers")
    for i in range(12): add("hit", x, "atk-fwd", 1150, label="tank fires")
    # knight attacks up, tank answers with barrel up
    for i in range(12): add("atk-up", x, "atk-up", 1150, label="attack up")
    for i in range(12): add("atk-down", x, "jump", 1150, ty=60, label="attack down / tank hops")
    for i in range(14): add("idle", x, "idle", 1150, label="idle")
    return frames

frames = build()
os.makedirs("/tmp/fightsheet/frames", exist_ok=True)
for i, f in enumerate(frames):
    f.save(f"/tmp/fightsheet/frames/{i:04d}.png")
print("frames", len(frames))
