// A stand-in for the forge worker's name judges, for local testing: takes every name players ask for and, after a
// moment, passes it, or refuses it (both judges: bullying) when it has "mean" in it.
//   node scripts/fake-name-judge.mjs [server=http://localhost:3010] [token=devtoken]
const server = process.argv[2] ?? "http://localhost:3010";
const token = process.argv[3] ?? "devtoken";
const headers = { "x-forge-token": token, "content-type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (;;) {
  const res = await fetch(`${server}/api/forge/names/next`, { headers });
  if (res.status === 204) { await sleep(700); continue; }
  if (!res.ok) throw new Error(`names/next: HTTP ${res.status} ${await res.text()}`);
  const n = await res.json();
  await sleep(1500);
  const verdict = /mean/i.test(n.name) ? "bullying" : "pass";
  const judgement = { verdict, reason: verdict === "pass" ? "a harmless name" : "it's aimed at someone" };
  const d = await fetch(`${server}/api/forge/names/${n.id}/verdict`, { method: "POST", headers, body: JSON.stringify({ harsh: judgement, lenient: judgement }) });
  if (!d.ok) throw new Error(`verdict: HTTP ${d.status} ${await d.text()}`);
  console.log(`"${n.name}" for ${n.playerName}: ${verdict}`);
}
