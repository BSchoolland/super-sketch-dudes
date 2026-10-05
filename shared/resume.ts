/** Mid-match, a relay socket that broke keeps its player's slot this long for a fresh socket to resume it. */
export const RESUME_GRACE_MS = 15_000;
/** Close codes: the relay replaced this socket with a resumed one; the relay can't catch a resuming client up. */
export const CLOSE_SUPERSEDED = 4002;
export const CLOSE_CANNOT_RESUME = 4003;
