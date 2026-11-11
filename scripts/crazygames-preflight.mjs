// Is the CrazyGames page ready to submit? CrazyGames frames our own URL (ARCHITECTURE.md, CrazyGames), so there is no
// zip: this checks the URL and prints it.
//   1. the page loads and nothing forbids framing it (X-Frame-Options, CSP frame-ancestors)
//   2. the server can check CrazyGames sign-ins (CRAZYGAMES_GAME_ID is set: a junk token is refused, not a 500)
//   3. a browser reaches the title as a guest (the SDK forced into its local mode, logged out), with the bytes and
//      seconds it took, against CrazyGames' limits: 50 MB initial download (20 MB for the mobile homepage), 20 s
// Step 3 makes one guest on that server (swept after 7 days).
// Usage: node scripts/crazygames-preflight.mjs [url]   (default https://supersketchdudes.com/crazygames)
import { chromium } from "playwright";

const url = process.argv[2] ?? "https://supersketchdudes.com/crazygames";
const problems = [];
const say = (ok, line) => { console.log(`${ok ? "ok  " : "FAIL"} ${line}`); if (!ok) problems.push(line); };

const page = await fetch(url);
const html = await page.text();
say(page.ok && html.includes('id="game"'), `${url}: HTTP ${page.status}, ${page.headers.get("content-type")}`);
const xfo = page.headers.get("x-frame-options"), csp = page.headers.get("content-security-policy") ?? "";
say(!xfo, `X-Frame-Options: ${xfo ?? "none"}`);
say(!/frame-ancestors/.test(csp) || /crazygames\.com/.test(csp), `CSP frame-ancestors: ${/frame-ancestors[^;]*/.exec(csp)?.[0] ?? "none"}`);

const api = new URL("../api/auth/crazygames", url.endsWith("/") ? url : `${url}/`);
const auth = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "preflight.not.a-token" }) });
const why = (await auth.json()).error;
say(auth.status === 401, `CrazyGames sign-in check: ${auth.status} ${why}`);

const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const sizes = [];
  p.on("requestfinished", (r) => sizes.push(r.sizes()));
  const t0 = Date.now();
  await p.goto(`${url}?useLocalSdk=true&token_response=logged_out&user_response=logged_out`);
  await p.waitForFunction(() => window.sketchbattle?.screen?.constructor.name === "TitleScreen", null, { timeout: 60000 });
  const seconds = (Date.now() - t0) / 1000;
  const mb = (await Promise.all(sizes)).reduce((n, s) => n + s.responseBodySize + s.responseHeadersSize, 0) / 1e6;
  say(seconds <= 20, `title as a guest in ${seconds.toFixed(1)} s (limit 20 s; CrazyGames counts to the first gameplayStart, one click on)`);
  say(mb <= 50, `downloaded ${mb.toFixed(1)} MB to the title (limit 50 MB; ${mb <= 20 ? "under" : "over"} the 20 MB mobile homepage limit)`);
} finally {
  await browser.close();
}

if (problems.length) { console.log(`\nnot ready: ${problems.length} problem(s)`); process.exitCode = 1; }
else console.log(`\nready: give CrazyGames this URL as the game's iframe URL\n  ${url}`);
