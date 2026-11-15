import { sessionList } from "./telemetry/events";

const SEEN = "sketchbattle.mobileNote";
const WORDS = "I'm still working on Mobile so it may have problems, if you have a computer, the game is way, WAY better on that so please try it there!";

/** Phones and tablets, once per device: the game is better on a computer. Lives in #stage so it turns with the game. */
export function mobileNote(): void {
  if (localStorage.getItem(SEEN)) return;
  const card = document.createElement("div");
  card.id = "mobile-note";
  card.innerHTML = `<div><p></p><button type="button">GOT IT</button></div>`;
  card.querySelector("p")!.textContent = WORDS;
  card.querySelector("button")!.addEventListener("click", () => {
    localStorage.setItem(SEEN, "1");
    card.remove();
    sessionList("bars", ["mobile note closed", Math.round(performance.now() / 100) / 10], 30);
  });
  document.getElementById("stage")!.append(card);
  sessionList("bars", ["mobile note", Math.round(performance.now() / 100) / 10], 30);
}
