/**
 * Campus transport: the Halls Shuttle and the Campus Bus, driving loops along
 * real roads (routed by web/scripts/import-osm.mts). Shared so the server can
 * simulate them and the client can draw routes and stops.
 *
 * Distances are in map px along a line's closed loop.
 */
import campus from "./data/campus.json";
import { PX_PER_METER, onRoad, type Point } from "./map";
import { isBlocked } from "./movement";
import { ROAD_LANES, laneLoop } from "./lanes";

export type LineKind = "shuttle" | "bus";
export type VehicleKind = LineKind | "okada" | "keke" | "bicycle";

export interface VehicleSpec {
  label: string;
  /** Body size in metres (length, width, height). */
  size: [number, number, number];
  seats: number;
  /** Cruise speed, map px per second. */
  cruise: number;
}

export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  shuttle: { label: "Shuttle", size: [4.9, 1.95, 2.15], seats: 14, cruise: 12 * PX_PER_METER },
  bus: { label: "Campus Bus", size: [7.6, 2.3, 2.95], seats: 30, cruise: 10.5 * PX_PER_METER },
  okada: { label: "Okada", size: [2.05, 0.75, 1.15], seats: 1, cruise: 12.5 * PX_PER_METER },
  keke: { label: "Keke", size: [2.7, 1.35, 1.75], seats: 3, cruise: 9.5 * PX_PER_METER },
  bicycle: { label: "Bicycle", size: [1.75, 0.6, 1.65], seats: 0, cruise: 4.6 * PX_PER_METER },
};
export const VEHICLE_KINDS: VehicleKind[] = ["shuttle", "bus", "okada", "keke", "bicycle"];
export const DRIVER_LINE = 255;
export const HAIL_LINE = 254;
export const TRAFFIC_LINE = 253;

/** Seconds a vehicle waits at each stop. */
export const DWELL_SECONDS = 10;
/** Max distance (map px) from a vehicle's centre at which you can board it. */
export const BOARD_DISTANCE = 8 * PX_PER_METER;

export interface Stop {
  name: string;
  /** Distance along the line where the vehicle stops. */
  s: number;
  /** Where the vehicle stands. */
  x: number;
  y: number;
  /** Walkable kerb spot beside the vehicle, where riders get off. */
  kerb: Point;
}

export interface Line {
  id: number;
  name: string;
  kind: LineKind;
  /** Closed polyline (the last point connects back to the first). */
  pts: readonly number[];
  /** cum[i] = distance from point 0 to point i; cum[n] = full loop length. */
  cum: number[];
  length: number;
  stops: Stop[];
}

function buildLine(raw: (typeof campus.transit)[number], id: number): Line {
  const kind = raw.kind as LineKind;
  const source: Point[] = [];
  for (let i = 0; i + 1 < raw.pts.length; i += 2) source.push({ x: raw.pts[i], y: raw.pts[i + 1] });
  const lane = laneLoop(source, ROAD_LANES[kind], VEHICLE_SPECS[kind].size[1] / 2);
  const pts = lane.flatMap((p) => [p.x, p.y]);
  const n = pts.length / 2;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum.push(cum[i] + Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]));
  }
  const line: Line = { id, name: raw.name, kind, pts, cum, length: cum[n], stops: [] };
  line.stops = raw.stops.map((st) => {
    const at = source[st.i];
    let nearest = 0;
    for (let i = 1; i < n; i++) if (Math.hypot(pts[i * 2] - at.x, pts[i * 2 + 1] - at.y) < Math.hypot(pts[nearest * 2] - at.x, pts[nearest * 2 + 1] - at.y)) nearest = i;
    // Lines sharing a stop pull up one behind the other instead of on top of each other.
    const s = (cum[nearest] - id * 11 * PX_PER_METER + line.length) % line.length;
    const p = pointAt(line, s);
    return { name: st.name, s, x: p.x, y: p.y, kerb: kerbBeside(line, s) };
  });
  return line;
}

/** A free spot just to the right of the vehicle (the passenger side), searching outward. */
function kerbBeside(line: Line, s: number): Point {
  const p = pointAt(line, s);
  const rx = -Math.sin(p.angle);
  const ry = Math.cos(p.angle);
  for (let d = 3; d < 18; d += 0.5) {
    for (const along of [0, 2, -2, 4, -4]) {
      const x = p.x + rx * d * PX_PER_METER + Math.cos(p.angle) * along * PX_PER_METER;
      const y = p.y + ry * d * PX_PER_METER + Math.sin(p.angle) * along * PX_PER_METER;
      if (!isBlocked(x, y) && !onRoad(x, y, 0.6 * PX_PER_METER)) return { x, y };
    }
  }
  return { x: p.x, y: p.y };
}

export const LINES: readonly Line[] = (campus.transit ?? []).map(buildLine);

/** Position + heading (radians, atan2(dy, dx) in map space) at distance s along a line. */
export function pointAt(line: Line, s: number): { x: number; y: number; angle: number; seg: number } {
  const L = line.length;
  s = ((s % L) + L) % L;
  const cum = line.cum;
  // Binary search for the segment containing s.
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const n = line.pts.length / 2;
  const i = lo;
  const j = (i + 1) % n;
  const ax = line.pts[i * 2];
  const ay = line.pts[i * 2 + 1];
  const bx = line.pts[j * 2];
  const by = line.pts[j * 2 + 1];
  const segLen = cum[i + 1] - cum[i] || 1;
  const t = (s - cum[i]) / segLen;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(by - ay, bx - ax), seg: i };
}

/**
 * Speed limit (px/s) when arriving at point i: sharp turns force a slow
 * crawl, gentle bends a moderate speed.
 */
export function cornerLimit(line: Line, i: number, cruise: number): number {
  const n = line.pts.length / 2;
  const a = (i - 1 + n) % n;
  const b = (i + 1) % n;
  const p = line.pts;
  const a1 = Math.atan2(p[i * 2 + 1] - p[a * 2 + 1], p[i * 2] - p[a * 2]);
  const a2 = Math.atan2(p[b * 2 + 1] - p[i * 2 + 1], p[b * 2] - p[i * 2]);
  const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
  if (turn > 1.2) return 2.5 * PX_PER_METER;
  if (turn > 0.6) return 4 * PX_PER_METER;
  if (turn > 0.3) return 6 * PX_PER_METER;
  return cruise;
}

/** How many vehicles run on a line (the long Gate Shuttle gets the most). */
export const vehiclesOnLine = (line: Line) => (line.stops.length <= 2 ? 4 : 3);

export interface TripPlan {
  line: number;
  /** Stop indices to get on / off at. */
  board: number;
  alight: number;
  /** Estimated door-to-door seconds by transport vs on foot. */
  seconds: number;
  walkSeconds: number;
}

/**
 * Best single-line trip from `from` to `to`, or null when walking is about
 * as quick. Estimates use straight-line walking (x1.3 for paths), average
 * waiting time, ride time at ~70% of cruise speed, and stop dwells.
 */
export const TRIP_WORTH_IT = 0.85;
export const lineRidePx = (line: Line, board: number, alight: number) => (line.stops[alight].s - line.stops[board].s + line.length) % line.length;

export function planTrip(from: Point, to: Point, walkSpeed: number, allowed?: (kind: LineKind) => boolean, worthIt = TRIP_WORTH_IT): TripPlan | null {
  const walk = (a: Point, b: Point) => (Math.hypot(a.x - b.x, a.y - b.y) * 1.3) / walkSpeed;
  const walkSeconds = walk(from, to);
  let best: TripPlan | null = null;
  for (const line of LINES) {
    if (allowed && !allowed(line.kind)) continue;
    const spec = VEHICLE_SPECS[line.kind];
    const n = line.stops.length;
    const loopSeconds = line.length / (spec.cruise * 0.7) + n * DWELL_SECONDS;
    const wait = loopSeconds / vehiclesOnLine(line) / 2;
    for (let i = 0; i < n; i++) {
      const toStop = walk(from, line.stops[i].kerb);
      if (toStop > walkSeconds * 0.6) continue;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const ride = lineRidePx(line, i, j);
        const stopsBetween = (j - i + n) % n;
        const seconds = toStop + wait + ride / (spec.cruise * 0.7) + stopsBetween * DWELL_SECONDS + walk(line.stops[j].kerb, to);
        if (!best || seconds < best.seconds) best = { line: line.id, board: i, alight: j, seconds, walkSeconds };
      }
    }
  }
  return best && best.seconds < walkSeconds * worthIt ? best : null;
}

/** Angle (radians) <-> uint8 for compact syncing. */
export const angleToByte = (a: number) => Math.round(((a / (Math.PI * 2)) % 1 + 1) * 256) & 0xff;
export const byteToAngle = (b: number) => (b / 256) * Math.PI * 2;
