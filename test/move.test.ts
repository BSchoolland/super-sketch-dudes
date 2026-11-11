import { describe, expect, it } from "vitest";
import { takeCarried } from "../client/src/move";
import { oldHostPage, GAME_URL } from "../server/oldhost";

class Mem implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}
const carry = (o: Record<string, string>) => `#carry=${encodeURIComponent(JSON.stringify(o))}`;

describe("moving hosts", () => {
  it("the old host's page sends the browser to the game's home with the query kept", () => {
    const html = oldHostPage("?ref=oldlink");
    expect(html).toContain(JSON.stringify(`${GAME_URL}?ref=oldlink`));
    expect(html).toContain('k.startsWith("sketchbattle.")');
  });

  it("takes in the carried game storage, and nothing else", () => {
    const fresh = new Mem();
    expect(takeCarried(carry({ "sketchbattle.account": "acct", "sketchbattle.settings": "s", unrelated: "x" }), fresh)).toBe("");
    expect(fresh.getItem("sketchbattle.account")).toBe("acct");
    expect(fresh.getItem("sketchbattle.settings")).toBe("s");
    expect(fresh.getItem("unrelated")).toBeNull();
  });

  it("leaves a sign-in already on this host alone, and other hashes as they are", () => {
    const fresh = new Mem();
    fresh.setItem("sketchbattle.account", "mine");
    takeCarried(carry({ "sketchbattle.account": "theirs" }), fresh);
    expect(fresh.getItem("sketchbattle.account")).toBe("mine");
    expect(takeCarried("#other", fresh)).toBe("#other");
  });
});
