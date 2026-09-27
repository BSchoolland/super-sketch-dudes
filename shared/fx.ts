import type { Fighter, State } from "./types";

export type FxKind = "sparks" | "flame" | "smoke" | "ring";

/** A burst of particles at a world point, drawn by the client and nothing else: no hit, no state, not in the hash. */
export function fx(state: State, f: Fighter, kind: FxKind, x: number, y: number, n = 6, color?: string): void {
  state.events.push({ t: "fx", frame: state.frame, slot: f.slot, kind, x, y, n, color });
}
