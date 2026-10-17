import assert from "node:assert/strict";
import test from "node:test";
import { SPECIAL_TRADES } from "../src/social/trades";
import {
  KNOCK,
  PLAYER_RADIUS,
  PX_PER_METER,
  SPOTS,
  STALLS,
  ROADS,
  ROADSIDE_TRADES,
  isBlocked,
  LINES,
  PLACES,
  ROAD_LANES,
  VEHICLE_SPECS,
  findRoadPath,
  nearestCarriageway,
  resample,
  roundCorners,
  shiftRight,
  tidy,
  knocks,
  mustYield,
  nearBuilding,
  onCarriageway,
  onRoad,
  pushOut,
  stoppingRange,
  touchesBody,
  vehicleBody,
} from "../src/index";

const M = PX_PER_METER;
const open = () => false;

const SPECIAL_LABELS = new Set(Object.values(SPECIAL_TRADES).map((t) => t.label));

test("a vehicle body is its spec size turned to its heading", () => {
  const bus = vehicleBody("bus", 1000, 1000, Math.PI / 2, 0);
  assert.ok(touchesBody(bus, 1000, 1000 + 3.5 * M));
  assert.ok(!touchesBody(bus, 1000 + 3.5 * M, 1000));
  assert.ok(touchesBody(bus, 1000 + 1.1 * M + PLAYER_RADIUS - 1, 1000));
});

test("someone inside a vehicle is eased out to the nearer side", () => {
  const keke = vehicleBody("keke", 5000, 5000, 0, 0);
  const out = pushOut(keke, { x: 5000 + 10, y: 5000 + 4 }, open);
  assert.ok(out);
  assert.ok(!touchesBody(keke, out.x, out.y));
  assert.ok(out.y > 5000);
  assert.equal(Math.round(out.x), 5010);
  const step = pushOut(keke, { x: 5010, y: 5004 }, open, { maxStep: 5 });
  assert.ok(step);
  assert.ok(Math.abs(Math.hypot(step.x - 5010, step.y - 5004) - 5) < 1e-6);
  assert.equal(pushOut(keke, { x: 5000, y: 5000 + 5 * M }, open), null);
});

test("the push picks the other side when the near side is blocked, and gives up when boxed in", () => {
  const keke = vehicleBody("keke", 5000, 5000, 0, 0);
  const wallBelow = (_x: number, y: number) => y > 5000;
  const out = pushOut(keke, { x: 5000, y: 5004 }, wallBelow);
  assert.ok(out);
  assert.ok(out.y < 5000);
  assert.equal(pushOut(keke, { x: 5000, y: 5004 }, () => true), null);
});

test("only a moving vehicle knocks, and a knock shoves further than a push", () => {
  const parked = vehicleBody("bus", 5000, 5000, 0, 0);
  const moving = vehicleBody("bus", 5000, 5000, 0, 8 * M);
  assert.equal(knocks(parked, 5010, 5000), false);
  assert.equal(knocks(moving, 5010, 5000), true);
  assert.equal(knocks(vehicleBody("bus", 5000, 5000, 0, KNOCK.minSpeed - 1), 5010, 5000), false);
  const push = pushOut(moving, { x: 5010, y: 5002 }, open);
  const shove = pushOut(moving, { x: 5010, y: 5002 }, open, { extra: KNOCK.shove });
  assert.ok(push && shove);
  assert.ok(shove.y - push.y > KNOCK.shove - 1);
});

test("a vehicle yields in time for its speed, to people in its path only", () => {
  const brake = 5 * M;
  const fast = vehicleBody("keke", 5000, 5000, 0, 10 * M);
  const far = { x: 5000 + 13 * M, y: 5000 };
  assert.ok(stoppingRange(10 * M, brake) > 13 * M);
  assert.equal(mustYield(fast, [far], brake), true);
  assert.equal(mustYield(vehicleBody("keke", 5000, 5000, 0, 1 * M), [far], brake), false);
  assert.equal(mustYield(fast, [{ x: 5000 + 13 * M, y: 5000 + 3 * M }], brake), false);
  assert.equal(mustYield(fast, [{ x: 5000 - 5 * M, y: 5000 }], brake), false);
  assert.equal(mustYield(fast, [far], brake, far), false);
});

const bends = (pts: readonly { x: number; y: number }[]) => {
  let worst = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const d = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x) - Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
  }
  return worst;
};

test("a laned route holds one steady distance right of the road centre", () => {
  const from = PLACES.find((p) => /student union/i.test(p.name));
  const to = PLACES.find((p) => /moremi/i.test(p.name));
  assert.ok(from && to);
  const path = findRoadPath(from.door, to.door);
  assert.ok(path);
  const lane = shiftRight(resample(path.points), ROAD_LANES.keke, 0.675);
  let steady = 0;
  let onRight = 0;
  for (let i = 1; i + 1 < lane.length; i++) {
    const p = lane[i];
    const hx = lane[i + 1].x - lane[i - 1].x;
    const hy = lane[i + 1].y - lane[i - 1].y;
    const len = Math.hypot(hx, hy) || 1;
    const snap = nearestCarriageway(p.x, p.y, hx / len, hy / len);
    assert.ok(snap);
    assert.ok(onCarriageway(p.x, p.y, 0.6 * M), "laned point is off the carriageway");
    const side = ((p.x - snap.x) * -hy + (p.y - snap.y) * hx) / len;
    if (ROAD_LANES.keke.some((l) => Math.abs(snap.distance - l * M) < 2) || snap.distance < 2) steady++;
    if (side > -2) onRight++;
  }
  assert.ok(steady / (lane.length - 2) > 0.97, `only ${steady} of ${lane.length - 2} points sit in a lane`);
  assert.ok(onRight / (lane.length - 2) > 0.97, `only ${onRight} of ${lane.length - 2} points are on the right`);
});

test("corners are rounded so no single bend is sharp", () => {
  const corner = [{ x: 1000, y: 1000 }, { x: 1400, y: 1000 }, { x: 1400, y: 1400 }];
  assert.ok(bends(corner) > 1.5);
  const round = roundCorners(corner);
  assert.ok(bends(round) < 0.45, `sharpest bend ${bends(round)}`);
  assert.deepEqual(round[0], corner[0]);
  assert.deepEqual(round[round.length - 1], corner[2]);
  assert.deepEqual(tidy([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 110, y: 0 }, { x: 300, y: 1 }, { x: 600, y: 0 }]).length, 2);
});

test("shuttle and bus lines run in the right-hand lane with stops on the line", () => {
  for (const line of LINES) {
    const half = VEHICLE_SPECS[line.kind].size[1] / 2;
    let on = 0;
    const n = line.pts.length / 2;
    for (let i = 0; i < n; i++) if (onCarriageway(line.pts[i * 2], line.pts[i * 2 + 1], half * M * 0.8)) on++;
    assert.ok(on / n > 0.97, `${line.name}: ${on} of ${n} points inside the carriageway`);
    for (const stop of line.stops) {
      assert.ok(onCarriageway(stop.x, stop.y), `${line.name} stop ${stop.name} is off the road`);
      assert.ok(!isBlocked(stop.kerb.x, stop.kerb.y), `${line.name} kerb ${stop.name} is blocked`);
      assert.ok(Math.hypot(stop.kerb.x - stop.x, stop.kerb.y - stop.y) < 20 * M);
    }
  }
});

test("roadside traders stand clear of roads and buildings with a free spot to buy at", () => {
  const road = STALLS.filter((s) => s.roadside);
  assert.ok(road.length >= 40 && road.length <= 96, `${road.length} roadside traders`);
  assert.equal(STALLS.filter((s) => !s.roadside).every((s) => s.style === "umbrella"), true);
  for (const s of road) {
    const spot = SPOTS[s.spot];
    assert.equal(spot.kind, "eat");
    assert.equal(spot.roadside, true);
    assert.ok(spot.label === ROADSIDE_TRADES[s.goods].label || SPECIAL_LABELS.has(spot.label), `${spot.label} is not a known trade`);
    assert.ok((spot.price ?? 0) > 0 && (spot.food ?? 0) > 0);
    assert.ok(!isBlocked(spot.x, spot.y), `${s.name} customer spot is blocked`);
    assert.ok(!onRoad(spot.x, spot.y), `${s.name} customer stands in the road`);
    assert.ok(!onRoad(s.x, s.y, 2 * M) && !nearBuilding(s.x, s.y, 3 * M));
    assert.ok(isBlocked(s.x, s.y));
  }
  for (let i = 0; i < STALLS.length; i++) for (let j = i + 1; j < STALLS.length; j++) assert.ok(Math.hypot(STALLS[i].x - STALLS[j].x, STALLS[i].y - STALLS[j].y) > 6.9 * M);
});
