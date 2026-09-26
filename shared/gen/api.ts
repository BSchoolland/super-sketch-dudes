import { cap, hb, key, mv, throwMove } from "./helpers";
import { setAction, startMove, releaseGrab, throwVictim } from "../fighter";
import { spawnProjectile, knockback } from "../hits";
import { approach, clamp, lerp, sign, sinDeg, cosDeg, atan2Deg } from "../fixed";
import { B, STICK_DEAD, STICK_RUN, STICK_WALK } from "../input";
import { C } from "../config";
import { spriteAnims, spriteLoops, SPRITE_CELLS } from "./sprite";

/**
 * Everything a generated fighter module may use. The module is a plain ES module with no imports:
 * `export default function make(api) { ... return fighterDef }`. Keeping the surface explicit is
 * what lets the same source run in the browser, in the forge's headless checks and in vitest.
 */
export const generatedApi = Object.freeze({
  hb, cap, key, mv, throwMove,
  setAction, startMove, releaseGrab, throwVictim, spawnProjectile, knockback,
  approach, clamp, lerp, sign, sinDeg, cosDeg, atan2Deg,
  B, STICK_DEAD, STICK_RUN, STICK_WALK, C,
  spriteAnims, spriteLoops, SPRITE_CELLS,
});
export type GeneratedApi = typeof generatedApi;
