import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDINGS, PLACES, PX_PER_METER, pointInPoly } from "@campuslife/shared";
import { pickBuilding } from "./pick-building";

const centred = (id: number) => {
  const b = BUILDINGS[id];
  return pointInPoly(b.bbox.x + b.bbox.w / 2, b.bbox.y + b.bbox.h / 2, b.poly);
};
const place = PLACES.find((p) => p.building !== undefined && BUILDINGS[p.building].height > 4 && centred(p.building));
const metres = (px: number) => px / PX_PER_METER;

test("a tap on a named building picks its place, and a tap on open ground picks nothing", () => {
  assert.ok(place && place.building !== undefined);
  const b = BUILDINGS[place.building];
  const cx = metres(b.bbox.x + b.bbox.w / 2);
  const cz = metres(b.bbox.y + b.bbox.h / 2);
  const down = pickBuilding({ origin: { x: cx, y: 120, z: cz }, direction: { x: 0, y: -1, z: 0 } });
  assert.equal(down?.building.id, b.id, "the outline is hit from above");
  assert.equal(down?.place.name, place.name);
  const slanted = pickBuilding({ origin: { x: cx - 60, y: 60 + b.height / 2, z: cz }, direction: { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 } });
  assert.equal(slanted?.place.name, place.name, "a camera style slanted ray lands on the same building");
  assert.equal(pickBuilding({ origin: { x: cx, y: 120, z: cz }, direction: { x: 0, y: 1, z: 0 } }), null, "a ray into the sky hits nothing");
  assert.equal(pickBuilding({ origin: { x: -500, y: 30, z: -500 }, direction: { x: 0, y: -1, z: 0 } }), null, "off the map hits nothing");
});

test("the ray stops at the first building it meets, below that building's roof", () => {
  assert.ok(place && place.building !== undefined);
  const b = BUILDINGS[place.building];
  const cx = metres(b.bbox.x + b.bbox.w / 2);
  const cz = metres(b.bbox.y + b.bbox.h / 2);
  const over = pickBuilding({ origin: { x: cx - 400, y: b.height + 40, z: cz }, direction: { x: 1, y: 0, z: 0 } });
  assert.equal(over, null, "a level ray above the roofs hits nothing");
});
