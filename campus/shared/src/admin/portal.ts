import type { GameTime } from "../clock";
import { SEMESTER_TIMES } from "../semester";
import { randomFor } from "../academics/seed";
import { WEEK_MINUTES } from "../politics/calendar";
import type { AdminRecord, RegistrationVia } from "./record";

export type PortalState = "up" | "slow" | "down";

export interface PortalStatus {
  state: PortalState;
  queue: number;
}

export const REGISTRATION = {
  closeMinute: SEMESTER_TIMES.registrationCloses,
  lateFine: 1000,
  centreFee: 200,
  testPenalty: 8,
} as const;

export const PORTAL_TROUBLE = {
  blockMinutes: 30,
  rushMinutes: 6 * 60,
  calm: { down: 0.16, slow: 0.14 },
  rush: { down: 0.3, slow: 0.45 },
  queueMin: 14,
  queueSpread: 30,
  queueDrainPerMinute: 2,
} as const;

export const PORTAL_TEXT = {
  down: "Service unavailable, try again.",
  queue: (position: number) => `Portal is busy. You are number ${position} in the queue.`,
  registered: "You don register for this semester already.",
  cash: (cost: number) => `You need ₦${cost.toLocaleString("en-NG")} for this. Find money first.`,
};

export const adminWeekOf = (total: number) => Math.floor(total / WEEK_MINUTES);
export const adminWeek = (t: GameTime) => Math.floor(t.dayIndex / 7);
export const adminWeekMinute = (total: number) => total - adminWeekOf(total) * WEEK_MINUTES;

export const registrationOpen = (total: number) => adminWeekMinute(total) < REGISTRATION.closeMinute;
export const registrationClosesIn = (total: number) => Math.max(0, REGISTRATION.closeMinute - adminWeekMinute(total));
export const isRegistered = (record: AdminRecord, week: number) => record.reg?.week === week;

export function portalRush(total: number): boolean {
  const left = REGISTRATION.closeMinute - adminWeekMinute(total);
  return left > 0 && left <= PORTAL_TROUBLE.rushMinutes;
}

export function portalStatus(total: number): PortalStatus {
  const T = PORTAL_TROUBLE;
  const minute = adminWeekMinute(total);
  const block = Math.floor(minute / T.blockMinutes);
  const rand = randomFor(`portal:${adminWeekOf(total)}:${block}`);
  const odds = portalRush(block * T.blockMinutes + adminWeekOf(total) * WEEK_MINUTES) ? T.rush : T.calm;
  const roll = rand();
  if (roll < odds.down) return { state: "down", queue: 0 };
  if (roll >= odds.down + odds.slow) return { state: "up", queue: 0 };
  const start = T.queueMin + Math.floor(rand() * T.queueSpread);
  const queue = Math.max(0, start - (minute - block * T.blockMinutes) * T.queueDrainPerMinute);
  return { state: queue > 0 ? "slow" : "up", queue };
}

export type RegisterOutcome =
  | { ok: true; cost: number; late: boolean }
  | { ok: false; reason: "registered" | "down" | "queue" | "cash"; text: string };

export function registrationCost(total: number, via: RegistrationVia): number {
  return (registrationOpen(total) ? 0 : REGISTRATION.lateFine) + (via === "centre" ? REGISTRATION.centreFee : 0);
}

export function tryRegister(record: AdminRecord, total: number, cash: number, via: RegistrationVia): RegisterOutcome {
  if (isRegistered(record, adminWeekOf(total))) return { ok: false, reason: "registered", text: PORTAL_TEXT.registered };
  if (via === "portal") {
    const status = portalStatus(total);
    if (status.state === "down") return { ok: false, reason: "down", text: PORTAL_TEXT.down };
    if (status.state === "slow") return { ok: false, reason: "queue", text: PORTAL_TEXT.queue(status.queue) };
  }
  const cost = registrationCost(total, via);
  if (cash < cost) return { ok: false, reason: "cash", text: PORTAL_TEXT.cash(cost) };
  return { ok: true, cost, late: !registrationOpen(total) };
}

export function unregisteredPenalty(record: AdminRecord, total: number): number {
  return !registrationOpen(total) && !isRegistered(record, adminWeekOf(total)) ? REGISTRATION.testPenalty : 0;
}
