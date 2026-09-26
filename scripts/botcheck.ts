import { cpuInput } from "../shared/cpu";
import { hitOf } from "../shared/hits";
import { B, EMPTY_INPUT } from "../shared/input";
import { rosterList } from "../shared/fighters/index";
import { createMatch, step } from "../shared/sim";
import { loadAllHouse } from "../test/house";

await loadAllHouse();
const DUMMY = "lampjack";

let failed = false;

function result(name: string, pass: boolean, detail: string): void {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!pass) failed = true;
}

function recoveryCheck(id: string): void {
  let recovered = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const state = createMatch({
      stage: "proving",
      players: [{ fighter: id, cpu: 9 }, { fighter: DUMMY }],
      rules: { stocks: 1 },
      seed,
    });
    const fighter = state.fighters[0], thrower = state.fighters[1];
    const side = seed % 2 ? 1 : -1;
    fighter.x = side * 535;
    fighter.y = 0;
    fighter.percent = 52;
    fighter.facing = (-side) as 1 | -1;
    thrower.x = fighter.x - side * 75;
    thrower.y = 0;
    thrower.facing = side as 1 | -1;
    thrower.moveFacing = thrower.facing;
    hitOf(state, thrower, fighter, {
      frames: [0, 0], x: 0, y: 0, r: 0,
      damage: 8, angle: 35, base: 50, growth: 55,
    }, fighter.x, fighter.y - 50, true);

    let landed = false;
    for (let frame = 0; frame < 900 && fighter.stocks > 0; frame++) {
      step(state, [cpuInput(state, 0, 9), EMPTY_INPUT]);
      if (fighter.grounded && fighter.platform === 0 && Math.abs(fighter.x) <= 560) {
        landed = true;
        break;
      }
      state.events.length = 0;
    }
    if (landed) recovered++;
  }
  result(`${id} recovery`, recovered >= 8, `${recovered}/10`);
}

function techCheck(): void {
  let techs = 0;
  const attempts = 12;
  for (let seed = 1; seed <= attempts; seed++) {
    const state = createMatch({ stage: "proving", players: [{ fighter: rosterList[seed % rosterList.length].id, cpu: 9 }, { fighter: DUMMY }], seed });
    const fighter = state.fighters[0];
    fighter.x = (seed - 6) * 35;
    fighter.y = -150 - seed * 4;
    fighter.vx = seed % 2 ? 3 : -3;
    fighter.vy = 7 + (seed % 3);
    fighter.grounded = false;
    fighter.platform = -1;
    fighter.action = "tumble";
    fighter.frame = 0;
    fighter.hitstun = 75;
    let teched = false;
    for (let frame = 0; frame < 90 && !fighter.grounded; frame++) {
      step(state, [cpuInput(state, 0, 9), EMPTY_INPUT]);
      if (state.events.some((event) => event.t === "tech" && event.slot === 0)) teched = true;
      state.events.length = 0;
    }
    if (teched) techs++;
  }
  result("level-9 techs", techs >= attempts / 2, `${techs}/${attempts} tumble landings`);
}

function secondUpSpecialCheck(): void {
  let violations = 0;
  let frames = 0;
  for (const def of rosterList) {
    const state = createMatch({ stage: "proving", players: [{ fighter: def.id, cpu: 9 }, { fighter: DUMMY }], seed: 71 });
    const fighter = state.fighters[0];
    fighter.x = 690;
    fighter.y = 90;
    fighter.vx = 1;
    fighter.vy = 3;
    fighter.grounded = false;
    fighter.platform = -1;
    fighter.action = "air";
    fighter.jumpsLeft = 0;
    fighter.usedUpSpecial = true;
    for (let frame = 0; frame < 180 && fighter.stocks > 0 && !fighter.grounded; frame++) {
      const input = cpuInput(state, 0, 9);
      if (fighter.usedUpSpecial && !fighter.grounded && (input.b & B.SPECIAL) !== 0 && input.y < -Math.abs(input.x)) violations++;
      frames++;
      step(state, [input, EMPTY_INPUT]);
      state.events.length = 0;
    }
  }
  result("no second up-special", violations === 0, `${violations} violations in ${frames} airborne frames`);
}

function koCheck(id: string): void {
  const state = createMatch({
    stage: "proving",
    players: [{ fighter: id, cpu: 9 }, { fighter: DUMMY }],
    rules: { stocks: 1 },
    seed: 31337,
  });
  let frames = 0;
  while (state.fighters[1].stocks > 0 && frames < 1800) {
    step(state, [cpuInput(state, 0, 9), EMPTY_INPUT]);
    state.events.length = 0;
    frames++;
  }
  const pass = state.fighters[1].stocks === 0;
  result(`${id} idle-dummy KO`, pass, pass ? `${(frames / 60).toFixed(1)}s` : ">30.0s");
}

console.log("botcheck");
for (const def of rosterList) recoveryCheck(def.id);
techCheck();
secondUpSpecialCheck();
for (const def of rosterList) koCheck(def.id);
console.log(failed ? "botcheck: FAIL" : "botcheck: PASS");
if (failed) process.exitCode = 1;
