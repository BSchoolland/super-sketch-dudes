import { VIEW_W } from "../../render/camera";
import type { MenuInput } from "../../input/devices";
import { sfx } from "../../audio/audio";
import { bg, card, hint, label, title, hover, clicked, backButton, goTo, type Screen, INK } from "../ui";
import { activity } from "../../activity";

export type BattleEntry = "call" | "quick" | "create" | "join" | "bots";

const CALL = { id: "call" as const, name: "THIS CALL", desc: "Everyone in the voice channel who opened the game" };
const ONLINE: { id: BattleEntry; name: string; desc: string }[] = [
  { id: "quick", name: "QUICK MATCH", desc: "Join a public lobby quickly" },
  { id: "create", name: "CREATE LOBBY", desc: "Public, or only for people with the code" },
  { id: "join", name: "JOIN ROOM", desc: "Pick a public lobby, or enter a room code" },
  { id: "bots", name: "VS BOTS", desc: "Play against bots" },
];

const X = VIEW_W / 2 - 360, W = 720, H = 130, Y0 = 220, STEP = 170, CALL_STEP = 150;

/** BATTLE: how you want to fight. Your fighter is picked on the next screen. */
export class BattleMenuScreen implements Screen {
  t = 0;
  sel = 0;
  private items = activity ? [CALL, ...ONLINE] : ONLINE;
  private step = activity ? CALL_STEP : STEP;

  constructor(private onPick: (entry: BattleEntry) => Screen, private onBack: () => Screen) {}

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const n = this.items.length;
    if (m.up) { this.sel = (this.sel + n - 1) % n; sfx.menuMove(); }
    if (m.down) { this.sel = (this.sel + 1) % n; sfx.menuMove(); }
    if (m.confirm || m.start) { sfx.menuConfirm(); return this.onPick(this.items[this.sel].id); }
    if (m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "BATTLE", VIEW_W / 2, 110, 72);
    this.items.forEach((it, i) => {
      const y = Y0 + i * this.step;
      if (hover(X, y, W, H)) { this.sel = i; document.body.style.cursor = "pointer"; }
      if (clicked(X, y, W, H)) { sfx.menuConfirm(); goTo(this.onPick(it.id)); }
      const selected = i === this.sel;
      card(ctx, X, y, W, H, INK, selected);
      title(ctx, it.name, VIEW_W / 2, y + 62, 42, INK);
      label(ctx, it.desc, VIEW_W / 2, y + 103, 21, selected ? INK : "rgba(41,39,34,0.8)");
    });
    if (backButton(ctx)) goTo(this.onBack());
    hint(ctx, "click, or up/down + Enter · Esc: back");
  }
}
