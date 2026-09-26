/**
 * Synth primitives. Everything schedules onto a Voice, so the same sound runs on the live context
 * or on an OfflineAudioContext (scripts/sound-reel.mjs renders every sound that way).
 */
export interface Voice {
  c: BaseAudioContext;
  /** Panned input for this sound; feeds the dry bus and the reverb send. */
  out: AudioNode;
  /** Reverb send level, 0..1. A sound sets it once for its whole body. */
  send: GainNode;
  t: number;
  /** Random pitch factor for this trigger, so repeats don't machine-gun. */
  vary: number;
}

interface Buffers { noise: AudioBuffer; crackle: AudioBuffer; scribble: AudioBuffer; shapes: Map<number, Float32Array> }
const cache = new WeakMap<BaseAudioContext, Buffers>();

function buffers(c: BaseAudioContext): Buffers {
  let b = cache.get(c);
  if (b) return b;
  const sr = c.sampleRate;
  const noise = c.createBuffer(1, sr * 2, sr);
  const n = noise.getChannelData(0);
  for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

  // Paper crumple: sparse clicks whose density and size wander.
  const crackle = c.createBuffer(1, sr * 1, sr);
  const k = crackle.getChannelData(0);
  for (let i = 0; i < k.length; i++) {
    if (Math.random() < 0.012 * (0.4 + Math.sin(i / sr * 23) ** 2)) {
      const amp = (Math.random() * 2 - 1) * (0.3 + Math.random() * 0.7);
      const len = 8 + Math.floor(Math.random() * 60);
      for (let j = 0; j < len && i + j < k.length; j++) k[i + j] += amp * Math.exp(-j / (len / 4)) * (Math.random() * 2 - 1);
    }
  }

  // Pencil on paper: noise under a jittery stroke envelope (~30-60 strokes a second).
  const scribble = c.createBuffer(1, sr * 1, sr);
  const s = scribble.getChannelData(0);
  let phase = 0, rate = 40, env = 0;
  for (let i = 0; i < s.length; i++) {
    if (i % 400 === 0) rate = 30 + Math.random() * 30;
    phase += rate / sr;
    const stroke = Math.abs(Math.sin(Math.PI * phase)) ** 3;
    env += (stroke - env) * 0.02;
    s[i] = (Math.random() * 2 - 1) * (0.25 + env);
  }
  b = { noise, crackle, scribble, shapes: new Map() };
  cache.set(c, b);
  return b;
}

/** A stereo room: decaying noise that darkens as it fades. */
export function roomImpulse(c: BaseAudioContext, seconds = 1.8): AudioBuffer {
  const sr = c.sampleRate, len = Math.floor(sr * seconds);
  const ir = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const cut = 0.9 - t * 0.8;
      lp += (Math.random() * 2 - 1 - lp) * cut;
      d[i] = lp * Math.pow(1 - t, 3.2) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
    }
  }
  return ir;
}

function shaper(c: BaseAudioContext, drive: number): WaveShaperNode {
  const b = buffers(c);
  let curve = b.shapes.get(drive);
  if (!curve) {
    curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
    b.shapes.set(drive, curve);
  }
  const w = c.createWaveShaper(); w.curve = curve as Float32Array<ArrayBuffer>; w.oversample = "2x";
  return w;
}

interface Env { dur: number; gain: number; attack?: number; delay?: number; drive?: number }

/** Gain envelope: fast attack then exponential decay to silence over dur. Returns the node to feed. */
function envelope(v: Voice, e: Env): { input: AudioNode; t: number; end: number } {
  const t = v.t + (e.delay ?? 0), a = e.attack ?? 0.002, end = t + e.dur;
  const g = v.c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, e.gain), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.connect(v.out);
  if (e.drive) { const w = shaper(v.c, e.drive); w.connect(g); return { input: w, t, end }; }
  return { input: g, t, end };
}

function glide(p: AudioParam, from: number, to: number | undefined, t: number, dur: number, curve: "exp" | "lin" = "exp"): void {
  p.setValueAtTime(from, t);
  if (to === undefined) return;
  if (curve === "exp") p.exponentialRampToValueAtTime(to, t + dur); else p.linearRampToValueAtTime(to, t + dur);
}

export interface ToneOpts extends Env {
  f: number; to?: number; glideTime?: number; type?: OscillatorType;
  /** Vibrato: rate in Hz and depth in Hz. */
  vib?: [number, number];
  /** Lowpass on the oscillator, optional sweep. */
  lp?: number; lpTo?: number;
}
export function tone(v: Voice, o: ToneOpts): void {
  const { input, t, end } = envelope(v, o);
  const osc = v.c.createOscillator(); osc.type = o.type ?? "sine";
  glide(osc.frequency, o.f * v.vary, o.to === undefined ? undefined : o.to * v.vary, t, o.glideTime ?? o.dur);
  if (o.vib) {
    const lfo = v.c.createOscillator(); lfo.frequency.value = o.vib[0];
    const depth = v.c.createGain(); depth.gain.value = o.vib[1];
    lfo.connect(depth); depth.connect(osc.frequency); lfo.start(t); lfo.stop(end + 0.05);
  }
  let head: AudioNode = osc;
  if (o.lp) { const f = v.c.createBiquadFilter(); f.type = "lowpass"; glide(f.frequency, o.lp, o.lpTo, t, o.dur); osc.connect(f); head = f; }
  head.connect(input);
  osc.start(t); osc.stop(end + 0.05);
}

export interface NoiseOpts extends Env {
  src?: "noise" | "crackle" | "scribble";
  type?: BiquadFilterType; f: number; to?: number; q?: number;
  /** Tremolo: rate in Hz, depth 0..1. */
  trem?: [number, number];
  rate?: number;
}
export function noise(v: Voice, o: NoiseOpts): void {
  const { input, t, end } = envelope(v, o);
  const b = buffers(v.c);
  const src = v.c.createBufferSource();
  src.buffer = b[o.src ?? "noise"]; src.loop = true;
  src.playbackRate.value = (o.rate ?? 1) * v.vary;
  const f = v.c.createBiquadFilter(); f.type = o.type ?? "bandpass"; f.Q.value = o.q ?? 1;
  glide(f.frequency, o.f * v.vary, o.to === undefined ? undefined : o.to * v.vary, t, o.dur);
  src.connect(f);
  if (o.trem) {
    const tg = v.c.createGain(); tg.gain.value = 1 - o.trem[1] / 2;
    const lfo = v.c.createOscillator(); lfo.frequency.value = o.trem[0];
    const depth = v.c.createGain(); depth.gain.value = o.trem[1] / 2;
    lfo.connect(depth); depth.connect(tg.gain); lfo.start(t); lfo.stop(end + 0.05);
    f.connect(tg); tg.connect(input);
  } else f.connect(input);
  src.start(t, Math.random() * 0.5); src.stop(end + 0.05);
}

/** Two-operator FM: bells (inharmonic ratio), zaps (falling index). */
export interface FmOpts extends Env { f: number; ratio: number; index: number; indexTo?: number; to?: number }
export function fm(v: Voice, o: FmOpts): void {
  const { input, t, end } = envelope(v, o);
  const car = v.c.createOscillator();
  const mod = v.c.createOscillator();
  const idx = v.c.createGain();
  glide(car.frequency, o.f * v.vary, o.to === undefined ? undefined : o.to * v.vary, t, o.dur);
  glide(mod.frequency, o.f * o.ratio * v.vary, o.to === undefined ? undefined : o.to * o.ratio * v.vary, t, o.dur);
  glide(idx.gain, o.index * o.f, o.indexTo === undefined ? undefined : Math.max(1, o.indexTo * o.f), t, o.dur);
  mod.connect(idx); idx.connect(car.frequency); car.connect(input);
  car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
}

/** A struck bar: a few inharmonic partials, each decaying faster the higher it sits. */
export function bell(v: Voice, o: { f: number; dur: number; gain: number; delay?: number; partials?: number[] }): void {
  const partials = o.partials ?? [1, 2.76, 5.4, 8.93];
  partials.filter((p) => o.f * p < 16000).forEach((p, i) => tone(v, { f: o.f * p, dur: o.dur / (1 + i * 0.9), gain: o.gain / (1 + i * 1.3), delay: o.delay, attack: 0.001 }));
}

export const semis = (f: number, n: number): number => f * Math.pow(2, n / 12);
