/**
 * Student-driven shuttles: a fixed pool of slots (so vehicle indices in the
 * synced array never shift). A slot is active while a student is on a
 * driving shift; the server steps the car with the shared physics from the
 * driver's latest input.
 */
import { DRIVER_SLOTS, LINES, PX_PER_METER, STOP_COOLDOWN_SECONDS, stepCar, type Car, type DriveInput } from "@campuslife/shared";

export interface DriverSlot {
  active: boolean;
  driver: string;
  car: Car;
  input: DriveInput;
  riders: Set<string>;
  /** Seconds the bus has been (almost) stationary. */
  stoppedFor: number;
  /** "line:stop" -> last time passengers paid there (ms). */
  lastPaid: Map<string, number>;
  /** Earned this shift (₦), for the end-of-shift summary. */
  earned: number;
}

export function createDriverSlots(): DriverSlot[] {
  return Array.from({ length: DRIVER_SLOTS }, () => ({
    active: false,
    driver: "",
    car: { x: 0, y: 0, angle: 0, v: 0 },
    input: { t: 0, s: 0 },
    riders: new Set<string>(),
    stoppedFor: 0,
    lastPaid: new Map(),
    earned: 0,
  }));
}

/** Seats in a student-driven shuttle. */
export const DRIVER_SEATS = 14;
/** Counts as "at a stop" within this distance (map px) of a line's stop point. */
const AT_STOP = 14 * PX_PER_METER;
/** Seconds to wait at a stop before the passengers there pay and climb in. */
const BOARD_WAIT = 2.5;

/**
 * Step every active slot. Returns stops where a driver has just picked up
 * paying passengers, so the room can pay them.
 */
export function stepDrivers(slots: DriverSlot[], dt: number, now: number): { slot: number; stop: string; key: string }[] {
  const pickups: { slot: number; stop: string; key: string }[] = [];
  slots.forEach((slot, i) => {
    if (!slot.active) return;
    stepCar(slot.car, slot.input, dt);
    if (Math.abs(slot.car.v) > 0.3 * PX_PER_METER) {
      slot.stoppedFor = 0;
      return;
    }
    slot.stoppedFor += dt;
    if (slot.stoppedFor < BOARD_WAIT) return;
    for (const line of LINES)
      for (let k = 0; k < line.stops.length; k++) {
        const st = line.stops[k];
        if (Math.hypot(st.x - slot.car.x, st.y - slot.car.y) > AT_STOP) continue;
        // Lines sharing a stop share its waiting passengers.
        const key = `${Math.round(st.kerb.x / 400)},${Math.round(st.kerb.y / 400)}`;
        const last = slot.lastPaid.get(key) ?? -Infinity;
        if (now - last < STOP_COOLDOWN_SECONDS * 1000) continue;
        slot.lastPaid.set(key, now);
        pickups.push({ slot: i, stop: st.name, key });
      }
  });
  return pickups;
}
