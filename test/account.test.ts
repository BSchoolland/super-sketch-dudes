import { describe, expect, it } from "vitest";
import { isBundlePath } from "../shared/account";

describe("room fighter bundles", () => {
  it("accepts only same-site gen/ and house/ bundles named after the fighter", () => {
    expect(isBundlePath("/sketch-battle/gen/gen--ann-6435c8/bundle.json", "gen--ann-6435c8")).toBe(true);
    expect(isBundlePath("/sketch-battle/house/tank/bundle.json", "tank")).toBe(true);
    expect(isBundlePath("/gen/tank/bundle.json", "tank")).toBe(true);
    expect(isBundlePath("/sketch-battle/house/tank/bundle.json?v=709b13d", "tank")).toBe(true);
    expect(isBundlePath("/sketch-battle/gen/gen--ann-6435c8/0badf00d/bundle.json", "gen--ann-6435c8")).toBe(true);
    expect(isBundlePath("/sketch-battle/gen/gen--ann-6435c8/evil/bundle.json", "gen--ann-6435c8")).toBe(false);
    expect(isBundlePath("/sketch-battle/house/tank/bundle.json", "lampjack")).toBe(false);
    expect(isBundlePath("https://evil.example/gen/tank/bundle.json", "tank")).toBe(false);
    expect(isBundlePath("//evil.example/gen/tank/bundle.json", "tank")).toBe(false);
    expect(isBundlePath("/sketch-battle/gen/../api/tank/bundle.json", "tank")).toBe(false);
    expect(isBundlePath("house/tank/bundle.json", "tank")).toBe(false);
  });
});
