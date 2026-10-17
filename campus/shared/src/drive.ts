/**
 * Car physics for student-driven shuttles. Deterministic and shared: the
 * server simulates it as the truth, the driver's phone runs the same code to
 * predict their bus so steering feels instant.
 *
 * Units: map px, seconds, radians (map-space angle, atan2(dy, dx)).
 */
import { PX_PER_METER } from "./map";
import { isBlocked } from "./movement";

export interface Car {
  x: number;
  y: number;
  angle: number;
  /** Signed speed along the heading, px/s (negative = reversing). */
  v: number;
}

export interface DriveInput {
  /** -1 (brake / reverse) .. 1 (accelerate). */
  t: number;
  /** -1 (left) .. 1 (right). */
  s: number;
}

const M = PX_PER_METER;
export const CAR_MAX_SPEED = 15 * M;
const REVERSE_MAX = 4 * M;
const ACCEL = 4.5 * M;
const BRAKE = 10 * M;
const DRAG = 1.6 * M;
/** Radians per second at full lock and normal speed. */
const TURN_RATE = 1.5;
/** Collision circles along the body (front, middle, back), radius in px. */
const BODY_R = 1.05 * M;
const BODY_OFFSETS = [-1.6 * M, 0, 1.6 * M];

/** Clamp an untrusted input to sane values (or null). */
export function parseDriveInput(t: unknown, s: unknown): DriveInput | null {
  if (typeof t !== "number" || typeof s !== "number" || !Number.isFinite(t) || !Number.isFinite(s)) return null;
  return { t: Math.max(-1, Math.min(1, t)), s: Math.max(-1, Math.min(1, s)) };
}

function carBlocked(x: number, y: number, angle: number): boolean {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (const o of BODY_OFFSETS) if (isBlocked(x + c * o, y + s * o, BODY_R)) return true;
  return false;
}

/** Advance a car by dt seconds. Hitting a wall stops it dead. Mutates and returns `car`. */
export function stepCar(car: Car, input: DriveInput, dt: number): Car {
  dt = Math.min(dt, 0.25);
  const { t, s } = input;
  // Throttle / brake / reverse.
  if (t > 0) car.v += (car.v < 0 ? BRAKE : ACCEL) * t * dt;
  else if (t < 0) car.v += (car.v > 0 ? -BRAKE : -ACCEL * 0.7) * -t * dt;
  else {
    const d = DRAG * dt;
    car.v = Math.abs(car.v) <= d ? 0 : car.v - Math.sign(car.v) * d;
  }
  car.v = Math.max(-REVERSE_MAX, Math.min(CAR_MAX_SPEED, car.v));

  // Steering: needs some speed, is gentler when fast, and flips when reversing.
  const speedFactor = Math.min(1, Math.abs(car.v) / (4 * M)) * (1 - 0.45 * (Math.abs(car.v) / CAR_MAX_SPEED));
  const turn = s * TURN_RATE * speedFactor * Math.sign(car.v) * dt;

  // Sub-steps so a fast bus can't tunnel through a wall.
  const dist = car.v * dt;
  const steps = Math.max(1, Math.ceil(Math.abs(dist) / (0.5 * M)));
  for (let i = 0; i < steps; i++) {
    const a = car.angle + turn / steps;
    const nx = car.x + Math.cos(a) * (dist / steps);
    const ny = car.y + Math.sin(a) * (dist / steps);
    if (carBlocked(nx, ny, a)) {
      car.v = 0;
      break;
    }
    car.x = nx;
    car.y = ny;
    car.angle = a;
  }
  return car;
}

/** A free spot beside a car's passenger (right) side, where riders get out. */
export function besideCar(car: Car): { x: number; y: number } {
  const rx = -Math.sin(car.angle);
  const ry = Math.cos(car.angle);
  for (let d = 2.2; d < 10; d += 0.5)
    for (const side of [1, -1]) {
      const x = car.x + rx * side * d * M;
      const y = car.y + ry * side * d * M;
      if (!isBlocked(x, y)) return { x, y };
    }
  return { x: car.x, y: car.y };
}
