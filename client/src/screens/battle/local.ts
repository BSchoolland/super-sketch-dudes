import { VIEW_H, VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import { pollJoinPresses, readDevice, type DeviceId, type MenuInput } from "../../input/devices";
import { B, EMPTY_INPUT, type InputFrame } from "../../../../shared/input";
import { sfx } from "../../audio/audio";
import { SLOT_COLORS } from "../../render/hud";
import { allChoices, choiceDef, type FighterChoice } from "../../fighters";
import { drawFighterPortrait } from "../portrait";
import { bg, card, hint, label, title, arrows, button, backButton, goTo, type Screen, INK } from "../ui";

export interface SlotPick { device: DeviceId | null; fighter: number; ready: boolean }

const KEYS: Record<string, string> = { kb1: "J", kb2: "Num1" };

/**
 * LOCAL 2P: two slot cards. Player 1 arrives with a fighter and a device; player 2 claims the
 * other slot by pressing a button on any other device (or JOIN with the mouse). Left/right picks,
 * attack/jump readies, shield leaves. FIGHT once both are ready.
 */
export class LocalSetupScreen implements Screen {
  t = 0;
  readonly choices: FighterChoice[];
  readonly slots: SlotPick[];
  private prev = new Map<DeviceId, InputFrame>();

  constructor(you: FighterChoice, device: DeviceId, private onStart: (p1: { fighter: FighterChoice; device: DeviceId }, p2: { fighter: FighterChoice; device: DeviceId }) => Screen, private onBack: () => Screen) {
    const { mine, house } = allChoices();
    this.choices = [...mine, ...house];
    if (!this.choices.some((c) => c.id === you.id)) this.choices.unshift(you);
    this.slots = [
      { device, fighter: this.choices.findIndex((c) => c.id === you.id), ready: true },
      { device: null, fighter: 0, ready: false },
    ];
    this.prev.set(device, readDevice(device, { tapJump: false }));
  }

  private join(slot: SlotPick, device: DeviceId): void {
    slot.device = device;
    slot.ready = false;
    const taken = this.slots[0].fighter;
    slot.fighter = this.choices.findIndex((_, i) => i !== taken && this.choices[i].house);
    if (slot.fighter < 0) slot.fighter = 0;
    this.prev.set(device, readDevice(device, { tapJump: false }));
    sfx.menuConfirm();
  }

  private leave(slot: SlotPick): void {
    if (slot.device) this.prev.delete(slot.device);
    slot.device = null;
    slot.ready = false;
    sfx.menuBack();
  }

  private step(slot: SlotPick, d: number): void {
    slot.fighter = (slot.fighter + d + this.choices.length) % this.choices.length;
    sfx.menuMove();
  }

  private get allReady(): boolean {
    return this.slots.every((s) => s.device && s.ready);
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const used = new Set(this.slots.map((s) => s.device));
    for (const d of pollJoinPresses()) {
      const free = this.slots.find((s) => !s.device);
      if (free && !used.has(d)) { this.join(free, d); used.add(d); }
    }
    for (const s of this.slots) {
      const d = s.device;
      if (!d) continue;
      const now = readDevice(d, { tapJump: false });
      const prev = this.prev.get(d) ?? EMPTY_INPUT;
      this.prev.set(d, now);
      const edge = (bit: number) => (now.b & bit) && !(prev.b & bit);
      if (!s.ready) {
        if (now.x <= -60 && prev.x > -60) this.step(s, -1);
        if (now.x >= 60 && prev.x < 60) this.step(s, 1);
        if (edge(B.ATTACK) || edge(B.JUMP)) { s.ready = true; sfx.menuConfirm(); }
        if (edge(B.SHIELD)) {
          if (s === this.slots[0]) return this.onBack();
          this.leave(s);
        }
      } else if (edge(B.SHIELD) || edge(B.SPECIAL)) { s.ready = false; sfx.menuBack(); }
    }
    if (this.allReady && m.start) return this.start();
    if (m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  private start(): Screen {
    sfx.go();
    const [a, b] = this.slots;
    return this.onStart({ fighter: this.choices[a.fighter], device: a.device! }, { fighter: this.choices[b.fighter], device: b.device! });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "LOCAL 2P", VIEW_W / 2, 90, 64);
    const w = 560, h = 680, gap = 120;
    const x0 = (VIEW_W - (2 * w + gap)) / 2;
    this.slots.forEach((s, i) => {
      const x = x0 + i * (w + gap), y = 140;
      card(ctx, x, y, w, h, SLOT_COLORS[i], s.ready, s.device ? 1 : 0.8);
      if (!s.device) {
        label(ctx, "PRESS A BUTTON", x + w / 2, y + h / 2 - 60, 34, PENCIL);
        label(ctx, "TO JOIN", x + w / 2, y + h / 2 - 18, 34, PENCIL);
        const free: DeviceId | null = this.slots.some((o) => o.device === "kb2") ? (this.slots.some((o) => o.device === "kb1") ? null : "kb1") : "kb2";
        if (free && button(ctx, x + 110, y + h / 2 + 30, w - 220, 70, "JOIN (MOUSE)", { size: 24 })) this.join(s, free);
        return;
      }
      const choice = this.choices[s.fighter];
      const def = choiceDef(choice).def;
      label(ctx, `P${i + 1} · ${s.device.startsWith("pad") ? `pad ${Number(s.device.slice(3)) + 1}` : s.device === "kb1" ? "keys WASD" : "keys arrows"}`, x + w / 2, y + 48, 28, SLOT_COLORS[i], "center", 900);
      if (def) drawFighterPortrait(ctx, def, this.t + i * 0.4, s.ready, { x: x + 40, y: y + 70, w: w - 80, h: 400 });
      else label(ctx, "…", x + w / 2, y + 280, 40, PENCIL);
      title(ctx, choice.name, x + w / 2, y + 530, 52, INK);
      label(ctx, choice.house ? "house" : "yours", x + w / 2, y + 566, 22, PENCIL);
      if (!s.ready) { const d = arrows(ctx, x + w / 2, y + 300, w / 2 - 30, 44); if (d) this.step(s, d); }
      const bw = (w - 100) / 2;
      if (button(ctx, x + 40, y + h - 90, bw, 64, s.ready ? "UNREADY" : "READY", { size: 22, key: KEYS[s.device] ?? "A" })) { s.ready = !s.ready; s.ready ? sfx.menuConfirm() : sfx.menuBack(); }
      if (i > 0 && button(ctx, x + 60 + bw, y + h - 90, bw, 64, "LEAVE", { size: 22 })) this.leave(s);
    });
    if (button(ctx, VIEW_W / 2 - 170, VIEW_H - 200, 340, 84, "FIGHT", { key: "Enter", size: 36, disabled: !this.allReady })) goTo(this.start());
    if (backButton(ctx)) goTo(this.onBack());
    hint(ctx, this.allReady ? "both ready: Enter or FIGHT" : "left/right picks · attack readies · shield leaves");
  }
}
