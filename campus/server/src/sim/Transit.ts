/**
 * Shuttle + bus simulation. Each vehicle drives its line's loop at a fixed
 * tick: accelerates, slows for bends, stops at every stop for DWELL_SECONDS,
 * and brakes for students standing in the road (or a vehicle in front).
 */
import {
  DWELL_SECONDS,
  LINES,
  PX_PER_METER,
  VEHICLE_SPECS,
  angleToByte,
  cornerLimit,
  mustYield,
  pointAt,
  vehicleBody,
  vehiclesOnLine,
  type Line,
  type VehicleSpec,
} from "@campuslife/shared";

const ACCEL = 2.2 * PX_PER_METER; // px/s²
const BRAKE = 4 * PX_PER_METER;
/** How far ahead (along the route) to look for bends to slow down for. */
const LOOKAHEAD = 45 * PX_PER_METER;
const DRIVING = 255;

export interface Vehicle {
  index: number;
  line: Line;
  spec: VehicleSpec;
  /** Distance along the loop. */
  s: number;
  /** Speed, px/s. */
  v: number;
  dwell: number;
  /** Stop index while dwelling, DRIVING otherwise. */
  atStop: number;
  next: number;
  x: number;
  y: number;
  angle: number;
  riders: Set<string>;
  /** Seconds spent stopped for something in the way (used to break deadlocks). */
  blockedFor: number;
}

/** After this long stuck behind something, ease through it instead (no gridlock, ever). */
const MAX_BLOCKED_SECONDS = 6;
/** Speed while easing through an obstacle (px/s). */
const CREEP = 2.5 * PX_PER_METER;

/** A few vehicles per line, spread evenly around the loop, already driving. */
export function createVehicles(): Vehicle[] {
  const out: Vehicle[] = [];
  for (const line of LINES) {
    const spec = VEHICLE_SPECS[line.kind];
    const count = vehiclesOnLine(line);
    for (let j = 0; j < count; j++) {
      const s = (line.length * j) / count;
      const p = pointAt(line, s);
      // Next stop = the closest stop ahead along the loop (stop distances wrap around).
      let next = 0;
      let bestAhead = Infinity;
      line.stops.forEach((st, k) => {
        const ahead = (st.s - s + line.length) % line.length;
        if (ahead < bestAhead) (bestAhead = ahead), (next = k);
      });
      out.push({
        index: out.length,
        line,
        spec,
        s,
        v: 0,
        dwell: 0,
        atStop: DRIVING,
        next,
        x: p.x,
        y: p.y,
        angle: p.angle,
        riders: new Set(),
        blockedFor: 0,
      });
    }
  }
  return out;
}

export const isDwelling = (v: Vehicle) => v.atStop !== DRIVING;

/**
 * Advance every vehicle by dt seconds. `walkers` are positions of students on
 * foot (map px), so vehicles stop instead of driving through people.
 */
export function stepVehicles(
  vehicles: Vehicle[],
  dt: number,
  walkers: { x: number; y: number }[],
  /** Other traffic to queue behind (student-driven shuttles). */
  traffic: { x: number; y: number; angle: number }[] = [],
) {
  for (const veh of vehicles) {
    const line = veh.line;
    if (veh.dwell > 0) {
      veh.dwell -= dt;
      if (veh.dwell <= 0) {
        veh.atStop = DRIVING;
        veh.next = (veh.next + 1) % line.stops.length;
      }
      continue;
    }
    const L = line.length;
    const stopS = line.stops[veh.next].s;
    const toStop = (stopS - veh.s + L) % L;

    // Speed limit: cruise, brake smoothly for the stop and for bends ahead.
    let vmax = Math.min(veh.spec.cruise, Math.sqrt(2 * ACCEL * toStop) + 0.5 * PX_PER_METER);
    const n = line.pts.length / 2;
    const here = pointAt(line, veh.s);
    let i = (here.seg + 1) % n;
    let dist = (line.cum[here.seg + 1] - veh.s + L) % L;
    while (dist < LOOKAHEAD) {
      const lim = cornerLimit(line, i, veh.spec.cruise);
      vmax = Math.min(vmax, Math.sqrt(lim * lim + 2 * ACCEL * dist));
      const next = (i + 1) % n;
      dist += line.cum[i + 1] - line.cum[i];
      i = next;
    }

    // Yield to people and vehicles in front.
    const c = Math.cos(veh.angle);
    const s = Math.sin(veh.angle);
    const halfLen = (veh.spec.size[0] / 2) * PX_PER_METER;
    const halfW = (veh.spec.size[1] / 2 + 0.9) * PX_PER_METER;
    const blockedAhead = (x: number, y: number, range: number) => {
      const dx = x - veh.x;
      const dy = y - veh.y;
      const fwd = dx * c + dy * s;
      const lat = -dx * s + dy * c;
      return fwd > 0 && fwd < halfLen + range && Math.abs(lat) < halfW;
    };
    let blocked = mustYield(vehicleBody(line.kind, veh.x, veh.y, veh.angle, veh.v), walkers, BRAKE);
    if (!blocked)
      for (const o of [...vehicles, ...traffic]) {
        // Only queue behind traffic going our way; oncoming/crossing vehicles never block.
        const sameWay = Math.cos(o.angle - veh.angle) > 0.5;
        if (o !== veh && sameWay && blockedAhead(o.x, o.y, 12 * PX_PER_METER)) {
          blocked = true;
          break;
        }
      }
    if (blocked) {
      veh.blockedFor += dt;
      vmax = veh.blockedFor > MAX_BLOCKED_SECONDS ? Math.min(vmax, CREEP) : 0;
    } else veh.blockedFor = 0;

    if (veh.v < vmax) veh.v = Math.min(vmax, veh.v + ACCEL * dt);
    else veh.v = Math.max(vmax, veh.v - BRAKE * dt);

    const move = veh.v * dt;
    if (move >= toStop - 1) {
      veh.s = stopS;
      veh.v = 0;
      veh.dwell = DWELL_SECONDS;
      veh.atStop = veh.next;
    } else {
      veh.s = (veh.s + move) % L;
    }
    const p = pointAt(line, veh.s);
    veh.x = p.x;
    veh.y = p.y;
    veh.angle = p.angle;
  }
}

export const vehicleRot = (v: Vehicle) => angleToByte(v.angle);
