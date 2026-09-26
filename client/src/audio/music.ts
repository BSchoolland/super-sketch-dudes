import { live } from "./engine";

/** Battle music: every file in ./music, one picked at random per battle, looped. */
const TRACKS = Object.values(import.meta.glob<string>("./music/*.{mp3,m4a,ogg,opus}", { eager: true, query: "?url", import: "default" }));
if (!TRACKS.length) throw new Error("no battle music in client/src/audio/music");

let el: HTMLAudioElement | null = null;
let chain: { duck: GainNode; tone: BiquadFilterNode } | null = null;
let last = -1;

function player(): { el: HTMLAudioElement; duck: GainNode; tone: BiquadFilterNode } {
  if (!el || !chain) {
    const m = live();
    el = new Audio();
    el.loop = true;
    el.preload = "auto";
    const src = m.c.createMediaElementSource(el);
    const tone = m.c.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 20000; tone.Q.value = 0.5;
    const duck = m.c.createGain(); duck.gain.value = 0;
    src.connect(tone); tone.connect(duck); duck.connect(m.music);
    chain = { duck, tone };
  }
  return { el, ...chain };
}

export class Music {
  private on = false;
  private muffled = false;

  start(): void {
    if (this.on) return;
    this.on = true;
    const p = player();
    let pick = Math.floor(Math.random() * TRACKS.length);
    if (TRACKS.length > 1 && pick === last) pick = (pick + 1) % TRACKS.length;
    last = pick;
    p.el.src = TRACKS[pick];
    p.el.currentTime = 0;
    p.el.play().catch((err) => console.error("battle music failed to start", err));
    const t = p.duck.context.currentTime;
    p.duck.gain.cancelScheduledValues(t);
    p.duck.gain.setValueAtTime(0, t);
    p.duck.gain.linearRampToValueAtTime(1, t + 0.8);
    p.tone.frequency.setValueAtTime(20000, t);
    this.muffled = false;
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    const p = player();
    const t = p.duck.context.currentTime;
    p.duck.gain.cancelScheduledValues(t);
    p.duck.gain.setValueAtTime(p.duck.gain.value, t);
    p.duck.gain.linearRampToValueAtTime(0, t + 0.25);
    const which = p.el.src;
    setTimeout(() => { if (!this.on && p.el.src === which) p.el.pause(); }, 300);
  }

  /** Paused or on the results screen, the song drops behind a wall. */
  muffle(on: boolean): void {
    if (!this.on || on === this.muffled) return;
    this.muffled = on;
    const p = player();
    const t = p.tone.context.currentTime;
    p.tone.frequency.cancelScheduledValues(t);
    p.tone.frequency.setValueAtTime(p.tone.frequency.value, t);
    p.tone.frequency.exponentialRampToValueAtTime(on ? 650 : 20000, t + 0.35);
  }

  /** A KO: the song ducks under the boom and comes back. */
  duck(): void {
    if (!this.on) return;
    const p = player();
    const t = p.duck.context.currentTime;
    p.duck.gain.cancelScheduledValues(t);
    p.duck.gain.setValueAtTime(p.duck.gain.value, t);
    p.duck.gain.linearRampToValueAtTime(0.3, t + 0.04);
    p.duck.gain.setValueAtTime(0.3, t + 0.5);
    p.duck.gain.linearRampToValueAtTime(1, t + 1.8);
  }
}
