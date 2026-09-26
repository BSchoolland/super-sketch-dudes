from PIL import Image, ImageDraw
import random, math

PAPER = (247, 244, 235)
INK = (30, 30, 30)

def paper(w=768, h=768):
    return Image.new("RGB", (w, h), PAPER)

def wob(d, pts, width=5, color=INK, j=2.2, n=6):
    out = []
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i+1]
        for t in [k / n for k in range(n + 1)]:
            out.append((x0 + (x1-x0)*t + random.uniform(-j, j),
                        y0 + (y1-y0)*t + random.uniform(-j, j)))
    d.line(out, fill=color, width=width, joint="curve")

def circ(d, cx, cy, r, width=5, color=INK):
    pts = [(cx + r*math.cos(a*math.pi/12) + random.uniform(-2,2),
            cy + r*math.sin(a*math.pi/12) + random.uniform(-2,2)) for a in range(25)]
    d.line(pts, fill=color, width=width, joint="curve")

# ---------- 1. TRIPOD GRUB: 3 unequal legs, eye on a stalk, spiral tail, 5 dots ----------
random.seed(11)
img = paper(); d = ImageDraw.Draw(img)
circ(d, 380, 400, 120)                                     # blobby body
wob(d, [(300, 500), (270, 620)], 6)                        # leg 1 (long)
wob(d, [(380, 515), (395, 590)], 6)                        # leg 2 (short)
wob(d, [(455, 495), (520, 610), (490, 640)], 6)            # leg 3 (bent, footed)
wob(d, [(360, 285), (340, 200)], 5)                        # eye stalk
circ(d, 335, 175, 38)                                      # eye
d.ellipse([322, 162, 348, 188], fill=INK)                  # pupil
sp = []                                                     # spiral tail
for i in range(70):
    a = i * 0.32; r = 8 + i * 1.5
    sp.append((500 + r*math.cos(a) * 0.55, 350 + r*math.sin(a) * 0.55))
d.line(sp, fill=INK, width=4, joint="curve")
for i, x in enumerate(range(300, 401, 25)):                 # exactly 5 teal dots
    d.ellipse([x-9, 430+i%2*14, x+9, 448+i%2*14], fill=(40, 130, 130))
wob(d, [(300, 330), (350, 355), (300, 380)], 4, (170,60,60))  # little red chevron mouth
img.save("/tmp/fightsheet/in-grub.png")

# ---------- 2. KEYWIND: mismatched arms, square head, 3-stripe scarf, back key ----------
random.seed(23)
img = paper(); d = ImageDraw.Draw(img)
wob(d, [(310, 130), (470, 130), (470, 275), (310, 275), (310, 130)], 6)   # square head
d.ellipse([400, 180, 436, 216], fill=INK)                                # single off-centre eye
wob(d, [(340, 240), (365, 255), (340, 268)], 4)                          # tiny frown
wob(d, [(390, 275), (390, 450)], 6)                                      # torso
for i, y in enumerate((295, 315, 335)):                                  # exactly 3 scarf stripes
    wob(d, [(330, y), (455, y-6)], 7, (190, 100, 40))
wob(d, [(390, 320), (250, 380), (215, 500), (250, 540)], 5)              # long noodle arm
wob(d, [(390, 320), (455, 350)], 8)                                      # stub arm
circ(d, 468, 358, 16, 5)                                                  # stub hand
wob(d, [(390, 450), (345, 600)], 6); wob(d, [(345,600),(310,610)], 6)     # leg + foot
wob(d, [(390, 450), (440, 600)], 6); wob(d, [(440,600),(475,612)], 6)
circ(d, 300, 360, 34, 5, (60, 60, 140))                                   # wind-up key ring
wob(d, [(334, 360), (372, 360)], 6, (60, 60, 140))                        # key shaft
img.save("/tmp/fightsheet/in-keywind.png")

# ---------- 3. LAMPJACK: floating lamp, 2 unequal props, coiled cord, dangling hook ----------
random.seed(37)
img = paper(); d = ImageDraw.Draw(img)
wob(d, [(300, 330), (480, 330), (520, 440), (260, 440), (300, 330)], 6)  # lamp shade
wob(d, [(300, 330), (480, 330)], 6)
for x in (300, 350, 400, 450):                                            # 4 bulb teeth
    wob(d, [(x, 440), (x + 22, 468), (x + 44, 440)], 4, (200, 150, 40))
wob(d, [(390, 330), (390, 250)], 5)                                       # mast
wob(d, [(300, 250), (480, 250)], 5)                                       # prop bar
d.ellipse([272, 232, 330, 268], outline=INK, width=5)                     # big prop (left)
d.ellipse([468, 240, 500, 262], outline=INK, width=5)                     # small prop (right)
cord = []                                                                 # coiled cord
for i in range(120):
    t = i / 120
    cord.append((520 + 26*math.sin(i*0.55), 430 + t*210))
d.line(cord, fill=INK, width=4, joint="curve")
wob(d, [(520, 640), (556, 660), (534, 690), (504, 672)], 5)               # hook
d.ellipse([352, 372, 374, 394], fill=(170, 60, 60))                       # one red rivet
img.save("/tmp/fightsheet/in-lampjack.png")
print("ok")
