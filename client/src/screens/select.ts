import { VIEW_H, VIEW_W } from "../render/camera";
import { pollJoinPresses, readDevice, type DeviceId, type MenuInput } from "../input/devices";
import { B, EMPTY_INPUT, type InputFrame } from "../../../shared/input";
import { rosterList } from "../../../shared/fighters/index";
import { sfx } from "../audio/audio";
import { SLOT_COLORS } from "../render/hud";
import { drawFighterPortrait } from "./portrait";
import { bg, card, hint, label, title, type Screen, INK, settings } from "./ui";

export interface SlotPick { device: DeviceId | null; cpu: number; fighter: number; ready: boolean }

/**
 * Four slot cards. Press a button on any device to claim a slot; left/right picks a fighter;
 * attack/jump readies; special on an unclaimed slot (from any joined device) cycles it CPU.
 * Start with pause/start or by readying when at least two slots are filled.
 */
export class SelectScreen implements Screen {
  t = 0;
  slots: SlotPick[] = [0, 1, 2, 3].map(() => ({ device: null, cpu: 0, fighter: 0, ready: false }));
  cursor = new Map<DeviceId, number>(); // which slot a joined device is pointing at (its own)
  prev = new Map<DeviceId, InputFrame>();
  cpuCursor = 1;
  constructor(private onStart: (slots: SlotPick[]) => Screen, private onBack: () => Screen, private training = false) {}
  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    for (const d of pollJoinPresses()) {
      if ([...this.cursor.keys()].includes(d)) continue;
      const free = this.slots.findIndex((s) => !s.device && !s.cpu);
      if (free < 0) continue;
      this.slots[free].device = d;
      this.slots[free].fighter = free % rosterList.length;
      this.cursor.set(d, free);
      this.prev.set(d, readDevice(d, { tapJump: false }));
      sfx.menuConfirm();
    }
    for (const [d, slotIdx] of this.cursor) {
      const now = readDevice(d, { tapJump: false });
      const prev = this.prev.get(d) ?? EMPTY_INPUT;
      const edge = (bit: number) => (now.b & bit) && !(prev.b & bit);
      const s = this.slots[slotIdx];
      const left = now.x <= -60 && prev.x > -60, right = now.x >= 60 && prev.x < 60;
      const up = now.y <= -60 && prev.y > -60, down = now.y >= 60 && prev.y < 60;
      if (!s.ready) {
        if (left) { s.fighter = (s.fighter + rosterList.length - 1) % rosterList.length; sfx.menuMove(); }
        if (right) { s.fighter = (s.fighter + 1) % rosterList.length; sfx.menuMove(); }
        if (edge(B.ATTACK) || edge(B.JUMP)) { s.ready = true; sfx.menuConfirm(); }
        if (edge(B.SHIELD)) {
          // leave the slot; if the last device leaves, go back
          s.device = null; s.ready = false; this.cursor.delete(d); this.prev.delete(d); sfx.menuBack();
          if (!this.cursor.size) return this.onBack();
          continue;
        }
      } else {
        if (edge(B.SHIELD) || edge(B.SPECIAL)) { s.ready = false; sfx.menuBack(); }
      }
      // CPU management from any joined device: up/down moves the CPU cursor, special toggles/cycles
      if (up || down) { const empties = this.slots.map((x, i) => i).filter((i) => !this.slots[i].device); if (empties.length) { const cur = empties.indexOf(this.cpuCursor); this.cpuCursor = empties[(cur + (down ? 1 : empties.length - 1) + empties.length) % empties.length]; sfx.menuMove(); } }
      if (edge(B.SPECIAL) && !s.ready) {
        const c = this.slots[this.cpuCursor];
        if (c && !c.device) {
          c.cpu = c.cpu === 0 ? settings.cpuLevel : c.cpu >= 9 ? 0 : c.cpu + 1;
          c.fighter = c.cpu ? (this.cpuCursor + 1) % rosterList.length : 0;
          c.ready = c.cpu > 0;
          sfx.menuMove();
        }
      }
      if (edge(B.GRAB) && !s.ready) {
        const c = this.slots[this.cpuCursor];
        if (c && !c.device && c.cpu) { c.fighter = (c.fighter + 1) % rosterList.length; sfx.menuMove(); }
      }
      this.prev.set(d, now);
    }
    const filled = this.slots.filter((s) => s.device || s.cpu);
    const allReady = filled.length >= (this.training ? 1 : 2) && filled.every((s) => s.ready);
    if (allReady && (m.start || filled.every((s) => s.ready) && filled.some((s) => s.device) && m.confirm && this.everyoneReadyFor > 0.4)) {
      sfx.go();
      if (this.training && filled.length === 1) { const c = this.slots.find((s) => !s.device && !s.cpu)!; c.cpu = 1; c.fighter = 0; c.ready = true; }
      return this.onStart(this.slots);
    }
    this.everyoneReadyFor = allReady ? this.everyoneReadyFor + dt : 0;
    if (m.back && !this.cursor.size) return this.onBack();
    return null;
  }
  everyoneReadyFor = 0;
  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, this.training ? "TRAINING" : "CHOOSE YOUR FIGHTER", VIEW_W / 2, 90, 64);
    const w = 400, h = 640, gap = 40;
    const x0 = (VIEW_W - (4 * w + 3 * gap)) / 2;
    this.slots.forEach((s, i) => {
      const x = x0 + i * (w + gap), y = 150;
      const color = SLOT_COLORS[i];
      const empty = !s.device && !s.cpu;
      card(ctx, x, y, w, h, empty ? "rgba(18,16,26,0.55)" : color, s.ready, empty ? 0.8 : 1);
      if (empty) {
        label(ctx, "PRESS A BUTTON", x + w / 2, y + h / 2 - 10, 28, "rgba(255,255,255,0.7)");
        label(ctx, "TO JOIN", x + w / 2, y + h / 2 + 26, 28, "rgba(255,255,255,0.7)");
        if (this.cpuCursor === i && this.cursor.size) label(ctx, "▲ special: add CPU ▼", x + w / 2, y + h - 30, 20, "#ffc43a");
        return;
      }
      const def = rosterList[s.fighter];
      drawFighterPortrait(ctx, def, i, this.t, s.ready, { x: x + 16, y: y + 70, w: w - 32, h: 400 });
      label(ctx, s.cpu ? `CPU ${s.cpu}` : `P${i + 1}`, x + w / 2, y + 44, 30, INK, "center", 900);
      title(ctx, def.name, x + w / 2, y + 530, 44, "#fff");
      label(ctx, def.tagline, x + w / 2, y + 566, 16, "rgba(255,255,255,0.9)", "center", 600);
      if (!s.ready) { label(ctx, "◀", x + 30, y + 300, 40, "#fff"); label(ctx, "▶", x + w - 30, y + 300, 40, "#fff"); }
      label(ctx, s.ready ? "READY" : s.cpu ? "" : "attack: ready · shield: leave", x + w / 2, y + h - 24, 20, s.ready ? "#fff" : "rgba(255,255,255,0.85)");
    });
    const filled = this.slots.filter((s) => s.device || s.cpu);
    const allReady = filled.length >= (this.training ? 1 : 2) && filled.every((s) => s.ready);
    hint(ctx, allReady ? "everyone's ready: press START (Esc / pause) or attack again to fight" : "left/right pick a fighter · special adds a CPU to the highlighted empty slot (grab cycles its fighter)");
    void VIEW_H;
  }
}
