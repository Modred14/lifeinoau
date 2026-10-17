import {
  LINES,
  IMPORTED_PLACE_COUNT,
  PLACES,
  PX_PER_METER,
  TRAFFIC_FLEET,
  TRAFFIC_KINDS,
  TRAFFIC_LINE,
  TRAFFIC_REST,
  TRAFFIC_SYNC_TICKS,
  TRAFFIC_TRIP_MAX,
  TRAFFIC_TRIP_MIN,
  VEHICLE_KINDS,
  VEHICLE_SPECS,
  VehicleState,
  angleToByte,
  findRoadPath,
  laneRoute,
  ROAD_LANES,
  mustYield,
  nearestRoadPoint,
  vehicleBody,
  type Point,
  type TrafficKind,
  type VehicleBody,
} from "@campuslife/shared";
import { makeTrack, stepTrack, type Track } from "./Hail";

const M = PX_PER_METER;
const BRAKE = 5 * M;
const FOLLOW_GAP = 4 * M;
const LEADER_HALF = 2 * M;
const FOLLOW_RANGE = 30 * M;
const LANE_PAD = 0.7 * M;
const MAX_BLOCKED_SECONDS = 6;
const CREEP = 2.5 * M;
const CRAWL = 0.5 * M;
const RETRY_SECONDS = 2;
const ANCHOR_MERGE = 25 * M;
const START_STAGGER_SECONDS = 0.4;
const KEKE_LOADS = [0, 1, 1, 2, 2, 3];

export interface RoadUser {
  x: number;
  y: number;
  angle: number;
  speed: number;
  slow?: boolean;
}

export interface TrafficHost {
  vehicles: { push(...items: VehicleState[]): number; length: number };
  walkers(): Iterable<Point>;
  others(): Iterable<RoadUser>;
  random?: () => number;
}

export interface TrafficCar {
  index: number;
  kind: TrafficKind;
  state: VehicleState;
  track: Track | null;
  rest: number;
  blockedFor: number;
  x: number;
  y: number;
  angle: number;
}

export interface TrafficBody {
  index: number;
  body: VehicleBody;
  halt(): void;
}

export function trafficAnchors(): Point[] {
  const out: Point[] = [];
  const add = (p: Point) => {
    const road = nearestRoadPoint(p);
    if (road && out.every((o) => Math.hypot(o.x - road.x, o.y - road.y) > ANCHOR_MERGE)) out.push(road);
  };
  for (const place of PLACES.slice(0, IMPORTED_PLACE_COUNT)) add(place.door);
  for (const line of LINES) for (const stop of line.stops) add(stop);
  return out;
}

export class TrafficDesk {
  readonly cars: TrafficCar[] = [];
  private tickN = 0;
  private readonly random: () => number;

  constructor(
    private readonly host: TrafficHost,
    private readonly anchors: readonly Point[] = trafficAnchors(),
  ) {
    this.random = host.random ?? Math.random;
    for (const kind of TRAFFIC_KINDS)
      for (let k = 0; k < TRAFFIC_FLEET[kind]; k++) {
        const at = this.anchors.length ? this.anchors[Math.floor(this.random() * this.anchors.length)] : { x: 0, y: 0 };
        const state = new VehicleState();
        state.line = TRAFFIC_LINE;
        state.kind = VEHICLE_KINDS.indexOf(kind);
        state.driver = "";
        state.active = this.anchors.length > 0;
        state.stop = 255;
        state.next = 0;
        state.riders = 0;
        state.x = Math.round(at.x);
        state.y = Math.round(at.y);
        const index = host.vehicles.length;
        host.vehicles.push(state);
        this.cars.push({ index, kind, state, track: null, rest: this.cars.length * START_STAGGER_SECONDS, blockedFor: 0, x: at.x, y: at.y, angle: 0 });
      }
  }

  step(dt: number) {
    if (this.anchors.length < 2) return;
    this.tickN++;
    let planned = false;
    const walkers = this.host.walkers();
    const others = [...this.host.others()];
    for (const car of this.cars) {
      const track = car.track;
      if (!track) {
        car.rest -= dt;
        if (car.rest > 0 || planned) continue;
        planned = true;
        this.plan(car);
        continue;
      }
      const spec = VEHICLE_SPECS[car.kind];
      const body = vehicleBody(car.kind, track.x, track.y, track.angle, track.v);
      let limit = spec.cruise;
      for (const o of others) limit = Math.min(limit, this.followLimit(car, body, o));
      for (const o of this.cars) {
        if (o === car || !o.track) continue;
        limit = Math.min(limit, this.followLimit(car, body, { x: o.x, y: o.y, angle: o.angle, speed: o.track.v, slow: o.kind === "bicycle" }));
      }
      if (mustYield(body, walkers, BRAKE)) limit = 0;
      if (limit < CRAWL) {
        car.blockedFor += dt;
        if (car.blockedFor > MAX_BLOCKED_SECONDS) limit = CREEP;
      } else car.blockedFor = 0;
      const arrived = stepTrack(track, dt, limit, Math.min(limit, CRAWL));
      car.x = track.x;
      car.y = track.y;
      car.angle = track.angle;
      if (arrived) {
        car.track = null;
        car.rest = TRAFFIC_REST[0] + this.random() * (TRAFFIC_REST[1] - TRAFFIC_REST[0]);
        car.blockedFor = 0;
        this.sync(car);
      } else if ((this.tickN + car.index) % TRAFFIC_SYNC_TICKS === 0) this.sync(car);
    }
  }

  bodies(): TrafficBody[] {
    return this.cars.map((car) => ({
      index: car.index,
      body: vehicleBody(car.kind, car.x, car.y, car.angle, car.track?.v ?? 0),
      halt: () => {
        if (car.track) car.track.v = 0;
      },
    }));
  }

  roadUsers(): RoadUser[] {
    return this.cars.filter((c) => c.kind !== "bicycle").map((c) => ({ x: c.x, y: c.y, angle: c.angle, speed: c.track?.v ?? 0 }));
  }

  private followLimit(car: TrafficCar, body: VehicleBody, o: RoadUser): number {
    if (o.slow && car.kind !== "bicycle") return Infinity;
    if (Math.cos(o.angle - body.angle) <= 0.5) return Infinity;
    const dx = o.x - body.x;
    const dy = o.y - body.y;
    if (Math.abs(dx) > FOLLOW_RANGE || Math.abs(dy) > FOLLOW_RANGE) return Infinity;
    const c = Math.cos(body.angle);
    const s = Math.sin(body.angle);
    const fwd = dx * c + dy * s;
    if (fwd <= 0 || Math.abs(-dx * s + dy * c) > body.halfWidth + LANE_PAD) return Infinity;
    const gap = fwd - body.halfLength - LEADER_HALF - FOLLOW_GAP;
    return o.speed + Math.sqrt(2 * BRAKE * Math.max(0, gap));
  }

  private plan(car: TrafficCar) {
    const here = { x: car.x, y: car.y };
    const reachable = this.anchors.filter((a) => {
      const d = Math.hypot(a.x - here.x, a.y - here.y);
      return d >= TRAFFIC_TRIP_MIN && d <= TRAFFIC_TRIP_MAX;
    });
    const ahead = reachable.filter((a) => (a.x - here.x) * Math.cos(car.angle) + (a.y - here.y) * Math.sin(car.angle) > 0);
    const pool = ahead.length ? ahead : reachable.length ? reachable : this.anchors;
    const to = pool[Math.floor(this.random() * pool.length)];
    const path = findRoadPath(here, to);
    if (!path || path.points.length < 2 || path.length < TRAFFIC_TRIP_MIN / 2) {
      car.rest = RETRY_SECONDS;
      return;
    }
    const spec = VEHICLE_SPECS[car.kind];
    const lane = laneRoute([here, ...path.points], ROAD_LANES[car.kind], spec.size[1] / 2);
    car.track = makeTrack([here, ...lane.slice(1)], spec.cruise);
    car.angle = car.track.angle;
    car.blockedFor = 0;
    car.state.riders = car.kind === "keke" ? KEKE_LOADS[Math.floor(this.random() * KEKE_LOADS.length)] : 0;
    this.sync(car);
  }

  private sync(car: TrafficCar) {
    car.state.x = Math.round(car.x);
    car.state.y = Math.round(car.y);
    car.state.rot = angleToByte(car.angle);
  }
}
