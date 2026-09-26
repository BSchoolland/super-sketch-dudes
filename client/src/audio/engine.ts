import { roomImpulse, type Voice } from "./synth";

/**
 * The live audio graph. Sound effects: voice → panner → sfx bus (+ room send) → limiter → out.
 * Music runs on its own bus beside the limiter, so hits never pump the song; KOs duck it on purpose.
 */
export interface Mix {
  c: BaseAudioContext;
  sfx: GainNode;
  room: ConvolverNode;
  music: GainNode;
}

/** Builds the sfx and music buses on any context; the offline sound reel uses the same graph. */
export function buildMix(c: BaseAudioContext, dest: AudioNode): Mix {
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.15;
  const sfx = c.createGain();
  const room = c.createConvolver(); room.buffer = roomImpulse(c);
  const roomReturn = c.createGain(); roomReturn.gain.value = 0.55;
  sfx.connect(limiter); room.connect(roomReturn); roomReturn.connect(limiter);
  limiter.connect(dest);
  const music = c.createGain();
  music.connect(dest);
  return { c, sfx, room, music };
}

export function voiceOn(mix: Mix, t: number, pan: number, vary: number): Voice {
  const c = mix.c;
  const out = c.createStereoPanner(); out.pan.value = Math.max(-1, Math.min(1, pan));
  const send = c.createGain(); send.gain.value = 0.12;
  out.connect(mix.sfx); out.connect(send); send.connect(mix.room);
  return { c, out, send, t, vary: 1 + (Math.random() * 2 - 1) * vary };
}

let ctx: AudioContext | null = null;
let mix: (Mix & { c: AudioContext }) | null = null;
const volumes = { sfx: 0.8, music: 0.5 };

export function live(): Mix & { c: AudioContext } {
  if (mix) return mix;
  ctx = new AudioContext({ latencyHint: "interactive" });
  mix = { ...buildMix(ctx, ctx.destination), c: ctx };
  mix.sfx.gain.value = volumes.sfx;
  mix.music.gain.value = volumes.music;
  return mix;
}

export function unlockAudio(): void {
  live();
  if (ctx!.state === "suspended") ctx!.resume().catch((err) => console.error("audio resume failed", err));
}
for (const ev of ["keydown", "pointerdown", "touchstart"]) window.addEventListener(ev, unlockAudio, { passive: true });

export function running(): Mix | null { return ctx?.state === "running" ? mix : null; }

export function setVolume(v: number): void { volumes.sfx = v; if (mix) mix.sfx.gain.value = v; }
export function setMusicVolume(v: number): void { volumes.music = v; if (mix) mix.music.gain.value = v; }

/** Screen x in world units → stereo position. Stages are ~±1250 wide; keep it off the hard edges. */
export const panOf = (x: number | undefined): number => (x === undefined ? 0 : Math.max(-1, Math.min(1, x / 1100)) * 0.7);

/** Run a sound on the live mix. vary is the random pitch spread; musical cues pass 0. */
export function play(sound: (v: Voice) => void, opts: { x?: number; pan?: number; delay?: number; vary?: number } = {}): void {
  const m = running();
  if (!m) return;
  sound(voiceOn(m, m.c.currentTime + 0.005 + (opts.delay ?? 0), opts.pan ?? panOf(opts.x), opts.vary ?? 0.05));
}
