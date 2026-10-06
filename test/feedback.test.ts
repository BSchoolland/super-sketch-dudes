import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachAuth } from "../server/auth";
import { attachFeedback } from "../server/feedback";
import { initLibrary } from "../server/library";
import type { FeedbackItem } from "../shared/feedback";

let server: http.Server, port: number, dataDir: string;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const call = (p: string, session: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}/api${p}`, { ...init, headers: { "content-type": "application/json", ...(session ? { "x-session": session } : {}) } });
const json = async <T = any>(p: string, session: string | null, init: RequestInit = {}): Promise<T> => (await call(p, session, init)).json() as Promise<T>;
const signIn = async (name: string) => (await json<{ session: string }>("/auth/dev", null, { method: "POST", body: JSON.stringify({ name }) })).session;
const send = (session: string | null, body: object) => call("/feedback", session, { method: "POST", body: JSON.stringify(body) });

let ben: string, ann: string, bob: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-feedback-"));
  // an entry from before responses existed
  fs.writeFileSync(path.join(dataDir, "feedback.jsonl"), JSON.stringify({ at: "2026-10-01T10:00:00.000Z", player: { id: "dev-ann", name: "ann" }, text: "add tournaments", sketch: null }) + "\n");
  const a = express();
  a.use(express.json({ limit: "2mb" }));
  const router = express.Router();
  a.use("/api", router);
  initLibrary(dataDir);
  attachAuth(router, { dataDir, devLogin: true, botKey: null });
  attachFeedback(router, { dataDir, admins: ["dev-ben"] });
  server = http.createServer(a).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as { port: number }).port;
  [ben, ann, bob] = await Promise.all([signIn("ben"), signIn("ann"), signIn("bob")]);
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("feedback responses", () => {
  it("lets only the admin read everyone's feedback and respond", async () => {
    expect((await send(ann, { text: "more maps", png: PNG })).status).toBe(204);
    expect((await send(null, { text: "signed out idea" })).status).toBe(204);
    expect((await call("/feedback/all", ann)).status).toBe(403);
    expect((await call("/feedback/response", ann, { method: "PUT", body: JSON.stringify({ id: "2026-10-01T10:00:00.000Z", text: "no" }) })).status).toBe(403);
    const { items } = await json<{ items: FeedbackItem[] }>("/feedback/all", ben);
    expect(items.map((i) => i.text)).toEqual(["signed out idea", "more maps", "add tournaments"]);
    const anon = await call("/feedback/response", ben, { method: "PUT", body: JSON.stringify({ id: items[0].id, text: "hi" }) });
    expect(anon.status).toBe(400);
    const r = await json<{ item: FeedbackItem }>("/feedback/response", ben, { method: "PUT", body: JSON.stringify({ id: "2026-10-01T10:00:00.000Z", text: "coming soon" }) });
    expect(r.item.response).toMatchObject({ text: "coming soon", seenAt: null });
  });

  it("shows a player their own feedback and responses until they've seen them", async () => {
    const mine = await json<{ items: FeedbackItem[]; admin: boolean }>("/feedback/mine", ann);
    expect(mine.admin).toBe(false);
    expect(mine.items.map((i) => [i.text, i.response?.text ?? null])).toEqual([["more maps", null], ["add tournaments", "coming soon"]]);
    expect((await json<{ admin: boolean }>("/feedback/mine", ben)).admin).toBe(true);
    // someone else can't mark it seen
    await call("/feedback/seen", bob, { method: "POST", body: JSON.stringify({ ids: ["2026-10-01T10:00:00.000Z"] }) });
    expect((await json<{ items: FeedbackItem[] }>("/feedback/mine", ann)).items[1].response!.seenAt).toBeNull();
    await call("/feedback/seen", ann, { method: "POST", body: JSON.stringify({ ids: ["2026-10-01T10:00:00.000Z"] }) });
    expect((await json<{ items: FeedbackItem[] }>("/feedback/mine", ann)).items[1].response!.seenAt).not.toBeNull();
    // a new response is unseen again
    await call("/feedback/response", ben, { method: "PUT", body: JSON.stringify({ id: "2026-10-01T10:00:00.000Z", text: "next week" }) });
    expect((await json<{ items: FeedbackItem[] }>("/feedback/mine", ann)).items[1].response).toMatchObject({ text: "next week", seenAt: null });
  });

  it("serves a sketch to its sender and the admin only", async () => {
    const { items } = await json<{ items: FeedbackItem[] }>("/feedback/mine", ann);
    const name = items[0].sketch!;
    expect(name).toMatch(/^[0-9a-f]{12}\.png$/);
    expect((await call(`/feedback/sketch/${name}`, ann)).status).toBe(200);
    expect((await call(`/feedback/sketch/${name}`, ben)).status).toBe(200);
    expect((await call(`/feedback/sketch/${name}`, bob)).status).toBe(403);
    expect((await call(`/feedback/sketch/${name}`, null)).status).toBe(403);
  });

  it("responds with an image, served to the feedback's sender and the admin, and replaced with the response", async () => {
    const id = "2026-10-01T10:00:00.000Z";
    const respond = (body: object) => call("/feedback/response", ben, { method: "PUT", body: JSON.stringify({ id, ...body }) });
    expect((await respond({ text: "", png: "data:image/png;base64,AAAA" })).status).toBe(400);
    const { item } = await (await respond({ text: "", png: PNG })).json() as { item: FeedbackItem };
    const name = item.response!.sketch!;
    expect(name).toMatch(/^[0-9a-f]{12}\.png$/);
    expect((await call(`/feedback/sketch/${name}`, ann)).status).toBe(200);
    expect((await call(`/feedback/sketch/${name}`, ben)).status).toBe(200);
    expect((await call(`/feedback/sketch/${name}`, bob)).status).toBe(403);
    const after = await (await respond({ text: "text only now" })).json() as { item: FeedbackItem };
    expect(after.item.response).toMatchObject({ text: "text only now", sketch: null });
    expect(fs.existsSync(path.join(dataDir, "feedback", name))).toBe(false);
    expect((await call(`/feedback/sketch/${name}`, ann)).status).toBe(404);
  });

  it("keeps feedback.jsonl's lines as they were and responses beside it", () => {
    const lines = fs.readFileSync(path.join(dataDir, "feedback.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(Object.keys(lines[1]).sort()).toEqual(["at", "player", "sketch", "text"]);
    expect(lines[1].sketch).toMatch(/^feedback\/[0-9a-f]{12}\.png$/);
    const responses = JSON.parse(fs.readFileSync(path.join(dataDir, "feedback-responses.json"), "utf8"));
    expect(Object.keys(responses)).toEqual(["2026-10-01T10:00:00.000Z"]);
  });
});
