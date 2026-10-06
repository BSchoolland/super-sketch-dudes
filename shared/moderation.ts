/** What a moderation judge can say about a submitted drawing and its name. */
export const VERDICTS = ["pass", "inappropriate", "language", "gore", "other"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Flag = Exclude<Verdict, "pass">;

export interface Judgement { verdict: Verdict; reason: string }
/** Both judges on one submission. */
export interface Judgements { harsh: Judgement; lenient: Judgement }

export const FLAG_LABELS: Record<Flag, string> = {
  inappropriate: "inappropriate art",
  language: "foul language",
  gore: "excessive gore/violence",
  other: "other inappropriate content",
};

export const isJudgement = (j: unknown): j is Judgement =>
  !!j && typeof j === "object" && VERDICTS.includes((j as Judgement).verdict) && typeof (j as Judgement).reason === "string";
