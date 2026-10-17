import {
  HAIL_BOARD_PX,
  HAIL_COOLDOWN_MS,
  HAIL_LINE,
  HAIL_MODES,
  HAIL_POOL,
  HAIL_WAIT_SECONDS,
  MAP_HEIGHT_PX,
  MAP_WIDTH_PX,
  PX_PER_METER,
  ServerMsg,
  TRAVEL_MODE_LABEL,
  VEHICLE_KINDS,
  VEHICLE_SPECS,
  angleToByte,
  checkHail,
  collectOverrides,
  findRoadPath,
  hailRefusalText,
  interiorAt,
  isBlocked,
  isDrivable,
  isHailMode,
  laneRoute,
  ROAD_LANES,
  lineFare,
  mustYield,
  vehicleBody,
  type VehicleBody,
  nearestRoadPoint,
  partFare,
  transportFor,
  type HailMode,
  type HailRefusal,
  type HailUpdate,
  type Point,
  type TransportConfig,
  type TransportOverride,
  VehicleState,
  allowsMode,
} from "@campuslife/shared";
import { findSchool } from "@campuslife/shared/schools";

const M = PX_PER_METER;
const ACCEL = 3 * M;
const BRAKE = 5 * M;
const LOOKAHEAD = 40 * M;
const SHARP_TURN = 1.2;
const MEDIUM_TURN = 0.6;
const GENTLE_TURN = 0.3;
const SHARP_SPEED = 3 * M;
const MEDIUM_SPEED = 5.5 * M;
const GENTLE_SPEED = 8 * M;
const ARRIVE_SPEED = 0.5 * M;
const BEND_WINDOW = 7 * M;
const SPAWN_DISTANCES = [140 * M, 90 * M, 200 * M];
const SPAWN_DIRECTIONS = 8;
const SPAWN_MAX_PATH = 450 * M;
const LEAVE_SECONDS = 3;
const KERB_MIN_M = 1.5;
const KERB_MAX_M = 14;
const KERB_FAN = [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI];
const RELOAD_SECONDS = 60;
const MAX_BLOCKED_SECONDS = 6;
const CREEP = 2.5 * M;
const NO_STOP = 255;

export interface Track {
  pts: Point[];
  cum: number[];
  limit: number[];
  seg: number;
  s: number;
  v: number;
  x: number;
  y: number;
  angle: number;
}

export function makeTrack(pts: Point[], cruise: number): Track {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const turns = pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return 0;
    const d = Math.atan2(pts[i + 1].y - p.y, pts[i + 1].x - p.x) - Math.atan2(p.y - pts[i - 1].y, p.x - pts[i - 1].x);
    return Math.atan2(Math.sin(d), Math.cos(d));
  });
  const limit = pts.map((_p, i) => {
    if (i === 0) return cruise;
    if (i === pts.length - 1) return 0;
    let sum = 0;
    for (let j = i; j >= 0 && cum[i] - cum[j] <= BEND_WINDOW; j--) sum += turns[j];
    for (let j = i + 1; j < pts.length && cum[j] - cum[i] <= BEND_WINDOW; j++) sum += turns[j];
    const turn = Math.abs(sum);
    if (turn > SHARP_TURN) return Math.min(cruise, SHARP_SPEED);
    if (turn > MEDIUM_TURN) return Math.min(cruise, MEDIUM_SPEED);
    if (turn > GENTLE_TURN) return Math.min(cruise, GENTLE_SPEED);
    return cruise;
  });
  const first = pts[0];
  const second = pts[1] ?? first;
  return { pts, cum, limit, seg: 0, s: 0, v: 0, x: first.x, y: first.y, angle: Math.atan2(second.y - first.y, second.x - first.x) };
}

export const trackLength = (t: Track) => t.cum[t.cum.length - 1];

export function stepTrack(t: Track, dt: number, cruise: number, floor = ARRIVE_SPEED): boolean {
  const total = trackLength(t);
  if (t.pts.length < 2 || t.s >= total) return true;
  let vmax = cruise;
  for (let i = t.seg + 1; i < t.pts.length && t.cum[i] - t.s < LOOKAHEAD; i++) {
    const lim = t.limit[i];
    vmax = Math.min(vmax, Math.sqrt(lim * lim + 2 * BRAKE * Math.max(0, t.cum[i] - t.s)));
  }
  vmax = Math.max(vmax, floor);
  t.v = t.v < vmax ? Math.min(vmax, t.v + ACCEL * dt) : Math.max(vmax, t.v - BRAKE * dt);
  t.s = Math.min(total, t.s + t.v * dt);
  while (t.seg < t.pts.length - 2 && t.cum[t.seg + 1] <= t.s) t.seg++;
  const a = t.pts[t.seg];
  const b = t.pts[t.seg + 1];
  const len = t.cum[t.seg + 1] - t.cum[t.seg] || 1;
  const k = (t.s - t.cum[t.seg]) / len;
  t.x = a.x + (b.x - a.x) * k;
  t.y = a.y + (b.y - a.y) * k;
  t.angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (t.s < total) return false;
  t.v = 0;
  return true;
}

export function kerbNear(road: Point, toward: Point): Point {
  const heading = Math.atan2(toward.y - road.y, toward.x - road.x);
  let fallback: Point | null = null;
  for (let d = KERB_MIN_M; d <= KERB_MAX_M; d += 0.5)
    for (const turn of KERB_FAN) {
      const x = road.x + Math.cos(heading + turn) * d * M;
      const y = road.y + Math.sin(heading + turn) * d * M;
      if (x < 0 || y < 0 || x > MAP_WIDTH_PX || y > MAP_HEIGHT_PX || isBlocked(x, y)) continue;
      if (!isDrivable(x, y)) return { x, y };
      fallback ??= { x, y };
    }
  return fallback ?? { ...road };
}

export interface HailRider {
  x: number;
  y: number;
  cash: number;
  ride: number;
  driving: number;
  school: string;
}

export interface HailHost {
  vehicles: { push(...items: VehicleState[]): number; length: number };
  rider(id: string): HailRider | undefined;
  riders(): Iterable<[string, HailRider]>;
  send(id: string, type: string, payload: unknown): void;
  seat(id: string, vehicle: number): void;
  unseat(id: string, to: Point): void;
  charge(id: string, amount: number): void;
  walkers?: () => Iterable<Point>;
  loadRows?: () => Promise<unknown[]>;
}

export interface HailBody {
  index: number;
  body: VehicleBody;
  rider: string;
  halt(): void;
}

export async function loadSchoolTransportRows(): Promise<unknown[]> {
  const [{ db }, { schoolTransport }] = await Promise.all([import("../database/database"), import("../database/schema/transport")]);
  const rows = await db.select().from(schoolTransport);
  return rows.map((r) => ({ schoolId: r.schoolId, modes: r.modes, fares: r.fares, enabled: r.enabled }));
}

type Phase = "idle" | "coming" | "waiting" | "riding" | "leaving";

interface HailSlot {
  index: number;
  mode: HailMode;
  state: VehicleState;
  phase: Phase;
  rider: string;
  track: Track | null;
  ride: Point[];
  target: Point;
  pickup: Point;
  fare: number;
  timer: number;
  blockedFor: number;
}

const IDLE_POINT: Point = { x: 0, y: 0 };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export class HailDesk {
  private slots: HailSlot[] = [];
  private overrides = new Map<string, TransportOverride>();
  private configs = new Map<string, TransportConfig>();
  private lastHail = new Map<string, number>();
  private sinceReload = 0;
  private loading = false;

  constructor(private readonly host: HailHost) {
    for (const mode of HAIL_MODES)
      for (let k = 0; k < HAIL_POOL[mode]; k++) {
        const state = new VehicleState();
        state.line = HAIL_LINE;
        state.kind = VEHICLE_KINDS.indexOf(mode);
        state.driver = "";
        state.active = false;
        state.stop = NO_STOP;
        state.next = 0;
        state.riders = 0;
        const index = host.vehicles.length;
        host.vehicles.push(state);
        this.slots.push({ index, mode, state, phase: "idle", rider: "", track: null, ride: [], target: IDLE_POINT, pickup: IDLE_POINT, fare: 0, timer: 0, blockedFor: 0 });
      }
  }

  configFor(schoolId: string): TransportConfig {
    let config = this.configs.get(schoolId);
    if (!config) {
      config = transportFor(findSchool(schoolId) ?? schoolId, this.overrides);
      this.configs.set(schoolId, config);
    }
    return config;
  }

  lineFare(schoolId: string, lineId: number, distancePx = 0): number {
    return lineFare(lineId, this.configFor(schoolId), distancePx);
  }

  sendConfig(id: string) {
    const rider = this.host.rider(id);
    if (rider) this.host.send(id, ServerMsg.Transport, this.configFor(rider.school));
  }

  setOverrides(rows: readonly unknown[]) {
    const next = collectOverrides(
      rows,
      (id) => findSchool(id) !== undefined,
      (row, why) => console.warn("[transport] ignored school_transport row:", why, JSON.stringify(row)),
    );
    const before = JSON.stringify([...this.overrides]);
    this.overrides = next;
    if (JSON.stringify([...next]) === before) return;
    this.configs.clear();
    for (const [id] of this.host.riders()) this.sendConfig(id);
  }

  async loadOverrides() {
    const load = this.host.loadRows;
    if (this.loading || !load) return;
    this.loading = true;
    try {
      this.setOverrides(await load());
    } catch (err) {
      console.error("[transport] could not load school_transport, keeping the current config", err instanceof Error ? err.message : err);
    } finally {
      this.loading = false;
    }
  }

  bodies(): HailBody[] {
    const out: HailBody[] = [];
    for (const slot of this.slots) {
      const track = slot.track;
      if (slot.phase === "idle" || !track) continue;
      const rolling = slot.phase === "coming" || slot.phase === "riding";
      out.push({
        index: slot.index,
        body: vehicleBody(slot.mode, track.x, track.y, track.angle, rolling ? track.v : 0),
        rider: slot.rider,
        halt: () => {
          track.v = 0;
        },
      });
    }
    return out;
  }

  private drive(slot: HailSlot, track: Track, dt: number, rider: HailRider): boolean {
    const spec = VEHICLE_SPECS[slot.mode];
    const walkers = this.host.walkers?.();
    const waitFor = walkers ? mustYield(vehicleBody(slot.mode, track.x, track.y, track.angle, track.v), walkers, BRAKE, rider) : false;
    slot.blockedFor = waitFor ? slot.blockedFor + dt : 0;
    if (!waitFor) return stepTrack(track, dt, spec.cruise);
    const ease = slot.blockedFor > MAX_BLOCKED_SECONDS ? CREEP : 0;
    return stepTrack(track, dt, ease, ease);
  }

  position(index: number): Point | undefined {
    const slot = this.slots[index - this.firstIndex];
    return slot && slot.phase !== "idle" && slot.track ? slot.track : undefined;
  }

  private get firstIndex() {
    return this.slots[0]?.index ?? 0;
  }

  private slotOf(id: string) {
    return this.slots.find((s) => s.rider === id && s.phase !== "idle" && s.phase !== "leaving");
  }

  request(id: string, payload: unknown, now = Date.now()) {
    const rider = this.host.rider(id);
    if (!rider) return;
    if (now - (this.lastHail.get(id) ?? 0) < HAIL_COOLDOWN_MS) return;
    this.lastHail.set(id, now);
    if (!isObject(payload)) return;
    const { x, y, mode } = payload;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < 0 || y < 0 || x > MAP_WIDTH_PX || y > MAP_HEIGHT_PX) return this.refuse(id, "unreachable");
    const target = { x, y };
    const config = this.configFor(rider.school);
    const inside = !!interiorAt(rider.x, rider.y);
    const hailMode = isHailMode(mode) ? mode : undefined;
    const hailing = !!this.slotOf(id);
    const routable = !!hailMode && allowsMode(config, hailMode) && !inside && !hailing && rider.ride < 0 && rider.driving < 0;
    const from = routable ? nearestRoadPoint(rider) : null;
    const to = from ? nearestRoadPoint(target) : null;
    const route = from && to ? findRoadPath(from, to) : null;
    const slot = hailMode ? this.slots.find((s) => s.mode === hailMode && s.phase === "idle") : undefined;
    const verdict = checkHail(config, {
      mode,
      cash: rider.cash,
      riding: rider.ride >= 0,
      driving: rider.driving >= 0,
      inside,
      hailing,
      rideDistancePx: route ? route.length : null,
      freeVehicle: !!slot,
    });
    if (!verdict.ok) return this.refuse(id, verdict.reason, verdict.mode, verdict.fare);
    if (!slot || !route || !from) return;
    const spec = VEHICLE_SPECS[slot.mode];
    slot.phase = "coming";
    slot.rider = id;
    slot.fare = verdict.fare;
    slot.target = target;
    slot.ride = route.points;
    slot.pickup = kerbNear(from, rider);
    slot.track = makeTrack(laneRoute(this.approach(from), ROAD_LANES[slot.mode], spec.size[1] / 2), spec.cruise);
    slot.timer = 0;
    slot.state.active = true;
    slot.state.riders = 0;
    this.sync(slot);
    this.update(slot, "coming");
    this.host.send(id, ServerMsg.Notice, `${TRAVEL_MODE_LABEL[slot.mode]} is coming. Fare ₦${slot.fare}. Wait by the road.`);
  }

  private approach(pickup: Point): Point[] {
    const start = Math.floor(Math.random() * SPAWN_DIRECTIONS);
    for (const distance of SPAWN_DISTANCES)
      for (let k = 0; k < SPAWN_DIRECTIONS; k++) {
        const a = ((start + k) / SPAWN_DIRECTIONS) * Math.PI * 2;
        const guess = { x: pickup.x + Math.cos(a) * distance, y: pickup.y + Math.sin(a) * distance };
        if (guess.x < 0 || guess.y < 0 || guess.x > MAP_WIDTH_PX || guess.y > MAP_HEIGHT_PX) continue;
        const spawn = nearestRoadPoint(guess);
        if (!spawn || Math.hypot(spawn.x - pickup.x, spawn.y - pickup.y) < distance / 2) continue;
        const path = findRoadPath(spawn, pickup);
        if (path && path.points.length > 1 && path.length <= SPAWN_MAX_PATH) return path.points;
      }
    return [pickup, pickup];
  }

  cancel(id: string): boolean {
    const slot = this.slotOf(id);
    if (!slot) return false;
    if (slot.phase === "riding") this.drop(slot, false);
    else {
      this.host.send(id, ServerMsg.Notice, `${TRAVEL_MODE_LABEL[slot.mode]} cancelled.`);
      this.end(slot);
    }
    return true;
  }

  release(id: string) {
    const slot = this.slots.find((s) => s.rider === id && s.phase === "riding");
    if (!slot) return;
    slot.rider = "";
    this.park(slot);
  }

  step(dt: number) {
    this.sinceReload += dt;
    if (this.sinceReload >= RELOAD_SECONDS) {
      this.sinceReload = 0;
      const cutoff = Date.now() - HAIL_COOLDOWN_MS;
      for (const [id, at] of this.lastHail) if (at < cutoff) this.lastHail.delete(id);
      void this.loadOverrides();
    }
    for (const slot of this.slots) {
      if (slot.phase === "idle" || !slot.track) continue;
      if (slot.phase === "leaving") {
        slot.timer -= dt;
        if (slot.timer <= 0) this.free(slot);
        continue;
      }
      const rider = this.host.rider(slot.rider);
      if (!rider) {
        this.park(slot);
        continue;
      }
      if (slot.phase === "coming" || slot.phase === "waiting") {
        if (rider.ride >= 0 || rider.driving >= 0 || interiorAt(rider.x, rider.y)) {
          this.host.send(slot.rider, ServerMsg.Notice, `${TRAVEL_MODE_LABEL[slot.mode]} cancelled.`);
          this.end(slot);
          continue;
        }
      }
      if (slot.phase === "coming") {
        if (this.drive(slot, slot.track, dt, rider)) {
          slot.phase = "waiting";
          slot.timer = HAIL_WAIT_SECONDS;
          this.update(slot, "waiting");
        }
      } else if (slot.phase === "waiting") {
        slot.timer -= dt;
        if (Math.hypot(rider.x - slot.track.x, rider.y - slot.track.y) <= HAIL_BOARD_PX) this.board(slot, rider);
        else if (slot.timer <= 0) {
          this.host.send(slot.rider, ServerMsg.Notice, `The ${TRAVEL_MODE_LABEL[slot.mode].toLowerCase()} rider got tired of waiting and left.`);
          this.end(slot);
          continue;
        }
      } else if (this.drive(slot, slot.track, dt, rider)) {
        this.drop(slot, true);
        continue;
      }
      this.sync(slot);
    }
  }

  private board(slot: HailSlot, rider: HailRider) {
    if (rider.cash < slot.fare) {
      this.refuse(slot.rider, "cash", slot.mode, slot.fare);
      this.end(slot);
      return;
    }
    const spec = VEHICLE_SPECS[slot.mode];
    const here = { x: slot.track?.x ?? slot.ride[0].x, y: slot.track?.y ?? slot.ride[0].y };
    slot.track = makeTrack(laneRoute([here, ...slot.ride.slice(1)], ROAD_LANES[slot.mode], spec.size[1] / 2), spec.cruise);
    slot.phase = "riding";
    slot.state.riders = 1;
    this.host.seat(slot.rider, slot.index);
    this.update(slot, "riding");
  }

  private drop(slot: HailSlot, arrived: boolean) {
    const id = slot.rider;
    const rider = this.host.rider(id);
    const track = slot.track;
    if (!rider || !track) return this.park(slot);
    const total = trackLength(track) || 1;
    const due = arrived ? slot.fare : partFare(this.configFor(rider.school), slot.mode, slot.fare, track.s / total);
    const paid = Math.min(due, Math.max(0, Math.floor(rider.cash)));
    const at = kerbNear({ x: track.x, y: track.y }, slot.target);
    slot.rider = "";
    slot.state.riders = 0;
    this.host.unseat(id, at);
    this.host.charge(id, paid);
    this.host.send(id, ServerMsg.Hail, { phase: arrived ? "arrived" : "ended", mode: slot.mode, fare: paid, vehicle: slot.index, drop: at } satisfies HailUpdate);
    this.host.send(id, ServerMsg.Notice, arrived ? `You paid ₦${paid} for the ${TRAVEL_MODE_LABEL[slot.mode].toLowerCase()}.` : `You got down early and paid ₦${paid}.`);
    this.park(slot);
  }

  private refuse(id: string, reason: HailRefusal, mode?: HailMode, fare?: number) {
    this.host.send(id, ServerMsg.Notice, hailRefusalText(reason, mode, fare));
    this.host.send(id, ServerMsg.Hail, { phase: "ended", mode: mode ?? "okada", fare: fare ?? 0, vehicle: -1 } satisfies HailUpdate);
  }

  private update(slot: HailSlot, phase: HailUpdate["phase"]) {
    this.host.send(slot.rider, ServerMsg.Hail, { phase, mode: slot.mode, fare: slot.fare, vehicle: slot.index, pickup: slot.pickup } satisfies HailUpdate);
  }

  private end(slot: HailSlot) {
    this.host.send(slot.rider, ServerMsg.Hail, { phase: "ended", mode: slot.mode, fare: 0, vehicle: slot.index } satisfies HailUpdate);
    slot.rider = "";
    this.park(slot);
  }

  private park(slot: HailSlot) {
    slot.phase = "leaving";
    slot.timer = LEAVE_SECONDS;
    slot.state.riders = 0;
    if (slot.track) slot.track.v = 0;
  }

  private free(slot: HailSlot) {
    slot.phase = "idle";
    slot.rider = "";
    slot.track = null;
    slot.ride = [];
    slot.state.active = false;
    slot.state.riders = 0;
  }

  private sync(slot: HailSlot) {
    if (!slot.track) return;
    slot.state.x = Math.round(slot.track.x);
    slot.state.y = Math.round(slot.track.y);
    slot.state.rot = angleToByte(slot.track.angle);
  }
}
