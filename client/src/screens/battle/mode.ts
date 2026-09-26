import { VIEW_H } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import type { DeviceId, MenuInput } from "../../input/devices";
import { consumeTaps } from "../../input/pointer";
import { sfx } from "../../audio/audio";
import { choiceDef, type FighterChoice } from "../../fighters";
import { bg, label, title, type Screen } from "../ui";
import { ButtonMenu, type Button } from "../draw/buttons";
import { drawFighterPortrait } from "../portrait";

export type BattleMode = "cpu" | "local" | "online";

const X = 1060, W = 640;
const BUTTONS: Button[] = [
  { id: "cpu", x: X, y: 220, w: W, h: 140, text: "VS CPU", size: 60 },
  { id: "local", x: X, y: 400, w: W, h: 140, text: "LOCAL 2P", size: 60 },
  { id: "online", x: X, y: 580, w: W, h: 140, text: "ONLINE", size: 60 },
  { id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 },
];

/** BATTLE, step 2: your fighter on the left, how you want to fight on the right. */
export class ModeScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  /** The device that last drove the menus: player 1's in a local match. */
  private device: DeviceId;

  constructor(private fighter: FighterChoice, device: DeviceId | null, private onMode: (mode: BattleMode, device: DeviceId) => Screen, private onBack: () => Screen) {
    this.device = device ?? "kb1";
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (m.from) this.device = m.from;
    const id = this.menu.update(BUTTONS, m, consumeTaps());
    if (id === "cpu" || id === "local" || id === "online") return this.onMode(id, this.device);
    if (id === "back" || m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    const def = choiceDef(this.fighter).def;
    if (def) drawFighterPortrait(ctx, def, this.t, true, { x: 160, y: 140, w: 640, h: 640 });
    title(ctx, this.fighter.name, 480, 860, 80);
    if (def) label(ctx, def.tagline, 480, 910, 26, PENCIL, "center", 700);
    this.menu.draw(ctx, BUTTONS);
  }
}
