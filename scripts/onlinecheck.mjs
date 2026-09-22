import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:5175/sketch-battle/";
const server = process.argv[3] ?? base;
const health = new URL("api/health", server.endsWith("/") ? server : `${server}/`);

function fail(message) {
  throw new Error(message);
}

let browser;
try {
  const response = await fetch(health);
  if (!response.ok) fail(`server health returned ${response.status} at ${health}`);

  browser = await chromium.launch();
  const pageA = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageB = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  for (const [name, page] of [["host", pageA], ["guest", pageB]]) {
    page.on("pageerror", (error) => errors.push(`${name} page error: ${error}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${name} console error: ${message.text()}`);
    });
  }

  async function press(page, key) {
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
  }

  async function openOnline(page) {
    await page.goto(base);
    await page.waitForFunction(() => window.sketchbattle?.screen);
    await press(page, "ArrowDown");
    await press(page, "KeyJ");
    await page.waitForFunction(() => "roomCode" in window.sketchbattle.screen);
    await page.waitForTimeout(200);
  }

  await openOnline(pageA);
  await press(pageA, "ArrowDown");
  await press(pageA, "Space");
  await pageA.waitForFunction(() => window.sketchbattle.screen.roomCode !== null);
  const code = await pageA.evaluate(() => window.sketchbattle.screen.roomCode);
  if (!/^[A-Z2-9]{4}$/.test(code)) fail(`invalid room code ${code}`);

  await openOnline(pageB);
  await press(pageB, "ArrowDown");
  await press(pageB, "ArrowDown");
  await press(pageB, "Space");
  await pageB.keyboard.type(code, { delay: 30 });
  await press(pageB, "Enter");

  await Promise.all([
    pageA.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.length === 2),
    pageB.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.length === 2),
  ]);
  await press(pageA, "Space");
  await press(pageB, "Space");
  await Promise.all([
    pageA.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.every((member) => member.ready)),
    pageB.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.every((member) => member.ready)),
  ]);
  await press(pageA, "Escape");

  await Promise.all([
    pageA.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function"),
    pageB.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function"),
  ]);
  await pageA.waitForTimeout(20_000);

  const currentA = await pageA.evaluate(() => window.sketchbattle.screen.netDebug());
  const currentB = await pageB.evaluate(() => window.sketchbattle.screen.netDebug());
  const frame = Math.min(currentA.frame, currentB.frame);
  const stateA = await pageA.evaluate((target) => window.sketchbattle.screen.netDebug(target), frame);
  const stateB = await pageB.evaluate((target) => window.sketchbattle.screen.netDebug(target), frame);
  if (stateA.hash === null || stateB.hash === null) fail(`frame ${frame} fell outside a rollback history`);
  if (stateA.hash !== stateB.hash) fail(`hash mismatch at frame ${frame}: ${stateA.hash} !== ${stateB.hash}`);
  if (errors.length) fail(errors.join("\n"));

  console.log("PASS onlinecheck");
  console.log(`room ${code}`);
  console.log(`frame ${frame}`);
  console.log(`hash ${stateA.hash}`);
} catch (error) {
  console.error("FAIL onlinecheck");
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
