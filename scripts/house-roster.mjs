// Packs forge runs into the house roster: client/public/house/<id>/{bundle.json, cells}. The house
// roster is what the tests, the forge's balance ladder and CPU fights use now that there are no
// hand-made fighters. Usage: node scripts/house-roster.mjs <id>=<run dir> ...   (a run dir has
// module.json, concept.json, report.json and cells/; or fighter.js + cells/ for hand-written ones)
import fs from "node:fs";
import path from "node:path";
const out = path.resolve("client/public/house");
const names = [];
for (const arg of process.argv.slice(2)) {
  const [id, dir] = arg.split("=");
  const cellsDir = path.join(dir, "cells");
  const meta = JSON.parse(fs.readFileSync(path.join(cellsDir, "cells.json"), "utf8"));
  let source, anims = {}, name = id.toUpperCase(), tagline = "", description = "", card = null;
  if (fs.existsSync(path.join(dir, "module.json"))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
    const c = JSON.parse(fs.readFileSync(path.join(dir, "concept.json"), "utf8"));
    source = m.source; anims = m.anims ?? {}; name = c.name; tagline = c.tagline; description = c.description; card = c.card ?? null;
  } else {
    source = fs.readFileSync(path.join(dir, "fighter.js"), "utf8");
    const extra = fs.existsSync(path.join(dir, "meta.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) : {};
    name = extra.name ?? name; tagline = extra.tagline ?? ""; description = extra.description ?? ""; card = extra.card ?? null; anims = extra.anims ?? {};
  }
  const dest = path.join(out, id);
  fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
  const cells = {};
  for (const c of Object.keys(meta.cells)) { fs.copyFileSync(path.join(cellsDir, `${c}.png`), path.join(dest, `${c}.png`)); cells[c] = `house/${id}/${c}.png`; }
  fs.copyFileSync(path.join(cellsDir, "cells.json"), path.join(dest, "cells.json"));
  const bundle = { id, player: "house", name, tagline, description, card, source, sprite: { px: meta.px, feetPx: meta.feetPx, heightPx: meta.heightPx, anims, cells } };
  fs.writeFileSync(path.join(dest, "bundle.json"), JSON.stringify(bundle));
  names.push({ id, name, tagline });
  console.log(`${id}: ${name} (${Object.keys(cells).length} cells)`);
}
