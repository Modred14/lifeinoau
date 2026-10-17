import { MINUTES_PER_DAY, type GameTime } from "../clock";
import { PLACES } from "../map";
import { roll, rollBetween } from "./seed";

const HOUR = 60;
const READING_ROOM_NAMES = /^white house$|1000 seater|^aud i$|^aud ii$|^hslta$|first bank lecture/i;
const READERS_SALT = 91;
const MOMENT_SALT = 97;

export const JACKING = {
  start: 22 * HOUR,
  end: 5 * HOUR,
  fewestReaders: 6,
  mostReaders: 28,
  baseBonus: 0.25,
  perReader: 0.05,
  maxBonus: 0.5,
  energyCost: 0.08,
  countsAfter: 60,
};
export const DARK_STUDY_FACTOR = 0.5;

export const READING_ROOMS: readonly number[] = PLACES.map((p, i) => (READING_ROOM_NAMES.test(p.name) ? i : -1)).filter((i) => i >= 0);

const roomSet = new Set(READING_ROOMS);

export const isReadingRoom = (place: number): boolean => roomSet.has(place);

export const isJackingTime = (minute: number): boolean => minute >= JACKING.start || minute < JACKING.end;

export function nightIndex(t: GameTime): number {
  return t.minute < JACKING.end ? t.dayIndex - 1 : t.dayIndex;
}

export function npcReaders(place: number, night: number): number {
  if (!isReadingRoom(place)) return 0;
  return rollBetween(JACKING.fewestReaders, JACKING.mostReaders, place, night, READERS_SALT);
}

export function groupBonus(npcs: number, players: number): number {
  if (npcs + players <= 0) return 0;
  return Math.min(JACKING.maxBonus, JACKING.baseBonus + JACKING.perReader * Math.max(0, players));
}

export interface StudyScene {
  lit: boolean;
  jacking: boolean;
  npcs: number;
  players: number;
}

export function studyMultiplier(scene: StudyScene): number {
  if (!scene.lit) return DARK_STUDY_FACTOR;
  return scene.jacking ? 1 + groupBonus(scene.npcs, scene.players) : 1;
}

export type ReadingMomentKind = "mosquito" | "patrol" | "sleepy" | "snore";

export interface ReadingMoment {
  at: number;
  kind: ReadingMomentKind;
  text: string;
  fun: number;
  energy: number;
}

const MOMENT_KINDS: readonly Omit<ReadingMoment, "at">[] = [
  { kind: "mosquito", text: "🦟 Mosquito dey sing for your ear. You slap am, e dodge.", fun: -2, energy: 0 },
  { kind: "patrol", text: "🔦 Security patrol enter. \"Your ID card?\" You show am and dem waka pass.", fun: -1, energy: 0 },
  { kind: "sleepy", text: "😴 Sleep dey catch you. You wash face for tap and continue.", fun: 0, energy: -3 },
  { kind: "snore", text: "😂 Somebody don sleep off for back row and e dey snore. The whole hall laugh.", fun: 3, energy: 0 },
];
const MOMENTS_PER_NIGHT = { fewest: 2, most: 4 };
const MOMENT_SPAN = (MINUTES_PER_DAY - JACKING.start + JACKING.end) - 40;

export function readingMoments(place: number, night: number): ReadingMoment[] {
  if (!isReadingRoom(place)) return [];
  const count = rollBetween(MOMENTS_PER_NIGHT.fewest, MOMENTS_PER_NIGHT.most, place, night, MOMENT_SALT);
  const from = night * MINUTES_PER_DAY + JACKING.start + 20;
  const out: ReadingMoment[] = [];
  for (let i = 0; i < count; i++) {
    const kind = MOMENT_KINDS[Math.floor(roll(place, night, MOMENT_SALT + 1, i) * MOMENT_KINDS.length)];
    out.push({ ...kind, at: from + Math.floor(((i + roll(place, night, MOMENT_SALT + 2, i)) / count) * MOMENT_SPAN) });
  }
  return out;
}

export interface NightLog {
  nights: number;
  lastNight: number;
  nightMinutes: number;
  nightOf: number;
}

export function noteReading(log: NightLog, t: GameTime, gameMinutes: number): boolean {
  const night = nightIndex(t);
  if (log.nightOf !== night) {
    log.nightOf = night;
    log.nightMinutes = 0;
  }
  log.nightMinutes += gameMinutes;
  if (log.nightMinutes < JACKING.countsAfter || log.lastNight === night) return false;
  log.nights = log.lastNight === night - 1 ? log.nights + 1 : 1;
  log.lastNight = night;
  return true;
}

export function readingStreak(log: NightLog, t: GameTime): number {
  return nightIndex(t) - log.lastNight > 1 ? 0 : log.nights;
}
