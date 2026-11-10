import path from "node:path";

/** The flags of a script that reads the event store: unknown ones and --help end it before anything runs. */
export function cliArgs(known: string[], usage: string): { flag: (name: string) => boolean; value: (name: string) => string | undefined } {
  const args = process.argv.slice(2);
  for (const a of args) if (a.startsWith("-") && !known.includes(a) && a !== "--help") throw new Error(`unknown flag ${a}\n${usage}`);
  if (args.includes("--help")) { console.log(usage); process.exit(0); }
  return {
    flag: (name) => args.includes(name),
    value: (name) => {
      const i = args.indexOf(name);
      if (i < 0) return undefined;
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
      return v;
    },
  };
}

export function parseSince(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(s);
  if (m) return Date.now() - Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s" | "m" | "h" | "d"];
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`--since wants 90s, 30m, 2h, 1d or a date, not ${s}`);
  return t;
}

/** `--data`, else $SKETCHBATTLE_DATA, else the server-data dir beside scripts/ (or dist/, bundled). */
export function dataDir(flagged: string | undefined, scriptUrl: string): string {
  return flagged ?? process.env.SKETCHBATTLE_DATA ?? path.resolve(path.dirname(new URL(scriptUrl).pathname), "..", "server-data");
}
