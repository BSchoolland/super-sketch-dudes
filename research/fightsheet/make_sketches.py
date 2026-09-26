from PIL import Image, ImageDraw
import random, math

def paper(w=768, h=768):
    img = Image.new("RGB", (w, h), (247, 244, 235))
    return img

def wobble(d, pts, width=5, color=(30,30,30), jitter=2.5):
    out = []
    for (x, y) in pts:
        out.append((x + random.uniform(-jitter, jitter), y + random.uniform(-jitter, jitter)))
    d.line(out, fill=color, width=width, joint="curve")

random.seed(7)

# 1. A knight-ish stick guy with a big sword
img = paper(); d = ImageDraw.Draw(img)
d.ellipse([340, 150, 430, 245], outline=(30,30,30), width=6)          # head
wobble(d, [(385, 245), (385, 430)])                                   # spine
wobble(d, [(385, 300), (300, 370)])                                   # left arm
wobble(d, [(385, 300), (480, 250)])                                   # right arm
wobble(d, [(385, 430), (330, 570)])                                   # left leg
wobble(d, [(385, 430), (445, 570)])                                   # right leg
wobble(d, [(480, 250), (600, 90)], width=9, color=(40,40,40))         # sword blade
wobble(d, [(455, 225), (515, 285)], width=7)                          # crossguard
d.polygon([(340,150),(385,110),(430,150)], outline=(200,60,60), width=6)  # little crown
img.save("/tmp/fightsheet/in-knight.png")

# 2. A tank — the hard case, no limbs at all
img = paper(); d = ImageDraw.Draw(img)
wobble(d, [(180, 430), (600, 430), (620, 500), (160, 500), (180, 430)], width=6)   # hull
wobble(d, [(260, 430), (520, 430), (540, 360), (290, 360), (260, 430)], width=6)   # turret
wobble(d, [(540, 385), (720, 385)], width=10)                                      # barrel
for cx in range(210, 600, 70):
    d.ellipse([cx-28, 472, cx+28, 528], outline=(30,30,30), width=5)               # wheels
d.text((300, 300), "", fill=(30,30,30))
wobble(d, [(330, 395), (400, 395)], width=4, color=(60,110,60))
img.save("/tmp/fightsheet/in-tank.png")
print("done")
