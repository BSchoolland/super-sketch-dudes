// CPU difficulty. A fighter's `cpu` is a tier from 1 to CPU_TIERS.length (0 is a human).

export const CPU_TIERS = ["PATHETIC", "WEAK", "NORMAL", "FORMIDABLE", "UNFAIR"] as const;
export const DEFAULT_TIER = 3;

export interface Skill {
  /** Frames between something happening to the opponent and the CPU seeing it. */
  delay: number;
  /** How much of that delay it makes up by leading the opponent's movement, 0 to 1. */
  predict: number;
  /** How much farther than its real reach it believes its attacks go. */
  slack: number;
  /** Percent of the time it dawdles in neutral instead of playing. */
  idle: number;
  /** How often it does the right thing once it has seen it: 0 at the bottom of each odds range, 1 at the top. */
  c: number;
}

const SKILLS: Skill[] = [
  { delay: 26, predict: 0, slack: 40, idle: 50, c: 0 },
  { delay: 17, predict: 0.5, slack: 22, idle: 25, c: 0.35 },
  { delay: 8, predict: 1, slack: 6, idle: 6, c: 0.7 },
  { delay: 5, predict: 1, slack: 2, idle: 2, c: 0.9 },
  // past the top of every odds range: it shields, punishes and confirms more often than any person could
  { delay: 0, predict: 1, slack: 0, idle: 0, c: 1.2 },
];

export function skillOf(tier: number): Skill {
  return SKILLS[Math.max(1, Math.min(SKILLS.length, tier | 0)) - 1];
}

export function tierName(tier: number): string {
  return CPU_TIERS[Math.max(1, Math.min(CPU_TIERS.length, tier | 0)) - 1];
}

/** A percentage from `lo` at the bottom tier to `hi` at the top. */
export function at(skill: Skill, lo: number, hi: number): number {
  return lo + (hi - lo) * skill.c;
}
