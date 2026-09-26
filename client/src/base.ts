/**
 * Where the site lives and which build this is. Set at mount: a game bundle is served from
 * /games/<hash>/ but talks to the site's /api and /ws, so the URL prefix can't come from the
 * bundle's own location.
 */
export const site = { base: import.meta.env.BASE_URL, build: __BUILD__, paper: import.meta.env.VITE_PAPER || "#f4efe4" };

export function setSiteBase(base: string): void {
  site.base = base.endsWith("/") ? base : base + "/";
}
