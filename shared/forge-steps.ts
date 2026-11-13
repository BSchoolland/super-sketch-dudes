/**
 * The forge's steps in order: the stage the site or the worker reports, what the player reads, and the median
 * seconds the step takes. Seconds are from timed forges (scripts/forge-steps.py over their session streams); the
 * progress bar and the ETA both pace against them.
 */
export const FORGE_STEPS = [
  { stage: "waiting in line", label: "Waiting in line", s: 0 },
  { stage: "back in line", label: "Waiting in line", s: 0 },
  { stage: "reading the drawing", label: "Looking at your drawing", s: 2 },
  { stage: "auto moderator", label: "Looking at your drawing", s: 10 },
  { stage: "an agent is making it", label: "Looking at your drawing", s: 4 },
  { stage: "drawing the animation", label: "Animating your character", s: 78 },
  { stage: "designing the moves", label: "Adding moves", s: 207 },
  { stage: "writing the fighter", label: "Finalizing attacks", s: 4 },
  { stage: "balance testing", label: "Testing character", s: 230 },
  { stage: "final checks and upload", label: "Finishing touches", s: 20 },
] as const;

export type ForgeStage = (typeof FORGE_STEPS)[number]["stage"];

/** The steps the forge agent's tool use announces, in order. */
export const AGENT_STAGES: readonly ForgeStage[] = FORGE_STEPS.slice(FORGE_STEPS.findIndex((s) => s.stage === "drawing the animation")).map((s) => s.stage);
