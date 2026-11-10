import { afterEach, describe, expect, it } from "vitest";
import { activityLaunch, instanceKey, startActivity } from "../client/src/activity";
import { roomMesh } from "../client/src/net/mesh";

/** Telling the Discord Activity from the website, and what changes inside it. */
const DISCORD_QUERY = "frame_id=f1&instance_id=i-1276580072400224306-gc-912952092627435520-912954213460484116&platform=desktop&guild_id=912952092627435520&channel_id=912954213460484116";
const params = (q: string) => new URLSearchParams(q);

describe("Activity detection", () => {
  it("is the Activity only with Discord's launch parameters on its proxy domain", () => {
    expect(activityLaunch(params(DISCORD_QUERY), "1506034935838937201.discordsays.com", false)).toBe("discord");
    expect(activityLaunch(params(DISCORD_QUERY), "bschoolland.dev", false)).toBeNull();
    expect(activityLaunch(params("frame_id=f1&platform=desktop"), "1506034935838937201.discordsays.com", false)).toBeNull();
    expect(activityLaunch(params(""), "bschoolland.dev", false)).toBeNull();
  });

  it("only plays the stub Discord on a dev build", () => {
    expect(activityLaunch(params("activity=stub&instance=one&as=Ann"), "localhost:5175", true)).toBe("stub");
    expect(activityLaunch(params("activity=stub&instance=one&as=Ann"), "bschoolland.dev", false)).toBeNull();
  });

  it("keys the launch by a digest that is the same for everyone in it and names no server or channel", async () => {
    const instance = "i-1276580072400224306-gc-912952092627435520-912954213460484116";
    const key = await instanceKey(instance);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(await instanceKey(instance)).toBe(key);
    expect(await instanceKey(instance.replace("1276", "1277"))).not.toBe(key);
    for (const id of ["912952092627435520", "912954213460484116"]) expect(key).not.toContain(id);
  });
});

describe("links inside the Activity", () => {
  const made: unknown[] = [];
  const g = globalThis as { RTCPeerConnection?: unknown };
  afterEach(() => { delete g.RTCPeerConnection; made.length = 0; });
  const relay = () => {
    const sent: { t: string }[] = [];
    return { sent, sendLobby: (m: Record<string, unknown>) => { sent.push(m as { t: string }); }, onLobby: () => () => {} };
  };

  it("are made on the website, and asked for ICE servers", () => {
    g.RTCPeerConnection = class { constructor() { made.push(this); } };
    const r = relay();
    const mesh = roomMesh(r, () => 1);
    expect(mesh).not.toBeNull();
    expect(r.sent.map((m) => m.t)).toEqual(["ice"]);
    mesh!.close();
  });

  it("are never tried in the Activity: no mesh, no ICE request, no RTCPeerConnection", async () => {
    g.RTCPeerConnection = class { constructor() { made.push(this); } };
    await startActivity("stub", params("activity=stub&instance=one&as=Ann"));
    const r = relay();
    expect(roomMesh(r, () => 1)).toBeNull();
    expect(r.sent).toEqual([]);
    expect(made).toEqual([]);
  });
});
