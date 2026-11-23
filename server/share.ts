import fs from "node:fs";
import type express from "express";
import type { LibraryEntry, SharedCharacter } from "../shared/account";
import { SHARE_COPY as C, SHARE_ID_RE, SITE, characterPath } from "../shared/share";
import { HOME_COPY } from "./home-copy";
import { esc, gamePage, metaTags, strip } from "./home";
import { bestIds, communityCharacters, everyCharacter, findCharacter, isShareable, nameOf, playCount, saveCount, savedOf } from "./library";
import { cardOf, cardVersion, forgetCards, type CardFiles } from "./share-card";
import { playerOf } from "./auth";

/**
 * A page per character, at <base>c/<id>: the game booting straight to it (client/src/app.ts), with the head a crawler
 * or link preview reads: its name, its tagline and a share card (share-card.ts). Only a shareable character has one
 * (library.ts `isShareable`); anything else is a plain 404 with no card, so a held drawing never leaks through an
 * image URL. Both are decided on every request, so a hold or a take-down stops them at once.
 * /sitemap.xml lists every one of them, so search engines index all of them, the way a video site's are.
 */

/** The character, if its link may show it. */
export function shareableCharacter(id: string): LibraryEntry | null {
  if (!SHARE_ID_RE.test(id)) return null;
  const e = findCharacter(id);
  return e && isShareable(e) ? e : null;
}

const pageUrl = (id: string): string => `${SITE}${characterPath(id)}`;
const cardUrl = (e: LibraryEntry): string => `${pageUrl(e.id)}/card.png?v=${cardVersion(e)}`;

/** The head, with no creator anywhere: many players are children. */
function characterHead(e: LibraryEntry): string {
  const name = e.name ?? "?";
  const ld = {
    "@context": "https://schema.org", "@type": "CreativeWork",
    name, ...(e.tagline ? { description: e.tagline } : {}), url: pageUrl(e.id), image: cardUrl(e),
    isPartOf: { "@type": "VideoGame", name: HOME_COPY.name, url: SITE },
  };
  return metaTags({ title: C.pageTitle(name), description: e.tagline || null, url: pageUrl(e.id), image: cardUrl(e), imageType: "image/png", imageAlt: C.cardAlt(name), ld });
}

/** The about sections' first part on a character's page: its name, tagline and picture (a listed one's, as the front page's strip has it). */
function characterHero(e: LibraryEntry, base: string): string {
  const name = e.name ?? "?";
  const listed = communityCharacters().some((c) => c.entry.id === e.id);
  return `<header class="hero">
<div>
<h1 class="name">${esc(name)}</h1>
${e.tagline ? `<p class="pitch">${esc(e.tagline)}</p>\n` : ""}<p class="intro">${esc(C.pageIntro)}</p>
<a class="play card up" href="${base}">${esc(HOME_COPY.play)}</a>
</div>
${listed ? `<figure class="portrait card"><img src="${base}fighters/${encodeURIComponent(e.id)}.png" width="512" height="512" decoding="async" alt="${esc(C.cardAlt(name))}"></figure>\n` : ""}</header>
`;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The front page and every character that's shareable now; a held or taken-down one drops out. */
export function sitemap(): string {
  const urls = [`<url><loc>${esc(SITE)}</loc></url>`];
  for (const e of everyCharacter()) {
    if (isShareable(e)) urls.push(`<url><loc>${esc(pageUrl(e.id))}</loc><lastmod>${day(e.createdAt)}</lastmod></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  ${u}`).join("\n")}
</urlset>
`;
}

/** Not a character anyone may see: the game's paper and ink, and the way to the game. */
export function notFoundPage(base: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(C.notFoundTitle)}</title>
<link rel="icon" href="${base}favicon.ico" sizes="32x32" />
<style>
@font-face { font-family: "Patrick Hand"; src: url("${base}fonts/PatrickHand-Regular.ttf") format("truetype"); font-display: swap; }
html { min-height: 100%; background: #f4efe4; background-image: linear-gradient(rgba(100,105,103,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(100,105,103,.09) 1px, transparent 1px); background-size: 32px 32px; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #292722; font: 1.4rem/1.45 "Patrick Hand", "Comic Sans MS", cursive; }
main { max-width: 34rem; margin: 2rem 1.25rem; padding: 1.6rem 2rem 2rem; background: #f4efe4; border: 2px solid #292722; box-shadow: 5px 6px 0 rgba(41,39,34,.08); transform: rotate(-.5deg); text-align: center; }
h1 { font-weight: normal; font-size: 2.6rem; line-height: 1.05; margin: 0 0 .6rem; }
p { margin: 0 0 1.4rem; color: #625e55; }
a { display: inline-block; color: inherit; text-decoration: none; font-size: 1.8rem; letter-spacing: .05em; padding: .3rem 1.6rem; border: 3px solid #292722; outline: 1.5px solid #625e55; outline-offset: 4px; }
a:hover, a:focus-visible { background: #fffaf0; }
</style>
</head>
<body>
<main>
<h1>${esc(C.notFoundHeading)}</h1>
<p>${esc(C.notFoundText)}</p>
<a href="${base}">${esc(C.notFoundPlay)}</a>
</main>
</body>
</html>`;
}

export interface SharePageOptions { at: (p: string) => string[]; base: string; indexFile: string; files: CardFiles }

/** The character pages, their cards and the sitemap. Before the static files. */
export function attachSharePages(app: express.Express, opts: SharePageOptions): void {
  const index = fs.readFileSync(opts.indexFile, "utf8");
  if (!fs.existsSync(opts.files.fontFile)) throw new Error(`the share cards' font isn't at ${opts.files.fontFile}`);
  const missing = (res: express.Response): void => {
    res.setHeader("Cache-Control", "no-cache");
    res.status(404).type("html").send(notFoundPage(opts.base));
  };
  app.get(opts.at("/c/:id"), (req, res) => {
    const e = shareableCharacter(req.params.id);
    if (!e) return missing(res);
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(gamePage(index, characterHead(e), opts.base, characterHero(e, opts.base), strip()));
  });
  app.get(opts.at("/sitemap.xml"), (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("application/xml").send(sitemap());
  });
  app.get(opts.at("/c/:id/card.png"), (req, res, next) => {
    const e = shareableCharacter(req.params.id);
    if (!e) {
      if (SHARE_ID_RE.test(req.params.id)) forgetCards(opts.files, req.params.id);
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).end();
    }
    cardOf(opts.files, e).then(
      // asked again every time (no validators to revalidate with), so a hold stops it at once
      (file) => res.sendFile(file, { headers: { "Cache-Control": "no-cache" }, etag: false, lastModified: false }),
      next,
    );
  });
}

/** One character as its page in the game shows it to `caller`. */
function asShared(e: LibraryEntry, caller: string): SharedCharacter {
  const listed = communityCharacters().some((c) => c.entry.id === e.id);
  return {
    id: e.id, name: e.name, tagline: e.tagline, drawingUrl: e.drawingUrl, bundleUrl: e.bundleUrl!, createdAt: e.createdAt,
    creator: { name: nameOf(e.owner) ?? "?" }, plays: playCount(e.id), saves: saveCount(e.id), best: bestIds().includes(e.id),
    saved: !!caller && savedOf(caller).some((s) => s.id === e.id), mine: e.owner === caller, saveable: listed,
  };
}

/** The game's side of sharing: a shared character for its page. */
export function attachShareApi(api: express.Router, forgeToken: string): void {
  api.get("/characters/shared/:id", (req, res) => {
    const e = shareableCharacter(req.params.id);
    if (!e) return res.status(404).json({ error: "no such shared character" });
    res.json({ character: asShared(e, playerOf(req)?.id ?? "") });
  });

}
