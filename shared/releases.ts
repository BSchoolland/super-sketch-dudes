/** What a release adds that's worth a NEW sticker: the title's CHARACTERS button and the COMMUNITY tab inside it. */
export type Fresh = "characters" | "community";

/** A version that shows returning players a card the first time they play it. */
export interface Release {
  version: string;
  title: string;
  /** Ben's note, one paragraph per entry. */
  note: string[];
  fresh: Fresh[];
}

/** Oldest first. */
export const RELEASES: Release[] = [
  {
    version: "0.2.0",
    title: "COMMUNITY CHARACTERS UPDATE",
    note: ["TODO(Ben): the update note."],
    fresh: ["characters", "community"],
  },
];

/** How long NEW stickers stay up after a player first plays the release that added them. */
export const FRESH_MS = 2 * 24 * 60 * 60 * 1000;

/** -1, 0 or 1 as version a is older than, the same as or newer than b ("0.10.0" is newer than "0.9.3"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** The releases a player last on `from` hasn't seen yet, up to `to`, oldest first. */
export function releasesSince(from: string, to: string): Release[] {
  return RELEASES.filter((r) => compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0);
}
