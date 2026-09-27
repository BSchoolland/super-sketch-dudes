// CPU difficulty. A fighter's `cpu` is a tier from 1 to CPU_TIERS.length (0 is a human).

export const CPU_TIERS = ["PATHETIC", "WEAK", "NORMAL", "FORMIDABLE", "UNFAIR"] as const;
export const DEFAULT_TIER = 3;

export interface Skill {
  /** Frames between something happening to the opponent and the CPU seeing it. */
  delay: number;
  /** How much farther than its real reach it believes its attacks go. */
  slack: number;
  /** 0 to 1: how often it does the right thing once it has seen it. */
  c: number;
}

const SKILLS: Skill[] = [
  { delay: 28, slack: 40, c: 0 },
  { delay: 21, slack: 26, c: 0.3 },
  { delay: 15, slack: 14, c: 0.55 },
  { delay: 10, slack: 6, c: 0.8 },
  { delay: 5, slack: 0, c: 1 },
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
