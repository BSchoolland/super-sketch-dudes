import { layoutStage } from "./layout";

/** Battlefield-like: a solid main stage and two thin platforms over it. */
export const stadium = layoutStage({
  id: "stadium",
  name: "Stadium",
  main: [-450, 450],
  bottom: 260,
  thin: [[-310, -110, -190], [110, 310, -190]],
});
