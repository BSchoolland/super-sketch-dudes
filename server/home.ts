import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { HOME_COPY as C } from "./home-copy";
import { communityCharacters, rankedCommunity } from "./library";

/**
 * The landing page: <base>home/ here, https://supersketchdudes.com/ through Apache, which proxies the whole domain to <base>home/.
 * Its files are client/public/home/ and its URLs are relative, so they work at both. The game is always reached at GAME.
 */
const SITE = "https://supersketchdudes.com/";
const GAME = "https://supersketchdudes.com/play/";
const PLAY = `${GAME}?ref=home`;
/** Fighters in the strip: BEST's order, one per creator. */
const STRIP = 6;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The strip's characters: listed ones only (public, unheld, an account's, not deleted), from COMMUNITY's BEST. */
function strip(): { id: string; name: string; tagline: string }[] {
  const creators = new Set<string>();
  const out: { id: string; name: string; tagline: string }[] = [];
  for (const { entry } of rankedCommunity("best")) {
    if (creators.has(entry.owner)) continue;
    creators.add(entry.owner);
    out.push({ id: entry.id, name: entry.name ?? entry.id, tagline: entry.tagline ?? "" });
    if (out.length === STRIP) break;
  }
  return out;
}

function page(fighters: { id: string; name: string; tagline: string }[]): string {
  const ld = {
    "@context": "https://schema.org", "@type": "VideoGame",
    name: C.name, url: SITE, description: C.description, image: `${SITE}og.jpg`,
    genre: ["Fighting", "Platform"], gamePlatform: "Web browser", applicationCategory: "Game", operatingSystem: "Any",
    playMode: ["SinglePlayer", "MultiPlayer"], inLanguage: "en", isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    screenshot: ["draw", "alive", "fight"].map((s) => `${SITE}shots/${s}.webp`),
    potentialAction: { "@type": "PlayAction", target: PLAY },
  };
  const shot = (i: number, file: string): string =>
    `<img src="shots/${file}.webp" width="960" height="540" loading="lazy" decoding="async" alt="${esc(C.steps[i].alt)}">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(C.title)}</title>
<meta name="description" content="${esc(C.description)}">
<link rel="canonical" href="${SITE}">
<meta name="theme-color" content="#f4efe4">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(C.name)}">
<meta property="og:title" content="${esc(C.title)}">
<meta property="og:description" content="${esc(C.description)}">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(C.ogImageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(C.title)}">
<meta name="twitter:description" content="${esc(C.description)}">
<meta name="twitter:image" content="${SITE}og.jpg">
<meta name="twitter:image:alt" content="${esc(C.ogImageAlt)}">
<link rel="icon" href="favicon.ico" sizes="32x32">
<link rel="icon" href="icon.png" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preload" href="patrick-hand.woff2" as="font" type="font/woff2" crossorigin>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<style>
@font-face { font-family: "Patrick Hand"; src: url("patrick-hand.woff2") format("woff2"); font-display: swap; }
:root { color-scheme: light; --paper: #f4efe4; --ink: #292722; --pencil: #625e55; }
html { background: var(--paper) linear-gradient(rgba(100,105,103,.09) 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, rgba(100,105,103,.09) 1px, transparent 1px) 0 0 / 32px 32px; }
body { margin: 0; color: var(--ink); font: 1.25rem/1.45 "Patrick Hand", "Comic Sans MS", cursive; }
main { max-width: 68rem; margin: 0 auto; padding: 0 1.25rem 2rem; }
h1, h2, h3 { font-weight: normal; margin: 0; line-height: 1.05; }
h2 { font-size: 2.4rem; margin: 3.5rem 0 1.2rem; border-bottom: 3px solid var(--ink); padding-bottom: .25rem; }
h3 { font-size: 1.7rem; margin: .7rem 0 .2rem; }
p { margin: .3rem 0; }
a { color: inherit; text-decoration-thickness: 2px; text-underline-offset: 3px; }
img, video { display: block; max-width: 100%; height: auto; }
.card { background: var(--paper); border: 1.5px solid var(--ink); box-shadow: 5px 6px 0 rgba(41,39,34,.08); }
.hero { display: grid; grid-template-columns: 1fr 1.25fr; gap: 2.5rem; align-items: center; padding-top: 3rem; }
h1 { font-size: clamp(3rem, 5.6vw, 5.2rem); letter-spacing: .01em; white-space: nowrap; }
h1 span { display: block; font-size: .42em; margin-left: .3em; }
h1::after { content: ""; display: block; height: 4px; margin-top: .2rem; background: var(--ink); border-radius: 2px; transform: rotate(-.6deg); }
.pitch { font-size: 1.6rem; margin: 1rem 0 1.4rem; }
.play { display: inline-block; font-size: 2.4rem; letter-spacing: .06em; text-decoration: none; padding: .35rem 2.6rem; border-width: 3px; outline: 1.5px solid var(--pencil); outline-offset: 4px; transform: rotate(-.4deg); }
.play:hover, .play:focus-visible { background: #fffaf0; transform: rotate(-.4deg) translateY(-2px); }
.note { color: var(--pencil); margin-top: 1rem; }
.clip { transform: rotate(.5deg); aspect-ratio: 16 / 9; width: 100%; }
.steps, .where { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.6rem; list-style: none; padding: 0; margin: 0; }
.where { grid-template-columns: repeat(2, 1fr); }
.steps img { aspect-ratio: 16 / 9; }
.fighters { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 1.2rem; list-style: none; padding: 0; margin: 1rem 0 0; }
.fighters li { padding: .4rem .6rem .7rem; text-align: center; overflow: hidden; }
.fighters li:nth-child(odd) { transform: rotate(-.6deg); }
.fighters li:nth-child(even) { transform: rotate(.5deg); }
.fighters img { width: 150%; max-width: none; aspect-ratio: 1; margin: -30% -25% -16%; }
.fighters b { display: block; font-weight: normal; font-size: 1.4rem; line-height: 1.1; }
.fighters small { display: block; color: var(--pencil); font-size: 1rem; line-height: 1.2; margin-top: .2rem; }
.facts { padding-left: 1.3rem; margin: 0; }
.facts li { margin: .3rem 0; }
.where li { padding: .8rem 1.1rem 1rem; }
footer { max-width: 68rem; margin: 3rem auto 0; padding: 1rem 1.25rem 2.5rem; color: var(--pencil); display: flex; gap: 1.5rem; }
@media (max-width: 760px) {
  .hero { grid-template-columns: 1fr; gap: 1.5rem; padding-top: 1.5rem; }
  .steps, .where { grid-template-columns: 1fr; }
  .fighters { grid-template-columns: repeat(2, 1fr); gap: .9rem; }
  h1 { font-size: clamp(2.6rem, 13vw, 3.6rem); }
  h2 { font-size: 2rem; margin-top: 2.5rem; }
  .play { display: block; text-align: center; }
}
@media (prefers-reduced-motion: reduce) { .play:hover, .play:focus-visible { transform: rotate(-.4deg); } }
</style>
</head>
<body>
<main>
<header class="hero">
<div>
<h1><span>SUPER</span>SKETCH DUDES</h1>
<p class="pitch">${esc(C.pitch)}</p>
<a class="play card" href="${PLAY}">${esc(C.play)}</a>
<p class="note">${esc(C.playNote)}</p>
</div>
<video class="clip card" autoplay muted loop playsinline preload="metadata" poster="clip.webp" width="1280" height="720" aria-label="${esc(C.clipLabel)}">
<source src="clip.mp4" type="video/mp4">
</video>
</header>

<section>
<h2>${esc(C.howTitle)}</h2>
<ol class="steps">
${C.steps.map((s, i) => `<li>${shot(i, ["draw", "alive", "fight"][i])}<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join("\n")}
</ol>
</section>

${fighters.length ? `<section>
<h2>${esc(C.fightersTitle)}</h2>
<p>${esc(C.fightersNote)}</p>
<ul class="fighters">
${fighters.map((f) => `<li class="card"><img src="fighters/${encodeURIComponent(f.id)}.png" width="512" height="512" loading="lazy" decoding="async" alt="${esc(f.name)}"><b>${esc(f.name)}</b>${f.tagline ? `<small>${esc(f.tagline)}</small>` : ""}</li>`).join("\n")}
</ul>
</section>` : ""}

<section>
<h2>${esc(C.factsTitle)}</h2>
<ul class="facts">
${C.facts.map((f) => `<li>${esc(f)}</li>`).join("\n")}
</ul>
</section>

<section>
<h2>${esc(C.whereTitle)}</h2>
<ul class="where">
<li class="card"><h3>${esc(C.where[0].title)}</h3><p>${esc(C.where[0].text)}</p><p><a href="${PLAY}">${esc(C.play)}</a></p></li>
<li class="card"><h3>${esc(C.where[1].title)}</h3><p>${esc(C.where[1].text)}</p></li>
</ul>
</section>
</main>
<footer><a href="${GAME}privacy">${esc(C.privacy)}</a><a href="${GAME}terms">${esc(C.terms)}</a></footer>
</body>
</html>
`;
}

/** The page, its fighters' pictures, and the redirect that keeps its relative URLs right. Before the static files. */
export function attachHome(app: express.Express, opts: { base: string; genDir: string }): void {
  const at = (p: string): string[] => [`/home${p}`, `${opts.base}/home${p}`];
  app.get(at(""), (req, res, next) => {
    if (req.path.endsWith("/")) return next();
    res.redirect(301, `${opts.base}/home/`);
  });
  app.get(at("/"), (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(page(strip()));
  });
  // a listed character's idle cell, so the domain needs nothing but <base>home/ and a held or private one is never served here
  app.get(at("/fighters/:id.png"), (req, res) => {
    const c = communityCharacters().find(({ entry }) => entry.id === req.params.id);
    if (!c) return res.status(404).end();
    const ver = path.basename(path.dirname(c.entry.bundleUrl!));
    const file = path.join(opts.genDir, c.entry.id, ver, "idle.png");
    if (!fs.existsSync(file)) throw new Error(`${c.entry.id} is listed without ${file}`);
    res.sendFile(file, { maxAge: "1h" });
  });
}
