import type { GameTime } from "../clock";
import { INTERIORS } from "../interiors";
import { roll } from "./seed";
import { powerZoneOfPlace } from "./zones";

const HOUR = 60;
const DRY_SALT = 131;

export const DRY_TAPS = { chance: 0.28, from: 5 * HOUR + 30, to: 10 * HOUR };
export const WAKE_WINDOW = { from: 4 * HOUR, to: 11 * HOUR };
export const WATER = { fetchSeconds: 6, fetchEnergy: 3, fetchFun: 2, unwashedFunDrain: 0.012, wakeDryFun: 3 };

export const isHostel = (place: number): boolean => INTERIORS[place]?.template.id === "hostel";

export function dryMorning(zone: number, dayIndex: number): boolean {
  return roll(zone, dayIndex, DRY_SALT) < DRY_TAPS.chance;
}

export function tapsDry(place: number, t: GameTime): boolean {
  if (!isHostel(place)) return false;
  return t.minute >= DRY_TAPS.from && t.minute < DRY_TAPS.to && dryMorning(powerZoneOfPlace(place).index, t.dayIndex);
}

export interface BathLog {
  bathDay: number;
  unwashed: boolean;
  unwashedDay: number;
}

export type WakeResult = "none" | "bathed" | "dry";

export function wakeUp(log: BathLog, place: number, t: GameTime): WakeResult {
  if (!isHostel(place) || t.minute < WAKE_WINDOW.from || t.minute >= WAKE_WINDOW.to) return "none";
  if (log.bathDay === t.dayIndex || (log.unwashed && log.unwashedDay === t.dayIndex)) return "none";
  if (tapsDry(place, t)) {
    log.unwashed = true;
    log.unwashedDay = t.dayIndex;
    return "dry";
  }
  bathe(log, t);
  return "bathed";
}

export function bathe(log: BathLog, t: GameTime) {
  log.unwashed = false;
  log.bathDay = t.dayIndex;
}

export function tapsReturned(log: BathLog, t: GameTime): boolean {
  if (!log.unwashed) return false;
  if (t.dayIndex === log.unwashedDay && t.minute < DRY_TAPS.to) return false;
  bathe(log, t);
  return true;
}
