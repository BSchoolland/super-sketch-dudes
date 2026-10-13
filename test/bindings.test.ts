import { describe, expect, it } from "vitest";
import { KB1_DEFAULT, KB2_DEFAULT, overridesOf, rebind, release } from "../client/src/input/bindings";

describe("rebinding keyboard 1", () => {
  it("a free key replaces the one picked and leaves the action's other keys", () => {
    const b = rebind(KB1_DEFAULT, "special", "KeyE", "KeyQ");
    expect(b.special).toEqual(["KeyQ", "Mouse2"]);
    expect(overridesOf("kb1", b)).toEqual({ special: ["KeyQ", "Mouse2"] });
  });

  it("a key taken from an action with others to spare just comes off it", () => {
    const b = rebind(KB1_DEFAULT, "jump", "Space", "KeyE");
    expect(b.jump).toEqual(["KeyE"]);
    expect(b.special).toEqual(["Mouse2"]);
  });

  it("a key taken from an action's only key swaps the two", () => {
    const b = rebind(KB1_DEFAULT, "attack", "Mouse0", "Space");
    expect(b.attack).toEqual(["Space", "KeyF"]);
    expect(b.jump).toEqual(["Mouse0"]);
  });

  it("an action with no key gets one", () => {
    const b = rebind({ ...KB1_DEFAULT, taunt: [] }, "taunt", null, "KeyG");
    expect(b.taunt).toEqual(["KeyG"]);
  });

  it("the defaults have nothing to save", () => {
    expect(overridesOf("kb1", rebind(KB1_DEFAULT, "jump", "Space", "Space"))).toEqual({});
  });
});

describe("two keyboard players", () => {
  it("each keyboard keeps its own overrides against its own defaults", () => {
    const b = rebind(KB2_DEFAULT, "jump", "Slash", "KeyM");
    expect(overridesOf("kb2", b)).toEqual({ jump: ["KeyM"] });
    expect(overridesOf("kb1", KB1_DEFAULT)).toEqual({});
  });
  it("release takes a key off every action of the other player", () => {
    const b = release(KB1_DEFAULT, "KeyF");
    expect(b.attack).toEqual(["Mouse0"]);
    expect(overridesOf("kb1", b)).toEqual({ attack: ["Mouse0"] });
  });
});
