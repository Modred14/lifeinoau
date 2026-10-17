import { MINUTES_PER_DAY, type GameTime } from "../clock";
import { readingStreak, type NightLog } from "./reading";
import { roll, rollBetween } from "./seed";

const HOUR = 60;
const ONSET_SALT = 151;
const KIND_SALT = 157;
const WAIT_SALT = 163;
const NUMBER_SALT = 167;
const BREAK_SALT = 173;

export type Illness = "malaria" | "typhoid";

export const ILLNESS_NAME: Record<Illness, string> = { malaria: "Malaria", typhoid: "Typhoid" };

export const HEALTH = {
  lowNeed: 15,
  weakAfter: 240,
  recoverRate: 2,
  weakChance: 0.18,
  typhoidShare: 0.5,
  nightsFor: 3,
  nightsChance: 0.22,
  immuneMinutes: MINUTES_PER_DAY,
  restCureSeconds: 90,
  walkPace: 0.85,
  energyDrain: 0.02,
  chemistPrice: 800,
  chemistSeconds: 4,
  chemistOpens: 7 * HOUR,
  chemistCloses: 21 * HOUR,
  clinicOpens: 8 * HOUR,
  clinicCloses: 16 * HOUR,
  clinicShortest: 40,
  clinicLongest: 90,
  clinicBreakChance: 0.5,
  clinicNumbers: { lowest: 7, highest: 38 },
};

export interface HealthLog extends NightLog {
  illness: Illness | "";
  sickSince: number;
  rest: number;
  immuneUntil: number;
  weak: number;
}

export function strain(log: HealthLog, food: number, energy: number, gameMinutes: number) {
  if (food < HEALTH.lowNeed || energy < HEALTH.lowNeed) log.weak = Math.min(HEALTH.weakAfter * 2, log.weak + gameMinutes);
  else log.weak = Math.max(0, log.weak - gameMinutes * HEALTH.recoverRate);
}

export function onsetChance(log: HealthLog, t: GameTime): number {
  if (log.illness || t.total < log.immuneUntil) return 0;
  let chance = 0;
  if (log.weak >= HEALTH.weakAfter) chance += HEALTH.weakChance;
  if (readingStreak(log, t) >= HEALTH.nightsFor) chance += HEALTH.nightsChance;
  return chance;
}

export function fallSick(log: HealthLog, t: GameTime, seed: number): Illness | "" {
  const chance = onsetChance(log, t);
  const hour = Math.floor(t.total / HOUR);
  if (chance <= 0 || roll(seed, hour, ONSET_SALT) >= chance) return "";
  const weak = log.weak >= HEALTH.weakAfter;
  log.illness = weak && roll(seed, hour, KIND_SALT) < HEALTH.typhoidShare ? "typhoid" : "malaria";
  log.sickSince = t.total;
  log.rest = 0;
  return log.illness;
}

export function cure(log: HealthLog, t: GameTime) {
  log.illness = "";
  log.rest = 0;
  log.weak = 0;
  log.nights = 0;
  log.immuneUntil = t.total + HEALTH.immuneMinutes;
}

export function restInBed(log: HealthLog, seconds: number, t: GameTime): boolean {
  if (!log.illness) return false;
  log.rest += seconds;
  if (log.rest < HEALTH.restCureSeconds) return false;
  cure(log, t);
  return true;
}

export const clinicOpen = (t: GameTime): boolean => t.minute >= HEALTH.clinicOpens && t.minute < HEALTH.clinicCloses;
export const chemistOpen = (t: GameTime): boolean => t.minute >= HEALTH.chemistOpens && t.minute < HEALTH.chemistCloses;

export interface ClinicTicket {
  number: number;
  wait: number;
  doctorOnBreak: boolean;
}

export function clinicTicket(seed: number, t: GameTime): ClinicTicket {
  return {
    number: rollBetween(HEALTH.clinicNumbers.lowest, HEALTH.clinicNumbers.highest, seed, t.total, NUMBER_SALT),
    wait: rollBetween(HEALTH.clinicShortest, HEALTH.clinicLongest, seed, t.dayIndex, WAIT_SALT),
    doctorOnBreak: roll(seed, t.dayIndex, BREAK_SALT) < HEALTH.clinicBreakChance,
  };
}
