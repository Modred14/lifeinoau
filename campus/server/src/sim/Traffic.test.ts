import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOCK,
  PLAYER_RADIUS,
  PX_PER_METER,
  TRAFFIC_FLEET,
  TRAFFIC_LINE,
  VEHICLE_KINDS,
  VEHICLE_SPECS,
  VehicleState,
  isBlocked,
  isDrivable,
  knocks,
  onCarriageway,
  type Point,
} from "@campuslife/shared";
import { TrafficDesk, trafficAnchors, type RoadUser } from "./Traffic";

const M = PX_PER_METER;
const DT = 0.05;
const FLEET = TRAFFIC_FLEET.keke + TRAFFIC_FLEET.bicycle + TRAFFIC_FLEET.bus;

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const anchors = trafficAnchors();

function world(seed = 7) {
  const vehicles: VehicleState[] = [];
  const walkers: Point[] = [];
  const others: RoadUser[] = [];
  const desk = new TrafficDesk({ vehicles, walkers: () => walkers, others: () => others, random: seeded(seed) }, anchors);
  const run = (seconds: number, each?: () => boolean | void) => {
    for (let t = 0; t < seconds; t += DT) {
      desk.step(DT);
      if (each?.()) return true;
    }
    return false;
  };
  return { desk, vehicles, walkers, others, run };
}

test("the fleet is appended as active traffic nobody can board", () => {
  const w = world();
  assert.equal(w.vehicles.length, FLEET);
  assert.ok(w.vehicles.every((v) => v.line === TRAFFIC_LINE && v.active));
  for (const kind of ["keke", "bicycle", "bus"] as const) assert.equal(w.vehicles.filter((v) => VEHICLE_KINDS[v.kind] === kind).length, TRAFFIC_FLEET[kind]);
  assert.equal(VEHICLE_SPECS.bicycle.seats, 0);
  assert.ok(anchors.length > 20);
});

test("traffic sets off, stays on the carriageway and never exceeds its cruise speed", () => {
  const w = world();
  let offRoad = 0;
  let samples = 0;
  w.run(90, () => {
    for (const car of w.desk.cars) {
      if (!car.track) continue;
      samples++;
      if (!isDrivable(car.x, car.y) && !onCarriageway(car.x, car.y, -2 * M)) offRoad++;
      assert.ok(car.track.v <= VEHICLE_SPECS[car.kind].cruise + 1e-6);
      assert.ok(!isBlocked(car.x, car.y, 1));
    }
  });
  assert.ok(samples > FLEET * 200, `only ${samples} moving samples`);
  assert.ok(offRoad / samples < 0.02, `${offRoad} of ${samples} samples off the road`);
  const moved = w.desk.cars.filter((c) => Math.hypot(c.x - c.state.x, c.y - c.state.y) < 4 * M && (c.track || c.rest > 0));
  assert.equal(moved.length, FLEET);
});

test("vehicles keep to the right of the centre line on a wide road", () => {
  const w = world(3);
  let right = 0;
  let total = 0;
  w.run(60, () => {
    for (const car of w.desk.cars) {
      const t = car.track;
      if (!t || t.seg < 1 || t.seg > t.pts.length - 3 || t.v < 2 * M) continue;
      const lane = car.kind === "bicycle" ? 0.9 : 0.8;
      const rx = -Math.sin(t.angle);
      const ry = Math.cos(t.angle);
      const farRight = onCarriageway(car.x + rx * 3.2 * M, car.y + ry * 3.2 * M);
      const farLeft = onCarriageway(car.x - rx * (3.2 + 2 * lane) * M, car.y - ry * (3.2 + 2 * lane) * M);
      if (!farLeft) continue;
      total++;
      if (!farRight || farLeft) right++;
    }
  });
  assert.ok(total > 50, `only ${total} wide-road samples`);
  assert.ok(right / total > 0.9);
});

test("a vehicle stops for someone standing in its lane and does not reach them", () => {
  const w = world(11);
  let car = w.desk.cars[0];
  assert.ok(w.run(40, () => {
    const found = w.desk.cars.find((c) => c.kind !== "bicycle" && c.track && c.track.v > 7 * M && c.track.seg < c.track.pts.length - 2);
    if (found) car = found;
    return !!found;
  }));
  const t = car.track;
  assert.ok(t);
  const ahead = 22 * M;
  const person = { x: t.x + Math.cos(t.angle) * ahead, y: t.y + Math.sin(t.angle) * ahead };
  w.walkers.push(person);
  let hit = false;
  let stopped = false;
  w.run(5, () => {
    const body = w.desk.bodies().find((b) => b.index === car.index);
    assert.ok(body);
    if (knocks(body.body, person.x, person.y)) hit = true;
    if (car.track && car.track.v === 0) stopped = true;
  });
  assert.equal(hit, false);
  assert.equal(stopped, true);
  assert.ok(Math.hypot(car.x - person.x, car.y - person.y) > VEHICLE_SPECS[car.kind].size[0] * 0.5 * M + PLAYER_RADIUS);
  w.walkers.length = 0;
  assert.ok(w.run(6, () => !!car.track && car.track.v > 3 * M));
});

test("someone who steps out right in front of a fast vehicle gets knocked", () => {
  const w = world(11);
  let car = w.desk.cars[0];
  assert.ok(w.run(40, () => {
    const found = w.desk.cars.find((c) => c.kind === "keke" && c.track && c.track.v > 8 * M && c.track.seg < c.track.pts.length - 2);
    if (found) car = found;
    return !!found;
  }));
  const t = car.track;
  assert.ok(t);
  const person = { x: t.x + Math.cos(t.angle) * 3 * M, y: t.y + Math.sin(t.angle) * 3 * M };
  w.walkers.push(person);
  let hit = false;
  w.run(1, () => {
    const body = w.desk.bodies().find((b) => b.index === car.index);
    if (body && knocks(body.body, person.x, person.y)) hit = true;
    return hit;
  });
  assert.equal(hit, true);
  assert.ok(KNOCK.minSpeed > 2.5 * M);
});

test("a vehicle queues behind a stopped one instead of driving through it", () => {
  const w = world(5);
  let car = w.desk.cars[0];
  assert.ok(w.run(40, () => {
    const found = w.desk.cars.find((c) => c.kind === "bus" && c.track && c.track.v > 6 * M && c.track.seg < c.track.pts.length - 2);
    if (found) car = found;
    return !!found;
  }));
  const t = car.track;
  assert.ok(t);
  const lead = { x: t.x + Math.cos(t.angle) * 24 * M, y: t.y + Math.sin(t.angle) * 24 * M, angle: t.angle, speed: 0 };
  w.others.push(lead);
  w.run(5);
  assert.ok(car.track);
  assert.ok(car.track.v < 0.6 * M);
  assert.ok(Math.hypot(car.x - lead.x, car.y - lead.y) > 5 * M);
});
