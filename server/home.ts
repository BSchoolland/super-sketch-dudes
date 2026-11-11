import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { HOME_COPY as C } from "./home-copy";
import { communityCharacters, rankedCommunity } from "./library";

/**
 * The front page is the game's own index.html with the about sections after the canvas and the head's title, description
 * and sharing tags, so a search engine or a link preview reads one page; client/src/about.ts opens the sections from
 * the title screen. The pictures are client/public/{screenshots,clip.*,og.jpg}; the strip's are served here.
 */
const SITE = "https://supersketchdudes.com/";
/** Fighters in the strip: BEST's order, one per creator. */
const STRIP = 6;
const SHOTS = ["draw", "alive", "fight"] as const;
type Fighter = { id: string; name: string; tagline: string };

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Puts `content` in place of index.html's <!--name-->…<!--/name-->. */
function fill(html: string, name: string, content: string): string {
  const parts = html.split(new RegExp(`<!--${name}-->[\\s\\S]*?<!--/${name}-->`));
  if (parts.length !== 2) throw new Error(`index.html needs exactly one <!--${name}-->…<!--/${name}-->`);
  return parts.join(content);
}

/** The strip's characters: listed ones only (public, unheld, an account's, not deleted), from COMMUNITY's BEST. */
function strip(): Fighter[] {
  const creators = new Set<string>();
  const out: Fighter[] = [];
  for (const { entry } of rankedCommunity("best")) {
    if (creators.has(entry.owner)) continue;
    creators.add(entry.owner);
    out.push({ id: entry.id, name: entry.name ?? entry.id, tagline: entry.tagline ?? "" });
    if (out.length === STRIP) break;
  }
  return out;
}

function head(): string {
  const ld = {
    "@context": "https://schema.org", "@type": "VideoGame",
    name: C.name, url: SITE, description: C.description, image: `${SITE}og.jpg`,
    genre: ["Fighting", "Platform"], gamePlatform: "Web browser", applicationCategory: "Game", operatingSystem: "Any",
    playMode: ["SinglePlayer", "MultiPlayer"], inLanguage: "en", isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    screenshot: SHOTS.map((s) => `${SITE}screenshots/${s}.webp`),
    potentialAction: { "@type": "PlayAction", target: SITE },
  };
  return `<title>${esc(C.title)}</title>
  <meta name="description" content="${esc(C.description)}" />
  <link rel="canonical" href="${SITE}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(C.name)}" />
  <meta property="og:title" content="${esc(C.title)}" />
  <meta property="og:description" content="${esc(C.description)}" />
  <meta property="og:url" content="${SITE}" />
  <meta property="og:image" content="${SITE}og.jpg" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(C.ogImageAlt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(C.title)}" />
  <meta name="twitter:description" content="${esc(C.description)}" />
  <meta name="twitter:image" content="${SITE}og.jpg" />
  <meta name="twitter:image:alt" content="${esc(C.ogImageAlt)}" />
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
  <style>
#about { display: none; position: relative; margin-top: 100vh; padding-bottom: 1rem; color: #292722; font: 1.25rem/1.45 "Patrick Hand", "Comic Sans MS", cursive; -webkit-user-select: text; user-select: text;
  background: #f4efe4; background-image: linear-gradient(rgba(100,105,103,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(100,105,103,.09) 1px, transparent 1px);
  background-size: 32px 32px; border-top: 3px solid #292722; box-shadow: 0 -8px 0 rgba(41,39,34,.08); }
html.about #about { display: block; }
#about main { max-width: 68rem; margin: 0 auto; padding: 0 1.25rem 2rem; }
#about h1, #about h2, #about h3 { font-weight: normal; margin: 0; line-height: 1.05; }
#about h2 { font-size: 2.4rem; margin: 3.5rem 0 1.2rem; border-bottom: 3px solid #292722; padding-bottom: .25rem; }
#about h3 { font-size: 1.7rem; margin: .7rem 0 .2rem; }
#about p { margin: .3rem 0; }
#about a { color: inherit; text-decoration-thickness: 2px; text-underline-offset: 3px; }
#about img, #about video { display: block; max-width: 100%; height: auto; }
#about .card { background: #f4efe4; border: 1.5px solid #292722; box-shadow: 5px 6px 0 rgba(41,39,34,.08); }
#about .hero { display: grid; grid-template-columns: 1fr 1.25fr; gap: 2.5rem; align-items: center; padding-top: 3rem; }
#about h1 { font-size: clamp(3rem, 5.6vw, 5.2rem); letter-spacing: .01em; white-space: nowrap; }
#about h1 span { display: block; font-size: .42em; margin-left: .3em; }
#about h1::after { content: ""; display: block; height: 4px; margin-top: .2rem; background: #292722; border-radius: 2px; transform: rotate(-.6deg); }
#about .pitch { font-size: 1.6rem; margin: 1rem 0 1.4rem; }
#about .play { display: inline-block; font-size: 2.4rem; letter-spacing: .06em; text-decoration: none; padding: .35rem 2.6rem; border-width: 3px; outline: 1.5px solid #625e55; outline-offset: 4px; transform: rotate(-.4deg); }
#about .play:hover, #about .play:focus-visible { background: #fffaf0; transform: rotate(-.4deg) translateY(-2px); }
#about .note, #about footer { color: #625e55; }
#about .note { margin-top: 1rem; }
#about .clip { transform: rotate(.5deg); aspect-ratio: 16 / 9; width: 100%; }
#about .steps, #about .where { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.6rem; list-style: none; padding: 0; margin: 0; }
#about .where { grid-template-columns: repeat(2, 1fr); }
#about .steps img { aspect-ratio: 16 / 9; }
#about .fighters { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 1.2rem; list-style: none; padding: 0; margin: 1rem 0 0; }
#about .fighters li { padding: .4rem .6rem .7rem; text-align: center; overflow: hidden; }
#about .fighters li:nth-child(odd) { transform: rotate(-.6deg); }
#about .fighters li:nth-child(even) { transform: rotate(.5deg); }
#about .fighters img { width: 150%; max-width: none; aspect-ratio: 1; margin: -30% -25% -16%; }
#about .fighters b { display: block; font-weight: normal; font-size: 1.4rem; line-height: 1.1; }
#about .fighters small { display: block; color: #625e55; font-size: 1rem; line-height: 1.2; margin-top: .2rem; }
#about .facts { padding-left: 1.3rem; margin: 0; }
#about .facts li { margin: .3rem 0; }
#about .where li { padding: .8rem 1.1rem 1rem; }
#about footer { max-width: 68rem; margin: 1rem auto 0; padding: 1rem 1.25rem 1.5rem; display: flex; gap: 1.5rem; }
@media (max-width: 760px) {
  #about .hero { grid-template-columns: 1fr; gap: 1.5rem; padding-top: 1.5rem; }
  #about .steps, #about .where { grid-template-columns: 1fr; }
  #about .fighters { grid-template-columns: repeat(2, 1fr); gap: .9rem; }
  #about h1 { font-size: clamp(2.6rem, 13vw, 3.6rem); }
  #about h2 { font-size: 2rem; margin-top: 2.5rem; }
  #about .play { display: block; text-align: center; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media (prefers-reduced-motion: reduce) { #about .play:hover, #about .play:focus-visible { transform: rotate(-.4deg); } }
  </style>`;
}

/** The about sections. `base`: the game's path, where PLAY goes (client/src/about.ts scrolls up to it instead). */
function about(base: string, fighters: Fighter[]): string {
  const shot = (i: number): string =>
    `<img src="${base}screenshots/${SHOTS[i]}.webp" width="960" height="540" loading="lazy" decoding="async" alt="${esc(C.steps[i].alt)}">`;
  return `<div id="about">
<main>
<header class="hero">
<div>
<h1><span>SUPER</span>SKETCH DUDES</h1>
<p class="pitch">${esc(C.pitch)}</p>
<a class="play card up" href="${base}">${esc(C.play)}</a>
<p class="note">${esc(C.playNote)}</p>
</div>
<video class="clip card" muted loop playsinline preload="none" width="1280" height="720" aria-label="${esc(C.clipLabel)}">
<source src="${base}clip.mp4" type="video/mp4">
</video>
</header>

<section>
<h2>${esc(C.howTitle)}</h2>
<ol class="steps">
${C.steps.map((s, i) => `<li>${shot(i)}<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join("\n")}
</ol>
</section>

${fighters.length ? `<section>
<h2>${esc(C.fightersTitle)}</h2>
<p>${esc(C.fightersNote)}</p>
<ul class="fighters">
${fighters.map((f) => `<li class="card"><img src="${base}fighters/${encodeURIComponent(f.id)}.png" width="512" height="512" loading="lazy" decoding="async" alt="${esc(f.name)}"><b>${esc(f.name)}</b>${f.tagline ? `<small>${esc(f.tagline)}</small>` : ""}</li>`).join("\n")}
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
<li class="card"><h3>${esc(C.where[0].title)}</h3><p>${esc(C.where[0].text)}</p><p><a class="up" href="${base}">${esc(C.play)}</a></p></li>
<li class="card"><h3>${esc(C.where[1].title)}</h3><p>${esc(C.where[1].text)}</p></li>
</ul>
</section>
</main>
<footer><a href="${base}privacy">${esc(C.privacy)}</a><a href="${base}terms">${esc(C.terms)}</a></footer>
</div>`;
}

/** The game's index.html with the head's tags and the about sections. Vite's dev server uses it too, with no strip. */
export function frontPage(index: string, base: string, fighters: Fighter[]): string {
  return fill(fill(index, "front-head", head()), "front-body", about(base, fighters));
}

/**
 * The game page with the about sections, and the strip's pictures. Before the static files. `at` gives a path's
 * addresses (root and base), `base` is where the game is.
 */
export function attachHome(app: express.Express, opts: { at: (p: string) => string[]; base: string; indexFile: string; genDir: string }): void {
  const index = fs.readFileSync(opts.indexFile, "utf8");
  frontPage(index, opts.base, []); // its places are checked at boot, not at the first visit
  app.get([...opts.at("/"), ...opts.at("/index.html"), ...opts.at("/auth")], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(frontPage(index, opts.base, strip()));
  });
  // a listed character's idle cell, so a held or private one is never served here
  app.get(opts.at("/fighters/:id.png"), (req, res) => {
    const c = communityCharacters().find(({ entry }) => entry.id === req.params.id);
    if (!c) return res.status(404).end();
    const ver = path.basename(path.dirname(c.entry.bundleUrl!));
    const file = path.join(opts.genDir, c.entry.id, ver, "idle.png");
    if (!fs.existsSync(file)) throw new Error(`${c.entry.id} is listed without ${file}`);
    res.sendFile(file, { maxAge: "1h" });
  });
}
