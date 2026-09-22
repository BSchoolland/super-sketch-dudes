// Deterministic math for the sim. Nothing in shared/ may call the transcendental Math functions or the RNG. // determinism-ok

const SIN: number[] = [];
const COS: number[] = [];
// Taylor series evaluated with + - * / only, then rounded to 1e-6 so every engine agrees.
function sinSeries(x: number): number {
  let term = x, sum = x;
  for (let i = 1; i < 12; i++) {
    term *= -x * x / ((2 * i) * (2 * i + 1));
    sum += term;
  }
  return Math.round(sum * 1e6) / 1e6;
}
const PI = 3.141592653589793;
for (let d = 0; d < 360; d++) {
  const r = (d * PI) / 180;
  SIN[d] = sinSeries(r);
  COS[d] = sinSeries(r + PI / 2 > PI ? r + PI / 2 - 2 * PI : r + PI / 2);
}

export function deg(a: number): number {
  a = Math.round(a) % 360;
  return a < 0 ? a + 360 : a;
}
export const sinDeg = (a: number): number => SIN[deg(a)];
export const cosDeg = (a: number): number => COS[deg(a)];

/** Angle in integer degrees of a vector, y-up convention (0 = +x, 90 = -y on screen). */
export function atan2Deg(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  let best = 0, bestDot = -Infinity;
  const len = Math.sqrt(x * x + y * y);
  const nx = x / len, ny = y / len;
  // coarse then fine search over the table: exact, deterministic, cheap enough for rare use
  for (let a = 0; a < 360; a += 10) {
    const d = nx * COS[a] + ny * SIN[a];
    if (d > bestDot) { bestDot = d; best = a; }
  }
  let fine = best;
  for (let a = best - 9; a <= best + 9; a++) {
    const dd = deg(a);
    const d = nx * COS[dd] + ny * SIN[dd];
    if (d > bestDot) { bestDot = d; fine = dd; }
  }
  return fine;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** xorshift32. State is a single uint32 kept in the match state. */
export function rngNext(s: number): number {
  s ^= s << 13; s >>>= 0;
  s ^= s >>> 17;
  s ^= s << 5; s >>>= 0;
  return s || 1;
}
export const rngFloat = (s: number): number => (s >>> 0) / 4294967296;

/** 32-bit FNV-1a over a list of numbers, quantized so tiny float noise can't hide a real desync. */
export function hashNumbers(nums: number[]): number {
  let h = 0x811c9dc5;
  for (const n of nums) {
    const q = Math.floor(n * 1000) | 0;
    h ^= q & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
