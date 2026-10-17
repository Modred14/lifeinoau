import assert from "node:assert/strict";
import { test } from "node:test";
import { walkingFactor, vitalityMessage } from "../src/vitals.ts";
import { stepMovement, segmentClear, type Mover } from "../src/movement.ts";
import { SPAWN_POINT } from "../src/map.ts";
import { PLAYER_SPEED } from "../src/constants.ts";

test("hunger and exhaustion slow walking progressively without trapping a player", () => {
  assert.equal(walkingFactor({ food: 100, energy: 100 }), 1);
  assert.equal(walkingFactor({ food: 30, energy: 25 }), 1);
  assert.ok(walkingFactor({ food: 15, energy: 100 }) < 1);
  assert.ok(walkingFactor({ food: 100, energy: 10 }) < 1);
  assert.equal(walkingFactor({ food: 0, energy: 0 }), 0.45);
  assert.equal(walkingFactor({ food: NaN, energy: Infinity }), 0.45);
  for (let food = 0; food < 30; food++) assert.ok(walkingFactor({ food, energy: 100 }) <= walkingFactor({ food: food + 1, energy: 100 }));
  assert.equal(walkingFactor({ food: 29.6, energy: 24.6 }), walkingFactor({ food: 30, energy: 25 }));
});

test("recovering needs clears the warning and restores full speed", () => {
  assert.match(vitalityMessage({ food: 0, energy: 0 })!, /Eat something and get some rest/);
  assert.match(vitalityMessage({ food: 20, energy: 100 })!, /hungry/);
  assert.match(vitalityMessage({ food: 100, energy: 20 })!, /tired/);
  assert.equal(vitalityMessage({ food: 30, energy: 25 }), null);
});

test("keyboard and tap movement apply the same needs rules as healthy movement", () => {
  let start = { ...SPAWN_POINT };
  for (let offset = 0; offset < 1000; offset += 20) {
    const candidate = { x: SPAWN_POINT.x, y: SPAWN_POINT.y + offset };
    if (segmentClear(candidate.x, candidate.y, candidate.x + 100, candidate.y)) { start = candidate; break; }
  }
  assert.ok(segmentClear(start.x, start.y, start.x + 100, start.y));
  for (const intent of [{ kind: "dir" as const, dx: 1, dy: 0 }, { kind: "target" as const, x: start.x + 100, y: start.y }]) {
    const healthy: Mover = { ...start, dir: 0, intent };
    const hungry: Mover = { ...start, dir: 0, intent };
    const legacy: Mover = { ...start, dir: 0, intent };
    stepMovement(healthy, 100, { food: 100, energy: 100 });
    stepMovement(hungry, 100, { food: 0, energy: 100 });
    stepMovement(legacy, 100);
    assert.ok(Math.abs(healthy.x - start.x - PLAYER_SPEED / 10) < 1e-8);
    assert.ok(Math.abs((hungry.x - start.x) / (healthy.x - start.x) - 0.45) < 1e-8);
    assert.equal(legacy.x, healthy.x);
  }
});
