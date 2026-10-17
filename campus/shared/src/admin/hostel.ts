import { MINUTES_PER_DAY } from "../clock";
import { INTERIORS } from "../interiors";
import { PLACES } from "../map";
import { randomFor } from "../academics/seed";
import { SEMESTER_TIMES } from "../semester";
import { adminWeekMinute, adminWeekOf } from "./portal";
import type { AdminRecord } from "./record";

export interface BedHall {
  place: number;
  name: string;
  beds: number;
}

export const BED_SPACE = {
  fee: 1500,
  bedsPerHall: 6,
  rivalsMin: 1,
  rivalsMax: 3,
  ownerRestBonus: 0.35,
  squatterRestShare: 0.7,
} as const;

export const PORTER_RAID = {
  chance: 0.3,
  earliest: 21 * 60,
  spread: 2 * 60,
  step: 10,
  minutes: 20,
  fine: 300,
} as const;

export const BED_TEXT = {
  closed: "Ballot is closed. Check the school calendar for the next one.",
  tried: "You don ballot this semester already. Try again next semester.",
  holding: (hall: string) => `You already hold a bed space in ${hall}.`,
  exhausted: "Bed spaces exhausted. Try again next session.",
  cash: `Bed space fee is ₦${BED_SPACE.fee.toLocaleString("en-NG")}. Find money first.`,
  won: (hall: string, position: number) => `🛏️ Ballot successful! You were number ${position}. Bed space in ${hall} is yours this semester.`,
  lost: (position: number, beds: number) => `🛏️ You were number ${position} for ${beds} beds. Bed spaces exhausted. You fit squat for now.`,
  raid: (hall: string, fine: number) => `🔦 Porter dey come! Squatters out of ${hall}.${fine > 0 ? ` You paid ₦${fine} fine.` : ""}`,
};

export const BED_HALLS: readonly BedHall[] = PLACES.map((p, place) => ({ name: p.name, place, beds: BED_SPACE.bedsPerHall })).filter((hall) => INTERIORS[hall.place]?.template.id === "hostel" && PLACES[hall.place].housing !== "private");

export const bedHall = (place: number) => BED_HALLS.find((hall) => hall.place === place);
export const bedHallNamed = (name: string) => BED_HALLS.find((hall) => hall.name === name);

export interface BallotWindow {
  start: number;
  end: number;
  late: boolean;
}

export const BALLOT_WINDOWS: readonly BallotWindow[] = [
  { start: SEMESTER_TIMES.ballotOpens, end: SEMESTER_TIMES.ballotCloses, late: false },
  { start: SEMESTER_TIMES.lateBallotOpens, end: SEMESTER_TIMES.lateBallotCloses, late: true },
];

export const ballotWindow = (): BallotWindow => BALLOT_WINDOWS[0];
export const ballotWindowAt = (minuteOfWeek: number) => BALLOT_WINDOWS.find((window) => minuteOfWeek >= window.start && minuteOfWeek < window.end);
export const nextBallotWindow = (minuteOfWeek: number) => BALLOT_WINDOWS.find((window) => minuteOfWeek < window.end);
export const publicBallotOpen = (total: number) => ballotWindowAt(adminWeekMinute(total)) !== undefined;

export function ballotOpenFor(record: AdminRecord, total: number): boolean {
  const week = adminWeekOf(total);
  if (holdsBed(record, week) || (record.ballot.week === week && record.ballot.tried)) return false;
  return publicBallotOpen(total);
}

export function ballotRivals(week: number, place: number): number {
  const B = BED_SPACE;
  const beds = bedHall(place)?.beds ?? B.bedsPerHall;
  const low = beds * B.rivalsMin;
  const high = beds * B.rivalsMax;
  return low + Math.floor(randomFor(`rivals:${week}:${place}`)() * (high - low + 1));
}

export const ballotTicket = (week: number, place: number, key: string, secret = "") => randomFor(`ticket:${week}:${place}:${key}${secret ? `:${secret}` : ""}`)();

export function ballotPosition(week: number, place: number, key: string, secret = ""): number {
  return 1 + Math.floor(ballotTicket(week, place, key, secret) * (ballotRivals(week, place) + 1));
}

export function ballotWins(week: number, place: number, key: string, secret = ""): boolean {
  const hall = bedHall(place);
  return hall !== undefined && ballotPosition(week, place, key, secret) <= hall.beds;
}

export const holdsBed = (record: AdminRecord, week: number) => record.bed?.week === week;
export const holdsBedIn = (record: AdminRecord, week: number, place: number) => holdsBed(record, week) && record.bed?.hall === PLACES[place]?.name;

export type Sleeper = "owner" | "guest" | "squatter";

export function sleeperIn(record: AdminRecord, week: number, place: number): Sleeper {
  if (holdsBedIn(record, week, place)) return "owner";
  return holdsBed(record, week) ? "guest" : "squatter";
}

export function restAdjust(sleeper: Sleeper, sleepRate: number): number {
  if (sleeper === "owner") return BED_SPACE.ownerRestBonus;
  return -sleepRate * (1 - BED_SPACE.squatterRestShare);
}

export function raidFor(dayIndex: number, place: number): { raid: boolean; start: number; end: number } {
  const R = PORTER_RAID;
  const rand = randomFor(`raid:${dayIndex}:${place}`);
  const raid = rand() < R.chance;
  const steps = Math.floor(R.spread / R.step) + 1;
  const start = Math.min(MINUTES_PER_DAY - R.minutes, R.earliest + Math.floor(rand() * steps) * R.step);
  return { raid, start, end: start + R.minutes };
}

export function raidOn(dayIndex: number, place: number, minute: number): boolean {
  const roll = raidFor(dayIndex, place);
  return roll.raid && minute >= roll.start && minute < roll.end;
}
