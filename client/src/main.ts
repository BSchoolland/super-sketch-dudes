import { takeCarried } from "./move";
import { activityLaunch } from "./activity";
import { phoneCardWanted, showPhoneCard } from "./phone";
import { notePhoneCardGamepad, startTelemetry } from "./telemetry/events";

// a browser sent here from the game's old host brings its sign-in along in the fragment
const hash = takeCarried(location.hash, localStorage);
if (hash !== location.hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
// Phones get the card and none of the game, unless a gamepad connects. The Activity is the game wherever it runs.
let telemetry: (() => void) | undefined;
if (!activityLaunch(params, location.host, import.meta.env.DEV) && phoneCardWanted()) {
  telemetry = startTelemetry({ canvas, bundle: "", phoneCard: true });
  notePhoneCardGamepad(await showPhoneCard());
}
// The classic single-build page: one bundle, mounted once. shell.html is the swappable version.
const { mount } = await import("./app");
await mount({ canvas, base: import.meta.env.BASE_URL, params, telemetry });
