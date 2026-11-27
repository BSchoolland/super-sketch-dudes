import { describe, expect, it } from "vitest";
import { houseStartersIn } from "../shared/house";

describe("house fighters a library already has as a starter", () => {
  it("is the house FIRE WIZARD when the library has its starter copy", () => {
    expect([...houseStartersIn(["gen-3358-v3sword", "gen-3358-bba1c9"])]).toEqual(["wizard"]);
  });
  it("is none for an empty library", () => {
    expect(houseStartersIn([]).size).toBe(0);
  });
});
