import { SHARE_COPY as C, SITE, SHARE_ID_RE, shareLink, type ShareEvent } from "../../shared/share";
import type { LibraryEntry } from "../../shared/account";
import { site } from "./base";
import { activity } from "./activity";
import { sessionList } from "./telemetry/events";

/**
 * SHARE on a character's page: the device's share sheet where there is one, else the link onto the clipboard. The
 * link is the character's page on the website (server/share.ts) with `?ref=share`; inside the Discord Activity it is
 * still the website's. Off in the CrazyGames build: no links out of their frame.
 */
export const sharing = { shown: true };

/** The character a page opened on: `<base>c/<id>`, else null. */
export function sharedIdOf(pathname: string, base: string): string | null {
  if (!pathname.startsWith(`${base}c/`)) return null;
  const id = decodeURIComponent(pathname.slice(base.length + 2).replace(/\/$/, ""));
  return SHARE_ID_RE.test(id) ? id : null;
}

export const linkTo = (id: string): string => shareLink(activity ? SITE : `${location.origin}${site.base}`, id);

/** A character can have a page: finished, public, not held, not deleted (server/library.ts `isShareable`). */
export const canShare = (e: Pick<LibraryEntry, "status" | "bundleUrl" | "public" | "held" | "deleted">): boolean =>
  sharing.shown && e.status === "ready" && !!e.bundleUrl && e.public && !e.held && !e.deleted;

/**
 * Shares the character's link. Resolves to what to tell the player ("link copied"), or null when the share sheet
 * took it or was closed. A failure is the player's to read, with the link in it so they can still copy it.
 */
export async function shareCharacter(c: { id: string; name: string | null }, mine: boolean): Promise<string | null> {
  const url = linkTo(c.id);
  const note = (how: ShareEvent["how"]): void => sessionList("shares", { fighter: c.id, mine, how } satisfies ShareEvent);
  const data = { title: C.pageTitle(c.name ?? "?"), text: C.shareText(c.name ?? "?"), url };
  if (!activity && typeof navigator.share === "function" && navigator.canShare?.(data) !== false) {
    try {
      await navigator.share(data);
      note("sheet");
      return null;
    } catch (error) {
      // the player closed the sheet
      if (error instanceof DOMException && error.name === "AbortError") return null;
      console.error("share sheet failed", error);
      throw new Error(C.copyFailed(url));
    }
  }
  try {
    if (!navigator.clipboard) throw new Error("no clipboard on this page");
    await navigator.clipboard.writeText(url);
  } catch (error) {
    console.error("copying the share link failed", error);
    throw new Error(C.copyFailed(url));
  }
  note("copy");
  return C.copied;
}
