// Prints the CPU study of the sword-guy exemplar as JSON, for scripts/fake-forge.mjs (which, as plain node, can't import the sim).
import fs from "node:fs";
import { buildGenerated } from "../../shared/gen/load";
import { studyFighter } from "../../shared/cpu-study";
import { registerFighter } from "../../shared/fighters/index";
import { SPRITE_CELLS } from "../../shared/gen/sprite";

const source = fs.readFileSync(new URL("../../forge/exemplar/sword-guy.fighter.js", import.meta.url), "utf8");
const cells = Object.fromEntries(SPRITE_CELLS.map((c) => [c, ""]));
buildGenerated({ id: "gen-fake-forge", source, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {}, cells }, player: "fake forge", description: "" }).then((def) => {
  registerFighter(def);
  process.stdout.write(JSON.stringify(studyFighter(def)));
});
