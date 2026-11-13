/**
 * The forge's steps in order: the stage the site or the worker reports, what the player reads, and the seconds
 * the step typically takes. The agent's steps are their medians over 16 forges (scripts/forge-steps.py over the
 * session streams, Nov 2026), scaled together so they add up to the median whole forge (about 9 min); the
 * progress bar and the ETA both pace against them.
 */
export const FORGE_STEPS = [
  { stage: "waiting in line", label: "Waiting in line", s: 0 },
  { stage: "back in line", label: "Waiting in line", s: 0 },
  { stage: "reading the drawing", label: "Looking at your drawing", s: 2 },
  { stage: "auto moderator", label: "Looking at your drawing", s: 10 },
  { stage: "an agent is making it", label: "Looking at your drawing", s: 4 },
  { stage: "drawing the animation", label: "Animating your character", s: 89 },
  { stage: "designing the moves", label: "Adding moves", s: 223 },
  { stage: "writing the fighter", label: "Finalizing attacks", s: 7 },
  { stage: "balance testing", label: "Testing character", s: 186 },
  { stage: "final checks and upload", label: "Finishing touches", s: 18 },
] as const;

export type ForgeStage = (typeof FORGE_STEPS)[number]["stage"];

/** The steps the forge agent's tool use announces, in order. */
export const AGENT_STAGES: readonly ForgeStage[] = FORGE_STEPS.slice(FORGE_STEPS.findIndex((s) => s.stage === "drawing the animation")).map((s) => s.stage);
