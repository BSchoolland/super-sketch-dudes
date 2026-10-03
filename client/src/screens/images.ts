import { PAPER, PENCIL } from "../render/paper";
import { label, INK } from "./ui";
import type { Player } from "../../../shared/account";

interface Entry { img: HTMLImageElement; ok: boolean; error: string }
const images = new Map<string, Entry>();

/** Drawings and sheets from the server, loaded once per URL. */
export function image(url: string): Entry {
  let e = images.get(url);
  if (e) return e;
  const img = new Image();
  // avatars come from the Discord and Google CDNs: drawn without CORS they taint the canvas for the rest of the session
  img.crossOrigin = "anonymous";
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

/** A player's avatar in an inked circle, or their initial when they have none. */
export function drawAvatar(ctx: CanvasRenderingContext2D, p: Pick<Player, "name" | "avatar">, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "rgba(119,114,103,0.15)";
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  const img = p.avatar ? image(p.avatar) : null;
  if (img?.ok) ctx.drawImage(img.img, cx - r, cy - r, r * 2, r * 2);
  else label(ctx, p.name.slice(0, 1).toUpperCase(), cx, cy + r * 0.4, r * 1.13, INK, "center", 900);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
