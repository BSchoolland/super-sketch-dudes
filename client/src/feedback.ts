import { account, api } from "./account";
import { site } from "./base";
import { SESSION_HEADER } from "../../shared/account";
import type { FeedbackItem } from "../../shared/feedback";

export const feedbackApi = {
  /** The caller's own feedback, newest first, and whether they're the one who reads everyone's. */
  mine: () => api<{ items: FeedbackItem[]; admin: boolean }>("/feedback/mine"),
  all: () => api<{ items: FeedbackItem[] }>("/feedback/all"),
  respond: (id: string, text: string, png: string | undefined) => api<{ item: FeedbackItem }>("/feedback/response", { method: "PUT", body: JSON.stringify({ id, text, png }) }),
  seen: (ids: string[]) => api<void>("/feedback/seen", { method: "POST", body: JSON.stringify({ ids }) }),
};

/** The session whose unseen responses have been fetched: once a visit, per account. */
let checkedFor: string | null = null;

/** Responses this player hasn't seen yet, oldest first; empty after the first call this visit. */
export async function unseenResponses(): Promise<FeedbackItem[]> {
  if (!account.session || checkedFor === account.session) return [];
  checkedFor = account.session;
  const { items } = await feedbackApi.mine();
  return items.filter((i) => i.response && !i.response.seenAt).reverse();
}

/** They've read this response. */
export function markSeen(item: FeedbackItem): void {
  if (!item.response || item.response.seenAt) return;
  item.response.seenAt = new Date().toISOString();
  void feedbackApi.seen([item.id]).catch((error: unknown) => console.error(`marking feedback ${item.id} seen failed`, error));
}

type Sketch = { url: string } | { error: string } | "loading";
const sketches = new Map<string, Sketch>();
const fetches = new Map<string, Promise<string>>();

/** A feedback sketch's object URL: it's behind the session header, which an <img> can't send. */
function sketchUrl(name: string): Promise<string> {
  let f = fetches.get(name);
  if (!f) {
    f = fetch(`${site.base}api/feedback/sketch/${name}`, { headers: { [SESSION_HEADER]: account.session ?? "" } }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    });
    fetches.set(name, f);
  }
  return f;
}

/** A feedback sketch to draw this frame: loading, its object URL, or why it failed. */
export function feedbackSketch(name: string): Sketch {
  const s = sketches.get(name);
  if (s) return s;
  sketches.set(name, "loading");
  sketchUrl(name).then(
    (url) => sketches.set(name, { url }),
    (error: unknown) => {
      console.error(`feedback sketch ${name} failed`, error);
      sketches.set(name, { error: "sketch failed to load" });
    },
  );
  return "loading";
}

/** A feedback sketch as a loaded image, to draw on. */
export async function feedbackSketchImage(name: string): Promise<HTMLImageElement> {
  return loadImage(await sketchUrl(name));
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed to load: ${src}`));
    img.src = src;
  });
}
