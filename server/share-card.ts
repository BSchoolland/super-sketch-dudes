import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { LibraryEntry } from "../shared/account";
import { SHARE_COPY as C } from "../shared/share";

/**
 * A character's link preview: 1200x630, the game's paper with the fighter big on the left (its drawing pinned to the
 * corner, as the character page has it) and its name hand-lettered on the right, the game's name small under it.
 * Made once per version of the character and kept on disk.
 */
export const CARD_W = 1200, CARD_H = 630;
const PAPER = "#f4efe4", INK = "#292722", PENCIL = "#625e55";
const ART = 600, PIN = 170;
const TEXT_X = 640, TEXT_W = 520;

export interface CardFiles { genDir: string; cardDir: string; fontFile: string }

/** What the card shows changes with these: its name, and its art (a new bundle is a new version folder). */
export const cardVersion = (e: Pick<LibraryEntry, "id" | "name" | "bundleUrl">): string =>
  crypto.createHash("sha1").update(JSON.stringify([e.id, e.name, e.bundleUrl])).digest("hex").slice(0, 10);

const versionDir = (e: Pick<LibraryEntry, "bundleUrl">): string => path.basename(path.dirname(e.bundleUrl!));
const pango = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cardFile = (files: CardFiles, e: Pick<LibraryEntry, "id" | "name" | "bundleUrl">): string => path.join(files.cardDir, `${e.id}-${cardVersion(e)}.png`);

const making = new Map<string, Promise<string>>();

/** The card's file, made now if this version of the character has none; older versions' cards are removed. */
export function cardOf(files: CardFiles, e: LibraryEntry): Promise<string> {
  const file = cardFile(files, e);
  if (fs.existsSync(file)) return Promise.resolve(file);
  let p = making.get(file);
  if (!p) {
    p = makeCard(files, e, file).finally(() => making.delete(file));
    making.set(file, p);
  }
  return p;
}

/** Every card kept for this character, whatever its version: it stopped being shareable. */
export function forgetCards(files: CardFiles, id: string): void {
  if (!fs.existsSync(files.cardDir)) return;
  for (const f of fs.readdirSync(files.cardDir)) if (f.startsWith(`${id}-`) && /^[0-9a-f]{10}\.png$/.test(f.slice(id.length + 1))) fs.rmSync(path.join(files.cardDir, f));
}

function paper(): Buffer {
  const lines: string[] = [];
  for (let x = 32; x < CARD_W; x += 32) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${CARD_H}"/>`);
  for (let y = 32; y < CARD_H; y += 32) lines.push(`<line x1="0" y1="${y}" x2="${CARD_W}" y2="${y}"/>`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
<rect width="100%" height="100%" fill="${PAPER}"/>
<g stroke="rgb(100,105,103)" stroke-opacity="0.09" stroke-width="1">${lines.join("")}</g>
<rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" fill="none" stroke="${INK}" stroke-width="3" rx="4" transform="rotate(-0.25 600 315)"/>
</svg>`);
}

/** Text in the game's hand, fitted into the box; `heavy` thickens it the way the game's titles are inked. */
async function lettering(files: CardFiles, text: string, w: number, h: number, color: string, heavy: boolean): Promise<{ input: Buffer; width: number; height: number }> {
  const img = sharp({ text: { text: `<span foreground="${color}">${pango(text)}</span>`, font: "Patrick Hand", fontfile: files.fontFile, width: w, height: h, rgba: true, wrap: "word" } });
  const { data, info } = await img.png().toBuffer({ resolveWithObject: true });
  if (!heavy) return { input: data, width: info.width, height: info.height };
  const d = Math.max(1, Math.round(info.height / 140));
  const pad = d * 2;
  const thick = await sharp({ create: { width: info.width + pad * 2, height: info.height + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([[0, 0], [d, 0], [0, d], [d, d]].map(([dx, dy]) => ({ input: data, left: pad + dx, top: pad + dy })))
    .png().toBuffer();
  return { input: thick, width: info.width + pad * 2, height: info.height + pad * 2 };
}

async function makeCard(files: CardFiles, e: LibraryEntry, file: string): Promise<string> {
  const idle = path.join(files.genDir, e.id, versionDir(e), "idle.png");
  const drawing = path.join(files.genDir, "drawings", `${e.id}.png`);
  if (!fs.existsSync(idle)) throw new Error(`${e.id} is shareable without ${idle}`);
  if (!fs.existsSync(drawing)) throw new Error(`${e.id} is shareable without its drawing ${drawing}`);
  const art = await sharp(idle).trim({ threshold: 1 }).resize(ART - 40, ART - 40, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  const pinImg = await sharp(drawing).flatten({ background: "#ffffff" }).resize(PIN - 8, PIN - 8, { fit: "contain", background: "#ffffff" })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: INK }).png().toBuffer();
  const pin = await sharp(pinImg).rotate(-3, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  const name = await lettering(files, e.name ?? "?", TEXT_W, 250, INK, true);
  const game = await lettering(files, C.cardGame, 330, 40, PENCIL, false);
  const nameTop = Math.round(CARD_H / 2 - name.height / 2 - 30);
  const ruleY = nameTop + name.height + 14;
  const rule = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TEXT_W}" height="12"><path d="M2 8 Q ${TEXT_W / 2} 2 ${Math.min(TEXT_W, name.width) - 2} 5" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`);
  const png = await sharp(paper())
    .composite([
      { input: art.data, left: Math.round(40 + (ART - art.info.width) / 2), top: Math.round((CARD_H - art.info.height) / 2) + 10 },
      { input: pin.data, left: 34, top: 30 },
      { input: name.input, left: TEXT_X, top: nameTop },
      { input: rule, left: TEXT_X, top: ruleY },
      { input: game.input, left: TEXT_X, top: ruleY + 32 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.mkdirSync(files.cardDir, { recursive: true });
  forgetCards(files, e.id);
  fs.writeFileSync(file, png);
  return file;
}
