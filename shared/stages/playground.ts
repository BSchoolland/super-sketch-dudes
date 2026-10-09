import { layoutStage } from "./layout";

/** Wide enough for six: a long main stage, a platform over each half and one high in the middle. */
export const playground = layoutStage({
  id: "playground",
  name: "Playground",
  main: [-820, 820],
  bottom: 300,
  thin: [[-600, -360, -170], [-120, 120, -300], [360, 600, -170]],
});
