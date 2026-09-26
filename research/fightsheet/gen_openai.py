import base64, os, sys, pathlib
from openai import OpenAI

env = {}
for line in open(os.path.expanduser("~/Projects/evergreen/services/discord-bot/.env")):
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.strip().split("=", 1); env[k] = v.strip().strip('"').strip("'")
client = OpenAI(api_key=env["OPENAI_API_KEY"])

POSES = ["IDLE", "WALK", "JUMP", "ATTACK FORWARD", "ATTACK UP", "ATTACK DOWN", "HIT", "LAUNCHED", "BLOCK"]

PROMPT = """This image is a player's hand-drawn character for a 2D fighting game drawn in pencil on paper.

Redraw THIS EXACT CHARACTER as a 3x3 sprite sheet of 9 fighting-game poses, in reading order:
row 1: idle stance, walking, jumping
row 2: attacking forward (horizontal swing/shot), attacking upward, attacking downward
row 3: getting hit (recoiling), launched flying backwards, blocking/guarding

Hard rules:
- It must be recognisably the SAME character in every cell: same proportions, same parts, same colours, same line weight. Do not add or remove features. Do not restyle it.
- The character always faces to the RIGHT.
- Same size in every cell, centred in its cell, full body always fully inside its cell, and the character's feet/base at the SAME height in every cell.
- Exactly 3 columns by 3 rows, evenly spaced, thin light pencil grid lines separating the cells, nothing else.
- Draw NO ground line, NO floor, NO shadow, NO horizon and NO scenery of any kind. Only the character itself on blank paper.
- Same hand-drawn pencil-on-paper look as the input, same off-white paper background. No text, no labels, no numbers, no shading beyond the original.
- Poses must be clearly readable and strongly exaggerated so each one is obvious at a glance.
"""

EXTRA = ""

def gen(src, out, quality="high", model="gpt-image-2"):
    with open(src, "rb") as f:
        r = client.images.edit(model=model, image=f, prompt=PROMPT + EXTRA,
                               n=1, size="1024x1024", quality=quality)
    pathlib.Path(out).write_bytes(base64.b64decode(r.data[0].b64_json))
    print("wrote", out, r.usage if hasattr(r, "usage") else "")

if __name__ == "__main__":
    if len(sys.argv) > 4: EXTRA = "\n\nCOUNT CHECK — these are exact and must be identical in all 9 cells:\n" + sys.argv[4]
    gen(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "high", os.environ.get("IMG_MODEL","gpt-image-2"))
