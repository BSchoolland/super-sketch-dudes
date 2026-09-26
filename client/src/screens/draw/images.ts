import { loadGeneratedFighter } from "../../gen";
import { PAPER, PENCIL } from "../../render/paper";
import { label } from "../ui";

interface Entry { img: HTMLImageElement; ok: boolean; error: string }
const images = new Map<string, Entry>();

/** Drawings and sheets from the server, loaded once per URL. */
export function image(url: string): Entry {
  let e = images.get(url);
  if (e) return e;
  const img = new Image();
  e = { img, ok: false, error: "" };
  images.set(url, e);
  const entry = e;
  img.onload = () => { entry.ok = true; };
  img.onerror = () => { entry.error = "image failed to load"; console.error(`draw image failed to load: ${url}`); };
  img.src = url;
  return e;
}

/** Draws the image fitted into the square, or says why it can't. */
export function drawImageIn(ctx: CanvasRenderingContext2D, url: string | null, x: number, y: number, size: number, empty = ""): void {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, size, size);
  if (url) {
    const e = image(url);
    if (e.ok) {
      const k = size / Math.max(e.img.naturalWidth, e.img.naturalHeight);
      const w = e.img.naturalWidth * k, h = e.img.naturalHeight * k;
      ctx.drawImage(e.img, x + (size - w) / 2, y + (size - h) / 2, w, h);
    } else label(ctx, e.error || "…", x + size / 2, y + size / 2, Math.max(16, size / 14), e.error ? "#c0392b" : PENCIL);
  } else if (empty) {
    label(ctx, empty, x + size / 2, y + size / 2, Math.max(16, size / 14), PENCIL);
  }
  ctx.restore();
}

export interface FighterLoad { state: "loading" | "ready" | "failed"; error: string; promise: Promise<void> }
const fighters = new Map<string, FighterLoad>();

/** Loads a generated fighter bundle once; the returned record says how it went. */
export function fighterLoad(bundleUrl: string): FighterLoad {
  let f = fighters.get(bundleUrl);
  if (f) return f;
  const record: FighterLoad = { state: "loading", error: "", promise: Promise.resolve() };
  record.promise = loadGeneratedFighter(bundleUrl).then(
    () => { record.state = "ready"; },
    (error: unknown) => {
      console.error(`fighter bundle failed: ${bundleUrl}`, error);
      record.state = "failed";
      record.error = error instanceof Error ? error.message : String(error);
    },
  );
  fighters.set(bundleUrl, record);
  return record;
}
