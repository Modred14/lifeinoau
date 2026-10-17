/**
 * Deterministic movement + collision rules.
 *
 * The server runs this as the source of truth. The client runs the exact
 * same code to *predict* its own player so input feels instant, then
 * corrects toward the server's position. Because the server never accepts
 * positions from clients, editing client code can't move you through walls.
 */
import { PLAYER_RADIUS, PLAYER_SPEED } from "./constants";
import { walkingFactor, type Vitals } from "./vitals";
import {
  BUILDINGS,
  MAP_HEIGHT_PX,
  MAP_WIDTH_PX,
  buildingCells,
  distSqToPolyEdge,
  forCells,
  pointInPoly,
} from "./map";
import { INTERIOR_X0, interiorBlocked, stallBlocked } from "./interiors";
import { solidBlocked } from "./solids";

/** 8-way facing. 0 = east, increasing clockwise (screen y points down). */
export const Direction = {
  E: 0,
  SE: 1,
  S: 2,
  SW: 3,
  W: 4,
  NW: 5,
  N: 6,
  NE: 7,
} as const;

/** What a player is currently trying to do. */
export type MoveIntent =
  | { kind: "idle" }
  | { kind: "dir"; dx: number; dy: number }
  | { kind: "target"; x: number; y: number };

export const IDLE: MoveIntent = { kind: "idle" };

export interface Mover {
  x: number;
  y: number;
  dir: number;
  intent: MoveIntent;
}

/** Max distance moved per collision sub-step, so fast frames can't tunnel through walls. */
const SUBSTEP_PX = 4;
/** Within this distance of a tap target counts as "arrived". */
const ARRIVE_EPSILON = 1;

// ------------------------------------------------------------ collision

/**
 * True if a circle of PLAYER_RADIUS at (x, y) overlaps a building outline,
 * a food stall, a registered solid or interior furniture, or leaves the walkable world.
 */
export function isBlocked(x: number, y: number, r = PLAYER_RADIUS): boolean {
  if (x >= INTERIOR_X0) return interiorBlocked(x, y, r);
  if (x < r || y < r || x > MAP_WIDTH_PX - r || y > MAP_HEIGHT_PX - r) return true;
  if (stallBlocked(x, y, r) || solidBlocked(x, y, r)) return true;
  const rr = r * r;
  let hit = false;
  forCells(x - r, y - r, x + r, y + r, (i) => {
    if (hit) return;
    for (const id of buildingCells[i]) {
      const b = BUILDINGS[id];
      const bb = b.bbox;
      if (x < bb.x - r || x > bb.x + bb.w + r || y < bb.y - r || y > bb.y + bb.h + r) continue;
      if (pointInPoly(x, y, b.poly) || distSqToPolyEdge(x, y, b.poly) < rr) {
        hit = true;
        return;
      }
    }
  });
  return hit;
}

/** True if a player can walk the straight segment a→b without touching anything. */
export function segmentClear(ax: number, ay: number, bx: number, by: number, step = 6): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (isBlocked(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

/** Quantise a movement vector to one of 8 directions. */
export function directionFromVector(dx: number, dy: number, fallback: number): number {
  if (dx === 0 && dy === 0) return fallback;
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (octant + 8) % 8;
}

/**
 * Advance a mover by dtMs according to its intent. Mutates and returns `m`.
 *
 * - "dir" intent: walk in that direction; slides along walls.
 * - "target" intent: walk straight toward the point; stops (and clears the
 *   intent) on arrival or on hitting an obstacle.
 */
export function stepMovement(m: Mover, dtMs: number, vitals?: Vitals): Mover {
  const intent = m.intent;
  if (intent.kind === "idle" || dtMs <= 0) return m;

  let budget = (PLAYER_SPEED * Math.min(dtMs, 250) * (vitals ? walkingFactor(vitals) : 1)) / 1000; // clamp dt so a stall can't teleport

  if (intent.kind === "dir") {
    let { dx, dy } = intent;
    const len = Math.hypot(dx, dy);
    if (len === 0) return m;
    dx /= len;
    dy /= len;
    m.dir = directionFromVector(dx, dy, m.dir);

    while (budget > 0) {
      const step = Math.min(SUBSTEP_PX, budget);
      budget -= step;
      // Move each axis separately so the player slides along walls.
      const nx = m.x + dx * step;
      if (!isBlocked(nx, m.y)) m.x = nx;
      const ny = m.y + dy * step;
      if (!isBlocked(m.x, ny)) m.y = ny;
    }
    return m;
  }

  // Target: straight line, no sliding.
  const tdx = intent.x - m.x;
  const tdy = intent.y - m.y;
  const dist = Math.hypot(tdx, tdy);
  if (dist <= ARRIVE_EPSILON) {
    m.intent = IDLE;
    return m;
  }
  const ux = tdx / dist;
  const uy = tdy / dist;
  m.dir = directionFromVector(ux, uy, m.dir);
  budget = Math.min(budget, dist);

  while (budget > 0) {
    const step = Math.min(SUBSTEP_PX, budget);
    budget -= step;
    const nx = m.x + ux * step;
    const ny = m.y + uy * step;
    if (isBlocked(nx, ny)) {
      m.intent = IDLE; // hit an obstacle: stop here
      return m;
    }
    m.x = nx;
    m.y = ny;
  }
  if (Math.hypot(intent.x - m.x, intent.y - m.y) <= ARRIVE_EPSILON) m.intent = IDLE;
  return m;
}

/**
 * Validate an untrusted direction (any angle, so a rotating camera can walk
 * in any direction). Returns a unit vector, or null for "stop".
 * Speed never depends on the input's length, so oversized values can't cheat.
 */
export function parseDirection(dx: unknown, dy: unknown): { dx: number; dy: number } | null {
  if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const len = Math.hypot(dx, dy);
  if (len < 0.2) return null;
  return { dx: dx / len, dy: dy / len };
}
