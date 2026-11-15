import { HOME_COPY } from "../../server/home-copy";

/**
 * The game is played with a keyboard, mouse or controller. A device with no fine pointer (no mouse, trackpad or pen)
 * and no gamepad gets a card instead, and the page under it is the about sections, a plain web page. A gamepad
 * connecting starts the game. main.ts decides before any of the game loads.
 */
const SITE = "https://supersketchdudes.com/";
const C = HOME_COPY.phoneCard;
const root = document.documentElement;

export function phoneCardWanted(): boolean {
  return !matchMedia("(any-pointer: fine)").matches && !navigator.getGamepads?.().some(Boolean);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}

/** Shows the card until a gamepad connects, then takes it down and resolves with the gamepad. */
export function showPhoneCard(): Promise<Gamepad> {
  const about = document.getElementById("about");
  const ac = new AbortController();
  const signal = ac.signal;

  const card = el("section");
  card.id = "phone-card";
  const name = el("h1");
  const [first, ...rest] = HOME_COPY.name.toUpperCase().split(" ");
  name.append(el("span", first), rest.join(" "));
  const share = el("button", C.share);
  share.type = "button";
  const said = el("output");
  card.append(name, el("p", C.text), share, said);
  if (about) {
    const more = el("a", HOME_COPY.tab, "more");
    more.href = "#about";
    more.insertAdjacentHTML("beforeend", `<svg viewBox="0 0 20 12" aria-hidden="true"><path d="M2 2 L10 10 L18 2"/></svg>`);
    card.append(more);
    about.before(card);
  } else document.body.append(card);
  root.classList.add("phone");

  share.addEventListener("click", () => {
    said.textContent = "";
    if (navigator.share) {
      navigator.share({ title: HOME_COPY.name, url: SITE }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      });
      return;
    }
    Promise.resolve().then(() => navigator.clipboard.writeText(SITE)).then(
      () => { said.textContent = C.copied; },
      (error: unknown) => { said.textContent = C.copyFailed; throw error; },
    );
  }, { signal });

  if (about) {
    const clip = about.querySelector("video");
    if (!clip) throw new Error("the about sections have no clip");
    // the PLAY links come back up to the card; the clip plays while it's on screen
    about.querySelectorAll<HTMLAnchorElement>("a.up").forEach((up) => up.addEventListener("click", (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0 });
    }, { signal }));
    const seen = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { clip.pause(); return; }
      clip.play().catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) throw error; });
    });
    seen.observe(clip);
    signal.addEventListener("abort", () => { seen.disconnect(); clip.pause(); });
  }

  return new Promise((resolve) => {
    window.addEventListener("gamepadconnected", (e) => {
      ac.abort();
      card.remove();
      root.classList.remove("phone");
      window.scrollTo({ top: 0, behavior: "instant" });
      resolve(e.gamepad);
    }, { signal });
  });
}
