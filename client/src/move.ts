/**
 * The game moved from bschoolland.dev to supersketchdudes.com. Browser storage belongs to one host, so a page on
 * the old host carries this browser's game storage (sign-in, settings, where they first came from) across in the
 * URL fragment, which never reaches a server, and the new host takes it in if it has no sign-in of its own.
 */
export const OLD_HOST = "bschoolland.dev";
export const NEW_ORIGIN = "https://supersketchdudes.com";
const PREFIX = "sketchbattle.";
const MARK = "carry=";

export interface Here { host: string; pathname: string; search: string; hash: string }

/** Where to send this page, or null to stay. The old host's /auth is left alone: it holds a sign-in in progress. */
export function moveTo(here: Here, storage: Storage): string | null {
  if (here.host !== OLD_HOST || here.pathname.endsWith("/auth")) return null;
  const kept: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)!;
    if (k.startsWith(PREFIX)) kept[k] = storage.getItem(k)!;
  }
  return `${NEW_ORIGIN}${here.pathname}${here.search}#${MARK}${encodeURIComponent(JSON.stringify(kept))}`;
}

/** Takes in storage carried from the old host; returns the hash to leave in the address bar. */
export function takeCarried(here: Here, storage: Storage): string {
  if (!here.hash.startsWith(`#${MARK}`)) return here.hash;
  const kept = JSON.parse(decodeURIComponent(here.hash.slice(1 + MARK.length))) as Record<string, unknown>;
  if (storage.getItem(`${PREFIX}account`) === null) {
    for (const [k, v] of Object.entries(kept)) if (k.startsWith(PREFIX) && typeof v === "string") storage.setItem(k, v);
  }
  return "";
}
