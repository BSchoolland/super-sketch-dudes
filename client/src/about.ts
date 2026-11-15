/**
 * The front page's about sections, which the server puts under the canvas (server/home.ts). They are shown, and the
 * page scrolls, only while open: the title screen's tab opens them, PLAY or scrolling back to the top closes them.
 * Nothing of them loads until then; the clip plays only while they're open.
 */
const sections = document.getElementById("about");
const clip = sections?.querySelector("video");
if (sections && !clip) throw new Error("the about sections have no clip");
const root = document.documentElement;

/** This page has the sections (the front page; not the shell's). */
export const hasAbout = sections !== null;

export const aboutOpen = (): boolean => root.classList.contains("about");

export function openAbout(): void {
  if (!sections || !clip) throw new Error("this page has no about sections");
  root.classList.add("about");
  sections.scrollIntoView({ block: "start" });
  // closing them before it starts interrupts it
  clip.play().catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) throw error; });
}

function shut(): void {
  root.classList.remove("about");
  clip!.pause();
}

/** At once, wherever the page was: something other than the title screen is up. */
export function closeAbout(): void {
  if (!aboutOpen()) return;
  shut();
  window.scrollTo({ top: 0, behavior: "instant" });
}

if (sections) {
  window.addEventListener("scroll", () => { if (window.scrollY === 0 && aboutOpen()) shut(); }, { passive: true });
  sections.querySelectorAll<HTMLAnchorElement>("a.up").forEach((up) => {
    up.addEventListener("click", (e) => {
      e.preventDefault();
      up.blur();
      window.scrollTo({ top: 0 });
    });
  });
}
