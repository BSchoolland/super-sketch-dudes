/** What a moderation judge can say about a submitted drawing and its name. */
export const VERDICTS = ["pass", "inappropriate", "language", "gore", "other"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Flag = Exclude<Verdict, "pass">;

/** What a judge can say about a name a player asked to go by. */
export const NAME_VERDICTS = ["pass", "inappropriate", "language", "personal", "impersonation", "bullying", "other"] as const;
export type NameVerdict = (typeof NAME_VERDICTS)[number];
export type NameFlag = Exclude<NameVerdict, "pass">;

export interface Judgement<V extends string = Verdict> { verdict: V; reason: string }
/** Both judges on one submission. */
export interface Judgements<V extends string = Verdict> { harsh: Judgement<V>; lenient: Judgement<V> }

export const FLAG_LABELS: Record<Flag, string> = {
  inappropriate: "inappropriate art",
  language: "foul language",
  gore: "excessive gore/violence",
  other: "other inappropriate content",
};

/** Written for the player whose name was refused. */
export const NAME_FLAG_LABELS: Record<NameFlag, string> = {
  inappropriate: "it isn't appropriate",
  language: "it has bad language in it",
  personal: "it looks like a real person's name or personal info",
  impersonation: "it pretends to be someone it isn't",
  bullying: "it picks on someone",
  other: "it isn't okay for the game",
};

export const isJudgement = <V extends string>(j: unknown, verdicts: readonly V[]): j is Judgement<V> =>
  !!j && typeof j === "object" && verdicts.includes((j as Judgement<V>).verdict) && typeof (j as Judgement<V>).reason === "string";
