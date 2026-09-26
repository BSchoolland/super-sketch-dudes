import type { InputFrame } from "./input";

export type FighterId = string;
export type StageId = string;

export interface Stats {
  weight: number;
  walk: number;
  run: number;
  dashInit: number;
  airSpeed: number;
  airAccel: number;
  fallSpeed: number;
  fastFall: number;
  gravity: number;
  shortHop: number;
  fullHop: number;
  doubleJump: number;
  jumps: number;
  wallJump: boolean;
  traction: number;
  height: number;
  width: number;
  crouchHeight: number;
  /** Frames of landing lag when landing from a plain jump. */
  landLag: number;
  /** Ledge grab box reach above the hands, in units. */
  ledgeReach: number;
}

export type MoveId =
  | "jab1" | "jab2" | "jab3" | "jabRapid" | "jabFinish"
  | "ftilt" | "utilt" | "dtilt" | "dashAttack"
  | "fsmash" | "usmash" | "dsmash"
  | "nair" | "fair" | "bair" | "uair" | "dair"
  | "grab" | "dashGrab" | "pummel" | "fthrow" | "bthrow" | "uthrow" | "dthrow"
  | "nspecial" | "sspecial" | "uspecial" | "dspecial"
  | "ledgeAttack" | "getupAttack" | "taunt"
  | (string & {});

export interface Hitbox {
  /** Inclusive frame range (1-based move frames) the hitbox is live. */
  frames: [number, number];
  /** Centre in fighter space: +x is facing direction, +y is down, origin at the feet. */
  x: number;
  y: number;
  r: number;
  /** Optional second point for a capsule. */
  x2?: number;
  y2?: number;
  damage: number;
  /** Launch angle in degrees, 0 = away from attacker, 90 = up, 270 = down (spike). */
  angle: number;
  base: number;
  growth: number;
  /** Hits share a group hit each victim once per move instance. Default 0. */
  group?: number;
  /** Frames between rehits for the same group (lingering multi-hit). */
  rehit?: number;
  hitlagMul?: number;
  /** Priority among overlapping hitboxes of one move: lower wins. Tippers use 0, sours 1. */
  priority?: number;
  spike?: boolean;
  electric?: boolean;
  grab?: boolean;
  /** Ignores shields (command grabs). */
  unblockable?: boolean;
  /** Knockback direction ignores attacker facing and always launches away from the attacker's centre. */
  radial?: boolean;
  /** Renderer family ("hit" | "slash" | "heavy" | "tip" | "fire" | "energy") or the name of one of the def's `looks`. */
  fx?: string;
  /** Windbox: pushes without damage or hitstun. */
  wind?: boolean;
}

export interface Pose {
  /** Offset in fighter space. */
  dx?: number;
  dy?: number;
  /** Squash and stretch scale. */
  sx?: number;
  sy?: number;
  /** Lean in degrees, positive tips the top toward the facing direction. */
  rot?: number;
}
export interface PoseKey {
  frame: number;
  pose: Pose;
  /** Snap instead of tween into this key. */
  snap?: boolean;
}

export interface Move {
  id: MoveId;
  total: number;
  landingLag?: number;
  hitboxes: Hitbox[];
  poses: PoseKey[];
  /** Frame from which any action may interrupt (IASA). Default total + 1. */
  iasa?: number;
  /** Frames during which the fighter is intangible. */
  invuln?: [number, number];
  /** Armour threshold (damage under which the fighter doesn't flinch) and the frames it applies. */
  armour?: { frames: [number, number]; threshold: number };
  /** Aerial moves are performed in the air; landing during them incurs landingLag. */
  aerial?: boolean;
  /** Smash attacks can be charged before this move starts. */
  smash?: boolean;
  /** Frame on which a throw releases the victim. */
  throwFrame?: number;
  /** Momentum applied on given frames: [frame, vx, vy] in fighter space. */
  motion?: [number, number, number][];
  /** Freeze vertical motion (no gravity) for these frames. */
  hover?: [number, number];
  /** Move continues with the fighter's own facing; false = can't turn on start. */
  canTurn?: boolean;
  /** Fighter can grab ledges while this move plays. */
  ledgeOk?: boolean;
  /** After the move, the fighter is helpless in the air. */
  helpless?: boolean;
  /** Fighter-specific hook name, run each frame of the move. */
  hook?: string;
  /** Sprite fighters: cell changes over the move as [fromFrame, cell] pairs, e.g. a transformation strip. */
  cells?: [number, string][];
  /** Renderer effect tag for the move (trail, flame, etc). */
  fx?: string;
  /** Voice/sound tag. */
  sfx?: string;
  /** Counter window: being hit during these frames cancels the hit and starts `move`. */
  counter?: { frames: [number, number]; move: string; mul: number; min: number };
  /** This move's hitboxes deal max(hitbox damage, fighter.counterDmg). */
  counterStrike?: boolean;
  /** Active hitboxes reflect projectiles. */
  reflect?: boolean;
  /** Fighter can't grab ledges; default for aerial specials is true. */
  /** The move is a grab (attack becomes grabHold on connect). */
  isGrab?: boolean;
  /** Pressing attack from `nextFrom` on chains into this move (jab combos). */
  next?: string;
  nextFrom?: number;
  /** Sprite fighters: which sheet cell this move shows (default by move id, see gen/sprite.ts). */
  cell?: string;
  /** Sprite fighters: mirror the cell (a back-air drawn from the forward-attack cell). */
  cellFlip?: boolean;
}

/** Pose tracks (squash, stretch, lean, offset of the whole cell) for the sprite's non-move states. */
export interface Rig {
  /** Named animations for non-move states: idle, walk, run, jumpsquat, jump, fall, land, crouch, shield, hitstun, tumble, ledge, helpless, dead. */
  anims: Record<string, PoseKey[]>;
  /** Animation loop lengths in frames for cyclic anims (walk, run, idle). */
  loops: Record<string, number>;
}
/** The character's marker colours. Nothing draws with them any more; the screens' bone branch still reads them. */
export interface Palette {
  colors: Record<string, string>;
  outline: string;
}

/**
 * A fighter drawn from a sheet of hand-drawn cells. Every cell is a
 * square PNG of `px` pixels with the character facing right, horizontally centred, feet on
 * the row `feetPx` from the top, and drawn so the idle cell's content is `heightPx` tall.
 * The renderer maps `heightPx` onto `stats.height`, so all cells share one world scale.
 */
export interface SpriteRig {
  /** Cell name -> image URL (or data URL). Names are the SPRITE_CELLS in gen/sprite.ts. */
  cells: Record<string, string>;
  /** Animation name -> cell name; anything missing falls back to the defaults in gen/sprite.ts. */
  anims: Record<string, string>;
  px: number;
  feetPx: number;
  heightPx: number;
}

/**
 * A form is an overlay on the fighter's def: stats, moves, sprite anims and pose tracks that replace
 * the base ones while `FighterDef.form(f)` names it (a car mode, a powered-up stance). Everything
 * else (hooks, hitbox helpers, cells) is shared.
 */
export interface FighterForm {
  stats?: Partial<Stats>;
  moves?: Record<string, Move>;
  /** Animation name -> sprite cell, over the base sprite.anims. */
  anims?: Record<string, string>;
  /** Pose tracks over rig.anims, and their loop lengths. */
  poses?: Record<string, PoseKey[]>;
  loops?: Record<string, number>;
}

export const LOOK_SHAPES = ["ball", "bolt", "ring", "blob", "star", "shard", "cloud", "puddle", "slash", "bar"] as const;
export const LOOK_TEXTURES = ["solid", "hatch", "dots", "scribble", "flame", "glow"] as const;
export const LOOK_TRAILS = ["none", "ghost", "streak", "smoke", "sparks"] as const;
export const HIT_FAMILIES = ["hit", "slash", "heavy", "tip", "fire", "energy"] as const;

/**
 * How a projectile, strike or area attack is drawn. Purely visual: the sim never reads it.
 * Either a piece of the drawing (`cell` + optional `crop`) or a shape, with colours and a texture.
 * Named in `FighterDef.looks`; a projectile uses the look named by its `kind`, a hitbox the one named by its `fx`.
 */
export interface Look {
  /** Sheet cell to draw (e.g. "atk-fwd"); with `crop` = [x, y, w, h] in cell pixels to draw just the sword, the fist, the hat. */
  cell?: string;
  crop?: [number, number, number, number];
  /** Drawn instead of a cell. Default "ball". */
  shape?: (typeof LOOK_SHAPES)[number];
  /** Any CSS colour: fill (shape) or tint of the hit sparks. Outline defaults to ink. */
  color?: string;
  ink?: string;
  /** Surface treatment. Default "solid". */
  texture?: (typeof LOOK_TEXTURES)[number];
  /** Long side in world units. Default: the hitbox size (projectile radius / capsule length), or the crop's natural size for cells. */
  size?: number;
  /** Degrees per frame of rotation (a thrown sword spins at about 20). */
  spin?: number;
  /** Rotate to face the direction of travel (projectiles) or along the capsule (strikes). Default true for shapes, false for cells. */
  aim?: boolean;
  /** Motion trail for projectiles. Default "none" for cells, "streak" for shapes. */
  trail?: (typeof LOOK_TRAILS)[number];
  /** Mirror the cell horizontally (a bair crop that should face the other way). */
  flip?: boolean;
}

export interface FighterDef {
  id: FighterId;
  name: string;
  tagline: string;
  stats: Stats;
  moves: Record<string, Move>;
  rig: Rig;
  palette: Palette;
  sprite: SpriteRig;
  /** Player-generated fighters carry who drew them and the description the agent worked from. */
  generated?: { player: string; description: string };
  /** Initial value of fighter.special (must be a plain object). */
  special: () => Record<string, number>;
  /** Alternate forms, and which one the fighter is in (null/undefined = base). Read every frame; keep it a pure function of the fighter. */
  forms?: Record<string, FighterForm>;
  form?: (f: Fighter) => string | null | undefined;
  /** Named hooks referenced from moves. Run each frame of the move; may mutate the fighter and state. */
  hooks: Record<string, (ctx: HookCtx) => void>;
  /** Called when this fighter lands a hit. */
  onHit?: (ctx: HookCtx, victim: Fighter, hb: Hitbox) => void;
  onHurt?: (ctx: HookCtx, attacker: Fighter | null, damage: number) => void;
  onFrame?: (ctx: HookCtx) => void;
  /** HUD meters: label + value getter, 0..1. */
  meters?: { label: string; color: string; get: (f: Fighter) => number; max?: (f: Fighter) => number }[];
  /** Renderer-only per-frame look: overall scale and glow strength 0..1 (e.g. a heat meter). */
  visual?: (f: Fighter) => { scale?: number; glow?: number };
  /** Named looks for projectiles (by `kind`) and hitboxes (by `fx`). See Look. */
  looks?: Record<string, Look>;
}

export interface HookCtx {
  state: State;
  f: Fighter;
  input: InputFrame;
  prev: InputFrame;
}

export interface Platform {
  x1: number;
  x2: number;
  y: number;
  /** Solid main stage: has walls and a bottom. */
  solid?: boolean;
  bottom?: number;
  /** Moving platforms report their own offset per frame; static ones omit it. */
  motion?: { kind: "orbit"; cx: number; cy: number; rx: number; ry: number; period: number; phase: number };
  /** Drawn by the screen that owns the stage (the title screen's menu cards), not the stage renderer. */
  hidden?: boolean;
}
export interface Ledge {
  x: number;
  y: number;
  /** -1: ledge on the left side of the stage (fighter hangs on the left, facing right). */
  side: 1 | -1;
  platform: number;
}
export interface Stage {
  id: StageId;
  name: string;
  platforms: Platform[];
  ledges: Ledge[];
  blast: { left: number; right: number; top: number; bottom: number };
  camera: { left: number; right: number; top: number; bottom: number; minWidth: number };
  spawns: { x: number; y: number; facing: 1 | -1 }[];
  respawn: { x: number; y: number };
  /** Renderer theme key. */
  theme: string;
}

export type Action =
  | "idle" | "walk" | "dash" | "run" | "runTurn" | "skid" | "crouch" | "crouchStart"
  | "jumpSquat" | "air" | "land" | "helpless"
  | "attack" | "smashCharge"
  | "shield" | "shieldStun" | "shieldBreak" | "parry" | "spotDodge" | "roll" | "airDodge"
  | "hitstun" | "tumble" | "knockdown" | "getup" | "getupRoll" | "tech" | "techRoll" | "wallTech"
  | "ledgeGrab" | "ledgeHang" | "ledgeClimb" | "ledgeRoll" | "ledgeJump" | "ledgeAttack" | "ledgeDrop"
  | "grabHold" | "grabbed" | "thrown"
  | "respawn" | "dead" | "taunt" | "shieldDrop";

export interface PendingKb {
  vx: number;
  vy: number;
  angle: number;
  kb: number;
  hitstun: number;
  attacker: number;
}

export interface Fighter {
  slot: number;
  id: FighterId;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  platform: number;
  action: Action;
  frame: number;
  move: string | null;
  moveInstance: number;
  moveFacing: 1 | -1;
  percent: number;
  stocks: number;
  jumpsLeft: number;
  fastFalling: boolean;
  airDodged: boolean;
  usedUpSpecial: boolean;
  hitlag: number;
  hitstun: number;
  pending: PendingKb | null;
  shield: number;
  shieldHeld: boolean;
  invuln: number;
  ledge: number;
  ledgeCooldown: number;
  ledgeTime: number;
  hitLog: Record<string, number>;
  hitsThisMove: number;
  grabbing: number;
  grabbedBy: number;
  grabTimer: number;
  mash: number;
  respawnTimer: number;
  charge: number;
  chargeMax: number;
  wallJumped: boolean;
  techWindow: number;
  lastHitBy: number;
  lastHitFrame: number;
  special: Record<string, number>;
  cpu: number;
  kos: number;
  falls: number;
  dealt: number;
  /** Frames since the last input edge, for the renderer's idle timers. */
  idleFrames: number;
  /** Buffered button presses and their age in frames. */
  buf: number;
  bufAge: number;
  /** Stick flick memory: direction and frames since the flick. */
  flickX: number;
  flickY: number;
  flickT: number;
  /** Frames the shield has been up (parry window). */
  shieldFrames: number;
  /** Damage multiplier from a smash charge, fixed when the attack starts. */
  chargeMul: number;
  /** Damage a counter will deal when its strike lands. */
  counterDmg: number;
  /** Frames left of dropping through soft platforms. */
  dropTimer: number;
  /** Deterministic per-fighter RNG for the CPU. */
  cpuSeed: number;
  /** Last damage taken, for the HUD shake. */
  lastDamage: number;
  tauntCooldown: number;
  landed: boolean;
}

export interface Projectile {
  id: number;
  owner: number;
  /** Slot that spawned it; the renderer takes the look from that fighter's def (owner changes on reflect). */
  from: number;
  /** Also names the projectile's look in the spawner's `looks`. */
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  hb: Hitbox;
  hitLog: Record<string, number>;
  facing: 1 | -1;
  data: Record<string, number>;
  reflected: number;
  dead: boolean;
}

export interface Rules {
  stocks: number;
  /** Time limit in frames, 0 = none. */
  time: number;
  /** Team battle. */
  teams: boolean;
  /** Damage ratio. */
  damageRatio: number;
}

export type GameEvent =
  | { t: "hit"; frame: number; attacker: number; victim: number; damage: number; kb: number; x: number; y: number; fx: string; angle: number; facing: number }
  | { t: "shieldHit"; frame: number; victim: number; x: number; y: number; damage: number }
  | { t: "parry"; frame: number; slot: number; x: number; y: number }
  | { t: "ko"; frame: number; slot: number; x: number; y: number; side: "left" | "right" | "top" | "bottom"; by: number }
  | { t: "land"; frame: number; slot: number; x: number; y: number; hard: boolean }
  | { t: "jump"; frame: number; slot: number; x: number; y: number; double: boolean }
  | { t: "dash"; frame: number; slot: number; x: number; y: number; facing: number }
  | { t: "tech"; frame: number; slot: number; x: number; y: number }
  | { t: "shieldBreak"; frame: number; slot: number; x: number; y: number }
  | { t: "ledge"; frame: number; slot: number; x: number; y: number }
  | { t: "grab"; frame: number; attacker: number; victim: number; x: number; y: number }
  | { t: "throw"; frame: number; attacker: number; victim: number; x: number; y: number }
  | { t: "move"; frame: number; slot: number; move: string; x: number; y: number }
  | { t: "respawn"; frame: number; slot: number; x: number; y: number }
  | { t: "projectile"; frame: number; slot: number; kind: string; x: number; y: number }
  | { t: "sfx"; frame: number; slot: number; name: string; x: number; y: number }
  | { t: "hookError"; frame: number; slot: number; move: string; error: string }
  | { t: "end"; frame: number; winner: number }
  | { t: "suddenDeath"; frame: number };

export interface State {
  frame: number;
  rng: number;
  seed: number;
  rules: Rules;
  stage: StageId;
  fighters: Fighter[];
  projectiles: Projectile[];
  nextProjectile: number;
  events: GameEvent[];
  timer: number;
  ended: boolean;
  winner: number;
  suddenDeath: boolean;
  /** Frames of global slow motion left (KO). */
  slowmo: number;
  paused: boolean;
  /** Platform offsets for moving platforms, indexed by platform. */
  platOffsets: { dx: number; dy: number }[];
  /** Previous frame's inputs, for edge detection. */
  inputs: InputFrame[];
}
