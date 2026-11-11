import { mount } from "./app";
import { moveTo, takeCarried } from "./move";

// The game moved hosts: the old one sends this browser, with its sign-in, to the new one
const to = moveTo(location, localStorage);
if (to) {
  location.replace(to);
} else {
  const hash = takeCarried(location, localStorage);
  if (hash !== location.hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  // The classic single-build page: one bundle, mounted once. shell.html is the swappable version.
  await mount({ canvas: document.getElementById("game") as HTMLCanvasElement, base: import.meta.env.BASE_URL, params: new URLSearchParams(location.search) });
}
