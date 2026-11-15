import { beforeAll, describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { defOf } from "../shared/fighter";
import { B, EMPTY_INPUT, STICK_RUN, STICK_WALK, type InputFrame } from "../shared/input";
import { C } from "../shared/config";
import type { State } from "../shared/types";
import { TouchPad, touchLayout, type TouchButton } from "../client/src/input/touchpad";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);

// a phone held sideways: the 1920x1080 view at about a third of a CSS pixel per view pixel
const layout = touchLayout(1920, 1080, 0.36, 1);
const R = layout.stick.r;
const HOME = { x: 320, y: 760 };
const THUMB = 1, LEFT_THUMB = 2, FINGER = 3;

/** A phone in one hand and a match: fingers move between ticks, every tick feeds the pad's frame to the sim. */
class Phone {
  pad = new TouchPad(layout);
  state: State = createMatch({ stage: "proving", players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 5 });
  frames: InputFrame[] = [];
  get f() { return this.state.fighters[0]; }
  tick(n = 1): this {
    for (let i = 0; i < n; i++) {
      const input = this.pad.frame();
      this.frames.push(input);
      step(this.state, [input, EMPTY_INPUT]);
    }
    return this;
  }
  /** The stick thumb down at HOME, then pushed (dx, dy) of a full push over `ticks` ticks (0: before the next tick). */
  push(dx: number, dy: number, ticks = 0): this {
    if (!this.thumbDown) { this.pad.down(LEFT_THUMB, HOME.x, HOME.y); this.thumbDown = true; }
    const from = { ...this.at };
    const steps = Math.max(1, ticks);
    for (let i = 1; i <= steps; i++) {
      this.at = { x: from.x + ((dx - from.x) * i) / steps, y: from.y + ((dy - from.y) * i) / steps };
      this.pad.move(LEFT_THUMB, HOME.x + this.at.x * R, HOME.y + this.at.y * R);
      if (ticks) this.tick();
    }
    return this;
  }
  letGo(): this { this.pad.up(LEFT_THUMB); this.thumbDown = false; this.at = { x: 0, y: 0 }; return this; }
  press(button: TouchButton, id = THUMB): this {
    const c = layout.buttons[button];
    this.pad.down(id, c.x, c.y);
    return this;
  }
  lift(id = THUMB): this { this.pad.up(id); return this; }
  private thumbDown = false;
  private at = { x: 0, y: 0 };
}

/** Steps the phone until `pred` holds, at most `max` ticks. */
function until(p: Phone, pred: () => boolean, max = 40): void {
  for (let i = 0; i < max && !pred(); i++) p.tick();
}

describe("touch stick", () => {
  it("reads the thumb's offset from where it landed, as a stick", () => {
    const p = new Phone();
    p.pad.down(LEFT_THUMB, 500, 700);
    expect(p.pad.frame()).toMatchObject({ x: 0, y: 0 });
    p.pad.move(LEFT_THUMB, 500 + R * 0.5, 700);
    expect(p.pad.frame().x).toBe(50);
    p.pad.move(LEFT_THUMB, 500, 700 - R);
    expect(p.pad.frame()).toMatchObject({ x: 0, y: -100 });
    // past the rim the stick comes along, so turning around is one full push
    p.pad.move(LEFT_THUMB, 500 + R * 3, 700);
    expect(p.pad.frame()).toMatchObject({ x: 100, y: 0 });
    // turning around is a flick: one frame at rest, then the push
    p.pad.move(LEFT_THUMB, 500 + R, 700);
    expect(p.pad.frame()).toMatchObject({ x: 0, y: 0 });
    expect(p.pad.frame()).toMatchObject({ x: -100, y: 0 });
    p.pad.up(LEFT_THUMB);
    expect(p.pad.frame()).toMatchObject({ x: 0, y: 0 });
  });

  it("is a second thumb on the left only when the first has let go", () => {
    const p = new Phone();
    expect(p.pad.down(LEFT_THUMB, 300, 700)).toBe(true);
    expect(p.pad.down(LEFT_THUMB + 10, 600, 700)).toBe(false);
  });

  it("a slow push walks, then runs without a flick", () => {
    const p = new Phone().push(0.4, 0, 6);
    expect(p.f.action).toBe("walk");
    p.push(1, 0, 15);
    const xs = p.frames.map((f) => f.x);
    // the values climb: nothing went back to rest on the way
    expect(xs.every((x, i) => i === 0 || x >= xs[i - 1])).toBe(true);
  });

  it("a fast push is a flick the sim sees: rest, then full, on consecutive frames", () => {
    for (const ticks of [0, 2, 4]) {
      const p = new Phone().tick().push(1, 0, ticks).tick();
      const i = p.frames.findIndex((f) => f.x >= STICK_RUN);
      expect(i).toBeGreaterThan(0);
      expect(Math.abs(p.frames[i - 1].x)).toBeLessThan(STICK_WALK + 15);
    }
  });

  it("a flick from a walk dashes", () => {
    const p = new Phone().push(0.35, 0, 4).tick(4);
    expect(p.f.action).toBe("walk");
    p.push(1, 0, 3).tick(2);
    expect(p.f.action).toBe("dash");
  });

  it("holding the stick down in the air fast falls", () => {
    const p = new Phone().press("jump").tick(8).lift();
    until(p, () => p.f.vy >= 0);
    p.push(0, 1, 2).tick(2);
    expect(p.f.fastFalling).toBe(true);
  });
});

describe("touch attacks", () => {
  it("a light push and a tap of ATTACK is the tilt, in each direction", () => {
    for (const [dx, dy, tilt] of [[0.5, 0, "ftilt"], [0, -0.55, "utilt"], [0, 0.55, "dtilt"]] as const) {
      const p = new Phone().push(dx, dy, 8).tick(2);
      p.press("attack").tick(3).lift().tick(2);
      expect(p.f.move).toBe(tilt);
      expect(p.f.action).toBe("attack");
    }
  });

  it("neutral ATTACK is the jab", () => {
    const p = new Phone().press("attack").tick(2);
    expect(p.f.move).toBe("jab1");
  });

  it("holding ATTACK with a direction is the smash, charging while held", () => {
    const p = new Phone().push(0.5, 0, 8).tick(2);
    p.press("attack").tick(C.SMASH_HOLD + 2);
    expect(p.f.action).toBe("smashCharge");
    expect(p.f.move).toBe("fsmash");
    p.lift().tick(2);
    expect(p.f.action).toBe("attack");
    expect(p.f.move).toBe("fsmash");
  });

  it("a flick and ATTACK smash at once, in every direction, even with ATTACK a few ticks late", () => {
    for (const [dx, dy, smash] of [[1, 0, "fsmash"], [-1, 0, "fsmash"], [0, -1, "usmash"], [0, 1, "dsmash"]] as const) {
      for (const late of [0, 2, 4]) {
        const p = new Phone().tick().push(dx, dy, 2);
        p.tick(late).press("attack").tick();
        expect(`${smash} late ${late}: ${p.f.action} ${p.f.move}`).toBe(`${smash} late ${late}: smashCharge ${smash}`);
        if (dx) expect(p.f.facing).toBe(dx);
      }
    }
  });

  it("a flick sideways and ATTACK well after it is the dash attack", () => {
    const p = new Phone().tick().push(1, 0, 2).tick(9).press("attack").tick();
    expect(p.f.move).toBe("dashAttack");
  });

  it("SPECIAL with a direction picks the special", () => {
    for (const [dx, dy, special] of [[0, 0, "nspecial"], [0.8, 0, "sspecial"], [0, -0.8, "uspecial"], [0, 0.8, "dspecial"]] as const) {
      const p = new Phone();
      if (dx || dy) p.push(dx, dy, 8);
      p.tick().press("special").tick(2);
      expect(p.f.move).toBe(special);
    }
  });

  it("in the air, ATTACK with a direction is that aerial", () => {
    for (const [dx, dy, aerial] of [[0, 0, "nair"], [0.8, 0, "fair"], [-0.8, 0, "bair"], [0, -0.8, "uair"], [0, 0.8, "dair"]] as const) {
      const p = new Phone().press("jump").tick(6).lift();
      if (dx || dy) p.push(dx, dy, 8);
      p.press("attack").tick(2);
      expect(p.f.move).toBe(aerial);
    }
  });
});

describe("touch jumps and defence", () => {
  const rise = (p: Phone) => { until(p, () => p.f.action === "air"); return -p.f.vy; };

  it("JUMP held is a full hop, JUMP with ATTACK a short hop with the attack in the air", () => {
    const stats = defOf(new Phone().f).stats;
    const full = new Phone().press("jump");
    expect(rise(full)).toBeCloseTo(stats.fullHop);
    for (const late of [0, 1, 2]) {
      const short = new Phone().press("jump", FINGER).tick(late).press("attack", THUMB);
      expect(rise(short)).toBeCloseTo(stats.shortHop);
      short.tick(2);
      expect(short.f.move).toBe("nair");
    }
  });

  it("JUMP again in the air is the double jump", () => {
    const p = new Phone().press("jump").tick(10).lift().tick();
    const left = p.f.jumpsLeft;
    p.press("jump").tick(2);
    expect(p.f.jumpsLeft).toBe(left - 1);
  });

  it("SHIELD holds the shield; a flick sideways rolls, a flick down spot-dodges, a slow push does neither", () => {
    const roll = new Phone().press("shield").tick(4);
    expect(roll.f.action).toBe("shield");
    roll.push(-1, 0, 2).tick();
    expect(roll.f.action).toBe("roll");
    expect(roll.f.facing).toBe(-1);
    const dodge = new Phone().press("shield").tick(4).push(0, 1, 2).tick();
    expect(dodge.f.action).toBe("spotDodge");
    const slow = new Phone().press("shield").tick(4).push(0.9, 0, 15).tick();
    expect(slow.f.action).toBe("shield");
  });

  it("SHIELD in the air is the air dodge", () => {
    const p = new Phone().press("jump", FINGER).tick(8).lift(FINGER).press("shield").tick(2);
    expect(p.f.action).toBe("airDodge");
  });
});

describe("touch fingers", () => {
  it("holds the stick and two buttons at once", () => {
    const p = new Phone().push(0.5, 0);
    p.press("attack", THUMB).press("special", FINGER);
    const f = p.pad.frame();
    expect(f.x).toBe(50);
    expect(f.b & (B.ATTACK | B.SPECIAL)).toBe(B.ATTACK | B.SPECIAL);
    expect(f.b & B.DIGITAL).toBe(B.DIGITAL);
    p.lift(THUMB);
    expect(p.pad.frame().b & (B.ATTACK | B.SPECIAL)).toBe(B.SPECIAL);
  });

  it("a thumb rolls from one button onto the next, and off them all", () => {
    const p = new Phone().press("attack");
    expect(p.pad.frame().b & B.ATTACK).toBe(B.ATTACK);
    const j = layout.buttons.jump;
    p.pad.move(THUMB, j.x, j.y);
    const f = p.pad.frame();
    expect(f.b & (B.ATTACK | B.JUMP)).toBe(B.JUMP);
    p.pad.move(THUMB, 1100, 200);
    expect(p.pad.frame().b & (B.ATTACK | B.JUMP | B.SPECIAL | B.SHIELD)).toBe(0);
  });

  it("a tap shorter than a tick still presses once", () => {
    const p = new Phone().press("attack").lift();
    expect(p.pad.frame().b & B.ATTACK).toBe(B.ATTACK);
    expect(p.pad.frame().b & B.ATTACK).toBe(0);
  });

  it("has a pause button only where the match can pause", () => {
    const p = new Phone();
    expect(p.pad.down(FINGER, layout.pause.x, layout.pause.y)).toBe(true);
    expect(p.pad.frame().b & B.PAUSE).toBe(0);
    p.pad.up(FINGER);
    p.pad.pauseable = true;
    p.pad.down(FINGER, layout.pause.x, layout.pause.y);
    expect(p.pad.frame().b & B.PAUSE).toBe(B.PAUSE);
  });

  it("forgets every finger when the controls go away", () => {
    const p = new Phone().push(1, 0).press("shield");
    p.pad.clear();
    expect(p.pad.frame()).toEqual({ x: 0, y: 0, cx: 0, cy: 0, b: B.DIGITAL });
    p.pad.move(LEFT_THUMB, 900, 700);
    p.pad.up(THUMB);
    expect(p.pad.frame()).toEqual({ x: 0, y: 0, cx: 0, cy: 0, b: B.DIGITAL });
  });
});

describe("touch layout", () => {
  it("keeps the buttons apart and on screen, and leaves the HUD the middle", () => {
    for (const [scale, size] of [[0.36, 1], [0.36, 1.5], [0.53, 0.6], [1, 1]] as const) {
      const l = touchLayout(1920, 1080, scale, size);
      const all = Object.values(l.buttons);
      for (const a of all) {
        expect(a.x + a.r).toBeLessThanOrEqual(1920);
        expect(a.y + a.r).toBeLessThanOrEqual(1080);
        for (const b of all) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
      }
      expect(l.stick.x - l.stick.r).toBeGreaterThan(0);
      expect(l.free.right - l.free.left).toBeGreaterThan(size > 1 ? 300 : 600);
      expect(l.free.left).toBeGreaterThan(l.stick.x + l.stick.r);
    }
  });
});
