import type { Player } from "./account";

export const FEEDBACK_MAX = 2000;
export const RESPONSE_MAX = 1000;

/** Ben's Discord account: the one that reads feedback and answers it. */
export const FEEDBACK_ADMIN = "953441333601763358";

/** One feedback submission, keyed by when it was sent, with Ben's response once there is one. */
export interface FeedbackItem {
  /** The submission's `at`, which identifies it. */
  id: string;
  player: Pick<Player, "id" | "name"> | null;
  text: string;
  /** File name of the sketch, fetched from /feedback/sketch/<name>. */
  sketch: string | null;
  response: FeedbackResponse | null;
}

export interface FeedbackResponse {
  text: string;
  at: string;
  /** When the player saw it, in the popup or their past feedback. */
  seenAt: string | null;
}
