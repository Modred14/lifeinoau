/**
 * Student life rules: family background (how much allowance lands), skills
 * that grow with work, jobs that pay, and microfinance loans.
 * Shared so the server enforces exactly what the client shows.
 */
import { PX_PER_METER, type Point } from "./map";
import { LINES } from "./transit";
import { isBlocked } from "./movement";

export * from "./backgrounds";

// ---------------------------------------------------------------- skills

export type Skill = "drive" | "cook" | "teach";
export const SKILLS: Skill[] = ["drive", "cook", "teach"];
export const SKILL_INFO: Record<Skill, { label: string; icon: string }> = {
  drive: { label: "Driving", icon: "🚐" },
  cook: { label: "Cooking", icon: "🍳" },
  teach: { label: "Teaching", icon: "📚" },
};
/** Pay multiplier at a skill level (0..100): up to double pay when mastered. */
export const skillPay = (level: number) => 1 + Math.max(0, Math.min(100, level)) / 100;

// ---------------------------------------------------------------- jobs

/** Base pay per shift (₦) for the seat-based jobs (cook / tutor). */
export const JOB_PAY = { cook: 600, tutor: 900 } as const;
/** Study points needed before anyone will pay you to tutor them. */
export const TUTOR_MIN_STUDY = 15;
/** Fare a passenger pays a student driver when they get off (₦). */
export const PLAYER_FARE = 150;
/** Fare paid by the (simulated) passengers waiting at a stop, per head. */
export const STOP_FARE = 150;
/** A driver can collect stop passengers at the same stop once per this many seconds. */
export const STOP_COOLDOWN_SECONDS = 60;
/** Student-driven shuttles available at once. */
export const DRIVER_SLOTS = 6;

/** The motor park where drivers start a shift: beside the Gate Shuttle's SUB stop. */
export const MOTOR_PARK: Point & { name: string; spawn: { x: number; y: number; angle: number } } = (() => {
  const line = LINES.find((l) => /gate/i.test(l.name)) ?? LINES[0];
  const stop = line?.stops.find((s) => /student union/i.test(s.name)) ?? line?.stops[0];
  if (!line || !stop) return { name: "Motor park", x: 0, y: 0, spawn: { x: 0, y: 0, angle: 0 } };
  // Drivers pick their bus up 25 m before the stop, already in the lane.
  const back = (stop.s - 25 * PX_PER_METER + line.length) % line.length;
  let i = 0;
  while (i + 1 < line.cum.length - 1 && line.cum[i + 1] <= back) i++;
  const n = line.pts.length / 2;
  const j = (i + 1) % n;
  const ax = line.pts[i * 2], ay = line.pts[i * 2 + 1], bx = line.pts[j * 2], by = line.pts[j * 2 + 1];
  const t = (back - line.cum[i]) / (line.cum[i + 1] - line.cum[i] || 1);
  const spawn = { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(by - ay, bx - ax) };
  // The sign-up point stands on the kerb next to where the bus waits.
  let x = stop.kerb.x - Math.cos(spawn.angle) * 8 * PX_PER_METER;
  let y = stop.kerb.y - Math.sin(spawn.angle) * 8 * PX_PER_METER;
  if (isBlocked(x, y)) ({ x, y } = stop.kerb);
  return { name: "Motor park", x, y, spawn };
})();
/** Get this close (map px) to the motor park to start a shift. */
export const JOB_DISTANCE = 6 * PX_PER_METER;

// ---------------------------------------------------------------- loans

export const LOAN_AMOUNT = 10000;
/** What you owe back (20% interest). */
export const LOAN_REPAY = 12000;
/** Share of every job payment that goes to repaying an open loan. */
export const LOAN_CUT = 0.3;

// ---------------------------------------------------------------- food delivery

/** Delivery fee on every order (₦); it's what the rider earns. */
export const DELIVERY_FEE = 200;
/** Seconds the kitchen takes before an order can be picked up. */
export const COOK_SECONDS = 8;
/** If no student rider takes an open order within this many seconds, a campus rider does. */
export const NPC_RIDER_WAIT = 25;
/** Campus riders' speed for the delivery estimate (px/s). */
export const NPC_RIDER_SPEED = 6 * PX_PER_METER;
/** Hand over an order within this distance (map px) of the customer. */
export const DELIVER_DISTANCE = 4 * PX_PER_METER;
/** What one food pack restores. */
export const PACK_FOOD = 45;
export const PACK_FUN = 5;
/** Order status (OrderState.status). */
export const ORDER = { cooking: 0, open: 1, accepted: 2, carrying: 3 } as const;
