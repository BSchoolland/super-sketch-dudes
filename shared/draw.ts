/**
 * DRAW BATTLE contract, shared by server/draw.ts and the client screens.
 *
 * A game: a room of 2..4 players draws `rounds` characters each (one per draw round, `drawSeconds`
 * on the clock, rounds back to back) while the forge turns them into fighters, waits for the last
 * ones, then fights an elimination ladder: every alive player brings their current character; the
 * winner keeps theirs, everyone else's is spent and they move to their next one. Out of
 * characters means out of the game. Last player standing wins.
 */
/** `reveal` is the wait after the last draw round while the forge finishes; draw rounds run back to back. */
export type DrawPhase = "lobby" | "draw" | "reveal" | "loading" | "battle" | "between" | "over";
export type CharStatus = "waiting" | "queued" | "generating" | "ready" | "failed";

export interface DrawCharacter {
  round: number;
  status: CharStatus;
  /** Forge progress note while generating ("reading the drawing", "drawing the sheet", "balance testing"). */
  stage: string;
  drawingUrl: string | null;
  fighterId: string | null;
  bundleUrl: string | null;
  sheetUrl: string | null;
  name: string | null;
  tagline: string | null;
  description: string | null;
  /** Four lines: attack, special, up+special, grab. Shown while the fight loads. */
  card: string[] | null;
  error: string | null;
  /** Lost a battle with it. */
  spent: boolean;
}

export interface DrawPlayer {
  id: number;
  name: string;
  /** Room slot (join order). During a battle, participants' relay slots are their index in battle.participants. */
  slot: number;
  ready: boolean;
  /** Fighter ids this client has confirmed it loaded (bundles + images). */
  loaded: string[];
  characters: DrawCharacter[];
  /** Index into characters of the one that fights next; -1 when none are left. */
  current: number;
  alive: boolean;
  wins: number;
  connected: boolean;
}

export interface DrawBattle {
  index: number;
  /** Player ids, in relay slot order. */
  participants: number[];
  /** Winning player id once reported. */
  winner: number | null;
  seed: number;
  stage: string;
}

export interface DrawRoomState {
  code: string;
  host: number;
  phase: DrawPhase;
  /** 1-based draw round while drawing/revealing. */
  round: number;
  rounds: number;
  drawSeconds: number;
  /** Epoch ms when the current timed phase ends (draw deadline, reveal auto-advance, between). 0 = untimed. */
  deadline: number;
  players: DrawPlayer[];
  battles: DrawBattle[];
  battle: DrawBattle | null;
  /** One line the screen shows under the phase (why we're waiting, who won). */
  note: string;
}

export type DrawClientMessage =
  | { t: "drawAuth"; password: string }
  | { t: "drawCreate"; name: string }
  | { t: "drawJoin"; code: string; name: string }
  | { t: "drawStart"; rounds?: number; drawSeconds?: number }
  /** The player's drawing for the round as a PNG data URL. Sent when they press done or the clock runs out. */
  | { t: "drawSubmit"; round: number; png: string }
  | { t: "drawReady"; ready: boolean }
  /** Bundles this client has fully loaded; the battle starts when every participant has loaded every fighter in it. */
  | { t: "drawLoaded"; fighterIds: string[] }
  /** Host reports the finished battle: winner's relay slot, then the rest by placing. */
  | { t: "drawBattleEnd"; winner: number; standings: number[] }
  | { t: "drawLeave" };

export type DrawServerMessage =
  | { t: "drawAuth"; ok: boolean; error?: string }
  | { t: "draw"; room: DrawRoomState }
  /** The battle is starting: same shape as the classic online `start`, so the same match screen runs it. */
  | { t: "start"; seed: number; config: { stage: string; rules: { stocks: number; time: number }; inputDelay: number; players: { fighter: string }[] }; members: { id: number; name: string; slot: number }[] };

export const DRAW_DEFAULTS = { rounds: 1, drawSeconds: 90, betweenSeconds: 8, stocks: 3, minPlayers: 2, maxPlayers: 4 };
/** Longest side of the drawing the client uploads; the server rejects bigger. */
export const DRAW_PNG_MAX_BYTES = 900_000;
