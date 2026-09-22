import type { GameEvent } from "../../../shared/types";

/**
 * Every sound is synthesised. Hits are filtered noise bursts scaled by damage, tippers ring a
 * sine, KOs are a sub thump plus a rising sweep. Nothing here touches the sim.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let unlocked = false;
export const audioSettings = { volume: 0.8, music: 0.5 };

export function audioContext(): AudioContext | null {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12;
    master = ctx.createGain();
    master.gain.value = audioSettings.volume;
    master.connect(comp); comp.connect(ctx.destination);
  }
  return ctx;
}
export function unlockAudio(): void {
  const c = audioContext();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  unlocked = true;
}
for (const ev of ["keydown", "pointerdown", "touchstart"]) window.addEventListener(ev, unlockAudio, { once: false, passive: true });
export function setVolume(v: number): void { audioSettings.volume = v; if (master) master.gain.value = v; }

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  noiseBuf = c.createBuffer(1, c.sampleRate * 1, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function burst(opts: { freq: number; q?: number; dur: number; gain: number; type?: BiquadFilterType; sweepTo?: number; delay?: number }): void {
  const c = audioContext(); if (!c || !master || !unlocked) return;
  const t = c.currentTime + (opts.delay ?? 0);
  const src = c.createBufferSource(); src.buffer = noise(c);
  const f = c.createBiquadFilter(); f.type = opts.type ?? "bandpass"; f.frequency.setValueAtTime(opts.freq, t); f.Q.value = opts.q ?? 1;
  if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.dur);
  const g = c.createGain(); g.gain.setValueAtTime(opts.gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + opts.dur + 0.05);
}
function tone(opts: { freq: number; dur: number; gain: number; type?: OscillatorType; sweepTo?: number; delay?: number; attack?: number }): void {
  const c = audioContext(); if (!c || !master || !unlocked) return;
  const t = c.currentTime + (opts.delay ?? 0);
  const o = c.createOscillator(); o.type = opts.type ?? "sine"; o.frequency.setValueAtTime(opts.freq, t);
  if (opts.sweepTo) o.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.004)); g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + opts.dur + 0.05);
}

export const sfx = {
  hit(damage: number, fx: string, kb: number): void {
    const d = Math.min(30, damage);
    burst({ freq: 900 - d * 18, q: 0.8, dur: 0.08 + d * 0.008, gain: 0.35 + d * 0.02, type: "lowpass" });
    burst({ freq: 3000, q: 0.5, dur: 0.04, gain: 0.18 });
    if (fx === "tip") { tone({ freq: 2200, dur: 0.25, gain: 0.25, sweepTo: 1800 }); tone({ freq: 4400, dur: 0.12, gain: 0.08 }); }
    if (fx === "heavy" || d >= 14) { tone({ freq: 90, dur: 0.22, gain: 0.5, sweepTo: 40 }); burst({ freq: 300, q: 0.7, dur: 0.25, gain: 0.35, type: "lowpass" }); }
    if (kb > 140) { tone({ freq: 400, dur: 0.5, gain: 0.18, type: "sawtooth", sweepTo: 1400 }); }
    if (fx === "fire") burst({ freq: 1400, q: 0.4, dur: 0.2, gain: 0.2, type: "highpass" });
  },
  shieldHit(damage: number): void { tone({ freq: 640, dur: 0.12, gain: 0.25, type: "triangle", sweepTo: 480 }); burst({ freq: 1800, dur: 0.06, gain: 0.12 + damage * 0.01 }); },
  parry(): void { tone({ freq: 1500, dur: 0.3, gain: 0.3, sweepTo: 3000 }); burst({ freq: 5000, q: 0.4, dur: 0.15, gain: 0.25, type: "highpass" }); },
  shieldBreak(): void { burst({ freq: 2500, q: 0.3, dur: 0.5, gain: 0.5, type: "highpass" }); tone({ freq: 600, dur: 0.6, gain: 0.3, type: "square", sweepTo: 120 }); },
  land(hard: boolean): void { burst({ freq: hard ? 240 : 420, q: 0.6, dur: hard ? 0.14 : 0.06, gain: hard ? 0.35 : 0.14, type: "lowpass" }); },
  jump(double: boolean): void { burst({ freq: 700, q: 0.6, dur: 0.07, gain: 0.12, type: "highpass" }); if (double) tone({ freq: 500, dur: 0.12, gain: 0.12, sweepTo: 900, type: "triangle" }); },
  dash(): void { burst({ freq: 500, q: 0.6, dur: 0.08, gain: 0.1, type: "bandpass", sweepTo: 1200 }); },
  swing(kind: string): void {
    if (kind === "heavy") burst({ freq: 240, q: 0.8, dur: 0.16, gain: 0.16, type: "bandpass", sweepTo: 800 });
    else burst({ freq: 1200, q: 0.8, dur: 0.1, gain: 0.12, type: "bandpass", sweepTo: 2400 });
  },
  tech(): void { tone({ freq: 900, dur: 0.1, gain: 0.15, type: "triangle", sweepTo: 1400 }); },
  ledge(): void { burst({ freq: 1500, dur: 0.05, gain: 0.1 }); },
  grab(): void { burst({ freq: 400, q: 1.2, dur: 0.1, gain: 0.25, type: "bandpass" }); tone({ freq: 160, dur: 0.1, gain: 0.2, type: "square" }); },
  throw(): void { burst({ freq: 800, q: 0.7, dur: 0.15, gain: 0.25, sweepTo: 200 }); },
  ko(): void {
    tone({ freq: 60, dur: 0.6, gain: 0.7, sweepTo: 30 });
    burst({ freq: 200, q: 0.5, dur: 0.5, gain: 0.5, type: "lowpass" });
    tone({ freq: 300, dur: 0.9, gain: 0.25, type: "sawtooth", sweepTo: 2400, delay: 0.05 });
    burst({ freq: 4000, q: 0.3, dur: 0.6, gain: 0.3, type: "highpass", delay: 0.1 });
  },
  respawn(): void { tone({ freq: 700, dur: 0.3, gain: 0.15, sweepTo: 1400, type: "triangle" }); },
  projectile(): void { burst({ freq: 2000, q: 1, dur: 0.12, gain: 0.2, sweepTo: 600 }); tone({ freq: 800, dur: 0.08, gain: 0.1, type: "square", sweepTo: 300 }); },
  charge(t: number): void { tone({ freq: 200 + t * 600, dur: 0.05, gain: 0.05, type: "square" }); },
  named(name: string): void {
    switch (name) {
      case "nova": tone({ freq: 200, dur: 0.5, gain: 0.4, type: "sawtooth", sweepTo: 1600 }); burst({ freq: 1200, q: 0.4, dur: 0.5, gain: 0.4, type: "highpass" }); break;
      case "reignite": burst({ freq: 900, q: 0.5, dur: 0.25, gain: 0.3, type: "bandpass", sweepTo: 2600 }); tone({ freq: 300, dur: 0.2, gain: 0.15, type: "triangle", sweepTo: 900 }); break;
      case "thrust": burst({ freq: 260, q: 0.7, dur: 0.09, gain: 0.12, type: "lowpass" }); break;
      case "click": tone({ freq: 1400, dur: 0.03, gain: 0.12, type: "square" }); break;
      default: break;
    }
  },
  menuMove(): void { tone({ freq: 900, dur: 0.05, gain: 0.12, type: "square" }); },
  menuConfirm(): void { tone({ freq: 600, dur: 0.12, gain: 0.18, type: "square", sweepTo: 1200 }); },
  menuBack(): void { tone({ freq: 600, dur: 0.12, gain: 0.14, type: "square", sweepTo: 300 }); },
  go(): void { tone({ freq: 440, dur: 0.15, gain: 0.25, type: "square" }); tone({ freq: 880, dur: 0.4, gain: 0.3, type: "square", delay: 0.15 }); },
  countdown(): void { tone({ freq: 440, dur: 0.12, gain: 0.2, type: "square" }); },
};

export function playEvents(events: GameEvent[]): void {
  let hits = 0;
  for (const e of events) {
    switch (e.t) {
      case "hit": if (hits++ < 3) sfx.hit(e.damage, e.fx, e.kb); break;
      case "shieldHit": sfx.shieldHit(e.damage); break;
      case "parry": sfx.parry(); break;
      case "shieldBreak": sfx.shieldBreak(); break;
      case "land": sfx.land(e.hard); break;
      case "jump": sfx.jump(e.double); break;
      case "dash": sfx.dash(); break;
      case "tech": sfx.tech(); break;
      case "ledge": sfx.ledge(); break;
      case "grab": sfx.grab(); break;
      case "throw": sfx.throw(); break;
      case "ko": sfx.ko(); break;
      case "respawn": sfx.respawn(); break;
      case "projectile": sfx.projectile(); break;
      case "move": if (/smash|special|dashAttack|fair|bair|dair/.test(e.move)) sfx.swing(/smash/.test(e.move) ? "heavy" : "light"); break;
      case "sfx": sfx.named(e.name); break;
      default: break;
    }
  }
}

/** Generative music: a slow chord pad and a pulse whose rate follows match intensity (0..1). */
interface Theme { base: number; chord: number[]; bass: number[]; bpm: number; pad: OscillatorType; pulse: OscillatorType }
const THEMES: Record<string, Theme> = {
  proving: { base: 110, chord: [0, 7, 12, 19], bass: [0, 0, 7, 5, 0, 0, 10, 7], bpm: 96, pad: "triangle", pulse: "square" },
  rooftops: { base: 98, chord: [0, 3, 7, 14], bass: [0, 0, 3, 5, 0, 0, 10, 8], bpm: 108, pad: "sawtooth", pulse: "square" },
  kessler: { base: 82.4, chord: [0, 7, 14, 21], bass: [0, 12, 7, 0, 5, 12, 7, 3], bpm: 84, pad: "sine", pulse: "triangle" },
};

export class Music {
  private nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private pulseTimer = 0;
  private intensity = 0;
  private started = false;
  private root = 0;
  private theme: Theme = THEMES.proving;
  start(themeId = "proving"): void {
    const c = audioContext(); if (!c || !master || this.started) return;
    this.started = true;
    this.theme = THEMES[themeId] ?? THEMES.proving;
    for (const semi of this.theme.chord) {
      const osc = c.createOscillator(); osc.type = this.theme.pad;
      osc.frequency.value = this.theme.base * Math.pow(2, semi / 12);
      const g = c.createGain(); g.gain.value = 0;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700;
      osc.connect(f); f.connect(g); g.connect(master);
      osc.start();
      this.nodes.push({ osc, gain: g });
    }
  }
  stop(): void { for (const n of this.nodes) { try { n.osc.stop(); } catch { /* already stopped */ } } this.nodes = []; this.started = false; }
  update(dt: number, intensity: number): void {
    if (!this.started || !unlocked) return;
    this.intensity += (intensity - this.intensity) * Math.min(1, dt * 2);
    const vol = audioSettings.music * (0.05 + this.intensity * 0.05);
    this.nodes.forEach((n, i) => { n.gain.gain.value = vol * (i === 0 ? 1.2 : 0.6); });
    this.pulseTimer -= dt;
    if (this.pulseTimer <= 0) {
      const bpm = this.theme.bpm + this.intensity * 60;
      this.pulseTimer = 60 / bpm;
      this.root = (this.root + 1) % 8;
      const notes = this.theme.bass;
      tone({ freq: (this.theme.base / 2) * Math.pow(2, notes[this.root] / 12), dur: 0.18, gain: audioSettings.music * (0.12 + this.intensity * 0.12), type: this.theme.pulse, attack: 0.002 });
      if (this.root % 2 === 0) burst({ freq: 3000, q: 0.5, dur: 0.04, gain: audioSettings.music * 0.06, type: "highpass" });
    }
  }
}
