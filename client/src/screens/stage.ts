import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { stageList } from "../../../shared/stages/index";
import { sfx } from "../audio/audio";
import { bg, card, hint, label, title, hover, clicked, arrows, button, backButton, goTo, type Screen, INK, settings, saveSettings } from "./ui";
import { drawStage } from "../render/stage";
import type { State } from "../../../shared/types";

/** `time` is in frames; 0 is no limit. */
export interface MatchSetup { stage: string; stocks: number; time: number }

export type PickerAction = "fight" | "back" | null;

/**
 * Stage, stocks and time before a match. Whoever owns it edits it (and it remembers their last
 * picks); a read-only picker shows someone else's choice as it changes, like an online guest's.
 */
export class StagePicker {
  private sel = 0;
  private stocks = settings.stocks;
  private minutes = settings.time;
  private row = 0; // 0 stage, 1 stocks, 2 time

  constructor(private readOnly: boolean, private onChange: (setup: MatchSetup) => void = () => {}) {}

  get setup(): MatchSetup {
    return { stage: stageList[this.sel].id, stocks: this.stocks, time: this.minutes * 60 * 60 };
  }

  /** Mirror a pick made elsewhere. */
  show(setup: MatchSetup): void {
    const i = stageList.findIndex((s) => s.id === setup.stage);
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
    if (row === 0) this.sel = (this.sel + d + stageList.length) % stageList.length;
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
    const w = 460, h = 300, gap = 40;
    const x0 = (VIEW_W - (stageList.length * w + (stageList.length - 1) * gap)) / 2;
    stageList.forEach((st, i) => {
      const x = x0 + i * (w + gap), y = 150;
      if (edit && hover(x, y, w, h)) { this.row = 0; document.body.style.cursor = "pointer"; }
      if (edit && clicked(x, y, w, h) && i !== this.sel) { this.sel = i; this.changed(); }
      card(ctx, x, y, w, h, INK, i === this.sel && (this.row === 0 || !edit), i === this.sel || edit ? 1 : 0.5);
      // thumbnail: the platforms drawn to scale
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x + 12, y + 12, w - 24, h - 70, 10); ctx.clip();
      ctx.fillStyle = "#f4efe4"; ctx.fillRect(x, y, w, h);
      const sc = (w - 60) / (st.camera.right - st.camera.left);
      ctx.translate(x + w / 2, y + h / 2 + 30);
      ctx.scale(sc, sc);
      const fake = { platOffsets: st.platforms.map(() => ({ dx: 0, dy: 0 })) } as unknown as State;
      drawStage(ctx, fake, st);
      ctx.restore();
      title(ctx, st.name, x + w / 2, y + h - 18, 30, INK);
    });
    const rowCard = (r: number, y: number, text: string, value: string) => {
      const sel = edit && this.row === r;
      if (edit && hover(VIEW_W / 2 - 300, y, 600, 80)) this.row = r;
      card(ctx, VIEW_W / 2 - 300, y, 600, 80, INK, sel);
      if (edit) { const d = arrows(ctx, VIEW_W / 2 + 190, y + 52, 70, 26); if (d) this.step(r, d); }
      label(ctx, text, VIEW_W / 2 - 270, y + 52, 30, INK, "left", 900);
      label(ctx, value, VIEW_W / 2 + 190, y + 52, 30, INK, "center", 900);
    };
    rowCard(1, 520, "STOCKS", `${this.stocks}`);
    rowCard(2, 620, "TIME", this.minutes ? `${this.minutes}:00` : "none");
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
