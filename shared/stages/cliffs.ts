import { layoutStage } from "./layout";

/** One flat floating cliff and nothing else. */
export const cliffs = layoutStage({
  id: "cliffs",
  name: "Cliffs",
  main: [-420, 420],
  bottom: 240,
});
