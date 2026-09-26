import { VIEW_H, VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import { SLOT_COLORS } from "../../render/hud";
import type { MenuInput } from "../../input/devices";
import type { ViewPoint } from "../../input/pointer";
import type { DrawCharacter, DrawPlayer } from "../../../../shared/draw";
import { label, title, INK } from "../ui";
import { drawCharacterArt, RED } from "./character";
import { fighterLoad } from "./images";
import type { DrawHost, DrawView } from "./view";

interface Entry { player: DrawPlayer; ch: DrawCharacter }

/**
 * The fighters of the coming battle, side by side. While loading, participants fetch every
 * bundle and report; during the battle it's what eliminated players watch.
 */
export class LineupView implements DrawView {
  private reported = false;

  constructor(private host: DrawHost, private mode: "loading" | "battle") {}

  private entries(): Entry[] {
    const room = this.host.session.room;
    const battle = room?.battle;
    if (!room || !battle) throw new Error(`${this.mode} view without a battle`);
    return battle.participants.map((id) => {
      const player = room.players.find((p) => p.id === id);
      if (!player) throw new Error(`battle participant ${id} is not in the room`);
      const ch = player.characters[player.current];
      if (!ch) throw new Error(`${player.name} has no current character`);
      return { player, ch };
    });
  }

  private get fighting(): boolean {
    return this.entries().some((e) => e.player.id === this.host.session.id);
  }

  update(_m: MenuInput, _taps: ViewPoint[]): void {
    if (this.mode !== "loading" || this.reported || !this.fighting) return;
    const entries = this.entries();
    const loads = entries.map((e) => {
      if (!e.ch.bundleUrl || !e.ch.fighterId) throw new Error(`${e.player.name}'s fighter has no bundle`);
      return fighterLoad(e.ch.bundleUrl);
    });
    if (loads.every((l) => l.state === "ready")) {
      this.host.session.send({ t: "drawLoaded", fighterIds: entries.map((e) => e.ch.fighterId!) });
      this.reported = true;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const room = this.host.session.room!;
    const entries = this.entries();
    const n = entries.length;
    const size = n > 3 ? 360 : n > 2 ? 420 : 480;
    const gap = n > 2 ? 60 : 180;
    const x0 = (VIEW_W - (size * n + gap * (n - 1))) / 2;
    const top = 200;
    title(ctx, `BATTLE ${room.battle!.index + 1}`, VIEW_W / 2, 120, 64);
    entries.forEach((e, i) => {
      const x = x0 + i * (size + gap), cx = x + size / 2;
      drawCharacterArt(ctx, e.ch, x, top, size, this.host.t);
      title(ctx, e.ch.name ?? "?", cx, top + size + 70, n > 3 ? 44 : 56);
      ctx.fillStyle = SLOT_COLORS[i];
      ctx.fillRect(cx - 50, top + size + 96, 100, 5);
      label(ctx, e.player.name, cx, top + size + 140, 34, e.player.connected ? INK : PENCIL, "center", 800);
      label(ctx, this.stateOf(e), cx, top + size + 186, 28, this.stateColor(e));
      if (i < n - 1) title(ctx, "vs", x + size + gap / 2, top + size / 2 + 20, 56, PENCIL);
    });
    if (!this.fighting) label(ctx, "you're watching this one", VIEW_W / 2, VIEW_H - 60, 32, PENCIL);
  }

  private loadedAll(p: DrawPlayer): boolean {
    return this.entries().every((e) => e.ch.fighterId && p.loaded.includes(e.ch.fighterId));
  }

  private stateOf(e: Entry): string {
    if (!e.player.connected) return "left";
    if (this.mode === "battle") return "fighting";
    const local = e.ch.bundleUrl ? fighterLoad(e.ch.bundleUrl) : null;
    if (local?.state === "failed") return local.error;
    return this.loadedAll(e.player) ? "ready" : "loading…";
  }

  private stateColor(e: Entry): string {
    const local = this.mode === "loading" && e.ch.bundleUrl ? fighterLoad(e.ch.bundleUrl) : null;
    if (local?.state === "failed") return RED;
    return this.mode === "loading" && !this.loadedAll(e.player) ? PENCIL : INK;
  }
}
