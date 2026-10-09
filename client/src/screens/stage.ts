import { VIEW_H, VIEW_W } from "../render/camera";
import { hatch, inkLine, inkRect, PAPER, PENCIL } from "../render/paper";
import { platformMotion } from "../../../shared/physics";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { account } from "../account";
import { stageChoices, type StageChoice } from "../maps";
import type { MapDoc } from "../../../shared/maps";
import { bg, card, hint, label, title, hover, clicked, arrows, button, backButton, goTo, type Screen, INK, settings, saveSettings } from "./ui";
import { drawStageArtThumb, stageArt, stageArtThumb } from "../render/stageart";
import type { Stage } from "../../../shared/types";

/** `time` is in frames; 0 is no limit. `map` is the player-made map `stage` names, if it is one. */
export interface MatchSetup { stage: string; stocks: number; time: number; map: MapDoc | null }

export type PickerAction = "fight" | "back" | null;

const COLS = 4, GAP = 30, TOP = 150;
const CARD_W = (VIEW_W - 2 * 160 - (COLS - 1) * GAP) / COLS;

/**
 * A stage drawn small inside a card. An art stage is its art framed by its camera box; a pencil stage
 * is a diagram of its platforms framed by the platforms themselves, with each moving platform's path dashed.
 */
export function drawStageThumb(ctx: CanvasRenderingContext2D, stage: Stage, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.clip();
  const art = stageArtThumb(stage);
  if (art) {
    const sc = Math.min((w - 40) / (stage.camera.right - stage.camera.left), (h - 24) / (stage.camera.bottom - stage.camera.top));
    const cx = (stage.camera.left + stage.camera.right) / 2, cy = (stage.camera.top + stage.camera.bottom) / 2;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    drawStageArtThumb(ctx, art, stage, [cx - w / sc / 2, cy - h / sc / 2, cx + w / sc / 2, cy + h / sc / 2]);
  } else drawPlatformDiagram(ctx, stage, x, y, w, h);
  ctx.restore();
}

function drawPlatformDiagram(ctx: CanvasRenderingContext2D, stage: Stage, x: number, y: number, w: number, h: number): void {
  const shown = stage.platforms.filter((p) => !p.hidden);
  const paths = shown.map((p) => Array.from({ length: p.motion ? 25 : 1 }, (_, i) => platformMotion(p, p.motion ? (i * p.motion.period) / 24 : 0)));
  let x1 = Infinity, x2 = -Infinity, top = Infinity;
  shown.forEach((p, i) => {
    for (const o of paths[i]) { x1 = Math.min(x1, p.x1 + o.dx); x2 = Math.max(x2, p.x2 + o.dx); top = Math.min(top, p.y + o.dy); }
  });
  // headroom over the highest platform; the solid bodies run off the card's bottom edge
  top -= 120;
  const sc = Math.min((w - 36) / (x2 - x1), (h - 30) / (Math.max(0, ...shown.map((p) => p.y)) - top + 60));
  const sx = (wx: number) => x + w / 2 + (wx - (x1 + x2) / 2) * sc;
  const sy = (wy: number) => y + 15 + (wy - top) * sc;
  shown.forEach((p, i) => {
    const o = paths[i][0], px = sx(p.x1 + o.dx), py = sy(p.y + o.dy), pw = (p.x2 - p.x1) * sc;
    const ph = p.solid ? y + h - py + 10 : 7;
    if (paths[i].length > 1) {
      ctx.save();
      ctx.strokeStyle = PENCIL; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
      ctx.beginPath();
      paths[i].forEach((q, k) => ctx[k ? "lineTo" : "moveTo"](sx((p.x1 + p.x2) / 2 + q.dx), sy(p.y + q.dy) + 3));
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = PAPER; ctx.fillRect(px, py, pw, ph);
    hatch(ctx, px, py, pw, ph, PENCIL, 0.36);
    inkRect(ctx, px, py, pw, ph, PENCIL, 1.5);
    inkLine(ctx, px, py, px + pw, py, INK, 3, i);
  });
}

/**
 * Stage, stocks and time before a match. Whoever owns it edits it (and it remembers their last
 * picks); a read-only picker shows someone else's choice as it changes, like an online guest's.
 * The stages on offer are the shipped ones and the player's own maps; a guest also sees the map
 * the host is showing them.
 */
export class StagePicker {
  private sel = 0;
  private stocks = settings.stocks;
  private minutes = settings.time;
  private row = 0; // 0 stage, 1 stocks, 2 time
  private scroll = 0;
  /** The selection the scroll last followed: the arrows can scroll it out of view until it moves again. */
  private scrolledTo = -1;
  private artSel = -1;
  private artSince = 0;
  private foreign: MapDoc | null = null;

  constructor(private readOnly: boolean, private onChange: (setup: MatchSetup) => void = () => {}) {}

  private get choices(): StageChoice[] {
    return stageChoices(this.foreign, this.readOnly || settings.extraStages);
  }

  get setup(): MatchSetup {
    const choices = this.choices;
    const c = choices[Math.min(this.sel, choices.length - 1)];
    return { stage: c.stage.id, stocks: this.stocks, time: this.minutes * 60 * 60, map: c.map };
  }

  /** Mirror a pick made elsewhere. */
  show(setup: MatchSetup): void {
    if (setup.map) this.foreign = setup.map;
    const i = this.choices.findIndex((c) => c.stage.id === setup.stage);
    if (i < 0) throw new Error(`unknown stage ${setup.stage}`);
    this.sel = i;
    this.stocks = setup.stocks;
    this.minutes = Math.round(setup.time / 3600);
  }

  private changed(): void {
    settings.stocks = this.stocks;
    settings.time = this.minutes;
    saveSettings();
    sfx.menuMove();
    this.onChange(this.setup);
  }

  private step(row: number, d: number): void {
    const n = this.choices.length;
    if (row === 0) this.sel = (this.sel + d + n) % n;
    if (row === 1) this.stocks = Math.max(1, Math.min(10, this.stocks + d));
    if (row === 2) this.minutes = Math.max(0, Math.min(10, this.minutes + d));
    this.changed();
  }

  update(m: MenuInput): PickerAction {
    if (m.back) { sfx.menuBack(); return "back"; }
    if (this.readOnly) return null;
    if (m.up) { this.row = (this.row + 2) % 3; sfx.menuMove(); }
    if (m.down) { this.row = (this.row + 1) % 3; sfx.menuMove(); }
    if (m.left || m.right) this.step(this.row, m.right ? 1 : -1);
    if (m.confirm || m.start) { sfx.go(); return "fight"; }
    return null;
  }

  /** `note` replaces the FIGHT button on a read-only picker (who's choosing). */
  draw(ctx: CanvasRenderingContext2D, t: number, note = ""): PickerAction {
    bg(ctx, t);
    title(ctx, "STAGE", VIEW_W / 2, 90, 64);
    const edit = !this.readOnly;
    const choices = this.choices;
    if (this.sel >= choices.length) this.sel = 0;
    // the chosen stage's full art loads while they decide, so the match opens on it; not while they scroll past
    if (this.sel !== this.artSel) { this.artSel = this.sel; this.artSince = t; }
    if (t - this.artSince > 0.4) stageArt(choices[this.sel].stage);
    const rowsShown = choices.length > COLS ? 2 : 1;
    const h = rowsShown === 1 ? 300 : 230;
    const rows = Math.ceil(choices.length / COLS);
    const selRow = Math.floor(this.sel / COLS);
    if (this.sel !== this.scrolledTo) {
      this.scrolledTo = this.sel;
      if (selRow < this.scroll) this.scroll = selRow;
      if (selRow >= this.scroll + rowsShown) this.scroll = selRow - rowsShown + 1;
    }
    const shown = Math.min(choices.length, COLS);
    const x0 = (VIEW_W - (shown * CARD_W + (shown - 1) * GAP)) / 2;
    choices.forEach((c, i) => {
      const row = Math.floor(i / COLS) - this.scroll;
      if (row < 0 || row >= rowsShown) return;
      const x = x0 + (i % COLS) * (CARD_W + GAP), y = TOP + row * (h + GAP);
      if (edit && hover(x, y, CARD_W, h)) { this.row = 0; document.body.style.cursor = "pointer"; }
      if (edit && clicked(x, y, CARD_W, h) && i !== this.sel) { this.sel = i; this.artSel = i; this.artSince = -Infinity; this.changed(); }
      card(ctx, x, y, CARD_W, h, INK, i === this.sel && (this.row === 0 || !edit), i === this.sel || edit ? 1 : 0.5);
      drawStageThumb(ctx, c.stage, x + 12, y + 12, CARD_W - 24, h - 70);
      title(ctx, c.stage.name, x + CARD_W / 2, y + h - 18, 30, INK, "center", CARD_W - 30);
      if (c.map) label(ctx, c.map.owner === account.player?.id ? "your map" : `${c.map.ownerName}'s map`, x + CARD_W - 14, y + 30, 18, PENCIL, "right");
    });
    // more rows above or below: an arrow beside the top or bottom row
    if (this.scroll > 0 && scrollArrow(ctx, "▲", VIEW_W - 110, TOP + h / 2)) this.scroll--;
    if (this.scroll < rows - rowsShown && scrollArrow(ctx, "▼", VIEW_W - 110, TOP + (rowsShown - 1) * (h + GAP) + h / 2)) this.scroll++;
    const rowY = TOP + rowsShown * (h + GAP) + 20;
    const rowCard = (r: number, y: number, text: string, value: string) => {
      const sel = edit && this.row === r;
      if (edit && hover(VIEW_W / 2 - 300, y, 600, 80)) this.row = r;
      card(ctx, VIEW_W / 2 - 300, y, 600, 80, INK, sel);
      if (edit) { const d = arrows(ctx, VIEW_W / 2 + 190, y + 52, 70, 26); if (d) this.step(r, d); }
      label(ctx, text, VIEW_W / 2 - 270, y + 52, 30, INK, "left", 900);
      label(ctx, value, VIEW_W / 2 + 190, y + 52, 30, INK, "center", 900);
    };
    rowCard(1, rowY, "STOCKS", `${this.stocks}`);
    rowCard(2, rowY + 100, "TIME", this.minutes ? `${this.minutes}:00` : "none");
    let out: PickerAction = null;
    if (edit) { if (button(ctx, VIEW_W / 2 - 160, VIEW_H - 180, 320, 84, "FIGHT", { key: "Enter", size: 36 })) { sfx.go(); out = "fight"; } }
    else label(ctx, note, VIEW_W / 2, VIEW_H - 130, 32, PENCIL);
    if (backButton(ctx, edit ? "BACK" : "LEAVE")) { sfx.menuBack(); out = "back"; }
    hint(ctx, edit ? "click a stage, then FIGHT · keyboard: up/down, left/right, Enter · Esc: back" : "");
    return out;
  }
}

/** The stage pick as its own screen, for matches on this device. */
export class StageScreen implements Screen {
  t = 0;
  private picker = new StagePicker(false);

  constructor(private onStart: (setup: MatchSetup) => Screen, private onBack: () => Screen) {}

  private act(action: PickerAction): Screen | null {
    if (action === "fight") return this.onStart(this.picker.setup);
    if (action === "back") return this.onBack();
    return null;
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    return this.act(this.picker.update(m));
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const next = this.act(this.picker.draw(ctx, this.t));
    if (next) goTo(next);
  }
}

/** A ▲ or ▼ like `arrows`' glyphs: true on the frame it's clicked. */
function scrollArrow(ctx: CanvasRenderingContext2D, glyph: string, cx: number, cy: number, size = 40): boolean {
  const x = cx - size / 2, y = cy - size * 0.9, w = size, h = size * 1.2;
  const over = hover(x, y, w, h);
  label(ctx, glyph, cx, cy, size * (over ? 1.15 : 1), over ? "#c8402c" : INK);
  if (over) document.body.style.cursor = "pointer";
  return clicked(x, y, w, h);
}
