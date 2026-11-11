/**
 * Takes in the game storage a browser carried from the game's old host (server/oldhost.ts) in the URL fragment,
 * unless this host already has a sign-in of its own. Returns the hash to leave in the address bar.
 */
const PREFIX = "sketchbattle.";
const MARK = "#carry=";

export function takeCarried(hash: string, storage: Storage): string {
  if (!hash.startsWith(MARK)) return hash;
  const kept = JSON.parse(decodeURIComponent(hash.slice(MARK.length))) as Record<string, unknown>;
  if (storage.getItem(`${PREFIX}account`) === null) {
    for (const [k, v] of Object.entries(kept)) if (k.startsWith(PREFIX) && typeof v === "string") storage.setItem(k, v);
  }
  return "";
}
