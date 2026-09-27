import { site } from "../base";
import type { BrawlTally } from "../../../server/brawl-stats";

/** Kills and deaths from this browser's menu brawls, posted to the server's running totals once a minute and on the way out. */
const FLUSH_MS = 60_000;
let pending: BrawlTally = {};
let started = false;

export function tallyKo(victim: string, killer: string | null): void {
  if (!started) start();
  (pending[victim] ??= { kills: 0, deaths: 0 }).deaths++;
  if (killer) (pending[killer] ??= { kills: 0, deaths: 0 }).kills++;
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
