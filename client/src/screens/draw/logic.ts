import { DRAW_DEFAULTS, type DrawCharacter, type DrawPlayer, type DrawRoomState } from "../../../../shared/draw";

/** The server's draw deadline includes this much grace so late uploads still land; the clock ends before it. */
export const DRAW_GRACE_MS = 4000;

/** Relay slots by placing: the winner, then the rest by stocks left, then lowest percent. */
export function standings(fighters: readonly { stocks: number; percent: number }[], winner: number): number[] {
  const rest = fighters.map((_, slot) => slot).filter((slot) => slot !== winner);
  rest.sort((a, b) => fighters[b].stocks - fighters[a].stocks || fighters[a].percent - fighters[b].percent || a - b);
  return winner >= 0 ? [winner, ...rest] : rest;
}

/** Who reports a battle's result: the host when fighting, otherwise relay slot 0. */
export function battleReporter(room: DrawRoomState): number | null {
  const battle = room.battle;
  if (!battle) return null;
  return battle.participants.includes(room.host) ? room.host : battle.participants[0];
}

export interface LadderEntry {
  index: number;
  fighters: { playerId: number; character: DrawCharacter | null }[];
  winner: number | null;
}

/**
 * Which character each player brought to each finished battle. Replays the ladder rule: everyone
 * starts on their first ready character, a loser moves on to their next ready one.
 */
export function ladderHistory(room: DrawRoomState): LadderEntry[] {
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const cursor = new Map<number, number>();
  const nextReady = (p: DrawPlayer, from: number) => p.characters.findIndex((ch, i) => i >= from && ch.status === "ready");
  for (const p of room.players) cursor.set(p.id, nextReady(p, 0));
  return room.battles.map((battle) => {
    const fighters = battle.participants.map((playerId) => {
      const p = byId.get(playerId);
      const at = cursor.get(playerId) ?? -1;
      return { playerId, character: p && at >= 0 ? p.characters[at] : null };
    });
    for (const playerId of battle.participants) {
      const p = byId.get(playerId);
      if (!p || playerId === battle.winner) continue;
      cursor.set(playerId, nextReady(p, (cursor.get(playerId) ?? 0) + 1));
    }
    return { index: battle.index, fighters, winner: battle.winner };
  });
}

export function secondsLeft(deadline: number, now: number, graceMs = 0): number {
  return deadline ? Math.max(0, Math.ceil((deadline - graceMs - now) / 1000)) : 0;
}

/** How long the server's timer runs for the phase it just started, so the clock runs on local time. */
export function phaseMs(room: Pick<DrawRoomState, "phase" | "drawSeconds">): number {
  if (room.phase === "draw") return room.drawSeconds * 1000 + DRAW_GRACE_MS;
  if (room.phase === "between") return DRAW_DEFAULTS.betweenSeconds * 1000;
  throw new Error(`the server set a deadline in phase ${room.phase}`);
}

/**
 * A battle that lost a player can't be finished: the result is where it stopped, the remaining
 * fighters ranked by `standings`, the missing ones last.
 */
export function abandonedResult(fighters: readonly { stocks: number; percent: number }[], gone: readonly number[]): { winner: number; standings: number[] } {
  const order = standings(fighters, -1);
  const ranked = [...order.filter((slot) => !gone.includes(slot)), ...order.filter((slot) => gone.includes(slot))];
  return { winner: ranked[0], standings: ranked };
}
