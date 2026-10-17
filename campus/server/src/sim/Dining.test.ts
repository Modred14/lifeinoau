import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERIORS, SPOTS, STALLS } from "@campuslife/shared";
import { findTableSeat, mealServed, serveMeal } from "./Dining";

const sub = INTERIORS.find((it) => it?.template.id === "foodcourt")!;
const counters: number[] = [];
for (let i = sub.spotStart; i < sub.spotEnd; i++) if (SPOTS[i].kind === "eat") counters.push(i);

test("a buyer is seated at a free table that belongs to the counter", () => {
  const owners = new Map<number, string>();
  for (const counter of counters) {
    const seat = findTableSeat(counter, owners);
    assert.ok(seat !== undefined);
    assert.equal(SPOTS[seat].menu, counter);
    assert.equal(SPOTS[seat].place, sub.place);
    assert.equal(SPOTS[seat].kind, "sit");
  }
});

test("taken seats are skipped, then other tables, then standing at the counter", () => {
  const owners = new Map<number, string>();
  const counter = counters[0];
  const used = new Set<number>();
  let own = 0;
  for (;;) {
    const seat = findTableSeat(counter, owners);
    if (seat === undefined) break;
    assert.ok(!used.has(seat));
    used.add(seat);
    owners.set(seat, "x");
    if (SPOTS[seat].menu === counter) own++;
    else assert.ok(![...Array(sub.spotEnd - sub.spotStart).keys()].some((k) => SPOTS[sub.spotStart + k].menu === counter && !owners.has(sub.spotStart + k)));
  }
  assert.ok(own >= 12);
  assert.equal(used.size, sub.template.spots.filter((s) => s.menu !== undefined).length);
});

test("stalls, vending machines and seats never hand out a table", () => {
  assert.equal(findTableSeat(STALLS[0].spot, new Map()), undefined);
  const room = INTERIORS.find((it) => it?.template.id === "classroom")!;
  for (let i = room.spotStart; i < room.spotEnd; i++) assert.equal(findTableSeat(i, new Map()), undefined);
  assert.equal(findTableSeat(sub.spotStart + sub.template.spots.findIndex((s) => s.kind === "sit"), new Map()), undefined);
  assert.equal(findTableSeat(-1, new Map()), undefined);
});

test("the meal eaten at a table is the one bought at the counter", () => {
  const counter = counters[2];
  const seat = findTableSeat(counter, new Map())!;
  const act = { spot: seat };
  assert.equal(mealServed(act, SPOTS[seat]), undefined);
  serveMeal(act, counter);
  assert.equal(mealServed(act, SPOTS[seat]), SPOTS[counter]);
  assert.equal(mealServed({ spot: counter }, SPOTS[counter]), SPOTS[counter]);
});
