import { inkLine } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { bg, card, hint, label, title, hover, clicked, goTo, type Screen, INK } from "./ui";
import { rosterList } from "../../../shared/fighters/index";
import { drawRig, poseAt, resolvePose } from "../render/rig";
import { drawSprite } from "../render/sprite";
import { cellForAnim } from "../../../shared/gen/sprite";

const MENU_Y = 450, MENU_STEP = 96;

export type Mode = "versus" | "online" | "draw" | "training" | "settings";

export class TitleScreen implements Screen {
  t = 0;
  sel = 0;
  items: { id: Mode; name: string; desc: string }[] = [
    { id: "versus", name: "VERSUS", desc: "Local. 2 to 4 fighters, humans or CPUs." },
    { id: "online", name: "ONLINE", desc: "Quick match or a room code. Rollback netcode." },
    { id: "draw", name: "DRAW BATTLE", desc: "Draw your fighters, then fight with them. Friends only." },
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
    title(ctx, "SKETCH BATTLE", 0, 40, 150, INK);
    inkLine(ctx, -410, 70, 410, 59, INK, 5);
    inkLine(ctx, -375, 82, 365, 75, INK, 2);
    ctx.restore();
    label(ctx, "you don't win by emptying a bar. you win by throwing them out.", VIEW_W / 2, 400, 26, "rgba(41,39,34,0.85)", "center", 600);
    // menu
    const x = VIEW_W / 2 - 220;
    this.items.forEach((it, i) => {
      const y = MENU_Y + i * MENU_STEP;
      const sel = i === this.sel;
      if (hover(x, y, 440, 86)) { this.sel = i; document.body.style.cursor = "pointer"; }
      if (clicked(x, y, 440, 86)) { sfx.menuConfirm(); goTo(this.onPick(it.id)); }
      card(ctx, x, y, 440, 86, sel ? "#ffc43a" : "rgba(18,16,26,0.7)", sel);
      title(ctx, it.name, x + 220, y + 58, 40, INK);
    });
    label(ctx, this.items[this.sel].desc, VIEW_W / 2, MENU_Y + this.items.length * MENU_STEP + 20, 24, INK);
    // roster parade on the right
    rosterList.slice(0, 4).forEach((def, i) => {
      const pose = poseAt(def.rig.anims.idle, Math.floor(this.t * 60) + i * 17, def.rig.loops.idle);
      ctx.save();
      ctx.translate(VIEW_W - 260 - (i % 2) * 220, 700 + Math.floor(i / 2) * 260);
      ctx.scale(1.4, 1.4);
      if (def.sprite) drawSprite(ctx, def, cellForAnim(def, "idle"), pose);
      else drawRig(ctx, resolvePose(def, pose), def.palette.colors, def.palette.outline);
      ctx.restore();
    });
    hint(ctx, "click, or arrows + Enter · gamepad: stick + A");
    label(ctx, `build ${__BUILD__}`, VIEW_W - 20, VIEW_H - 16, 14, "rgba(41,39,34,0.5)", "right", 400);
  }
}
