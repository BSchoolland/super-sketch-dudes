import { describe, expect, it } from "vitest";
import { KB1_DEFAULT, kb1OverridesOf, rebind } from "../client/src/input/bindings";

describe("rebinding keyboard 1", () => {
  it("a free key replaces the one picked and leaves the action's other keys", () => {
    const b = rebind(KB1_DEFAULT, "special", "KeyE", "KeyQ");
    expect(b.special).toEqual(["KeyQ", "Mouse2"]);
    expect(kb1OverridesOf(b)).toEqual({ special: ["KeyQ", "Mouse2"] });
  });

  it("a key taken from an action with others to spare just comes off it", () => {
    const b = rebind(KB1_DEFAULT, "jump", "Space", "KeyE");
    expect(b.jump).toEqual(["KeyE"]);
    expect(b.special).toEqual(["Mouse2"]);
  });

  it("a key taken from an action's only key swaps the two", () => {
    const b = rebind(KB1_DEFAULT, "attack", "Mouse0", "Space");
    expect(b.attack).toEqual(["Space"]);
    expect(b.jump).toEqual(["Mouse0"]);
  });

  it("an action with no key gets one", () => {
    const b = rebind({ ...KB1_DEFAULT, taunt: [] }, "taunt", null, "KeyG");
    expect(b.taunt).toEqual(["KeyG"]);
  });

  it("the defaults have nothing to save", () => {
    expect(kb1OverridesOf(rebind(KB1_DEFAULT, "jump", "Space", "Space"))).toEqual({});
  });
});
