import { describe, expect, it } from "vitest";
import { moveTo, takeCarried, NEW_ORIGIN } from "../client/src/move";

class Mem implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}
const at = (host: string, pathname = "/sketch-battle/", search = "", hash = "") => ({ host, pathname, search, hash });

describe("moving hosts", () => {
  it("carries the game's storage from the old host to the new one, and nothing else", () => {
    const old = new Mem();
    old.setItem("sketchbattle.account", JSON.stringify({ session: "s1", player: { id: "p", name: "Ann" } }));
    old.setItem("sketchbattle.settings", "{\"volume\":0.5}");
    old.setItem("unrelated", "x");
    const to = moveTo(at("bschoolland.dev", "/sketch-battle/", "?ref=x"), old)!;
    expect(to.startsWith(`${NEW_ORIGIN}/sketch-battle/?ref=x#carry=`)).toBe(true);
    const fresh = new Mem();
    const url = new URL(to);
    expect(takeCarried(at("supersketchdudes.com", url.pathname, url.search, url.hash), fresh)).toBe("");
    expect(JSON.parse(fresh.getItem("sketchbattle.account")!).session).toBe("s1");
    expect(fresh.getItem("sketchbattle.settings")).toBe("{\"volume\":0.5}");
    expect(fresh.getItem("unrelated")).toBeNull();
  });

  it("leaves a sign-in already on the new host alone", () => {
    const fresh = new Mem();
    fresh.setItem("sketchbattle.account", "mine");
    const hash = `#carry=${encodeURIComponent(JSON.stringify({ "sketchbattle.account": "theirs" }))}`;
    takeCarried(at("supersketchdudes.com", "/sketch-battle/", "", hash), fresh);
    expect(fresh.getItem("sketchbattle.account")).toBe("mine");
  });

  it("stays put on the new host, in the Discord Activity, and on the old host's sign-in return", () => {
    expect(moveTo(at("supersketchdudes.com"), new Mem())).toBeNull();
    expect(moveTo(at("1569520137055240272.discordsays.com", "/"), new Mem())).toBeNull();
    expect(moveTo(at("bschoolland.dev", "/sketch-battle/auth"), new Mem())).toBeNull();
    expect(takeCarried(at("supersketchdudes.com", "/sketch-battle/", "", "#other"), new Mem())).toBe("#other");
  });
});
