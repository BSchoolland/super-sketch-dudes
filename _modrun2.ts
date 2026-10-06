import { moderate } from "./forge/moderate";
const cases: [string, string, string][] = [["gen-7496-4c975b.png", "SPOODY", "s1"], ["gen-7496-4c975b.png", "SPOODY", "s2"]];
const out = await Promise.all(cases.map(([f, n, k]) => moderate(`/tmp/modrun/${f}`, n, `/tmp/modrun/${process.env.MODERATION_MODEL}-${k}`).then((j) => ({ n, k, j }), (e) => ({ n, k, e: String(e) }))));
for (const o of out) console.log(JSON.stringify(o));
