import type { CharStatus } from "./draw";

/** A signed-in player: a Discord identity or an email account. The id is the account. */
export interface Player {
  id: string;
  name: string;
  /** Avatar image URL, if Discord has one; email accounts never do. */
  avatar: string | null;
}

/** One character in a player's library: a forge job's outcome, from queued to ready. */
export interface LibraryEntry {
  /** The fighter id (roster key), also the folder under /gen. */
  id: string;
  owner: string;
  status: CharStatus;
  stage: string;
  error: string | null;
  name: string | null;
  tagline: string | null;
  description: string | null;
  card: string[] | null;
  drawingUrl: string;
  bundleUrl: string | null;
  sheetUrl: string | null;
  createdAt: number;
  /** Drawn in the creator, or in a draw battle room. */
  origin: "creator" | { room: string; round: number };
  /** In every player's library from the start (a reference fighter); can't be deleted. */
  starter?: boolean;
}

/** Header the client sends its session token in. */
export const SESSION_HEADER = "x-session";

/**
 * A fighter bundle a room member may name: a same-site path to a forged fighter or a house one,
 * whose folder is the fighter id. Bundles carry code every client runs, so nothing else is allowed.
 */
export function isBundlePath(url: string, fighter: string): boolean {
  const m = /^\/(?:[\w-]+\/)*(?:gen|house)\/([\w-]+)\/(?:[0-9a-f]{8}\/)?bundle\.json(?:\?v=[\w.-]+)?$/.exec(url);
  return !!m && m[1] === fighter;
}

/** The card lines to show. Cards made before grab left the game carry a GRAB line. */
export const cardLines = (card: string[] | null | undefined): string[] => (card ?? []).filter((l) => !/^GRAB\b/i.test(l));
