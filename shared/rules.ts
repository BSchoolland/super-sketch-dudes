import { C } from "./config";
import { defOf, setAction } from "./fighter";
import type { Fighter, Stage, State } from "./types";

export function stepRules(state: State, stage: Stage): void {
  const b = stage.blast;
  for (const f of state.fighters) {
    if (f.action === "dead") {
      if (f.frame >= C.DEAD_FRAMES && f.stocks > 0) respawn(state, f, stage);
      continue;
    }
    if (f.stocks <= 0) continue;
    if (f.action === "respawn") continue;
    let side: "left" | "right" | "top" | "bottom" | null = null;
    if (f.x < b.left) side = "left";
    else if (f.x > b.right) side = "right";
    else if (f.y - defOf(f).stats.height < b.top && f.vy < -1 && f.action !== "air" && f.action !== "attack" && f.action !== "helpless") side = "top";
    else if (f.y - defOf(f).stats.height < b.top - 200) side = "top";
    else if (f.y > b.bottom) side = "bottom";
    if (!side) continue;
    ko(state, f, side);
  }
  if (state.rules.time > 0 && !state.suddenDeath) {
    state.timer--;
    if (state.timer <= 0) endOrSuddenDeath(state);
  }
  // end condition: one fighter (or team) with stocks left
  if (!state.ended) {
    const alive = state.fighters.filter((f) => f.stocks > 0);
    const teams = new Set(alive.map((f) => (state.rules.teams ? f.team : f.slot)));
    if (teams.size <= 1 && state.fighters.length > 1) {
      state.ended = true;
      state.winner = alive.length ? (state.rules.teams ? alive[0].team : alive[0].slot) : -1;
      state.events.push({ t: "end", frame: state.frame, winner: state.winner });
    }
  }
}

function ko(state: State, f: Fighter, side: "left" | "right" | "top" | "bottom"): void {
  f.stocks--;
  f.falls++;
  if (f.lastHitBy >= 0 && state.frame - f.lastHitFrame < 600) state.fighters[f.lastHitBy].kos++;
  if (f.grabbing >= 0) { const v = state.fighters[f.grabbing]; if (v) { v.grabbedBy = -1; setAction(v, v.grounded ? "idle" : "air"); } f.grabbing = -1; }
  if (f.grabbedBy >= 0) { const g = state.fighters[f.grabbedBy]; if (g) { g.grabbing = -1; setAction(g, "idle"); } f.grabbedBy = -1; }
  state.events.push({ t: "ko", frame: state.frame, slot: f.slot, x: f.x, y: f.y, side, by: f.lastHitBy });
  setAction(f, "dead");
  f.percent = 0;
  f.vx = 0; f.vy = 0;
  f.hitlag = 0; f.pending = null; f.hitstun = 0;
  f.ledge = -1;
  f.shield = C.SHIELD_MAX;
  f.charge = 0;
  state.slowmo = C.KO_SLOWMO;
  if (state.suddenDeath) return;
}

function respawn(state: State, f: Fighter, stage: Stage): void {
  const def = defOf(f);
  f.x = stage.respawn.x;
  f.y = stage.respawn.y;
  f.vx = 0; f.vy = 0;
  f.grounded = false;
  f.platform = -1;
  f.facing = f.x < (stage.camera.left + stage.camera.right) / 2 ? 1 : -1;
  f.jumpsLeft = def.stats.jumps - 1;
  f.airDodged = false;
  f.usedUpSpecial = false;
  f.invuln = C.RESPAWN_INVULN;
  f.special = def.special();
  f.hitLog = {};
  setAction(f, "respawn");
  state.events.push({ t: "respawn", frame: state.frame, slot: f.slot, x: f.x, y: f.y });
}

function endOrSuddenDeath(state: State): void {
  const alive = state.fighters.filter((f) => f.stocks > 0);
  // most stocks, then lowest percent
  let best: Fighter[] = [];
  let bestStocks = -1;
  for (const f of alive) {
    if (f.stocks > bestStocks) { bestStocks = f.stocks; best = [f]; }
    else if (f.stocks === bestStocks) best.push(f);
  }
  if (best.length > 1) {
    const minP = Math.min(...best.map((f) => f.percent));
    best = best.filter((f) => f.percent === minP);
  }
  if (best.length === 1) {
    state.ended = true;
    state.winner = state.rules.teams ? best[0].team : best[0].slot;
    state.events.push({ t: "end", frame: state.frame, winner: state.winner });
    return;
  }
  state.suddenDeath = true;
  for (const f of state.fighters) { f.stocks = f.stocks > 0 ? 1 : 0; f.percent = C.SUDDEN_DEATH_PERCENT; }
  state.events.push({ t: "suddenDeath", frame: state.frame });
}
