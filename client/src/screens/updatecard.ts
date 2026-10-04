import { VIEW_H, VIEW_W } from "../render/camera";
import { inkLine, inkPath, PAPER, PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { fighterLoad } from "../gen";
import { roster } from "../../../shared/fighters/index";
import { FEATURED, type FeaturedCharacter } from "../../../shared/account";
import type { Release } from "../../../shared/releases";
import { drawImageIn } from "./images";
import { drawFighterHop } from "./portrait";
import { wrapped } from "./text";
import { card, clicked, hover, label, title, INK } from "./ui";

const W = 1200, H = 880, X = (VIEW_W - W) / 2, Y = (VIEW_H - H) / 2;
/** Each fighter gets a SLOT of the line; its sprite cell is drawn ART big, overlapping its neighbours' empty margins. */
const SLOT = (W - 80) / FEATURED, ART = 210, FLOOR = Y + 340;
/** Seconds per jump, and how far behind its left neighbour each fighter jumps: the lineup jumps in a wave. */
const HOP_S = 1.4, WAVE_S = 0.11;
const GO = { w: 340, h: 96, x: VIEW_W / 2 - 170, y: Y + H - 130 };

/** What came out since a returning player last played: one card per release, oldest first, over the title screen. */
export class UpdateCard {
  private t = 0;
  private lineup: FeaturedCharacter[] = [];
  /** How many characters players have made, for a note's {made}; null until it's fetched. */
  private made: number | null = null;

  constructor(private releases: Release[]) {
    library.featured().then(
      ({ characters, made }) => { this.lineup = characters; this.made = made; for (const c of characters) fighterLoad(c.bundleUrl); },
      (error: unknown) => console.error("featured characters failed", error),
    );
  }

  /** True once the last card is closed. */
  update(dt: number, m: MenuInput): boolean {
    this.t += dt;
    if (!(m.confirm || m.start || m.back || clicked(GO.x, GO.y, GO.w, GO.h))) return false;
    sfx.menuConfirm();
    this.releases.shift();
    this.t = 0;
    return !this.releases.length;
  }

  draw(ctx: CanvasRenderingContext2D, _dt: number): void {
    const r = this.releases[0];
    if (!r) return;
    ctx.fillStyle = "rgba(41,39,34,0.45)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    inkPath(ctx, [[X, Y], [X + W, Y], [X + W, Y + H], [X, Y + H]], true, 31);
    ctx.fillStyle = PAPER; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();

    ctx.save();
    ctx.translate(VIEW_W / 2, Y + 110);
    ctx.rotate(-0.035);
    title(ctx, r.title, 0, 0, 70, INK, "center", W - 120);
    inkLine(ctx, -500, 22, 500, 12, INK, 5);
    ctx.restore();
    label(ctx, `v${r.version}`, X + W - 30, Y + 44, 24, PENCIL, "right", 700);

    const n = this.lineup.length;
    inkLine(ctx, X + 30, FLOOR, X + W - 30, FLOOR + 3, INK, 2.4);
    if (n) {
      const x0 = VIEW_W / 2 - (n * SLOT) / 2;
      this.lineup.forEach((c, i) => {
        const cx = x0 + (i + 0.5) * SLOT, box = { x: cx - ART / 2, y: FLOOR - ART, w: ART, h: ART };
        const def = fighterLoad(c.bundleUrl).state === "ready" ? roster[c.id] : null;
        if (def) drawFighterHop(ctx, def, box, (((this.t - i * WAVE_S) / HOP_S) % 1 + 1) % 1);
        else drawImageIn(ctx, c.drawingUrl, cx - SLOT / 2 + 10, FLOOR - SLOT + 10, SLOT - 20);
      });
    }

    let y = Y + 410;
    for (const p of r.note) y += wrapped(ctx, p.replace("{made}", this.made === null ? "…" : String(this.made)), VIEW_W / 2, y, W - 200, 28, INK, 4, "center", 600) + 12;

    const over = hover(GO.x, GO.y, GO.w, GO.h);
    if (over) document.body.style.cursor = "pointer";
    card(ctx, GO.x, GO.y, GO.w, GO.h, INK, true);
    title(ctx, "LET'S GO!", VIEW_W / 2, GO.y + GO.h / 2 + 16, 46, INK);
  }
}
