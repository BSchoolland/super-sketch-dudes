/** Browser entry for scripts/sound-reel.mjs: renders every sound offline through the real mix. */
import { buildMix, voiceOn } from "../client/src/audio/engine";
import type { Voice } from "../client/src/audio/synth";
import * as S from "../client/src/audio/sounds";

const cues: [string, number, (v: Voice) => void][] = [
  ["menu move", 0.2, S.menuMove],
  ["menu confirm", 0.6, S.menuConfirm],
  ["menu back", 0.5, S.menuBack],
  ["countdown", 0.6, S.countdown],
  ["go", 1.4, S.go],
  ["jab 4%", 0.4, (v) => S.hit(v, 4, "hit", 40)],
  ["tilt 10%", 0.5, (v) => S.hit(v, 10, "hit", 90)],
  ["heavy 18%", 0.9, (v) => S.hit(v, 18, "heavy", 130)],
  ["tipper", 1.2, (v) => S.hit(v, 12, "tip", 120)],
  ["energy", 0.6, (v) => S.hit(v, 8, "energy", 80)],
  ["slash", 0.6, (v) => S.hit(v, 9, "slash", 80)],
  ["quake", 1.0, (v) => S.hit(v, 14, "quake", 120)],
  ["guard", 0.5, (v) => S.hit(v, 10, "guard", 80)],
  ["burst", 0.9, (v) => S.hit(v, 13, "burst", 130)],
  ["fire", 0.6, (v) => S.hit(v, 7, "fire", 60)],
  ["launcher", 1.2, (v) => S.hit(v, 20, "hit", 260)],
  ["shield hit light", 0.4, (v) => S.shieldHit(v, 5)],
  ["shield hit heavy", 0.5, (v) => S.shieldHit(v, 18)],
  ["parry", 1.4, S.parry],
  ["shield break", 1.3, S.shieldBreak],
  ["land", 0.3, (v) => S.land(v, false)],
  ["land hard", 0.5, (v) => S.land(v, true)],
  ["jump", 0.3, (v) => S.jump(v, false)],
  ["double jump", 0.4, (v) => S.jump(v, true)],
  ["dash", 0.35, S.dash],
  ["swing light", 0.3, (v) => S.swing(v, 0)],
  ["swing mid", 0.35, (v) => S.swing(v, 1)],
  ["swing smash", 0.5, (v) => S.swing(v, 2)],
  ["smash charge", 1.2, (v) => { for (let i = 0; i < 15; i++) S.charge({ ...v, t: v.t + i * 0.07 }, i / 14); }],
  ["tech", 0.3, S.tech],
  ["ledge", 0.3, S.ledge],
  ["grab", 0.35, S.grab],
  ["throw", 0.45, S.throwSound],
  ["ko", 2.2, S.ko],
  ["respawn", 1.1, S.respawn],
  ["projectile a", 0.3, (v) => S.projectile(v, "fireball")],
  ["projectile b", 0.3, (v) => S.projectile(v, "laser")],
  ["game end", 3.0, S.gameEnd],
  ["sudden death", 1.6, S.suddenDeath],
];

async function render(): Promise<{ name: string; l: number[]; r: number[] }[]> {
  const out = [];
  for (const [name, dur, fn] of cues) {
    const c = new OfflineAudioContext(2, Math.ceil(48000 * (dur + 0.6)), 48000);
    const mix = buildMix(c, c.destination);
    mix.sfx.gain.value = 0.8;
    fn(voiceOn(mix, 0.02, 0, 0));
    const buf = await c.startRendering();
    out.push({ name, l: Array.from(buf.getChannelData(0)), r: Array.from(buf.getChannelData(1)) });
  }
  return out;
}
(window as unknown as { render: typeof render }).render = render;
