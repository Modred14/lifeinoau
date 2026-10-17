import assert from "node:assert/strict";
import test from "node:test";
import campus from "../src/data/campus.json";
import { BED_HALLS } from "../src/admin/hostel";
import { doorPoint, INTERIORS, STALLS } from "../src/interiors";
import { BUILDINGS, CAMPUS_SITES, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, pointInPoly } from "../src/map";
import { isBlocked, segmentClear } from "../src/movement";
import { findPath } from "../src/path";

test("reviewed sites preserve existing place indices and unrelated building outlines", () => {
  assert.deepEqual(PLACES.slice(0, campus.places.length).map((p) => p.name), campus.places.map((p) => p.name));
  for (let id = 0; id < campus.buildings.length; id++) {
    assert.equal(BUILDINGS[id].id, id);
    if (![684, 1752, 1755].includes(id)) assert.deepEqual(BUILDINGS[id].poly, campus.buildings[id].pts);
  }
  assert.equal(new Set(PLACES.map((p) => p.id)).size, PLACES.length);
});

test("every reviewed footprint belongs to exactly one existing building", () => {
  for (const site of CAMPUS_SITES) for (const block of site.blocks) {
    const matches = campus.buildings.filter((b) => pointInPoly(block.anchor[0], block.anchor[1], b.pts));
    assert.equal(matches.length, 1, `${site.name}: ambiguous footprint at ${block.anchor}`);
  }
});

test("reviewed hostels and the market appear on the map and have walkable routes", () => {
  const sub = PLACES.find((p) => p.name === "Student Union Building")!;
  const from = doorPoint(sub, isBlocked);
  for (const site of CAMPUS_SITES) {
    const place = PLACES.find((p) => p.name === site.name);
    assert.ok(place, site.name);
    assert.ok(place.label.x >= 0 && place.label.x <= MAP_WIDTH_PX);
    assert.ok(place.label.y >= 0 && place.label.y <= MAP_HEIGHT_PX);
    assert.equal(isBlocked(place.door.x, place.door.y), false, `${site.name}: blocked entrance`);
    for (const path of site.paths ?? []) for (let i = 2; i < path.length; i += 2) {
      assert.ok(segmentClear(path[i - 2], path[i - 1], path[i], path[i + 1]), `${site.name}: access path crosses a wall`);
    }
    const to = doorPoint(place, isBlocked);
    const path = findPath(from, to);
    assert.ok(path.length, `${site.name}: unreachable`);
    assert.ok(Math.hypot(path.at(-1)!.x - to.x, path.at(-1)!.y - to.y) < 3 * PX_PER_METER);
    let previous = from;
    for (const point of path) {
      assert.ok(segmentClear(previous.x, previous.y, point.x, point.y), `${site.name}: route crosses a wall`);
      previous = point;
    }
  }
});

test("Ojaja courtyards are open ground and its room wings remain solid", () => {
  for (const [x, y] of [[601, 15858], [1043, 15632], [1467, 15479]]) {
    assert.equal(isBlocked(x, y), false, `courtyard blocked at ${x},${y}`);
  }
  assert.equal(isBlocked(884, 15397), true);
});

test("Maintenance hostels retain their open courts and separate identities", () => {
  const courts: Record<string, number[][]> = {
    "Amazing Grace Hostel": [[26162, 56156], [26627, 56279], [26902, 56376]],
    "SHG Hostel": [[27622, 57029], [28116, 57164], [27370, 57546], [27912, 57699], [27805, 57405]],
  };
  for (const [name, points] of Object.entries(courts)) {
    assert.ok(BUILDINGS.some((b) => b.site === name));
    for (const [x, y] of points) assert.equal(isBlocked(x, y), false, `${name}: courtyard blocked at ${x},${y}`);
  }
});

test("New Market shops do not overwrite New Buka or ETF residences", () => {
  const shops = BUILDINGS.filter((b) => b.site === "OAU New Market");
  assert.equal(shops.length, 126);
  assert.ok(shops.every((b) => b.kind === "commercial"));
  for (const id of [84, 85, 86, 87, 294, 295, 296, 297, 1499, 1509, 1529, 1530]) {
    assert.equal(BUILDINGS[id].site, undefined, `unrelated building ${id} became a market shop`);
  }
});

test("private hostels can be visited without entering the university bed ballot", () => {
  const akintola = PLACES.findIndex((p) => p.name === "Ladoke Akintola Hall");
  assert.ok(BED_HALLS.some((hall) => hall.place === akintola));
  for (const site of CAMPUS_SITES.filter((site) => site.housing === "private")) {
    const place = PLACES.findIndex((p) => p.name === site.name);
    assert.equal(INTERIORS[place]?.template.id, "hostel");
    assert.ok(!BED_HALLS.some((hall) => hall.place === place));
  }
});

test("new hostel activities are appended after the original indoor and outdoor activities", () => {
  const originalEnd = Math.max(...INTERIORS.slice(0, campus.places.length).flatMap((room) => room ? [room.spotEnd] : []));
  assert.equal(STALLS[0].spot, originalEnd);
  const outdoorEnd = Math.max(...STALLS.map((stall) => stall.spot));
  for (const room of INTERIORS.slice(campus.places.length)) if (room) assert.ok(room.spotStart > outdoorEnd);
});

test("surveyed heights only replace guessed heights on unnamed buildings", async () => {
  const { default: survey } = await import("../src/data/building-heights.json");
  const ids = Object.keys(survey.heights).map(Number);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const source = campus.buildings[id];
    const height = (survey.heights as Record<string, number>)[id];
    assert.ok(source && !source.name && source.kind === "other", `building ${id} is not an unnamed generic building`);
    assert.ok(height >= 3 && height <= 15 && Math.abs(height - source.h) >= 3, `building ${id} height ${height}`);
    assert.equal(BUILDINGS[id].height, BUILDINGS[id].site ? BUILDINGS[id].height : height);
  }
  const named = campus.buildings.findIndex((b) => /senate/i.test(b.name ?? ""));
  assert.equal(BUILDINGS[named].height, campus.buildings[named].h);
});
