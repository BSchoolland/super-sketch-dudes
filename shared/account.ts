export type CharStatus = "queued" | "generating" | "ready" | "failed";

/** A signed-in player: a Discord or Google identity, or an email account. The id is the account. */
export interface Player {
  id: string;
  name: string;
  /** Avatar image URL, if Discord or Google has one; email accounts never do. */
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
  drawingUrl: string;
  bundleUrl: string | null;
  sheetUrl: string | null;
  createdAt: number;
  /** Old entries may name the draw battle room they were drawn in. */
  origin: "creator" | { room: string; round: number };
  /** In every player's library from the start (a reference fighter); can't be deleted. */
  starter?: boolean;
  /** Listed in COMMUNITY for anyone to save. */
  public: boolean;
  /** In another player's library because they saved it; they can unsave it, not delete it. */
  saved?: boolean;
  /** Its creator deleted it while others had it saved: gone from theirs and from COMMUNITY, kept for the savers. */
  deleted?: boolean;
}

/** A character in COMMUNITY, as the caller sees it. */
export interface CommunityCharacter extends Pick<LibraryEntry, "id" | "name" | "tagline" | "drawingUrl" | "createdAt"> {
  bundleUrl: string;
  creator: Pick<Player, "name" | "avatar">;
  saves: number;
  /** In the caller's library by reference. */
  saved: boolean;
  /** The caller made it. */
  mine: boolean;
}
export type CommunitySort = "popular" | "new";
export const COMMUNITY_PAGE = 36;

/** Longest side of the drawing the client uploads; the server rejects bigger. */
export const DRAW_PNG_MAX_BYTES = 900_000;

/** The Google OAuth client (project super-sketch-dudes) whose ID tokens the server accepts. */
export const GOOGLE_CLIENT_ID = "568376323404-395dbb6rf9c6p8n3mhnd1obh4u4r1gc3.apps.googleusercontent.com";

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

