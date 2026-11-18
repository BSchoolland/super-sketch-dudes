import { fm, noise, semis, tone, type Voice } from "./synth";

/**
 * The sound set: heavy and physical, voiced for laptop and phone speakers. The punch of every sound sits between
 * 200 Hz and 4 kHz; the sub is a layer under it that grows with the size of the hit.
 */

// ---- fight -------------------------------------------------------------------------------

/**
 * The shared core of every hit. A jab is a dry snap; as damage climbs the knock drops in pitch, the smack gets
 * longer and dirtier, and a saturated boom comes in under it.
 */
function impact(v: Voice, d: number): void {
  const s = Math.min(1, d / 24);
  noise(v, { type: "highpass", f: 3200, q: 0.7, dur: 0.012 + s * 0.012, gain: 0.5 + s * 0.35 });
  tone(v, { f: 520 - s * 240, to: 150 - s * 60, glideTime: 0.03 + s * 0.03, dur: 0.05 + s * 0.08, gain: 0.6 + s * 0.3, drive: 2 + s * 3 });
  noise(v, { type: "bandpass", f: 1900 - s * 800, to: 600 - s * 200, q: 0.8, dur: 0.045 + s * 0.09, gain: 0.9 + s * 0.4, drive: 3 });
  if (s > 0.25) tone(v, { f: 130 - s * 45, to: 48, glideTime: 0.06 + s * 0.08, dur: 0.1 + s * 0.26, gain: (s - 0.1) * 0.9, drive: 3 + s * 3 });
  if (d >= 14) crunch(v, s);
}

/** The KRAK of a strong hit: a distorted burst, splinters, and a short room tail. */
function crunch(v: Voice, s: number): void {
  v.send.gain.value = Math.max(v.send.gain.value, 0.3);
  noise(v, { type: "bandpass", f: 1500, to: 450, q: 0.9, dur: 0.13 + s * 0.1, gain: 0.75, drive: 6 });
  noise(v, { src: "crackle", type: "bandpass", f: 2600, q: 0.8, dur: 0.12, gain: 1.2, rate: 1.1 });
}

const FX: Record<string, (v: Voice, d: number) => void> = {
  /** Sweet spot: a bat-crack with a short hard tink inside it. */
  tip(v) {
    v.send.gain.value = 0.25;
    noise(v, { type: "highpass", f: 4200, q: 0.7, dur: 0.03, gain: 0.9 });
    tone(v, { f: 1300, to: 420, glideTime: 0.035, dur: 0.06, gain: 0.45, drive: 2 });
    fm(v, { f: 880, ratio: 2.4, index: 2.5, indexTo: 0.1, dur: 0.13, gain: 0.3 });
  },
  heavy(v, d) {
    v.send.gain.value = 0.25;
    tone(v, { f: 190, to: 70, glideTime: 0.1, dur: 0.2, gain: 0.7, type: "triangle", drive: 4 });
    tone(v, { f: 70, to: 32, dur: 0.5, gain: 0.55, drive: 4 });
    noise(v, { type: "lowpass", f: 1000, to: 120, q: 0.8, dur: 0.36, gain: 0.5 + d * 0.01, drive: 4 });
  },
  /** A zap that falls as it discharges. */
  energy(v) {
    v.send.gain.value = 0.2;
    fm(v, { f: 620, to: 140, ratio: 1.5, index: 6, indexTo: 0.5, dur: 0.22, gain: 0.45, drive: 2 });
    noise(v, { type: "bandpass", f: 3200, to: 800, q: 3, dur: 0.16, gain: 0.8 });
  },
  /** A blade through air, with a thin ring of steel behind it. */
  slash(v) {
    v.send.gain.value = 0.15;
    noise(v, { type: "bandpass", f: 5200, to: 1500, q: 4, dur: 0.1, gain: 1.6 });
    noise(v, { type: "highpass", f: 6000, q: 0.7, dur: 0.16, gain: 0.25, delay: 0.01 });
    fm(v, { f: 1800, ratio: 3.1, index: 1.5, indexTo: 0.1, dur: 0.18, gain: 0.12 });
  },
  quake(v) {
    v.send.gain.value = 0.3;
    noise(v, { type: "lowpass", f: 220, q: 1.2, dur: 0.8, gain: 1.1, trem: [16, 0.8], drive: 4 });
    noise(v, { type: "bandpass", f: 420, q: 0.8, dur: 0.6, gain: 0.7, trem: [11, 0.7], drive: 3 });
    tone(v, { f: 45, to: 28, dur: 0.7, gain: 0.7 });
  },
  /** Counter-style hits: a thick wooden slam. */
  guard(v) {
    v.send.gain.value = 0.25;
    tone(v, { f: 310, to: 200, dur: 0.13, gain: 0.55, type: "triangle", drive: 2 });
    noise(v, { type: "bandpass", f: 650, q: 5, dur: 0.11, gain: 1.2 });
  },
  burst(v) {
    v.send.gain.value = 0.35;
    noise(v, { type: "lowpass", f: 3200, to: 120, q: 0.6, dur: 0.6, gain: 0.9, drive: 5 });
    noise(v, { type: "bandpass", f: 850, to: 300, q: 0.8, dur: 0.26, gain: 0.7, drive: 4 });
    tone(v, { f: 60, to: 28, dur: 0.6, gain: 0.8, drive: 2 });
  },
  /** A whoomph of flame catching, then it spits. */
  fire(v) {
    noise(v, { type: "bandpass", f: 450, to: 1700, q: 0.8, dur: 0.3, gain: 0.8, attack: 0.03, drive: 3 });
    noise(v, { type: "lowpass", f: 2600, to: 300, q: 0.7, dur: 0.45, gain: 0.4, drive: 3 });
    noise(v, { src: "crackle", type: "bandpass", f: 2600, q: 0.8, dur: 0.4, gain: 1.3, rate: 1 });
  },
};

export function hit(v: Voice, damage: number, fx: string, kb: number): void {
  impact(v, damage);
  const extra = FX[fx] ?? (damage >= 14 ? FX.heavy : undefined);
  extra?.(v, damage);
  if (kb > 140) launch(v, kb);
}

/** A big launch: the air tearing as they go. */
function launch(v: Voice, kb: number): void {
  const s = Math.min(1, (kb - 140) / 160);
  v.send.gain.value = Math.max(v.send.gain.value, 0.25);
  noise(v, { type: "bandpass", f: 400, to: 1900, q: 1.6, dur: 0.5 + s * 0.4, gain: 0.7 + s * 0.5, attack: 0.05, delay: 0.03, drive: 2 });
}

/** Thick rubber shield: a bwomp with a slap on its skin. */
export function shieldHit(v: Voice, damage: number): void {
  const s = Math.min(1, damage / 20);
  fm(v, { f: 270 - s * 70, to: 170 - s * 40, ratio: 0.5, index: 2, indexTo: 0.2, dur: 0.16 + s * 0.12, gain: 0.55 + s * 0.3, drive: 2 });
  noise(v, { type: "bandpass", f: 1300, q: 2, dur: 0.04, gain: 0.9 + s * 0.4 });
}

/** Steel on steel: a hard clang that rings. */
export function parry(v: Voice): void {
  v.send.gain.value = 0.35;
  noise(v, { type: "bandpass", f: 2600, q: 1.5, dur: 0.04, gain: 1.2, drive: 3 });
  fm(v, { f: 520, ratio: 2.76, index: 3, indexTo: 0.3, dur: 0.6, gain: 0.35, drive: 1.5 });
  fm(v, { f: 1310, ratio: 1.9, index: 1, indexTo: 0.1, dur: 0.25, gain: 0.14 });
  tone(v, { f: 150, to: 80, dur: 0.2, gain: 0.45, drive: 2 });
}

/** The shield blows apart and they reel. */
export function shieldBreak(v: Voice): void {
  v.send.gain.value = 0.35;
  noise(v, { type: "lowpass", f: 5000, to: 200, q: 0.6, dur: 0.5, gain: 1, drive: 4 });
  noise(v, { src: "crackle", type: "bandpass", f: 3000, q: 0.7, dur: 0.6, gain: 1.8, rate: 1 });
  noise(v, { src: "crackle", type: "bandpass", f: 1200, dur: 0.5, gain: 1.2, rate: 0.6 });
  tone(v, { f: 95, to: 35, dur: 0.5, gain: 0.8, drive: 3 });
  tone(v, { f: 420, to: 140, dur: 1.0, gain: 0.2, type: "triangle", vib: [7, 25], delay: 0.15 });
}

export function land(v: Voice, hard: boolean): void {
  if (hard) {
    tone(v, { f: 150, to: 50, dur: 0.16, gain: 0.7, drive: 3 });
    noise(v, { type: "lowpass", f: 1300, to: 150, dur: 0.18, gain: 0.6, drive: 2 });
    noise(v, { type: "bandpass", f: 750, q: 1, dur: 0.05, gain: 0.9 });
  } else {
    tone(v, { f: 230, to: 110, dur: 0.05, gain: 0.4, drive: 2 });
    noise(v, { type: "bandpass", f: 950, q: 1, dur: 0.04, gain: 0.7 });
  }
}

/** Push off the ground; the double jump is a bigger gust. */
export function jump(v: Voice, double: boolean): void {
  tone(v, { f: 170, to: 300, dur: 0.06, gain: 0.25, drive: 2 });
  noise(v, { type: "bandpass", f: 700, to: 1900, q: 1.5, dur: 0.09, gain: 1.1, attack: 0.01 });
  if (double) noise(v, { type: "bandpass", f: 500, to: 2300, q: 1.2, dur: 0.18, gain: 1.2, attack: 0.02 });
}

/** A pencil scuffing across the page. */
export function dash(v: Voice): void {
  noise(v, { src: "scribble", type: "bandpass", f: 1900, to: 900, q: 0.8, dur: 0.13, gain: 0.9, attack: 0.005 });
  tone(v, { f: 120, to: 80, dur: 0.05, gain: 0.3, drive: 2 });
}

/** Whooshes by weight; smashes haul a lot of air. */
export function swing(v: Voice, weight: 0 | 1 | 2): void {
  if (weight === 0) noise(v, { type: "bandpass", f: 1200, to: 3000, q: 2, dur: 0.09, gain: 1.8, attack: 0.02 });
  else if (weight === 1) noise(v, { type: "bandpass", f: 700, to: 2300, q: 1.8, dur: 0.15, gain: 2, attack: 0.03 });
  else {
    noise(v, { type: "bandpass", f: 300, to: 1600, q: 1.4, dur: 0.26, gain: 1.6, attack: 0.06, drive: 2 });
    noise(v, { type: "highpass", f: 3000, q: 0.7, dur: 0.2, gain: 0.3, attack: 0.08 });
    tone(v, { f: 95, to: 55, dur: 0.24, gain: 0.4, attack: 0.04, drive: 2 });
  }
}

/** Smash charge: a growl that rises, brightens and shakes faster. level 0..1. Short grains; the caller retriggers. */
export function charge(v: Voice, level: number): void {
  tone(v, { f: 80 + level * 80, dur: 0.09, gain: 0.12 + level * 0.1, type: "sawtooth", lp: 500 + level * 1800, attack: 0.02, vib: [8 + level * 10, 3 + level * 8], drive: 2 });
}

export function tech(v: Voice): void {
  tone(v, { f: 420, to: 200, dur: 0.05, gain: 0.5, drive: 2 });
  noise(v, { type: "bandpass", f: 2000, q: 1.5, dur: 0.03, gain: 1 });
}

/** A hand catching the edge of the page. */
export function ledge(v: Voice): void {
  tone(v, { f: 260, to: 160, dur: 0.06, gain: 0.4, drive: 2 });
  noise(v, { src: "scribble", type: "bandpass", f: 1500, q: 1, dur: 0.05, gain: 0.5 });
}

export function grab(v: Voice): void {
  noise(v, { type: "lowpass", f: 1600, to: 600, dur: 0.09, gain: 0.7, attack: 0.004 });
  tone(v, { f: 170, to: 90, dur: 0.08, gain: 0.5, drive: 2 });
}

export function throwSound(v: Voice): void {
  noise(v, { type: "bandpass", f: 400, to: 1700, q: 1.3, dur: 0.2, gain: 1.6, attack: 0.03 });
  tone(v, { f: 120, to: 60, dur: 0.14, gain: 0.45, drive: 2 });
}

/** KABOOM: a crack, a blast that starts bright and burns down dark, and debris. */
export function ko(v: Voice): void {
  v.send.gain.value = 0.45;
  impact(v, 24);
  noise(v, { type: "bandpass", f: 950, to: 200, q: 0.7, dur: 0.7, gain: 0.6, drive: 6 });
  noise(v, { type: "lowpass", f: 6500, to: 150, q: 0.7, dur: 1.2, gain: 0.55, drive: 4, delay: 0.02 });
  tone(v, { f: 230, to: 60, dur: 0.5, gain: 0.6, type: "triangle", drive: 4 });
  tone(v, { f: 55, to: 24, dur: 1.5, gain: 0.5, drive: 4, delay: 0.02 });
  noise(v, { src: "crackle", type: "bandpass", f: 2000, q: 0.7, dur: 1, gain: 1.3, rate: 0.7, attack: 0.05, delay: 0.1 });
}

/** Back on the stage: a rising swell that knocks down. */
export function respawn(v: Voice): void {
  v.send.gain.value = 0.3;
  noise(v, { type: "bandpass", f: 300, to: 1500, q: 1.5, dur: 0.42, gain: 1, attack: 0.3 });
  tone(v, { f: 190, to: 90, dur: 0.15, gain: 0.5, drive: 2, delay: 0.38 });
  noise(v, { type: "bandpass", f: 950, q: 1, dur: 0.04, gain: 0.7, delay: 0.38 });
}

/** Projectiles get a stable pitch per kind, so each fighter's shot has its own voice. */
export function projectile(v: Voice, kind: string): void {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  const p = 0.75 + (h % 9) * 0.07;
  noise(v, { type: "bandpass", f: 2200 * p, to: 700 * p, q: 2, dur: 0.13, gain: 1.2, drive: 2 });
  tone(v, { f: 430 * p, to: 160 * p, dur: 0.1, gain: 0.35, drive: 2 });
}

// ---- match flow ---------------------------------------------------------------------------

/** A war drum: stick, skin, shell. */
export function countdown(v: Voice): void {
  v.send.gain.value = 0.35;
  noise(v, { type: "bandpass", f: 1800, q: 1, dur: 0.03, gain: 0.9 });
  tone(v, { f: 160, to: 70, dur: 0.28, gain: 0.8, drive: 3 });
  noise(v, { type: "lowpass", f: 900, to: 200, dur: 0.12, gain: 0.5 });
}

/** A bigger drum, a brass stab and a wash of cymbal. */
export function go(v: Voice): void {
  v.send.gain.value = 0.4;
  tone(v, { f: 150, to: 55, dur: 0.45, gain: 0.8, drive: 3 });
  noise(v, { type: "lowpass", f: 2000, to: 150, dur: 0.35, gain: 0.7, drive: 2 });
  noise(v, { type: "highpass", f: 5000, q: 0.7, dur: 0.5, gain: 0.15 });
  for (const n of [0, 7, 12]) tone(v, { f: semis(196, n), dur: 0.8, gain: 0.2, type: "sawtooth", lp: 2600, lpTo: 500, attack: 0.01, drive: 2 });
}

/** GAME: two slams and a minor chord that hangs. */
export function gameEnd(v: Voice): void {
  v.send.gain.value = 0.45;
  for (const d of [0, 0.32]) {
    tone(v, { f: 140, to: 45, dur: 0.55, gain: 0.8, drive: 4, delay: d });
    noise(v, { type: "lowpass", f: 1800, to: 100, dur: 0.4, gain: 0.7, drive: 3, delay: d });
  }
  for (const n of [0, 7, 12, 15]) tone(v, { f: semis(146.8, n), dur: 2.2, gain: 0.17, type: "sawtooth", lp: 2000, lpTo: 300, delay: 0.32, drive: 1.5 });
}

/** Sudden death: a sour drone and two heartbeats. */
export function suddenDeath(v: Voice): void {
  v.send.gain.value = 0.35;
  for (const f of [110, 116.5]) tone(v, { f, dur: 1.4, gain: 0.32, type: "sawtooth", lp: 900, lpTo: 200, drive: 2 });
  for (const d of [0.1, 0.38]) tone(v, { f: 140, to: 60, dur: 0.18, gain: 0.6, drive: 3, delay: d });
}

// ---- menus --------------------------------------------------------------------------------

/** A chunky button: a knock with a click on top. */
function thock(v: Voice, f: number, gain: number, delay = 0): void {
  tone(v, { f, to: f * 0.6, dur: 0.06, gain, drive: 2, delay });
  noise(v, { type: "bandpass", f: 2400, q: 1, dur: 0.015, gain: gain * 1.2, delay });
}

export function menuMove(v: Voice): void {
  thock(v, 300, 0.45);
}

/** A swipe that lands on a heavy knock. */
export function menuConfirm(v: Voice): void {
  v.send.gain.value = 0.25;
  noise(v, { type: "bandpass", f: 600, to: 2200, q: 1.1, dur: 0.08, gain: 0.5, attack: 0.03 });
  thock(v, 220, 0.4, 0.07);
  tone(v, { f: 110, to: 60, dur: 0.1, gain: 0.2, drive: 2, delay: 0.07 });
}

export function menuBack(v: Voice): void {
  thock(v, 210, 0.45);
  noise(v, { type: "bandpass", f: 1400, to: 500, q: 1.2, dur: 0.1, gain: 0.6, delay: 0.02 });
}
