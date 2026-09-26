import { running, type Mix } from "./engine";

/**
 * One song at a time from ./music, picked at random and looped. Battles play it open; every other
 * screen plays a different one muffled, as if through a wall.
 */
const TRACKS = Object.values(import.meta.glob<string>("./music/*.{mp3,m4a,ogg,opus}", { eager: true, query: "?url", import: "default" }));
if (!TRACKS.length) throw new Error("no battle music in client/src/audio/music");

const MUFFLED = 650, OPEN = 20000;

interface Player { c: AudioContext; el: HTMLAudioElement; duck: GainNode; tone: BiquadFilterNode }
let player: Player | null = null;
/** The battle screen the song belongs to; null for the menus, undefined before anything plays. */
let owner: object | null | undefined;
let muffled = false;
let last = -1;

function build(m: Mix & { c: AudioContext }): Player {
  const el = new Audio();
  el.loop = true;
  el.preload = "auto";
  const src = m.c.createMediaElementSource(el);
  const tone = m.c.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = OPEN; tone.Q.value = 0.5;
  const duck = m.c.createGain(); duck.gain.value = 0;
  src.connect(tone); tone.connect(duck); duck.connect(m.music);
  return { c: m.c, el, duck, tone };
}

function ramp(c: AudioContext, p: AudioParam, to: number, secs: number, exp = false): void {
  const t = c.currentTime;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  if (exp) p.exponentialRampToValueAtTime(to, t + secs); else p.linearRampToValueAtTime(to, t + secs);
}

/** A new random track (never the one just played), faded in. False until audio is unlocked. */
function playNew(filter: number): boolean {
  const m = running();
  if (!m) return false;
  player ??= build(m);
  let pick = Math.floor(Math.random() * TRACKS.length);
  if (TRACKS.length > 1 && pick === last) pick = (pick + 1) % TRACKS.length;
  last = pick;
  player.el.src = TRACKS[pick];
  player.el.play().catch((err) => console.error("music failed to start", err));
  const t = player.c.currentTime;
  player.duck.gain.cancelScheduledValues(t);
  player.duck.gain.setValueAtTime(0, t);
  player.duck.gain.linearRampToValueAtTime(1, t + 0.8);
  player.tone.frequency.cancelScheduledValues(t);
  player.tone.frequency.setValueAtTime(filter, t);
  muffled = filter === MUFFLED;
  return true;
}

export const music = {
  /** Every frame, from the shell: the battle screen, or null anywhere else. Entering a battle, a rematch, or leaving for the menus changes the song. */
  follow(battle: object | null): void {
    if (battle !== owner && playNew(battle ? OPEN : MUFFLED)) owner = battle;
  },
  /** Paused or on the results screen, the battle song drops behind the wall too. */
  muffle(on: boolean): void {
    if (!owner || !player || on === muffled) return;
    muffled = on;
    ramp(player.c, player.tone.frequency, on ? MUFFLED : OPEN, 0.35, true);
  },
  /** A KO: the song ducks under the boom and comes back. */
  duck(): void {
    if (!owner || !player) return;
    const g = player.duck.gain, t = player.c.currentTime;
    ramp(player.c, g, 0.3, 0.04);
    g.setValueAtTime(0.3, t + 0.5);
    g.linearRampToValueAtTime(1, t + 1.8);
  },
};
