import { inkLine, PENCIL } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { account } from "../account";
import { allChoices, choiceDef, myLibrary, refreshLibrary } from "../fighters";
import { bg, card, hint, label, title, hover, clicked, goTo, type Screen, INK } from "./ui";
import { drawFighterPortrait } from "./portrait";
import { image } from "./draw/images";

const MENU_Y = 430, MENU_STEP = 104;

export type Mode = "draw" | "create" | "library" | "battle" | "settings";

export function drawLogo(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.save();
  ctx.translate(VIEW_W / 2, y);
  ctx.rotate(-0.04);
  title(ctx, "SKETCH BATTLE", 0, 40, 150, INK);
  inkLine(ctx, -410, 70, 410, 59, INK, 5);
  inkLine(ctx, -375, 82, 365, 75, INK, 2);
  ctx.restore();
}

/** Who's signed in, top right: the Discord avatar in a circle and the name. */
export function drawPlayerBadge(ctx: CanvasRenderingContext2D): void {
  const p = account.player;
  if (!p) return;
  const r = 30, cx = VIEW_W - 40 - r, cy = 30 + r;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "rgba(119,114,103,0.15)";
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  const img = p.avatar ? image(p.avatar) : null;
  if (img?.ok) ctx.drawImage(img.img, cx - r, cy - r, r * 2, r * 2);
  else label(ctx, p.name.slice(0, 1).toUpperCase(), cx, cy + 12, 34, INK, "center", 900);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  label(ctx, p.name, cx - r - 16, cy + 10, 30, INK, "right", 800);
}

export class TitleScreen implements Screen {
  t = 0;
  sel = 0;
  items: { id: Mode; name: string; desc: string }[] = [
    { id: "draw", name: "DRAW BATTLE", desc: "Everyone draws, the forge brings it to life, then you fight. Friends only." },
    { id: "create", name: "NEW CHARACTER", desc: "Draw a fighter for your library." },
    { id: "library", name: "MY CHARACTERS", desc: "Everything you've drawn." },
    { id: "battle", name: "BATTLE", desc: "Fight with one of yours: the CPU, a friend here, or online." },
    { id: "settings", name: "SETTINGS", desc: "Sound, shake, controls, sign out." },
  ];
  constructor(private onPick: (m: Mode) => Screen) {}
  enter(): void {
    void refreshLibrary();
  }
  update(_dt: number, m: MenuInput): Screen | null {
    if (m.up) { this.sel = (this.sel + this.items.length - 1) % this.items.length; sfx.menuMove(); }
    if (m.down) { this.sel = (this.sel + 1) % this.items.length; sfx.menuMove(); }
    if (m.confirm || m.start) { sfx.menuConfirm(); return this.onPick(this.items[this.sel].id); }
    return null;
  }
  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    this.t += dt;
    bg(ctx, this.t);
    drawLogo(ctx, 210);
    drawPlayerBadge(ctx);
    const x = 180;
    this.items.forEach((it, i) => {
      const y = MENU_Y + i * MENU_STEP;
      const sel = i === this.sel;
      if (hover(x, y, 520, 88)) { this.sel = i; document.body.style.cursor = "pointer"; }
      if (clicked(x, y, 520, 88)) { sfx.menuConfirm(); goTo(this.onPick(it.id)); }
      card(ctx, x, y, 520, 88, "", sel);
      title(ctx, it.name, x + 260, y + 60, 42, INK);
    });
    label(ctx, this.items[this.sel].desc, x, MENU_Y + this.items.length * MENU_STEP + 30, 24, INK, "left");
    this.drawParade(ctx);
    hint(ctx, "click, or arrows + Enter · gamepad: stick + A");
    label(ctx, `build ${__BUILD__}`, VIEW_W - 20, VIEW_H - 16, 14, "rgba(41,39,34,0.5)", "right", 400);
  }

  /** Your own fighters idling on the right; the house roster until you've made some. */
  private drawParade(ctx: CanvasRenderingContext2D): void {
    if (!myLibrary.entries) return;
    const { mine, house } = allChoices();
    const parade = (mine.length ? mine : house).slice(0, 6);
    parade.forEach((choice, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const box = { x: 820 + col * 340, y: 400 + row * 300, w: 300, h: 270 };
      const { def, load } = choiceDef(choice);
      if (def) drawFighterPortrait(ctx, def, this.t + i * 0.37, false, box);
      else if (load.state === "failed") label(ctx, "didn't load", box.x + box.w / 2, box.y + box.h / 2, 22, PENCIL);
      label(ctx, choice.name, box.x + box.w / 2, box.y + box.h + 22, 24, PENCIL, "center", 800);
    });
  }
}
