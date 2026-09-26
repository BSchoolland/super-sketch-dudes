import { VIEW_H, VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import { SLOT_COLORS } from "../../render/hud";
import type { MenuInput } from "../../input/devices";
import type { ViewPoint } from "../../input/pointer";
import type { DrawPlayer } from "../../../../shared/draw";
import { label, title, INK } from "../ui";
import { ButtonMenu, type Button } from "./buttons";
import { characterStatus, drawCharacterArt } from "./character";
import { fighterLoad } from "./images";
import { secondsLeft } from "./logic";
import { clock, wrapped } from "./text";
import type { DrawHost, DrawView } from "./view";

const MARGIN = 60, GAP = 40;

/** The gallery: this round's drawings turning into fighters as the forge finishes them. */
export class RevealView implements DrawView {
  private menu = new ButtonMenu();

  constructor(private host: DrawHost, private round: number) {}

  private buttons(): Button[] {
    const me = this.host.session.me;
    return [{ id: "ready", x: VIEW_W / 2 - 200, y: VIEW_H - 120, w: 400, h: 96, text: me?.ready ? "READY ✓" : "READY", size: 44 }];
  }

  update(m: MenuInput, taps: ViewPoint[]): void {
    const s = this.host.session;
    // start fetching finished fighters now so the battle doesn't wait on them
    for (const p of s.room?.players ?? []) for (const ch of p.characters) if (ch.status === "ready" && ch.bundleUrl) fighterLoad(ch.bundleUrl);
    if (this.menu.update(this.buttons(), m, taps) === "ready" || m.start) s.send({ t: "drawReady", ready: !s.me?.ready });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.host.session;
    const room = s.room;
    if (!room) throw new Error("reveal view without a room");
    const n = room.players.length;
    const colW = Math.min(560, (VIEW_W - MARGIN * 2 - GAP * (n - 1)) / n);
    const x0 = (VIEW_W - (colW * n + GAP * (n - 1))) / 2;
    const earlier = this.round > 1;
    const size = Math.min(colW, earlier ? 470 : 540);
    room.players.forEach((p, i) => this.drawColumn(ctx, p, x0 + i * (colW + GAP), colW, size, earlier));
    this.menu.draw(ctx, this.buttons());
    const left = secondsLeft(s.deadline, Date.now());
    const cx = VIEW_W / 2 + 260;
    if (s.deadline) label(ctx, clock(left), cx, VIEW_H - 55, 44, PENCIL, "left");
    if (room.note && room.round >= room.rounds) label(ctx, room.note, VIEW_W / 2 - 260, VIEW_H - 55, 30, PENCIL, "right");
  }

  private drawColumn(ctx: CanvasRenderingContext2D, p: DrawPlayer, x: number, w: number, size: number, earlier: boolean): void {
    const t = this.host.t;
    const cx = x + w / 2;
    ctx.fillStyle = SLOT_COLORS[p.slot % SLOT_COLORS.length];
    ctx.fillRect(cx - 40, 92, 80, 5);
    label(ctx, `${p.name}${p.ready ? " ✓" : ""}${p.connected ? "" : " (left)"}`, cx, 76, 34, p.connected ? INK : PENCIL, "center", 800);
    const ch = p.characters[this.round - 1] ?? null;
    const top = 134, ax = cx - size / 2;
    drawCharacterArt(ctx, ch, ax, top, size, t + p.slot * 0.3);
    let y = top + size + 58;
    if (ch?.status === "ready") {
      title(ctx, ch.name ?? "?", cx, y, size > 450 ? 58 : 48);
      y += 40;
      if (ch.tagline) wrapped(ctx, ch.tagline, cx, y, w - 10, 26, INK, 2);
    } else if (ch) {
      const status = characterStatus(ch, t);
      if (status) wrapped(ctx, status.text, cx, y - 16, w - 10, 30, status.color, 3);
    }
    if (!earlier) return;
    // earlier rounds, small: they finish while later ones are drawn
    const thumb = 92, rowY = 760;
    const past = p.characters.slice(0, this.round - 1);
    const rowW = past.length * thumb + (past.length - 1) * 16;
    past.forEach((prev, i) => {
      const tx = cx - rowW / 2 + i * (thumb + 16);
      drawCharacterArt(ctx, prev, tx, rowY, thumb, t);
      const status = characterStatus(prev, t);
      label(ctx, prev.status === "ready" ? prev.name ?? "?" : status?.text.replace(/\.+$/, "") ?? "", tx + thumb / 2, rowY + thumb + 26, 20, status?.color ?? INK, "center", 700);
    });
  }
}
