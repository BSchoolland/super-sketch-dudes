import type { Fighter, FighterDef, PoseKey } from "../types";
import { key } from "../fighters/helpers";

/** The nine cells every drawn fighter's sheet has, in sheet order (3 columns x 3 rows). */
export const SPRITE_CELLS = ["idle", "walk", "jump", "atk-fwd", "atk-up", "atk-down", "hit", "launched", "block"] as const;
export type SpriteCell = (typeof SPRITE_CELLS)[number];

/** Which cell each non-move animation shows unless the fighter's sprite.anims says otherwise. */
export const STATE_CELLS: Record<string, SpriteCell> = {
  idle: "idle", walk: "walk", run: "walk", dash: "walk", skid: "idle", crouch: "block", jumpSquat: "idle",
  jump: "jump", fall: "jump", land: "idle", helpless: "launched", shield: "block", hitstun: "hit", tumble: "launched",
  knockdown: "launched", ledgeHang: "jump", grabHold: "atk-fwd", grabbed: "hit", dead: "idle", taunt: "idle",
  respawn: "idle", spotDodge: "block", roll: "launched", airDodge: "jump",
};

/** Which cell a move shows when it doesn't name one. Unknown (fighter-specific) moves use atk-fwd. */
export function defaultCellForMove(id: string): SpriteCell {
  if (/^(utilt|usmash|uair|uthrow|uspecial)$/.test(id)) return "atk-up";
  if (/^(dtilt|dsmash|dair|dthrow|dspecial)$/.test(id)) return "atk-down";
  if (id === "taunt") return "idle";
  return "atk-fwd";
}

export function cellForAnim(def: FighterDef, anim: string): SpriteCell {
  const named = def.sprite?.anims[anim] as SpriteCell | undefined;
  return named ?? STATE_CELLS[anim] ?? "idle";
}

/** The cell and mirroring a sprite fighter shows for its current sim state, given the animation name the renderer picked. */
export function cellFor(f: Fighter, def: FighterDef, anim: string): { cell: SpriteCell; flip: boolean } {
  if (f.action === "attack" || f.action === "smashCharge") {
    const mv = f.move ? def.moves[f.move] : null;
    if (mv) return { cell: (mv.cell as SpriteCell) ?? defaultCellForMove(mv.id), flip: !!mv.cellFlip };
  }
  return { cell: cellForAnim(def, anim), flip: false };
}

const P = (extra: { dx?: number; dy?: number; sx?: number; sy?: number; rot?: number }) => ({ a: {}, ...extra });

/**
 * Default pose tracks for a sprite fighter's non-move states: the sheet gives one drawing per
 * state, these add the squash, stretch and lean that make it read as moving. Fighters can
 * override any entry.
 */
export function spriteAnims(): Record<string, PoseKey[]> {
  return {
    idle: [key(0, P({})), key(30, P({ sy: 0.97, dy: 0 })), key(60, P({}))],
    walk: [key(0, P({ rot: 4, dy: 0 })), key(8, P({ rot: 4, dy: -4, sy: 1.03 })), key(16, P({ rot: 4, dy: 0 }))],
    run: [key(0, P({ rot: 10, dy: 0, sx: 1.04 })), key(5, P({ rot: 10, dy: -6, sy: 1.05, sx: 0.98 })), key(10, P({ rot: 10, dy: 0, sx: 1.04 }))],
    dash: [key(0, P({ rot: 14, sx: 1.1, sy: 0.9 })), key(8, P({ rot: 10, sx: 1, sy: 1 }))],
    skid: [key(0, P({ rot: -10, sx: 1.05, sy: 0.95 }))],
    crouch: [key(0, P({ sy: 0.72, sx: 1.15 }))],
    jumpSquat: [key(0, P({ sy: 0.82, sx: 1.14 }))],
    jump: [key(0, P({ sy: 1.14, sx: 0.9 })), key(12, P({ sy: 1, sx: 1 }))],
    fall: [key(0, P({ sy: 1.04, sx: 0.98 }))],
    land: [key(0, P({ sy: 0.8, sx: 1.18 })), key(6, P({}))],
    helpless: [key(0, P({ rot: -15 })), key(20, P({ rot: 15 })), key(40, P({ rot: -15 }))],
    shield: [key(0, P({ sy: 0.94, sx: 1.04 }))],
    hitstun: [key(0, P({ rot: -18, sx: 1.08, sy: 0.94 }))],
    tumble: [key(0, P({ rot: -30 })), key(12, P({ rot: -150 })), key(24, P({ rot: -270 })), key(36, P({ rot: -390 }))],
    knockdown: [key(0, P({ rot: -80, dy: 20 }))],
    ledgeHang: [key(0, P({ rot: -10, dy: 20 }))],
    grabHold: [key(0, P({ rot: 6 }))],
    grabbed: [key(0, P({ rot: -12, sx: 0.94 }))],
    dead: [key(0, P({}))],
    taunt: [key(0, P({})), key(15, P({ rot: -12, sy: 1.08 })), key(30, P({ rot: 12, sy: 1.08 })), key(45, P({}))],
    respawn: [key(0, P({}))],
    spotDodge: [key(0, P({ sy: 0.7, sx: 1.1 }))],
    roll: [key(0, P({ rot: 40 })), key(16, P({ rot: 400 })), key(32, P({ rot: 720 }))],
    airDodge: [key(0, P({ sx: 0.85, sy: 0.85 })), key(30, P({}))],
  };
}
export const spriteLoops: Record<string, number> = { idle: 60, walk: 16, run: 10, helpless: 40 };
