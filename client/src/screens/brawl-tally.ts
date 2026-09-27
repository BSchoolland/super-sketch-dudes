import { site } from "../base";
import type { BrawlRow, BrawlTally } from "../../../server/brawl-stats";

/** Kills, deaths, time survived and damage dealt from this browser's menu brawls, posted to the server's running totals once a minute and on the way out. */
const FLUSH_MS = 60_000;
let pending: BrawlTally = {};
let started = false;

const row = (id: string): BrawlRow => pending[id] ??= { kills: 0, deaths: 0, lives: 0, survivedSec: 0, dealt: 0, dealtLives: 0 };

/** `survivedSec` is how long the victim lasted from dropping in, `dealt` the damage it did in that time. */
export function tallyKo(victim: string, killer: string | null, survivedSec: number, dealt: number): void {
  if (!started) start();
  const v = row(victim);
  v.deaths++; v.lives++; v.survivedSec += Math.round(survivedSec);
  v.dealtLives++; v.dealt += Math.round(dealt);
  if (killer) row(killer).kills++;
}

function start(): void {
  started = true;
  window.setInterval(() => flush(false), FLUSH_MS);
  window.addEventListener("pagehide", () => flush(true));
}

function flush(beacon: boolean): void {
  if (!Object.keys(pending).length) return;
  const url = `${site.base}api/brawl-stats`;
  const body = JSON.stringify(pending);
  pending = {};
  if (beacon) {
    if (!navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) console.error(`brawl stats: sendBeacon refused ${body.length} bytes`);
    return;
  }
  fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body, keepalive: true }).then(
    (res) => { if (!res.ok) console.error(`brawl stats: HTTP ${res.status}`); },
    (error: unknown) => console.error("brawl stats: send failed", error),
  );
}
