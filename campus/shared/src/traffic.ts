import { PLAYER_RADIUS } from "./constants";
import { MAP_HEIGHT_PX, MAP_WIDTH_PX, PX_PER_METER, type Point } from "./map";
import { VEHICLE_SPECS, type VehicleKind } from "./transit";

const M = PX_PER_METER;

export type TrafficKind = "keke" | "bicycle" | "bus";
export const TRAFFIC_KINDS: TrafficKind[] = ["keke", "bicycle", "bus"];
export const TRAFFIC_FLEET: Record<TrafficKind, number> = { keke: 7, bicycle: 6, bus: 3 };
export const TRAFFIC_BUS_NAME = "Town Service";
export const TRAFFIC_SYNC_TICKS = 2;
export const TRAFFIC_RENDER_DELAY_MS = 200;
export const TRAFFIC_TRIP_MIN = 220 * M;
export const TRAFFIC_TRIP_MAX = 1500 * M;
export const TRAFFIC_REST: [number, number] = [3, 11];

export const KNOCK = {
  minSpeed: 3 * M,
  energy: 10,
  fun: 6,
  cooldownMs: 6000,
  shove: 1.2 * M,
};
export const YIELD_GAP = 4 * M;

export interface VehicleBody {
  x: number;
  y: number;
  angle: number;
  halfLength: number;
  halfWidth: number;
  speed: number;
}

export function vehicleBody(kind: VehicleKind, x: number, y: number, angle: number, speed: number): VehicleBody {
  const [length, width] = VEHICLE_SPECS[kind].size;
  return { x, y, angle, halfLength: (length / 2) * M, halfWidth: (width / 2) * M, speed: Math.abs(speed) };
}

export function bodyOffset(b: VehicleBody, x: number, y: number): { fwd: number; lat: number } {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const dx = x - b.x;
  const dy = y - b.y;
  return { fwd: dx * c + dy * s, lat: -dx * s + dy * c };
}

export function touchesBody(b: VehicleBody, x: number, y: number, r = PLAYER_RADIUS): boolean {
  const reach = b.halfLength + b.halfWidth + r;
  if (Math.abs(x - b.x) > reach || Math.abs(y - b.y) > reach) return false;
  const o = bodyOffset(b, x, y);
  return Math.abs(o.fwd) < b.halfLength + r && Math.abs(o.lat) < b.halfWidth + r;
}

export function knocks(b: VehicleBody, x: number, y: number, r = PLAYER_RADIUS): boolean {
  return b.speed >= KNOCK.minSpeed && touchesBody(b, x, y, r);
}

export function stoppingRange(v: number, brake: number): number {
  return YIELD_GAP + (v * v) / (2 * brake);
}

const inWorld = (x: number, y: number) => x >= 0 && y >= 0 && x <= MAP_WIDTH_PX && y <= MAP_HEIGHT_PX;

const CORRIDOR_PAD = 0.2 * M;

export function mustYield(b: VehicleBody, walkers: Iterable<Point>, brake: number, skip?: Point): boolean {
  const range = b.halfLength + stoppingRange(b.speed, brake);
  const half = b.halfWidth + PLAYER_RADIUS + CORRIDOR_PAD;
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  for (const w of walkers) {
    if (w === skip) continue;
    const dx = w.x - b.x;
    const dy = w.y - b.y;
    if (Math.abs(dx) > range || Math.abs(dy) > range) continue;
    const fwd = dx * c + dy * s;
    if (fwd <= 0 || fwd >= range) continue;
    if (Math.abs(-dx * s + dy * c) < half) return true;
  }
  return false;
}

export const PUSH_SPEED = 8 * M;
const PUSH_PROBE = 0.2 * M;

function wayClear(p: Point, q: Point, blocked: (x: number, y: number) => boolean): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / PUSH_PROBE));
  let free = !blocked(p.x, p.y);
  for (let i = 1; i <= n; i++) {
    const hit = blocked(p.x + ((q.x - p.x) * i) / n, p.y + ((q.y - p.y) * i) / n);
    if (hit && free) return false;
    free = !hit;
  }
  return free;
}

export function pushOut(
  b: VehicleBody,
  p: Point,
  blocked: (x: number, y: number) => boolean,
  opts: { maxStep?: number; extra?: number } = {},
  r = PLAYER_RADIUS,
): Point | null {
  if (!touchesBody(b, p.x, p.y, r)) return null;
  const o = bodyOffset(b, p.x, p.y);
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const at = (fwd: number, lat: number): Point => ({ x: b.x + fwd * c - lat * s, y: b.y + fwd * s + lat * c });
  const side = o.lat >= 0 ? 1 : -1;
  const end = o.fwd >= 0 ? 1 : -1;
  const extra = opts.extra ?? 0;
  const sideReach = b.halfWidth + r + 1 + extra;
  const endReach = b.halfLength + r + 1 + extra;
  const exits = [at(o.fwd, side * sideReach), at(o.fwd, -side * sideReach), at(end * endReach, o.lat), at(-end * endReach, o.lat)];
  for (const q of exits) {
    if (!inWorld(q.x, q.y) || !wayClear(p, q, blocked)) continue;
    const dist = Math.hypot(q.x - p.x, q.y - p.y);
    if (opts.maxStep === undefined || dist <= opts.maxStep) return q;
    const k = opts.maxStep / dist;
    return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
  }
  return null;
}
