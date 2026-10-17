import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TRANSPORT,
  HAIL_LINE,
  HAIL_POOL,
  HAIL_SLOTS,
  PLACES,
  PX_PER_METER,
  ServerMsg,
  VEHICLE_KINDS,
  VEHICLE_SPECS,
  VehicleState,
  doorPoint,
  fareFor,
  findRoadPath,
  isBlocked,
  nearestRoadPoint,
  onRoad,
  parseHailUpdate,
  type HailUpdate,
  type Point,
} from "@campuslife/shared";
import { HailDesk, kerbNear, makeTrack, stepTrack, trackLength, type HailRider } from "./Hail";

const M = PX_PER_METER;
const DT = 0.05;
const OAU = "obafemi-awolowo-university-ile-ife";
const door = (re: RegExp): Point => {
  const p = PLACES.find((x) => re.test(x.name));
  assert.ok(p);
  return doorPoint(p, isBlocked);
};

interface Sent {
  id: string;
  type: string;
  payload: unknown;
}

function world() {
  const vehicles: VehicleState[] = [];
  const riders = new Map<string, HailRider>();
  const sent: Sent[] = [];
  const desk = new HailDesk({
    vehicles,
    rider: (id) => riders.get(id),
    riders: () => riders,
    send: (id, type, payload) => void sent.push({ id, type, payload }),
    seat: (id, vehicle) => {
      const r = riders.get(id);
      if (r) r.ride = vehicle;
    },
    unseat: (id, to) => {
      const r = riders.get(id);
      if (!r) return;
      desk.release(id);
      r.ride = -1;
      r.x = to.x;
      r.y = to.y;
    },
    charge: (id, amount) => {
      const r = riders.get(id);
      if (r) r.cash -= amount;
    },
  });
  const join = (id: string, at: Point, cash: number, school = "") => {
    const r: HailRider = { x: at.x, y: at.y, cash, ride: -1, driving: -1, school };
    riders.set(id, r);
    return r;
  };
  const updates = (id: string): HailUpdate[] =>
    sent.filter((s) => s.id === id && s.type === ServerMsg.Hail).map((s) => {
      const u = parseHailUpdate(s.payload);
      assert.ok(u);
      return u;
    });
  const notices = (id: string) => sent.filter((s) => s.id === id && s.type === ServerMsg.Notice).map((s) => String(s.payload));
  const run = (seconds: number, each?: () => boolean | void) => {
    for (let t = 0; t < seconds; t += DT) {
      desk.step(DT);
      for (const r of riders.values()) {
        const pos = r.ride >= 0 ? desk.position(r.ride) : undefined;
        if (pos) (r.x = pos.x), (r.y = pos.y);
      }
      if (each?.()) return true;
    }
    return false;
  };
  return { desk, vehicles, riders, sent, join, updates, notices, run };
}

const last = <T>(list: T[]): T => list[list.length - 1];

test("pool vehicles are appended as inactive okada and keke", () => {
  const w = world();
  assert.equal(w.vehicles.length, HAIL_SLOTS);
  assert.equal(w.vehicles.filter((v) => VEHICLE_KINDS[v.kind] === "okada").length, HAIL_POOL.okada);
  assert.equal(w.vehicles.filter((v) => VEHICLE_KINDS[v.kind] === "keke").length, HAIL_POOL.keke);
  assert.ok(w.vehicles.every((v) => v.line === HAIL_LINE && v.active === false));
  assert.equal(VEHICLE_SPECS.okada.seats, 1);
  assert.ok(VEHICLE_SPECS.keke.seats >= 3);
});

test("a track speeds up, slows for corners and stops at the end", () => {
  const cruise = VEHICLE_SPECS.okada.cruise;
  const track = makeTrack([{ x: 0, y: 0 }, { x: 200 * M, y: 0 }, { x: 200 * M, y: 150 * M }], cruise);
  let top = 0;
  let atCorner = Infinity;
  let done = false;
  for (let t = 0; t < 120 && !done; t += DT) {
    done = stepTrack(track, DT, cruise);
    top = Math.max(top, track.v);
    if (Math.abs(track.s - 200 * M) < 2 * M) atCorner = Math.min(atCorner, track.v);
  }
  assert.ok(done);
  assert.ok(top <= cruise + 1e-6 && top > cruise * 0.95);
  assert.ok(atCorner < cruise * 0.5);
  assert.equal(track.s, trackLength(track));
  assert.ok(Math.hypot(track.x - 200 * M, track.y - 150 * M) < 1);
});

test("an okada picks the player up, follows the road, charges the exact fare and drops on a kerb", () => {
  const w = world();
  const from = door(/student union/i);
  const target = door(/^faculty of technology$/i);
  const rider = w.join("a", from, 5000);
  w.desk.request("a", { x: target.x, y: target.y, mode: "okada" }, 10_000);
  const coming = last(w.updates("a"));
  assert.equal(coming.phase, "coming");
  const road = findRoadPath(nearestRoadPoint(from)!, nearestRoadPoint(target)!)!;
  const fare = fareFor(DEFAULT_TRANSPORT, "okada", road.length);
  assert.equal(coming.fare, fare);
  assert.ok(coming.pickup && !isBlocked(coming.pickup.x, coming.pickup.y));
  const veh = w.vehicles[coming.vehicle];
  assert.equal(veh.active, true);
  rider.x = coming.pickup.x;
  rider.y = coming.pickup.y;
  let offRoad = 0;
  let samples = 0;
  const arrived = w.run(600, () => {
    if (rider.ride >= 0) {
      samples++;
      if (!onRoad(veh.x, veh.y, 1.5 * M)) offRoad++;
    }
    return last(w.updates("a")).phase === "arrived";
  });
  assert.ok(arrived, "ride never arrived");
  assert.ok(samples > 100);
  assert.equal(offRoad, 0);
  assert.equal(rider.cash, 5000 - fare);
  assert.equal(rider.ride, -1);
  assert.ok(!isBlocked(rider.x, rider.y));
  assert.ok(Math.hypot(rider.x - target.x, rider.y - target.y) < 120 * M);
  assert.equal(last(w.updates("a")).fare, fare);
  w.run(5);
  assert.equal(veh.active, false);
});

test("refusals: banned mode, no cash, already riding, inside reach, bad payload, spam", () => {
  const w = world();
  const from = door(/student union/i);
  const target = door(/^faculty of technology$/i);
  const go = (id: string, mode: unknown, at = 10_000) => w.desk.request(id, { x: target.x, y: target.y, mode }, at);
  w.join("oau", from, 5000, OAU);
  go("oau", "okada");
  assert.equal(last(w.updates("oau")).phase, "ended");
  assert.match(last(w.notices("oau")), /does not allow okada/);
  go("oau", "keke", 20_000);
  assert.equal(last(w.updates("oau")).phase, "coming");

  const poor = w.join("poor", from, 50);
  go("poor", "okada");
  assert.equal(last(w.updates("poor")).phase, "ended");
  assert.match(last(w.notices("poor")), /fare is ₦\d+/);
  assert.equal(poor.cash, 50);

  const busy = w.join("busy", from, 5000);
  busy.ride = 0;
  go("busy", "okada");
  assert.equal(last(w.updates("busy")).phase, "ended");

  w.join("odd", from, 5000);
  w.desk.request("odd", { x: "1", y: 2, mode: "okada" }, 10_000);
  w.desk.request("odd", null, 20_000);
  go("odd", "rocket", 30_000);
  assert.equal(w.updates("odd").filter((u) => u.phase === "coming").length, 0);
  go("odd", "okada", 40_000);
  go("odd", "okada", 40_100);
  go("odd", "okada", 50_000);
  assert.equal(w.updates("odd").filter((u) => u.phase === "coming").length, 1);
  assert.match(last(w.notices("odd")), /already called/);

  w.join("near", from, 5000);
  w.desk.request("near", { x: from.x + 20 * M, y: from.y, mode: "okada" }, 10_000);
  assert.match(last(w.notices("near")), /Just walk/);
});

test("the pool runs out, cancel frees a vehicle, a stop mid-ride charges part of the fare", () => {
  const w = world();
  const from = door(/student union/i);
  const target = door(/^main gate$/i);
  for (let i = 0; i < HAIL_POOL.okada + 1; i++) {
    w.join(`p${i}`, from, 5000);
    w.desk.request(`p${i}`, { x: target.x, y: target.y, mode: "okada" }, 10_000);
  }
  const extra = `p${HAIL_POOL.okada}`;
  assert.match(last(w.notices(extra)), /No free okada/);
  assert.equal(w.desk.cancel("p0"), true);
  assert.equal(last(w.updates("p0")).phase, "ended");
  assert.equal(w.riders.get("p0")!.cash, 5000);
  w.run(5);
  w.desk.request(extra, { x: target.x, y: target.y, mode: "okada" }, 20_000);
  assert.equal(last(w.updates(extra)).phase, "coming");

  const rider = w.riders.get("p1")!;
  const coming = w.updates("p1").find((u) => u.phase === "coming")!;
  rider.x = coming.pickup!.x;
  rider.y = coming.pickup!.y;
  assert.ok(w.run(120, () => rider.ride >= 0), "never boarded");
  w.run(8);
  assert.equal(w.desk.cancel("p1"), true);
  const paid = 5000 - rider.cash;
  assert.ok(paid >= DEFAULT_TRANSPORT.fares.okada.base && paid < coming.fare, `paid ${paid} of ${coming.fare}`);
  assert.equal(paid % 50, 0);
  assert.equal(rider.ride, -1);
  assert.ok(!isBlocked(rider.x, rider.y));
});

test("a disconnect mid-ride frees the vehicle, and a no-show is given up on", () => {
  const w = world();
  const from = door(/student union/i);
  const target = door(/^main gate$/i);
  const gone = w.join("gone", from, 5000);
  w.desk.request("gone", { x: target.x, y: target.y, mode: "keke" }, 10_000);
  const coming = last(w.updates("gone"));
  gone.x = coming.pickup!.x;
  gone.y = coming.pickup!.y;
  assert.ok(w.run(120, () => gone.ride >= 0));
  w.desk.release("gone");
  w.riders.delete("gone");
  w.run(5);
  assert.equal(w.vehicles[coming.vehicle].active, false);

  const far = w.join("far", from, 5000);
  w.desk.request("far", { x: target.x, y: target.y, mode: "okada" }, 10_000);
  const call = last(w.updates("far"));
  far.x += 400 * M;
  assert.ok(w.run(200, () => last(w.updates("far")).phase === "ended"));
  assert.equal(far.cash, 5000);
  w.run(5);
  assert.equal(w.vehicles[call.vehicle].active, false);
});

test("a rider who cannot pay at the kerb is not carried", () => {
  const w = world();
  const from = door(/student union/i);
  const target = door(/^main gate$/i);
  const r = w.join("a", from, 5000);
  w.desk.request("a", { x: target.x, y: target.y, mode: "okada" }, 10_000);
  const coming = last(w.updates("a"));
  r.cash = 20;
  r.x = coming.pickup!.x;
  r.y = coming.pickup!.y;
  assert.ok(w.run(120, () => last(w.updates("a")).phase === "ended"));
  assert.equal(r.ride, -1);
  assert.equal(r.cash, 20);
});

test("kerbNear returns a walkable spot off the carriageway", () => {
  const road = nearestRoadPoint(door(/student union/i))!;
  const kerb = kerbNear(road, door(/student union/i));
  assert.ok(!isBlocked(kerb.x, kerb.y));
  assert.ok(Math.hypot(kerb.x - road.x, kerb.y - road.y) <= 15 * M);
});
