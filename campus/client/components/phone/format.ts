import type { OrdersView } from "@campus/game/CampusView";

const METERS_PER_KM = 1000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const BATTERY_FULL = 100;
const BATTERY_LOW = 18;
const BATTERY_CHARGED_AT_MINUTE = 6 * MINUTES_PER_HOUR;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;

export const ORDER_STATUS: Record<NonNullable<OrdersView["mine"]>["status"], string> = {
  cooking: "Cooking…",
  waiting: "Ready, waiting for a rider",
  picking: "Rider is picking it up",
  coming: "On the way to you",
  campus: "A campus rider is on the way",
};

export const naira = (amount: number) => `₦${Math.floor(amount).toLocaleString("en-NG")}`;

export const hhmm = (minute: number) =>
  `${String(Math.floor(minute / MINUTES_PER_HOUR) % HOURS_PER_DAY).padStart(2, "0")}:${String(minute % MINUTES_PER_HOUR).padStart(2, "0")}`;

export const distance = (meters: number) => (meters < METERS_PER_KM ? `${meters} m` : `${(meters / METERS_PER_KM).toFixed(1)} km`);

export function batteryAt(minute: number): number {
  const sinceCharge = (minute - BATTERY_CHARGED_AT_MINUTE + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return Math.round(BATTERY_FULL - (sinceCharge / MINUTES_PER_DAY) * (BATTERY_FULL - BATTERY_LOW));
}
