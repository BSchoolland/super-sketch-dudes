import { bell, fm, noise, semis, tone, type Voice } from "./synth";

/**
 * The sound set: sketchbook foley with arcade punch. Menus are pencil ticks, marker caps and
 * eraser swipes; fights are paper smacks over a real thump, and KOs tear the page.
 */

// ---- fight -------------------------------------------------------------------------------

/** The shared core of every hit: a snap, a pitched thump and a paper smack, all scaled by damage. */
function impact(v: Voice, d: number): void {
  const s = Math.min(1, d / 24);
  noise(v, { type: "highpass", f: 2600, q: 0.7, dur: 0.03, gain: 0.45 + s * 0.2 });
  tone(v, { f: 210 - s * 90, to: 48, glideTime: 0.07 + s * 0.08, dur: 0.1 + s * 0.2, gain: 0.55 + s * 0.35, drive: 1.5 + s * 2.5 });
  noise(v, { src: "crackle", type: "bandpass", f: 2200 - s * 700, q: 0.9, dur: 0.07 + s * 0.12, gain: 0.8 + s * 0.4, rate: 1.3 - s * 0.4 });
  noise(v, { type: "lowpass", f: 1400 - s * 600, to: 200, dur: 0.08 + s * 0.14, gain: 0.35 + s * 0.3 });
}

const FX: Record<string, (v: Voice, d: number) => void> = {
  /** Sweet spot: a clean struck-bar ding over the hit. */
  tip(v) {
    v.send.gain.value = 0.35;
    bell(v, { f: 1568, dur: 0.9, gain: 0.32 });
    tone(v, { f: 3136, dur: 0.18, gain: 0.08, type: "triangle" });
  },
  heavy(v, d) {
    v.send.gain.value = 0.28;
    tone(v, { f: 70, to: 32, dur: 0.45, gain: 0.7, drive: 2 });
    noise(v, { type: "lowpass", f: 900, to: 120, q: 0.8, dur: 0.35, gain: 0.45 + d * 0.01, drive: 3 });
  },
  energy(v) {
    v.send.gain.value = 0.22;
    fm(v, { f: 880, to: 180, ratio: 1.41, index: 6, indexTo: 0.5, dur: 0.22, gain: 0.26 });
    noise(v, { type: "bandpass", f: 5000, to: 1500, q: 3, dur: 0.18, gain: 0.3 });
  },
  slash(v) {
    v.send.gain.value = 0.2;
    noise(v, { type: "bandpass", f: 7000, to: 2400, q: 5, dur: 0.14, gain: 0.55 });
    bell(v, { f: 2350, dur: 0.35, gain: 0.12, partials: [1, 1.51, 2.37] });
  },
  quake(v) {
    v.send.gain.value = 0.3;
    noise(v, { type: "lowpass", f: 180, q: 1.2, dur: 0.7, gain: 0.9, trem: [17, 0.8], drive: 2 });
    tone(v, { f: 44, to: 30, dur: 0.6, gain: 0.6 });
  },
  /** Counter-style hits: a hard wood knock. */
  guard(v) {
    v.send.gain.value = 0.25;
    tone(v, { f: 620, to: 560, dur: 0.12, gain: 0.35, type: "triangle" });
    tone(v, { f: 1480, dur: 0.06, gain: 0.15 });
    noise(v, { type: "bandpass", f: 950, q: 9, dur: 0.1, gain: 0.5 });
  },
  burst(v) {
    v.send.gain.value = 0.35;
    noise(v, { type: "lowpass", f: 2400, to: 160, q: 0.6, dur: 0.55, gain: 0.7, drive: 3 });
    tone(v, { f: 60, to: 28, dur: 0.5, gain: 0.6 });
  },
  fire(v) {
    noise(v, { src: "crackle", type: "highpass", f: 1400, dur: 0.4, gain: 0.9, rate: 1.6 });
    noise(v, { type: "bandpass", f: 3000, to: 900, q: 0.6, dur: 0.3, gain: 0.25 });
  },
};

export function hit(v: Voice, damage: number, fx: string, kb: number): void {
  impact(v, damage);
  const extra = FX[fx] ?? (damage >= 14 ? FX.heavy : undefined);
  extra?.(v, damage);
  if (kb > 140) launch(v, kb);
}

/** A big launch: wind tearing past, longer the harder they fly. */
function launch(v: Voice, kb: number): void {
  const s = Math.min(1, (kb - 140) / 160);
  v.send.gain.value = Math.max(v.send.gain.value, 0.3);
  noise(v, { type: "bandpass", f: 500, to: 2600, q: 1.6, dur: 0.45 + s * 0.35, gain: 0.3 + s * 0.2, attack: 0.03, delay: 0.03 });
  noise(v, { type: "highpass", f: 6000, dur: 0.3, gain: 0.15, delay: 0.03 });
}

/** Rubbery bubble shield: a hollow bwomp and a plastic tick. */
export function shieldHit(v: Voice, damage: number): void {
  const s = Math.min(1, damage / 20);
  fm(v, { f: 330 - s * 80, to: 240 - s * 60, ratio: 0.5, index: 2.5, indexTo: 0.2, dur: 0.16 + s * 0.1, gain: 0.35 + s * 0.2 });
  noise(v, { type: "bandpass", f: 2600, q: 5, dur: 0.04, gain: 0.4 });
}

export function parry(v: Voice): void {
  v.send.gain.value = 0.45;
  noise(v, { type: "highpass", f: 4000, dur: 0.08, gain: 0.4 });
  bell(v, { f: 2637, dur: 1.1, gain: 0.3 });
  bell(v, { f: 3951, dur: 0.8, gain: 0.18, delay: 0.05 });
  noise(v, { type: "bandpass", f: 1800, to: 6000, q: 2, dur: 0.18, gain: 0.25 });
}

/** Ceramic shatter, then a dizzy wobble falling away. */
export function shieldBreak(v: Voice): void {
  v.send.gain.value = 0.4;
  noise(v, { src: "crackle", type: "highpass", f: 2800, dur: 0.8, gain: 1.4, rate: 0.8 });
  noise(v, { type: "highpass", f: 5000, dur: 0.25, gain: 0.35 });
  for (let i = 0; i < 6; i++) bell(v, { f: 2200 + Math.random() * 4000, dur: 0.35, gain: 0.08, delay: i * 0.035 + Math.random() * 0.03, partials: [1, 2.3] });
  tone(v, { f: 520, to: 90, dur: 0.9, gain: 0.25, type: "triangle", vib: [9, 30], delay: 0.1 });
}

export function land(v: Voice, hard: boolean): void {
  if (hard) {
    tone(v, { f: 120, to: 55, dur: 0.14, gain: 0.45 });
    noise(v, { type: "lowpass", f: 700, to: 150, dur: 0.18, gain: 0.4 });
    noise(v, { src: "scribble", type: "bandpass", f: 900, q: 0.8, dur: 0.22, gain: 0.15, attack: 0.02 });
  } else {
    tone(v, { f: 150, to: 80, dur: 0.07, gain: 0.4 });
    noise(v, { type: "lowpass", f: 900, dur: 0.06, gain: 0.35 });
  }
}

/** A page flick; the double jump adds an airy lift. */
export function jump(v: Voice, double: boolean): void {
  noise(v, { type: "bandpass", f: 900, to: 2400, q: 1.4, dur: 0.09, gain: 0.9, attack: 0.008 });
  if (double) {
    noise(v, { type: "bandpass", f: 1500, to: 4200, q: 2.2, dur: 0.18, gain: 0.7, attack: 0.02 });
    tone(v, { f: 420, to: 880, dur: 0.14, gain: 0.07, type: "triangle" });
  }
}

/** Pencil scrape. */
export function dash(v: Voice): void {
  noise(v, { src: "scribble", type: "bandpass", f: 2000, to: 3200, q: 1.2, dur: 0.15, gain: 0.8, attack: 0.01 });
}

/** Whooshes by weight: jabs and tilts flick, aerials and specials swipe, smashes haul through the air. */
export function swing(v: Voice, weight: 0 | 1 | 2): void {
  if (weight === 0) noise(v, { type: "bandpass", f: 1500, to: 3400, q: 1.5, dur: 0.09, gain: 0.6, attack: 0.012 });
  else if (weight === 1) noise(v, { type: "bandpass", f: 800, to: 2600, q: 1.3, dur: 0.15, gain: 0.65, attack: 0.02 });
  else {
    noise(v, { type: "bandpass", f: 350, to: 1700, q: 1.1, dur: 0.24, gain: 0.45, attack: 0.04 });
    tone(v, { f: 95, to: 60, dur: 0.2, gain: 0.2, attack: 0.03 });
  }
}

/** Smash charge: a rising, trembling strain. level 0..1. Short grains; the caller retriggers. */
export function charge(v: Voice, level: number): void {
  tone(v, { f: 110 + level * 110, dur: 0.09, gain: 0.05 + level * 0.05, type: "sawtooth", lp: 500 + level * 1500, attack: 0.02, vib: [11, 4 + level * 6] });
}

export function tech(v: Voice): void {
  noise(v, { type: "highpass", f: 3000, dur: 0.03, gain: 0.35 });
  tone(v, { f: 1100, to: 1900, dur: 0.1, gain: 0.12, type: "triangle" });
}

export function ledge(v: Voice): void {
  noise(v, { src: "crackle", type: "bandpass", f: 1800, dur: 0.1, gain: 1.2 });
  tone(v, { f: 180, to: 110, dur: 0.06, gain: 0.2 });
}

export function grab(v: Voice): void {
  noise(v, { type: "lowpass", f: 1300, dur: 0.1, gain: 0.35 });
  noise(v, { src: "crackle", type: "bandpass", f: 900, q: 1.2, dur: 0.12, gain: 0.6 });
  tone(v, { f: 140, to: 100, dur: 0.08, gain: 0.25 });
}

export function throwSound(v: Voice): void {
  noise(v, { type: "bandpass", f: 600, to: 2200, q: 1.3, dur: 0.22, gain: 0.55, attack: 0.03 });
  tone(v, { f: 110, to: 70, dur: 0.12, gain: 0.25 });
}

/** The page tears: crunch, a deep boom with a long room, and a little sparkle as they vanish. */
export function ko(v: Voice): void {
  v.send.gain.value = 0.5;
  impact(v, 30);
  noise(v, { src: "crackle", type: "bandpass", f: 3000, q: 0.6, dur: 0.7, gain: 1.6, rate: 0.7, delay: 0.02 });
  noise(v, { src: "scribble", type: "highpass", f: 2500, dur: 0.5, gain: 0.3, delay: 0.02 });
  tone(v, { f: 58, to: 26, dur: 1.4, gain: 0.8, drive: 2.5, delay: 0.03 });
  noise(v, { type: "lowpass", f: 1800, to: 80, q: 0.7, dur: 1.2, gain: 0.7, drive: 2, delay: 0.03 });
  [0, 4, 7, 12, 16].forEach((n, i) => bell(v, { f: semis(1318, n), dur: 0.5, gain: 0.07, delay: 0.25 + i * 0.055 }));
}

/** Drawn back in: a marker squeak and a soft rising chime. */
export function respawn(v: Voice): void {
  v.send.gain.value = 0.35;
  tone(v, { f: 1700, to: 2600, dur: 0.32, gain: 0.07, vib: [32, 140], attack: 0.03 });
  noise(v, { src: "scribble", type: "bandpass", f: 3500, q: 2, dur: 0.3, gain: 0.2, attack: 0.03 });
  [0, 4, 7].forEach((n, i) => bell(v, { f: semis(1046.5, n), dur: 0.6, gain: 0.09, delay: 0.1 + i * 0.07, partials: [1, 3.01] }));
}

/** Projectiles get a stable pitch per kind, so each fighter's shot has its own voice. */
export function projectile(v: Voice, kind: string): void {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  const p = 0.75 + (h % 9) * 0.07;
  noise(v, { type: "bandpass", f: 3200 * p, to: 900 * p, q: 2, dur: 0.13, gain: 0.7 });
  tone(v, { f: 1200 * p, to: 420 * p, dur: 0.11, gain: 0.22, type: "triangle" });
}

// ---- match flow ---------------------------------------------------------------------------

/** Ink stamp. */
export function countdown(v: Voice): void {
  v.send.gain.value = 0.3;
  tone(v, { f: 523, to: 500, dur: 0.16, gain: 0.3, type: "triangle" });
  tone(v, { f: 130, to: 80, dur: 0.1, gain: 0.35 });
  noise(v, { type: "bandpass", f: 1100, q: 3, dur: 0.05, gain: 0.45 });
}

/** A heavier stamp, a bright chord stab and a cymbal of paper. */
export function go(v: Voice): void {
  v.send.gain.value = 0.4;
  tone(v, { f: 150, to: 60, dur: 0.18, gain: 0.5, drive: 2 });
  noise(v, { type: "bandpass", f: 1300, q: 2.5, dur: 0.07, gain: 0.5 });
  for (const n of [0, 7, 12, 16, 19]) tone(v, { f: semis(261.6, n), dur: 0.7, gain: 0.07, type: "sawtooth", lp: 5000, lpTo: 900, attack: 0.005 });
  noise(v, { type: "highpass", f: 6000, dur: 0.9, gain: 0.2 });
}

/** GAME: the stamp comes down and the chord resolves. */
export function gameEnd(v: Voice): void {
  v.send.gain.value = 0.5;
  tone(v, { f: 100, to: 40, dur: 0.4, gain: 0.6, drive: 2 });
  noise(v, { type: "lowpass", f: 1500, to: 200, dur: 0.35, gain: 0.5 });
  const chord = [0, 4, 7, 12, 16];
  for (const n of chord) tone(v, { f: semis(196, n), dur: 1.6, gain: 0.06, type: "sawtooth", lp: 3500, lpTo: 600, delay: 0.02 });
  for (const n of chord) tone(v, { f: semis(261.6, n), dur: 2.2, gain: 0.06, type: "sawtooth", lp: 4000, lpTo: 700, delay: 0.36 });
  noise(v, { type: "highpass", f: 5000, dur: 1.4, gain: 0.2, delay: 0.36 });
}

/** Sudden death: a low, sour alarm and two heartbeats. */
export function suddenDeath(v: Voice): void {
  v.send.gain.value = 0.35;
  for (const f of [110, 116.5]) tone(v, { f, dur: 1.2, gain: 0.12, type: "sawtooth", lp: 1200, lpTo: 300 });
  for (const d of [0.1, 0.35]) tone(v, { f: 60, to: 40, dur: 0.18, gain: 0.55, delay: d });
}

// ---- menus --------------------------------------------------------------------------------

/** Pencil tick. */
export function menuMove(v: Voice): void {
  noise(v, { type: "bandpass", f: 3800, q: 3, dur: 0.03, gain: 0.7 });
  tone(v, { f: 2100, dur: 0.025, gain: 0.1 });
}

/** Marker cap pop and a two-note chime up. */
export function menuConfirm(v: Voice): void {
  noise(v, { type: "bandpass", f: 1500, q: 4, dur: 0.03, gain: 0.45 });
  tone(v, { f: 520, to: 260, dur: 0.04, gain: 0.25 });
  v.send.gain.value = 0.25;
  bell(v, { f: 1318.5, dur: 0.3, gain: 0.1, delay: 0.02, partials: [1, 3.01] });
  bell(v, { f: 1975.5, dur: 0.45, gain: 0.1, delay: 0.09, partials: [1, 3.01] });
}

/** Eraser swipe and a note down. */
export function menuBack(v: Voice): void {
  noise(v, { src: "scribble", type: "bandpass", f: 1400, to: 800, q: 1.2, dur: 0.12, gain: 0.4, attack: 0.01 });
  bell(v, { f: 987.8, dur: 0.25, gain: 0.07, partials: [1, 3.01] });
  bell(v, { f: 659.3, dur: 0.3, gain: 0.07, delay: 0.06, partials: [1, 3.01] });
}
