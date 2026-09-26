import { VIEW_H, VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import { SLOT_COLORS } from "../../render/hud";
import type { MenuInput } from "../../input/devices";
import type { ViewPoint } from "../../input/pointer";
import type { DrawPlayer } from "../../../../shared/draw";
import { label, title, FONT, INK } from "../ui";
import { ButtonMenu, type Button } from "./buttons";
import { drawCharacterArt, RED } from "./character";
import { ladderHistory, secondsLeft } from "./logic";
import { wrapped } from "./text";
import type { DrawHost, DrawView } from "./view";

const RIGHT = 1000;

/** After a battle (who won, with what) and at the end (the last one standing). */
export class ResultsView implements DrawView {
  private menu = new ButtonMenu();

  constructor(private host: DrawHost, private over: boolean) {}

  private buttons(): Button[] {
    return this.over ? [{ id: "back", x: VIEW_W / 2 - 200, y: VIEW_H - 124, w: 400, h: 96, text: "BACK", size: 44 }] : [];
  }

  update(m: MenuInput, taps: ViewPoint[]): void {
    if (this.menu.update(this.buttons(), m, taps) === "back" || (this.over && m.back)) {
      this.host.session.leave();
      this.host.exit();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.host.session;
    const room = s.room;
    if (!room) throw new Error("results view without a room");
    const history = ladderHistory(room);
    const last = history[history.length - 1];
    const byId = (id: number | null) => room.players.find((p) => p.id === id) ?? null;
    // the champion at the end; otherwise the last battle's winner
    const standing = room.players.filter((p) => p.alive && p.connected);
    const winner = this.over ? (standing.length === 1 ? standing[0] : null) : byId(last?.winner ?? null);
    const winnerChar = winner ? (this.over ? winner.characters[winner.current] ?? null : last?.fighters.find((f) => f.playerId === winner.id)?.character ?? null) : null;

    const cx = 470;
    if (winner) {
      title(ctx, winner.name, cx, 150, this.over ? 120 : 96, SLOT_COLORS[winner.slot % SLOT_COLORS.length]);
      label(ctx, this.over ? `wins DRAW BATTLE${winnerChar?.name ? ` with ${winnerChar.name}` : ""}` : `wins with ${winnerChar?.name ?? "?"}`, cx, 210, 36, INK, "center", 800, VIEW_W - 160);
      drawCharacterArt(ctx, winnerChar, cx - 250, 275, 500, this.host.t);
      if (winnerChar?.tagline) wrapped(ctx, winnerChar.tagline, cx, 825, 560, 28, PENCIL, 2);
    } else {
      wrapped(ctx, room.note || "no winner", cx, 400, 700, 60, INK, 3, "center", 900);
    }

    // the ladder so far, latest battles
    let y = 110;
    history.slice(-4).forEach((entry) => {
      const names = entry.fighters.map((f) => {
        const p = byId(f.playerId);
        return { text: `${f.character?.name ?? "?"} (${p?.name ?? "?"})`, won: f.playerId === entry.winner };
      });
      label(ctx, `${entry.index + 1}`, RIGHT, y, 30, PENCIL, "left", 800);
      let x = RIGHT + 50;
      names.forEach((nm, i) => {
        if (i) { label(ctx, "vs", x, y, 24, PENCIL, "left"); x += 44; }
        ctx.save();
        ctx.font = `${nm.won ? 900 : 700} 28px ${FONT}`;
        const w = ctx.measureText(nm.text).width;
        ctx.restore();
        label(ctx, nm.text, x, y, 28, nm.won ? INK : PENCIL, "left", nm.won ? 900 : 700);
        if (nm.won) { ctx.fillStyle = INK; ctx.fillRect(x, y + 8, w, 3); }
        x += w + 20;
      });
      y += 52;
    });

    // everyone's characters: spent ones crossed out
    y = Math.max(y + 30, 330);
    const rowH = Math.min(170, (VIEW_H - 170 - y) / room.players.length);
    room.players.forEach((p) => { this.drawRoster(ctx, p, RIGHT, y, rowH); y += rowH; });

    if (!this.over && s.deadline) label(ctx, `next battle in ${secondsLeft(s.deadline, Date.now())}`, VIEW_W / 2, VIEW_H - 50, 32, PENCIL);
    if (this.over && winner && room.note && !room.note.startsWith(winner.name)) label(ctx, room.note, VIEW_W / 2, VIEW_H - 150, 28, PENCIL);
    this.menu.draw(ctx, this.buttons());
  }

  private drawRoster(ctx: CanvasRenderingContext2D, p: DrawPlayer, x: number, y: number, h: number): void {
    const thumb = h - 40;
    ctx.fillStyle = SLOT_COLORS[p.slot % SLOT_COLORS.length];
    ctx.fillRect(x, y + 8, 6, thumb - 16);
    label(ctx, p.name, x + 20, y + 40, 34, p.alive && p.connected ? INK : PENCIL, "left", 900);
    const out = !p.connected ? "left" : !p.alive ? "out" : `${p.wins} win${p.wins === 1 ? "" : "s"}`;
    label(ctx, out, x + 20, y + 76, 24, p.alive ? PENCIL : RED, "left");
    p.characters.forEach((ch, i) => {
      const tx = x + 230 + i * (thumb + 20);
      drawCharacterArt(ctx, ch, tx, y, thumb, 0);
      if (ch.status === "failed") label(ctx, "didn't make it", tx + thumb / 2, y + thumb + 24, 18, RED);
      else label(ctx, ch.name ?? "?", tx + thumb / 2, y + thumb + 24, 20, ch.spent ? PENCIL : INK, "center", i === p.current && !ch.spent ? 900 : 700, thumb + 16);
    });
  }
}
