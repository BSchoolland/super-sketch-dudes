import type { GameEvent, Move, State } from "../../../shared/types";
import { defOf } from "../../../shared/fighter";
import { C } from "../../../shared/config";
import { panOf, play } from "./engine";
import * as S from "./sounds";
import type { Music } from "./music";

export { Music } from "./music";
export { setMusicVolume, setVolume, unlockAudio } from "./engine";

const hitVary = 0.06;

export const sfx = {
  menuMove: (): void => play(S.menuMove, { vary: 0.03 }),
  menuConfirm: (): void => play(S.menuConfirm, { vary: 0 }),
  menuBack: (): void => play(S.menuBack, { vary: 0 }),
  countdown: (): void => play(S.countdown, { vary: 0 }),
  go: (): void => play(S.go, { vary: 0 }),
};

/** Whoosh weight for a move, or null when it has nothing to swing (grabs, throws, pure spawns). */
function swingWeight(id: string, mv: Move): 0 | 1 | 2 | null {
  const strikes = mv.hitboxes.filter((h) => !h.grab && !h.wind);
  if (!strikes.length || /grab|throw|pummel/i.test(id)) return null;
  if (mv.smash) return 2;
  const big = Math.max(...strikes.map((h) => h.damage)) >= 12;
  if (big || /special|dashAttack|fair|bair|dair/.test(id)) return 1;
  return 0;
}

/** Sounds for one batch of sim events. The whoosh lands on the move's first active frame, not its start. */
export function playEvents(state: State, events: GameEvent[], music: Music): void {
  let hits = 0;
  for (const e of events) {
    switch (e.t) {
      case "hit": if (hits++ < 3) play((v) => S.hit(v, e.damage, e.fx, e.kb), { x: e.x, vary: hitVary }); break;
      case "shieldHit": play((v) => S.shieldHit(v, e.damage), { x: e.x }); break;
      case "parry": play(S.parry, { x: e.x, vary: 0 }); break;
      case "shieldBreak": play(S.shieldBreak, { x: e.x }); break;
      case "land": play((v) => S.land(v, e.hard), { x: e.x }); break;
      case "jump": play((v) => S.jump(v, e.double), { x: e.x }); break;
      case "dash": play(S.dash, { x: e.x }); break;
      case "tech": play(S.tech, { x: e.x }); break;
      case "ledge": play(S.ledge, { x: e.x }); break;
      case "grab": play(S.grab, { x: e.x }); break;
      case "throw": play(S.throwSound, { x: e.x }); break;
      case "ko": play(S.ko, { pan: e.side === "left" ? -0.8 : e.side === "right" ? 0.8 : panOf(e.x), vary: 0.03 }); music.duck(); break;
      case "respawn": play(S.respawn, { x: e.x, vary: 0 }); break;
      case "projectile": play((v) => S.projectile(v, e.kind), { x: e.x, vary: 0.03 }); break;
      case "end": play(S.gameEnd, { vary: 0 }); music.muffle(true); break;
      case "suddenDeath": play(S.suddenDeath, { vary: 0 }); break;
      case "move": {
        const f = state.fighters[e.slot];
        const mv = f && defOf(f).moves[e.move];
        if (!mv) break;
        const w = swingWeight(e.move, mv);
        if (w === null) break;
        const first = Math.min(...mv.hitboxes.filter((h) => !h.grab && !h.wind).map((h) => h.frames[0]));
        play((v) => S.swing(v, w), { x: e.x, delay: Math.max(0, first - (state.frame - e.frame)) / 60 });
        break;
      }
      default: break;
    }
  }
}

/** Sounds that follow fighter state rather than events: the smash charge strain. */
export class StateSounds {
  private grain = new Map<number, number>();
  update(dt: number, state: State): void {
    for (const f of state.fighters) {
      if (f.action !== "smashCharge") { this.grain.delete(f.slot); continue; }
      const left = (this.grain.get(f.slot) ?? 0) - dt;
      if (left > 0) { this.grain.set(f.slot, left); continue; }
      this.grain.set(f.slot, 0.07);
      const level = Math.min(1, f.charge / C.SMASH_CHARGE_MAX);
      play((v) => S.charge(v, level), { x: f.x, vary: 0 });
    }
  }
}
