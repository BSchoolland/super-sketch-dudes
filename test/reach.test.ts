import { describe, expect, it } from "vitest";
import { reach } from "../forge/reach";

describe("the forge worker reaching the site", () => {
  it("waits out requests that never reach the site, and logs each", async () => {
    let tries = 0;
    const lines: string[] = [];
    const res = await reach(async () => { if (++tries < 3) throw new TypeError("fetch failed"); return new Response("ok"); }, "POST /jobs/x/progress", (l) => lines.push(l), [1, 1, 1]);
    expect(await res.text()).toBe("ok");
    expect(tries).toBe(3);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("fetch failed");
  });
  it("hands back an answer at once, a refusal too", async () => {
    let tries = 0;
    const res = await reach(async () => { tries++; return new Response("gone", { status: 409 }); }, "POST /jobs/x/progress", () => {}, [1, 1]);
    expect(res.status).toBe(409);
    expect(tries).toBe(1);
  });
  it("throws once every wait is used up", async () => {
    let tries = 0;
    await expect(reach(async () => { tries++; throw new TypeError("fetch failed"); }, "GET /x", () => {}, [1, 1])).rejects.toThrow("fetch failed");
    expect(tries).toBe(3);
  });
  it("tries a poll once", async () => {
    let tries = 0;
    await expect(reach(async () => { tries++; throw new TypeError("fetch failed"); }, "GET /jobs/next", () => {}, [])).rejects.toThrow();
    expect(tries).toBe(1);
  });
});
