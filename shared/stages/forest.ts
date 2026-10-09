import { layoutStage } from "./layout";

/** Two branches at different heights, low on the left and high on the right. */
export const forest = layoutStage({
  id: "forest",
  name: "Forest",
  main: [-450, 450],
  bottom: 240,
  thin: [[-400, -170, -180], [140, 380, -270]],
});
