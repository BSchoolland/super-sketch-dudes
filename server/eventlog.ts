import fs from "node:fs";
import path from "node:path";
import { newestById, type EventLevel, type WideEventRecord } from "../shared/wide";

/**
 * The wide event store: `events.jsonl` in the data dir, one snapshot per line (`at` is when the
 * server wrote it), rotated once to `events.jsonl.1`. Readers take the newest snapshot per id.
 */
export type StoredEvent = WideEventRecord & { at: string };
export const EVENTS_FILE = "events.jsonl";

export function eventFiles(dataDir: string): string[] {
  const file = path.join(dataDir, EVENTS_FILE);
  return [file + ".1", file].filter((f) => fs.existsSync(f));
}

export function readEvents(dataDir: string): StoredEvent[] {
  const all: StoredEvent[] = [];
  for (const file of eventFiles(dataDir)) {
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (!line) return;
      try { all.push(JSON.parse(line)); } catch (e) { throw new Error(`${file}:${i + 1}: ${(e as Error).message}`); }
    });
  }
  return newestById(all).sort((a, b) => a.t0 - b.t0);
}

export interface EventQuery { trace?: string; since?: number; level?: EventLevel; kind?: string; grep?: string }
const RANK: Record<EventLevel, number> = { info: 0, warn: 1, error: 2 };

/** `trace` matches an event's trace, its parent, or its id, so a match trace finds every participant and the server. */
export function filterEvents(events: StoredEvent[], q: EventQuery): StoredEvent[] {
  return events.filter((e) =>
    (!q.trace || e.trace === q.trace || e.parent === q.trace || e.id === q.trace)
    && (q.since === undefined || e.t1 >= q.since)
    && (!q.level || RANK[e.level] >= RANK[q.level])
    && (!q.kind || e.kind === q.kind)
    && (!q.grep || JSON.stringify(e).toLowerCase().includes(q.grep.toLowerCase())));
}
