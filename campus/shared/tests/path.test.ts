import assert from "node:assert/strict";
import test from "node:test";
import { doorPoint } from "../src/interiors";
import { PLACES, PX_PER_METER, onRoad, type Point } from "../src/map";
import { isBlocked, segmentClear } from "../src/movement";
import { findPath, findRoadPath, isWalkway, nearestRoadPoint, pathLength } from "../src/path";

const M = PX_PER_METER;
const MIN_ROAD_SHARE = 0.85;
const MAX_LONG_ROUTE_MS = 400;
const ROAD_EDGE_MARGIN = 1.5 * M;
const place = (re: RegExp): Point => {
  const p = PLACES.find((x) => re.test(x.name));
  assert.ok(p, `no place matches ${re}`);
  return doorPoint(p, isBlocked);
};

const ROUTES: [string, RegExp, RegExp][] = [
  ["Main Gate to Moremi Hall", /^main gate$/i, /moremi/i],
  ["Moremi Hall to Faculty of Technology", /moremi/i, /^faculty of technology$/i],
  ["Awolowo Hall to Library", /awolowo hall/i, /oluwasanmi library/i],
  ["SUB to Sports Centre", /student union/i, /sports centre/i],
  ["Postgraduate Hall to Pharmacy", /postgraduate hall/i, /faculty of pharmacy/i],
  ["Angola Hall to Oduduwa Hall", /angola/i, /oduduwa/i],
];

function roadShare(from: Point, path: Point[], onNet: (x: number, y: number) => boolean): number {
  let on = 0;
  let total = 0;
  let a = from;
  for (const b of path) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / M));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      total++;
      if (onNet(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) on++;
    }
    a = b;
  }
  return on / total;
}

test("long walks follow roads and paths, and every segment is walkable", () => {
  for (const [name, a, b] of ROUTES) {
    const from = place(a);
    const to = place(b);
    const started = performance.now();
    const path = findPath(from, to);
    const ms = performance.now() - started;
    assert.ok(path.length > 0, `${name}: no route`);
    const end = path[path.length - 1];
    assert.ok(Math.hypot(end.x - to.x, end.y - to.y) < 3 * M, `${name}: does not end at the door`);
    let prev = from;
    for (const p of path) {
      assert.ok(segmentClear(prev.x, prev.y, p.x, p.y), `${name}: blocked segment`);
      prev = p;
    }
    const share = roadShare(from, path, (x, y) => onRoad(x, y, M));
    const net = roadShare(from, path, isWalkway);
    const metres = Math.round(pathLength(from, path) / M);
    console.log(`${name}: ${metres} m, ${path.length} waypoints, ${(share * 100).toFixed(1)}% on road or path, ${(net * 100).toFixed(1)}% on road, path or paved ground, ${ms.toFixed(1)} ms`);
    assert.ok(share >= MIN_ROAD_SHARE, `${name}: only ${(share * 100).toFixed(1)}% on roads`);
    assert.ok(ms < MAX_LONG_ROUTE_MS, `${name}: took ${ms.toFixed(0)} ms`);
  }
});

test("a short hop still goes straight", () => {
  const from = place(/student union/i);
  const to = { x: from.x + 6 * M, y: from.y };
  if (segmentClear(from.x, from.y, to.x, to.y)) assert.deepEqual(findPath(from, to), [to]);
});

test("vehicle routes stay on roads and connect real places", () => {
  const gate = place(/^main gate$/i);
  for (const p of PLACES) {
    const door = doorPoint(p, isBlocked);
    const near = nearestRoadPoint(door);
    assert.ok(near, `${p.name}: no road nearby`);
    const route = findRoadPath(gate, door);
    assert.ok(route, `${p.name}: no road route from the gate`);
    const last = route.points[route.points.length - 1];
    assert.ok(Math.hypot(last.x - near.x, last.y - near.y) < 1, `${p.name}: route does not reach its road point`);
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1];
      const b = route.points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (M / 2)));
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n;
        const y = a.y + ((b.y - a.y) * k) / n;
        assert.ok(onRoad(x, y, ROAD_EDGE_MARGIN), `${p.name}: left the road at ${Math.round(x)},${Math.round(y)}`);
        assert.ok(!isBlocked(x, y), `${p.name}: drives through something at ${Math.round(x)},${Math.round(y)}`);
      }
    }
  }
});
