import assert from "node:assert/strict";
import test from "node:test";
import { HOSTEL_PITCHES } from "../src/admin/hustles";
import { CONDITION_SITES } from "../src/conditions/sites";
import { PLAYER_RADIUS, SERVER_TICK_MS } from "../src/constants";
import { INTERIORS, SPOTS, STALLS, doorPoint } from "../src/interiors";
import { MOTOR_PARK } from "../src/life";
import { BUILDINGS, GATE, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, SPAWN_POINT, buildingCells, forCells, pointInPoly, type Point } from "../src/map";
import { IDLE, isBlocked, stepMovement, type MoveIntent, type Mover } from "../src/movement";
import { findPath } from "../src/path";
import { POLITICS_POINTS } from "../src/politics/sites";
import { QUEUES } from "../src/queues";
import { SOCIAL_POINTS } from "../src/social/points";
import { GATEHOUSE_NAME, GATE_PILLAR_NAME, SOLIDS, addSolid, solidBlocked, type Solid } from "../src/solids";
import { KNOCK, PUSH_SPEED, pushOut, vehicleBody } from "../src/traffic";
import { LINES } from "../src/transit";

const M = PX_PER_METER;
const SAMPLES_PER_BUILDING = 12;
const SAMPLE_TRIES = 400;
const PUSH_ANGLES = 8;
const PUSH_FROM = 6 * M;
const TICKS = [SERVER_TICK_MS, 250];
const MAX_STEPS = 4000;
const EDGE = 2 * M;
const AROUND = 7 * M;
const PUSH_TRIALS = 20000;
const OPEN_SEARCH = { step: 4 * M, reach: 120 * M, clear: 12 * M };

let seed = 20261006;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

function buildingAt(x: number, y: number): number {
  let hit = -1;
  forCells(x, y, x, y, (i) => {
    for (const id of buildingCells[i]) if (hit < 0 && pointInPoly(x, y, BUILDINGS[id].poly)) hit = id;
  });
  return hit;
}

function crossesWall(a: Point, b: Point): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= n; i++) if (buildingAt(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n) >= 0) return true;
  return false;
}

const inMap = (p: Point) => p.x > EDGE && p.y > EDGE && p.x < MAP_WIDTH_PX - EDGE && p.y < MAP_HEIGHT_PX - EDGE;

function walk(from: Point, intent: MoveIntent, tick: number, each: (m: Mover, before: Point) => void): Mover {
  const m: Mover = { x: from.x, y: from.y, dir: 0, intent };
  for (let i = 0; i < MAX_STEPS && m.intent.kind !== "idle"; i++) {
    const before = { x: m.x, y: m.y };
    stepMovement(m, tick);
    each(m, before);
    if (m.intent.kind === "dir" && m.x === before.x && m.y === before.y) break;
  }
  return m;
}

function follow(from: Point, path: readonly Point[], what: string): Mover {
  let m: Mover = { x: from.x, y: from.y, dir: 0, intent: IDLE };
  for (const next of path) {
    m = walk(m, { kind: "target", x: next.x, y: next.y }, SERVER_TICK_MS, (at) => assert.ok(!isBlocked(at.x, at.y), `${what}: walked into something`));
    assert.ok(Math.hypot(m.x - next.x, m.y - next.y) <= 2, `${what}: stopped short of a waypoint`);
  }
  return m;
}

const corners = (s: Solid, grow: number): Point[] =>
  [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0], [1, 0], [0, 1]].map(([a, b]) => {
    const along = a * (s.halfAlong + grow);
    const across = b * (s.halfAcross + grow);
    return { x: s.x + Math.cos(s.angle) * along - Math.sin(s.angle) * across, y: s.y + Math.sin(s.angle) * along + Math.cos(s.angle) * across };
  });

test("every point inside a building is blocked", () => {
  for (const b of BUILDINGS) {
    let found = 0;
    for (let i = 0; i < SAMPLE_TRIES && found < SAMPLES_PER_BUILDING; i++) {
      const x = b.bbox.x + random() * b.bbox.w;
      const y = b.bbox.y + random() * b.bbox.h;
      if (!pointInPoly(x, y, b.poly)) continue;
      found++;
      assert.ok(isBlocked(x, y) && isBlocked(x, y, 0), `building ${b.id} is open at ${Math.round(x)},${Math.round(y)}`);
    }
  }
});

test("a walker pushed at any wall never gets inside or through it", () => {
  for (const b of BUILDINGS) {
    const centre = { x: b.bbox.x + b.bbox.w / 2, y: b.bbox.y + b.bbox.h / 2 };
    const reach = Math.hypot(b.bbox.w, b.bbox.h) / 2 + PUSH_FROM;
    for (let k = 0; k < PUSH_ANGLES; k++) {
      const a = (k / PUSH_ANGLES) * Math.PI * 2 + b.id;
      const from = { x: centre.x + Math.cos(a) * reach, y: centre.y + Math.sin(a) * reach };
      if (!inMap(from) || isBlocked(from.x, from.y)) continue;
      const far = { x: centre.x - Math.cos(a) * reach, y: centre.y - Math.sin(a) * reach };
      const intents: MoveIntent[] = [{ kind: "dir", dx: -Math.cos(a), dy: -Math.sin(a) }, { kind: "target", x: far.x, y: far.y }];
      for (const intent of intents)
        walk(from, intent, TICKS[(k + b.id) % TICKS.length], (m, before) => {
          assert.equal(buildingAt(m.x, m.y), -1, `${intent.kind} walker ended inside building ${b.id}`);
          assert.ok(!crossesWall(before, m), `${intent.kind} walker crossed a wall of building ${b.id}`);
        });
    }
  }
});

test("the gate and the chemist kiosk are registered as solids", () => {
  if (GATE) {
    assert.equal(SOLIDS.filter((s) => s.name === GATEHOUSE_NAME).length, 1);
    assert.equal(SOLIDS.filter((s) => s.name === GATE_PILLAR_NAME).length, 3);
  }
  for (const site of CONDITION_SITES.filter((s) => s.kind === "chemist")) {
    assert.ok(isBlocked(site.x, site.y), "the chemist kiosk is walk-through");
    assert.ok(SOLIDS.some((s) => Math.hypot(s.x - site.x, s.y - site.y) < M), "the chemist kiosk has no footprint");
  }
});

test("every solid blocks a walker from every side and can be walked around", () => {
  for (const s of SOLIDS) {
    for (const p of corners(s, 0)) assert.ok(isBlocked(p.x, p.y, 1), `${s.name} is open at ${Math.round(p.x)},${Math.round(p.y)}`);
    for (let k = 0; k < PUSH_ANGLES * 2; k++) {
      const a = (k / (PUSH_ANGLES * 2)) * Math.PI * 2;
      const from = { x: s.x + Math.cos(a) * AROUND, y: s.y + Math.sin(a) * AROUND };
      if (isBlocked(from.x, from.y)) continue;
      const intents: MoveIntent[] = [{ kind: "dir", dx: -Math.cos(a), dy: -Math.sin(a) }, { kind: "target", x: s.x, y: s.y }];
      for (const intent of intents) walk(from, intent, TICKS[k % TICKS.length], (m) => assert.ok(!solidBlocked(m.x, m.y, PLAYER_RADIUS - 1), `walked into ${s.name}`));
      const to = { x: s.x - Math.cos(a) * AROUND, y: s.y - Math.sin(a) * AROUND };
      if (isBlocked(to.x, to.y)) continue;
      const path = findPath(from, to);
      assert.ok(path.length > 1, `no way around ${s.name}`);
      const end = follow(from, path, `around ${s.name}`);
      assert.ok(Math.hypot(end.x - to.x, end.y - to.y) <= 2, `route around ${s.name} ends short`);
    }
  }
});

test("fixed standing points are never inside something solid", () => {
  const free = (p: Point, what: string) => assert.ok(!isBlocked(p.x, p.y), `${what} is blocked at ${Math.round(p.x)},${Math.round(p.y)}`);
  PLACES.forEach((p, i) => {
    if (INTERIORS[i]) free(doorPoint(p, isBlocked), `${p.name} exit`);
  });
  for (const line of LINES) for (const stop of line.stops) free(stop.kerb, `${line.name} kerb ${stop.name}`);
  free(MOTOR_PARK, MOTOR_PARK.name);
  free(MOTOR_PARK.spawn, `${MOTOR_PARK.name} shuttle bay`);
  free(SPAWN_POINT, "spawn point");
  for (const s of STALLS) free({ x: SPOTS[s.spot].sx, y: SPOTS[s.spot].sy }, `${s.name} customer spot`);
  SPOTS.forEach((s, i) => free({ x: s.sx, y: s.sy }, `spot ${i} (${s.label}) standing point`));
  for (const q of QUEUES) for (const slot of q.slots) free(slot, "queue slot");
  for (const site of CONDITION_SITES) for (const p of [site.stand, ...site.queue]) free(p, `${site.name} queue`);
  for (const p of POLITICS_POINTS) free(p, "politics site");
  for (const p of SOCIAL_POINTS) free(p, "social spot");
  for (const pitch of HOSTEL_PITCHES) free(pitch.at, `${pitch.name} tray pitch`);
});

test("a vehicle never shoves a walker into or across a wall", () => {
  const kinds = ["shuttle", "okada", "keke"] as const;
  let shoved = 0;
  for (let i = 0; i < PUSH_TRIALS; i++) {
    const b = BUILDINGS[Math.floor(random() * BUILDINGS.length)];
    const k = Math.floor(random() * (b.poly.length / 2)) * 2;
    const a = random() * Math.PI * 2;
    const d = PLAYER_RADIUS + 1 + random() * M;
    const p = { x: b.poly[k] + Math.cos(a) * d, y: b.poly[k + 1] + Math.sin(a) * d };
    if (!inMap(p) || isBlocked(p.x, p.y)) continue;
    const body = vehicleBody(kinds[i % kinds.length], p.x + (random() - 0.5) * 3 * M, p.y + (random() - 0.5) * 3 * M, random() * Math.PI * 2, KNOCK.minSpeed);
    const to = pushOut(body, p, isBlocked, i % 2 ? { extra: KNOCK.shove } : { maxStep: PUSH_SPEED * (SERVER_TICK_MS / 1000) });
    if (!to) continue;
    shoved++;
    assert.equal(buildingAt(to.x, to.y), -1, "shoved inside a building");
    assert.ok(!crossesWall(p, to), "shoved across a wall");
  }
  assert.ok(shoved > PUSH_TRIALS / 10);
});

test("a solid added later is blocked at once and routes go around it", () => {
  let open: Point | undefined;
  for (let r = 0; r <= OPEN_SEARCH.reach && !open; r += OPEN_SEARCH.step)
    for (let k = 0; k < PUSH_ANGLES && !open; k++) {
      const a = (k / PUSH_ANGLES) * Math.PI * 2;
      const p = { x: SPAWN_POINT.x + Math.cos(a) * r, y: SPAWN_POINT.y + Math.sin(a) * r };
      if (inMap(p) && !isBlocked(p.x, p.y, OPEN_SEARCH.clear)) open = p;
    }
  assert.ok(open, "no open ground near the spawn point");
  const from = { x: open.x - AROUND, y: open.y };
  const to = { x: open.x + AROUND, y: open.y };
  assert.deepEqual(findPath(from, to), [to]);
  const shed = addSolid({ name: "test shed", x: open.x, y: open.y, halfAlong: 2 * M, halfAcross: 1.5 * M, angle: Math.PI / 5 });
  for (const p of corners(shed, 0)) assert.ok(isBlocked(p.x, p.y, 1));
  for (const p of corners(shed, PLAYER_RADIUS + 2).filter((c) => c.x !== shed.x || c.y !== shed.y)) assert.ok(!isBlocked(p.x, p.y));
  const path = findPath(from, to);
  assert.ok(path.length > 1);
  const end = follow(from, path, "around the test shed");
  assert.ok(Math.hypot(end.x - to.x, end.y - to.y) <= 2);
});
