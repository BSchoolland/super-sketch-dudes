import type { Fighter, State } from "./types";

export type FxKind = "sparks" | "flame" | "smoke" | "ring" | "shake";

/** A burst of particles at a world point, drawn by the client and nothing else: no hit, no state, not in the hash. `size` scales each particle; for a shake it is how hard (0..1), held while the shake keeps coming. */
export function fx(state: State, f: Fighter, kind: FxKind, x: number, y: number, n = 6, color?: string, size = 1): void {
  state.events.push({ t: "fx", frame: state.frame, slot: f.slot, kind, x, y, n, color, size });
}
