import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { bg, card, hint, label, title, type Screen, INK } from "./ui";
import { rosterList } from "../../../shared/fighters/index";
import { drawRig, poseAt, resolvePose } from "../render/rig";

export type Mode = "versus" | "online" | "training" | "settings";

export class TitleScreen implements Screen {
  t = 0;
  sel = 0;
  items: { id: Mode; name: string; desc: string }[] = [
    { id: "versus", name: "VERSUS", desc: "Local. 2 to 4 fighters, humans or CPUs." },
    { id: "online", name: "ONLINE", desc: "Quick match or a room code. Rollback netcode." },
    { id: "training", name: "TRAINING", desc: "Hitboxes, frame data, a dummy that does what you say." },
    { id: "settings", name: "SETTINGS", desc: "Sound, shake, controls." },
  ];
  constructor(private onPick: (m: Mode) => Screen) {}
  update(_dt: number, m: MenuInput): Screen | null {
    if (m.up) { this.sel = (this.sel + this.items.length - 1) % this.items.length; sfx.menuMove(); }
    if (m.down) { this.sel = (this.sel + 1) % this.items.length; sfx.menuMove(); }
    if (m.confirm || m.start) { sfx.menuConfirm(); return this.onPick(this.items[this.sel].id); }
    return null;
  }
  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    this.t += dt;
    bg(ctx, this.t);
    // logo
    ctx.save();
    ctx.translate(VIEW_W / 2, 250);
    ctx.rotate(-0.04);
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.roundRect(-470, -100, 940, 190, 30); ctx.fill();
    ctx.fillStyle = "#ff4d2e";
    ctx.beginPath(); ctx.roundRect(-458, -88, 916, 166, 22); ctx.fill();
    title(ctx, "RINGOUT", 0, 40, 150, "#fff1a8");
    ctx.restore();
    label(ctx, "you don't win by emptying a bar. you win by throwing them out.", VIEW_W / 2, 400, 26, "rgba(255,255,255,0.85)", "center", 600);
    // menu
    const x = VIEW_W / 2 - 220, y0 = 470;
    this.items.forEach((it, i) => {
      const y = y0 + i * 110;
      const sel = i === this.sel;
      card(ctx, x, y, 440, 86, sel ? "#ffc43a" : "rgba(18,16,26,0.7)", sel);
      title(ctx, it.name, x + 220, y + 58, 40, sel ? INK : "#fff");
    });
    label(ctx, this.items[this.sel].desc, VIEW_W / 2, y0 + this.items.length * 110 + 20, 24, "#fff");
    // roster parade on the right
    rosterList.forEach((def, i) => {
      const rp = resolvePose(def, poseAt(def.rig.anims.idle, Math.floor(this.t * 60) + i * 17, def.rig.loops.idle));
      ctx.save();
      ctx.translate(VIEW_W - 260 - (i % 2) * 220, 700 + Math.floor(i / 2) * 260);
      ctx.scale(1.4, 1.4);
      drawRig(ctx, rp, def.palette.colors, def.palette.outline);
      ctx.restore();
    });
    hint(ctx, "keyboard: WASD/arrows move · J/Numpad1 confirm · gamepad: A confirm");
    label(ctx, `build ${__BUILD__}`, VIEW_W - 20, VIEW_H - 16, 14, "rgba(255,255,255,0.5)", "right", 400);
  }
}
