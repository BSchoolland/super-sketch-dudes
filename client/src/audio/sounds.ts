import { fm, noise, semis, tone, type Voice } from "./synth";

/**
 * The sound set: heavy and physical. Weight lives under 400 Hz; highs are only the crack of contact.
 * No chimes, no sparkle.
 */

// ---- fight -------------------------------------------------------------------------------

/** The shared core of every hit, Smash-style: a slap-crack up front, a saturated body, dirt under it. */
function impact(v: Voice, d: number): void {
  const s = Math.min(1, d / 24), g = 0.5 + 0.5 * s;
  noise(v, { type: "highpass", f: 2200, q: 0.7, dur: 0.018, gain: 0.9 * g });
  noise(v, { type: "bandpass", f: 1300 - s * 400, q: 1, dur: 0.04 + s * 0.03, gain: 1.3 * g, drive: 3 });
  tone(v, { f: 150 - s * 60, to: 45, glideTime: 0.05 + s * 0.08, dur: 0.14 + s * 0.24, gain: 1.1 * g, drive: 3 + s * 3 });
  noise(v, { type: "lowpass", f: 1100 - s * 400, to: 120, q: 0.9, dur: 0.1 + s * 0.18, gain: 0.85 * g, drive: 2 });
  if (d >= 14) crunch(v, s);
}

/** The KRAK of a strong hit: a distorted burst with a short room tail. */
function crunch(v: Voice, s: number): void {
  v.send.gain.value = Math.max(v.send.gain.value, 0.3);
  noise(v, { type: "bandpass", f: 900, to: 400, q: 0.9, dur: 0.12 + s * 0.08, gain: 1, drive: 6 });
  noise(v, { src: "crackle", type: "bandpass", f: 1500, dur: 0.1, gain: 0.8, rate: 0.8 });
}

const FX: Record<string, (v: Voice, d: number) => void> = {
  /** Sweet spot: a bat-crack with a steel knock inside it. */
  tip(v) {
    v.send.gain.value = 0.25;
    noise(v, { type: "bandpass", f: 1200, q: 2, dur: 0.05, gain: 0.8, drive: 3 });
    fm(v, { f: 220, ratio: 1.4, index: 3, indexTo: 0.2, dur: 0.3, gain: 0.35, drive: 2 });
  },
  heavy(v, d) {
    v.send.gain.value = 0.25;
    tone(v, { f: 62, to: 30, dur: 0.5, gain: 0.8, drive: 3 });
    noise(v, { type: "lowpass", f: 700, to: 90, q: 0.8, dur: 0.4, gain: 0.5 + d * 0.01, drive: 4 });
  },
  energy(v) {
    v.send.gain.value = 0.2;
    fm(v, { f: 180, to: 60, ratio: 1.41, index: 5, indexTo: 0.5, dur: 0.28, gain: 0.4, drive: 3 });
    noise(v, { type: "bandpass", f: 1400, to: 500, q: 2, dur: 0.2, gain: 0.35, drive: 2 });
  },
  slash(v) {
    v.send.gain.value = 0.15;
    noise(v, { type: "bandpass", f: 2600, to: 900, q: 3, dur: 0.12, gain: 0.7 });
    tone(v, { f: 120, to: 60, dur: 0.12, gain: 0.35, drive: 2 });
  },
  quake(v) {
    v.send.gain.value = 0.3;
    noise(v, { type: "lowpass", f: 160, q: 1.2, dur: 0.8, gain: 1.1, trem: [14, 0.8], drive: 3 });
    tone(v, { f: 40, to: 28, dur: 0.7, gain: 0.7 });
  },
  /** Counter-style hits: a thick wooden slam. */
  guard(v) {
    v.send.gain.value = 0.25;
    tone(v, { f: 240, to: 180, dur: 0.14, gain: 0.5, type: "triangle", drive: 2 });
    noise(v, { type: "bandpass", f: 500, q: 5, dur: 0.12, gain: 0.7 });
  },
  burst(v) {
    v.send.gain.value = 0.35;
    noise(v, { type: "lowpass", f: 1400, to: 90, q: 0.6, dur: 0.65, gain: 0.9, drive: 4 });
    tone(v, { f: 55, to: 26, dur: 0.6, gain: 0.8, drive: 2 });
  },
  fire(v) {
    noise(v, { type: "lowpass", f: 1800, to: 300, q: 0.7, dur: 0.4, gain: 0.5, drive: 3 });
    noise(v, { src: "crackle", type: "bandpass", f: 1200, dur: 0.35, gain: 0.8, rate: 0.9 });
  },
};

export function hit(v: Voice, damage: number, fx: string, kb: number): void {
  impact(v, damage);
  const extra = FX[fx] ?? (damage >= 14 ? FX.heavy : undefined);
  extra?.(v, damage);
  if (kb > 140) launch(v, kb);
}

/** A big launch: a low roar of wind behind them. */
function launch(v: Voice, kb: number): void {
  const s = Math.min(1, (kb - 140) / 160);
  v.send.gain.value = Math.max(v.send.gain.value, 0.25);
  noise(v, { type: "bandpass", f: 250, to: 900, q: 1.2, dur: 0.5 + s * 0.4, gain: 0.5 + s * 0.3, attack: 0.04, delay: 0.03, drive: 2 });
}

/** Thick rubber shield: a dull bwomp. */
export function shieldHit(v: Voice, damage: number): void {
  const s = Math.min(1, damage / 20);
  fm(v, { f: 180 - s * 50, to: 120 - s * 30, ratio: 0.5, index: 2, indexTo: 0.2, dur: 0.18 + s * 0.12, gain: 0.55 + s * 0.3, drive: 2 });
  noise(v, { type: "lowpass", f: 900, dur: 0.06, gain: 0.45 });
}

/** Steel on steel: a hard clang with a low ring. */
export function parry(v: Voice): void {
  v.send.gain.value = 0.35;
  noise(v, { type: "bandpass", f: 1600, q: 1.5, dur: 0.05, gain: 0.8, drive: 3 });
  fm(v, { f: 330, ratio: 2.76, index: 2.5, indexTo: 0.3, dur: 0.7, gain: 0.35, drive: 1.5 });
  tone(v, { f: 110, to: 70, dur: 0.25, gain: 0.5, drive: 2 });
}

/** The shield blows apart and they reel. */
export function shieldBreak(v: Voice): void {
  v.send.gain.value = 0.35;
  noise(v, { type: "lowpass", f: 2200, to: 150, q: 0.6, dur: 0.6, gain: 1, drive: 4 });
  noise(v, { src: "crackle", type: "bandpass", f: 1200, dur: 0.5, gain: 1.2, rate: 0.6 });
  tone(v, { f: 70, to: 30, dur: 0.6, gain: 0.8, drive: 3 });
  tone(v, { f: 200, to: 60, dur: 1.0, gain: 0.25, type: "triangle", vib: [7, 12], delay: 0.15 });
}

export function land(v: Voice, hard: boolean): void {
  if (hard) {
    tone(v, { f: 95, to: 42, dur: 0.18, gain: 0.7, drive: 2.5 });
    noise(v, { type: "lowpass", f: 600, to: 100, dur: 0.22, gain: 0.55, drive: 2 });
  } else {
    tone(v, { f: 110, to: 60, dur: 0.08, gain: 0.5, drive: 2 });
    noise(v, { type: "lowpass", f: 700, dur: 0.06, gain: 0.35 });
  }
}

/** Push off the ground; the double jump is a heavier gust. */
export function jump(v: Voice, double: boolean): void {
  tone(v, { f: 90, to: 140, dur: 0.07, gain: 0.35, drive: 2 });
  noise(v, { type: "bandpass", f: 500, to: 1100, q: 1.2, dur: 0.1, gain: 0.6, attack: 0.008 });
  if (double) noise(v, { type: "bandpass", f: 300, to: 900, q: 1.1, dur: 0.2, gain: 0.7, attack: 0.02 });
}

/** Boots scuffing off. */
export function dash(v: Voice): void {
  noise(v, { type: "bandpass", f: 700, to: 400, q: 1.2, dur: 0.14, gain: 0.8, attack: 0.008 });
  tone(v, { f: 80, dur: 0.06, gain: 0.3 });
}

/** Whooshes by weight, all low and thick; smashes haul a lot of air. */
export function swing(v: Voice, weight: 0 | 1 | 2): void {
  if (weight === 0) noise(v, { type: "bandpass", f: 600, to: 1300, q: 1.3, dur: 0.1, gain: 0.8, attack: 0.015 });
  else if (weight === 1) noise(v, { type: "bandpass", f: 350, to: 1000, q: 1.2, dur: 0.17, gain: 0.95, attack: 0.025 });
  else {
    noise(v, { type: "bandpass", f: 180, to: 800, q: 1, dur: 0.28, gain: 1.1, attack: 0.05, drive: 2 });
    tone(v, { f: 70, to: 45, dur: 0.25, gain: 0.4, attack: 0.04 });
  }
}

/** Smash charge: a low growl that tightens. level 0..1. Short grains; the caller retriggers. */
export function charge(v: Voice, level: number): void {
  tone(v, { f: 55 + level * 40, dur: 0.09, gain: 0.12 + level * 0.1, type: "sawtooth", lp: 250 + level * 500, attack: 0.02, vib: [9, 2 + level * 4], drive: 2 });
}

export function tech(v: Voice): void {
  tone(v, { f: 140, to: 80, dur: 0.08, gain: 0.5, drive: 2 });
  noise(v, { type: "bandpass", f: 900, q: 1.5, dur: 0.05, gain: 0.5 });
}

export function ledge(v: Voice): void {
  tone(v, { f: 120, to: 80, dur: 0.07, gain: 0.45, drive: 2 });
  noise(v, { type: "lowpass", f: 900, dur: 0.07, gain: 0.4 });
}

export function grab(v: Voice): void {
  noise(v, { type: "lowpass", f: 900, dur: 0.12, gain: 0.6 });
  tone(v, { f: 100, to: 70, dur: 0.1, gain: 0.5, drive: 2 });
}

export function throwSound(v: Voice): void {
  noise(v, { type: "bandpass", f: 300, to: 900, q: 1.1, dur: 0.24, gain: 0.8, attack: 0.03 });
  tone(v, { f: 85, to: 50, dur: 0.15, gain: 0.45, drive: 2 });
}

/** KABOOM: the blast-line whoosh, a detonation with a long low tail, and debris. */
export function ko(v: Voice): void {
  v.send.gain.value = 0.45;
  impact(v, 30);
  noise(v, { type: "bandpass", f: 400, to: 2400, q: 0.8, dur: 0.9, gain: 0.7, drive: 3, attack: 0.02 });
  tone(v, { f: 48, to: 22, dur: 1.8, gain: 1, drive: 4, delay: 0.02 });
  noise(v, { type: "lowpass", f: 2500, to: 60, q: 0.7, dur: 1.6, gain: 1.1, drive: 6, delay: 0.02 });
  noise(v, { type: "lowpass", f: 300, q: 1, dur: 1.4, gain: 0.7, trem: [11, 0.6], attack: 0.1, delay: 0.1 });
  noise(v, { src: "crackle", type: "bandpass", f: 900, dur: 1, gain: 1.2, rate: 0.5, attack: 0.05, delay: 0.12 });
}

/** Back on the stage: a low rising swell that thuds down. */
export function respawn(v: Voice): void {
  v.send.gain.value = 0.3;
  noise(v, { type: "bandpass", f: 150, to: 700, q: 1.2, dur: 0.45, gain: 0.6, attack: 0.3 });
  tone(v, { f: 90, to: 50, dur: 0.2, gain: 0.55, drive: 2, delay: 0.38 });
}

/** Projectiles get a stable pitch per kind, so each fighter's shot has its own voice. */
export function projectile(v: Voice, kind: string): void {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  const p = 0.75 + (h % 9) * 0.07;
  noise(v, { type: "bandpass", f: 1100 * p, to: 350 * p, q: 1.5, dur: 0.15, gain: 0.75, drive: 2 });
  tone(v, { f: 160 * p, to: 70 * p, dur: 0.12, gain: 0.4, drive: 2 });
}

// ---- match flow ---------------------------------------------------------------------------

/** A war drum. */
export function countdown(v: Voice): void {
  v.send.gain.value = 0.35;
  tone(v, { f: 110, to: 60, dur: 0.3, gain: 0.8, drive: 2.5 });
  noise(v, { type: "lowpass", f: 900, to: 200, dur: 0.12, gain: 0.5 });
}

/** A bigger drum and a low brass stab. */
export function go(v: Voice): void {
  v.send.gain.value = 0.4;
  tone(v, { f: 90, to: 40, dur: 0.5, gain: 1, drive: 3 });
  noise(v, { type: "lowpass", f: 1500, to: 150, dur: 0.35, gain: 0.7, drive: 2 });
  for (const n of [0, 7, 12]) tone(v, { f: semis(98, n), dur: 0.8, gain: 0.14, type: "sawtooth", lp: 1800, lpTo: 300, attack: 0.01, drive: 2 });
}

/** GAME: two slams and a low chord that hangs. */
export function gameEnd(v: Voice): void {
  v.send.gain.value = 0.45;
  for (const d of [0, 0.32]) {
    tone(v, { f: 80, to: 32, dur: 0.6, gain: 1, drive: 3, delay: d });
    noise(v, { type: "lowpass", f: 1200, to: 100, dur: 0.4, gain: 0.6, drive: 2, delay: d });
  }
  for (const n of [0, 7, 12, 15]) tone(v, { f: semis(73.4, n), dur: 2.2, gain: 0.12, type: "sawtooth", lp: 1400, lpTo: 250, delay: 0.32, drive: 1.5 });
}

/** Sudden death: a low, sour drone and two heartbeats. */
export function suddenDeath(v: Voice): void {
  v.send.gain.value = 0.35;
  for (const f of [55, 58.3]) tone(v, { f, dur: 1.4, gain: 0.25, type: "sawtooth", lp: 600, lpTo: 150, drive: 2 });
  for (const d of [0.1, 0.38]) tone(v, { f: 55, to: 35, dur: 0.2, gain: 0.8, drive: 2, delay: d });
}

// ---- menus --------------------------------------------------------------------------------

/** A chunky button: a low knock with a dull click on top. */
function thock(v: Voice, f: number, gain: number, delay = 0): void {
  tone(v, { f, to: f * 0.6, dur: 0.07, gain, drive: 2, delay });
  noise(v, { type: "lowpass", f: 1400, dur: 0.02, gain: gain * 0.8, delay });
}

export function menuMove(v: Voice): void {
  thock(v, 190, 0.4);
}

/** A swipe that lands on a heavy knock. */
export function menuConfirm(v: Voice): void {
  v.send.gain.value = 0.25;
  noise(v, { type: "bandpass", f: 500, to: 1800, q: 1.1, dur: 0.08, gain: 0.3, attack: 0.03 });
  thock(v, 150, 0.4, 0.07);
  noise(v, { type: "bandpass", f: 1100, q: 1, dur: 0.03, gain: 0.15, drive: 3, delay: 0.07 });
}

export function menuBack(v: Voice): void {
  thock(v, 140, 0.45);
  noise(v, { type: "bandpass", f: 700, to: 300, q: 1.2, dur: 0.1, gain: 0.4, delay: 0.02 });
}
