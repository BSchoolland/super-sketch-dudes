// ===== EVERY WORD OF CHARACTER SHARING =====
// The character pages (server/share.ts: the head, the share card, the 404 page) and the game's SHARE and
// feature opt-in. Players, link previews and search engines read all of it. Plain text: whoever shows it escapes it.
// Never say "forge" here.
export const SHARE_COPY = {
  /** The page's <title> and its sharing title. */
  pageTitle: (name: string) => `${name} · Super Sketch Dudes`,
  /** The share card's alt text. */
  cardAlt: (name: string) => `${name}, a hand-drawn fighter in Super Sketch Dudes`,
  /** Small on the share card, under the name. */
  cardGame: "SUPER SKETCH DUDES",
  /** What the phone's share sheet sends with the link. */
  shareText: (name: string) => `Can you beat ${name}?`,

  notFoundTitle: "Not here · Super Sketch Dudes",
  notFoundHeading: "This character isn't here",
  notFoundText: "It may have been made private or taken down, or the link is wrong.",
  notFoundPlay: "PLAY SUPER SKETCH DUDES",
  share: "SHARE",
  copied: "link copied",
  copyFailed: (url: string) => `couldn't copy the link: ${url}`,
  /** Under your own character: what sharing it does. */
  ownNote: "Share it and your friends can fight it",
  featureOptIn: "OK to feature in our videos",
} as const;

/** The live site, which a character's link always points at (the Discord Activity's own address isn't one to send). */
export const SITE = "https://supersketchdudes.com/";
/** The path of a character's page, under the site's base. */
export const characterPath = (id: string): string => `c/${encodeURIComponent(id)}`;
/** What a share link's `?ref=` says: arrivals through one are the funnel's "share" source. */
export const SHARE_REF = "share";
/** The link a player sends: `site` is the site's root URL with its trailing slash. */
export const shareLink = (site: string, id: string): string => `${site}${characterPath(id)}?ref=${SHARE_REF}`;
/** A fighter id as a page path may carry it. */
export const SHARE_ID_RE = /^[\w-]{1,80}$/;
/** One SHARE press, on the page session's `shares` list (client/src/share.ts). `how`: the share sheet or the clipboard. */
export interface ShareEvent { fighter: string; mine: boolean; how: "sheet" | "copy" }
