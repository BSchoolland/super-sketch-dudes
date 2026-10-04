import { inkLine, inkPath } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { account, isNew, seeNews, unseenReleases } from "../account";
import { refreshLibrary } from "../fighters";
import { myMaps, refreshMaps } from "../maps";
import { bg, card, hint, label, title, hover, clicked, goTo, type Screen, INK } from "./ui";
import { drawAvatar } from "./images";
import { MenuBrawl } from "./brawl";
import { drawNewSticker } from "./sticker";
import { UpdateCard } from "./updatecard";
import { MENU_CARD } from "../../../shared/stages/menu";

const MENU_Y = MENU_CARD.y0, MENU_STEP = MENU_CARD.step;

export type Mode = "battle" | "library" | "create" | "maps" | "settings" | "feedback";

const NOTE = { x: 36, y: 24, w: 290, h: 120 };
/** `sel` for the FEEDBACK note in the top left, above the menu. */
const FEEDBACK = -1;

function drawFeedbackNote(ctx: CanvasRenderingContext2D, sel: boolean): void {
  const { x, y, w, h } = NOTE;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-0.05);
  ctx.translate(-w / 2, -h / 2);
  inkPath(ctx, [[0, 0], [w, 0], [w, h - 22], [w - 22, h], [0, h]], true, 7);
  ctx.fillStyle = "#f6e27a";
  ctx.fill();
  ctx.lineWidth = sel ? 4.5 : 2.4; ctx.strokeStyle = INK; ctx.stroke();
  title(ctx, "FEEDBACK", w / 2, h / 2 + 16, 46, INK);
  ctx.restore();
}

export function drawLogo(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.save();
  ctx.translate(VIEW_W / 2, y);
  ctx.rotate(-0.04);
  title(ctx, "SUPER", 0, -78, 64, INK);
  title(ctx, "SKETCH DUDES", 0, 40, 150, INK);
  inkLine(ctx, -410, 70, 410, 59, INK, 5);
  inkLine(ctx, -375, 82, 365, 75, INK, 2);
  ctx.restore();
}

/** Who's signed in, top right: the Discord avatar in a circle and the name. */
export function drawPlayerBadge(ctx: CanvasRenderingContext2D): void {
  const p = account.player;
  if (!p) return;
  const r = 30, cx = VIEW_W - 40 - r, cy = 30 + r;
  drawAvatar(ctx, p, cx, cy, r);
  label(ctx, p.name, cx - r - 16, cy + 10, 30, INK, "right", 800);
}

export class TitleScreen implements Screen {
  t = 0;
  /** A menu row, or FEEDBACK. */
  sel = 0;
  /** MAPS is only offered to accounts that may make them. */
  get items(): { id: Mode; name: string; desc: string }[] {
    return [
      { id: "battle", name: "BATTLE", desc: "Fight the CPU, a friend here, or someone online" },
      { id: "create", name: "NEW CHARACTER", desc: "Draw a new character" },
      { id: "library", name: "CHARACTERS", desc: "Yours, and everyone else's to save" },
      ...(myMaps.canCreate ? [{ id: "maps" as const, name: "MAPS", desc: "Build a stage to fight on" }] : []),
      { id: "settings", name: "SETTINGS", desc: "Change settings" },
    ];
  }
  brawl: MenuBrawl | null = null;
  /** What's new since this player last played, over the menu until they close it. */
  private whatsNew: UpdateCard | null = unseenReleases.length ? new UpdateCard(unseenReleases.splice(0)) : null;
  constructor(private onPick: (m: Mode) => Screen) {}
  enter(): void {
    void refreshLibrary();
    void refreshMaps();
    this.brawl = new MenuBrawl();
  }
  private pick(mode: Mode): Screen {
    sfx.menuConfirm();
    if (mode === "library") seeNews("characters");
    return this.onPick(mode);
  }
  update(dt: number, m: MenuInput): Screen | null {
    if (this.whatsNew) {
      if (this.whatsNew.update(dt, m)) this.whatsNew = null;
      return null;
    }
    const n = this.items.length;
    if (m.up) { this.sel = this.sel === FEEDBACK ? n - 1 : this.sel === 0 ? FEEDBACK : this.sel - 1; sfx.menuMove(); }
    if (m.down) { this.sel = this.sel === FEEDBACK ? 0 : (this.sel + 1) % n; sfx.menuMove(); }
    if (m.confirm || m.start) return this.pick(this.sel === FEEDBACK ? "feedback" : this.items[this.sel].id);
    return null;
  }
  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    this.t += dt;
    bg(ctx, this.t);
    drawLogo(ctx, 170);
    const live = !this.whatsNew;
    const x = MENU_CARD.x, w = MENU_CARD.w, h = MENU_CARD.h;
    this.items.forEach((it, i) => {
      const y = MENU_Y + i * MENU_STEP;
      if (live && hover(x, y, w, h)) { this.sel = i; document.body.style.cursor = "pointer"; }
      if (live && clicked(x, y, w, h)) goTo(this.pick(it.id));
      card(ctx, x, y, w, h, "", i === this.sel);
      title(ctx, it.name, x + w / 2, y + 60, 42, INK);
      if (it.id === "library" && isNew("characters")) drawNewSticker(ctx, x + w - 20, y + 8);
    });
    // the brawl plays over the menu: fighters stand on the cards and the logo
    if (this.brawl) { this.brawl.update(dt); this.brawl.draw(ctx, dt); }
    if (live && hover(NOTE.x, NOTE.y, NOTE.w, NOTE.h)) { this.sel = FEEDBACK; document.body.style.cursor = "pointer"; }
    if (live && clicked(NOTE.x, NOTE.y, NOTE.w, NOTE.h)) goTo(this.pick("feedback"));
    drawFeedbackNote(ctx, this.sel === FEEDBACK);
    drawPlayerBadge(ctx);
    const desc = this.sel === FEEDBACK ? "Ideas, bugs, anything: Ben reads these" : this.items[this.sel].desc;
    label(ctx, desc, VIEW_W / 2, MENU_Y + this.items.length * MENU_STEP + 30, 26, INK, "center");
    hint(ctx, "click, or arrows + Enter · gamepad: stick + A");
    label(ctx, `build ${__BUILD__}`, VIEW_W - 20, VIEW_H - 16, 14, "rgba(41,39,34,0.5)", "right", 400);
    this.whatsNew?.draw(ctx, dt);
  }
}
