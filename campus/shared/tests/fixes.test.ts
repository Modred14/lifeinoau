import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BED_HALLS,
  CLASS_VENUES,
  CONDITION_POINTS,
  CONGRESS_SITE,
  GST_VENUES,
  HOSTEL_PITCHES,
  MAP_HEIGHT_PX,
  MAP_WIDTH_PX,
  PLACES,
  POLITICS_POINTS,
  PREDICT,
  PX_PER_METER,
  RALLY_POINTS,
  SOCIAL_SITES,
  ballotPosition,
  calendarFor,
  nearBuilding,
  parseSocial,
  petitionGranted,
  type Point,
} from "../src/index";
import { SITES_APART, closestApart, sitesClear } from "../src/sites-clear";
import { SOCIAL_POINTS } from "../src/social/points";

const M = PX_PER_METER;
const SAMPLE = 200;
const SECRET = "a-server-only-secret";
const CANOPY_SOUTH_M = 1.5;

test("fixed sites from different systems keep at least 4 m apart", () => {
  const systems: Record<string, readonly Point[]> = {
    social: SOCIAL_POINTS,
    politics: POLITICS_POINTS,
    conditions: CONDITION_POINTS,
    hustles: HOSTEL_PITCHES.map((p) => p.at),
  };
  const names = Object.keys(systems);
  for (const list of Object.values(systems)) assert.ok(list.length > 0);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const apart = closestApart(systems[names[i]], systems[names[j]]);
      assert.ok(apart >= SITES_APART, `${names[i]} and ${names[j]} are ${(apart / M).toFixed(1)} m apart`);
    }
  assert.equal(sitesClear(0, 0, [[{ x: 3 * M, y: 0 }]]), false);
  assert.equal(sitesClear(0, 0, [[{ x: 4 * M, y: 0 }], []]), true);
});

test("congress sits on its own ground, off the Awo rally point", () => {
  assert.ok(Math.hypot(CONGRESS_SITE.x - RALLY_POINTS[0].x, CONGRESS_SITE.y - RALLY_POINTS[0].y) >= SITES_APART);
  assert.equal(CONGRESS_SITE.place, RALLY_POINTS[0].place);
});

test("the jollof canopy stands on the play grid, not inside a building", () => {
  const forecourt = SOCIAL_SITES.forecourt;
  assert.ok(forecourt);
  assert.equal(nearBuilding(forecourt.x, forecourt.y + CANOPY_SOUTH_M * M, 0), false);
});

test("class venues all have a door on the map", () => {
  for (const place of [...CLASS_VENUES, ...GST_VENUES]) {
    const door = PLACES[place].door;
    assert.ok(door.x >= 0 && door.y >= 0 && door.x <= MAP_WIDTH_PX && door.y <= MAP_HEIGHT_PX, `${PLACES[place].name} door is off the map`);
  }
  assert.ok(CLASS_VENUES.length > 0 && GST_VENUES.length > 0);
});

test("the day calendar is cached and stays the same", () => {
  const first = calendarFor(12);
  assert.equal(calendarFor(12), first);
  assert.deepEqual(calendarFor(12).map((e) => e.key), first.map((e) => e.key));
});

test("a secret changes the bed ballot and the petition ruling, and no secret keeps the old draw", () => {
  const hall = BED_HALLS[0];
  const keys = Array.from({ length: SAMPLE }, (_, i) => `acct-${i}`);
  assert.ok(keys.some((k) => ballotPosition(5, hall.place, k) !== ballotPosition(5, hall.place, k, SECRET)));
  assert.ok(keys.some((k) => petitionGranted(5, "race", k) !== petitionGranted(5, "race", k, SECRET)));
  for (const k of keys) assert.equal(ballotPosition(5, hall.place, k, SECRET), ballotPosition(5, hall.place, k, SECRET));
});

test("the weekly cash-win count survives a save and rejects junk", () => {
  assert.deepEqual(parseSocial({ paid: [3, 2] }).paid, [3, 2]);
  assert.equal(parseSocial({ paid: [3, -1] }).paid, undefined);
  assert.equal(parseSocial({ paid: "x" }).paid, undefined);
  assert.equal(parseSocial({ paid: [1.5, 1] }).paid, undefined);
  assert.ok(PREDICT.cashWinsPerWeek === 2 && PREDICT.cappedFun > 0);
});
