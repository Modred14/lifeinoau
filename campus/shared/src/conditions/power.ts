import { MINUTES_PER_DAY, daylight, type GameTime } from "../clock";
import { INTERIORS } from "../interiors";
import { PLACES } from "../map";
import { roll, rollBetween } from "./seed";
import { POWER_ZONES, powerZoneOfPlace, type PowerZone } from "./zones";

export interface PowerOutage {
  zone: number;
  start: number;
  end: number;
}

interface OutageWindow {
  salt: number;
  chance: number;
  from: number;
  to: number;
  shortest: number;
  longest: number;
  sparedBy: number;
}

const HOUR = 60;
const OUTAGE_WINDOWS: readonly OutageWindow[] = [
  { salt: 11, chance: 0.6, from: 18 * HOUR + 30, to: 22 * HOUR + 30, shortest: 45, longest: 180, sparedBy: 0 },
  { salt: 23, chance: 0.35, from: 8 * HOUR, to: 16 * HOUR, shortest: 30, longest: 120, sparedBy: 0 },
  { salt: 37, chance: 0.15, from: 1 * HOUR, to: 4 * HOUR + 30, shortest: 30, longest: 90, sparedBy: -1 },
];
const SPARE_SALT = 5;
const CACHE_LIMIT = 600;
const LOOK_AHEAD_DAYS = 2;
const GENERATOR_NAMES = /oluwasanmi library|amphi theatre|oduduwa hall/i;
const SCREEN_SALT = 71;
const GENERATOR_SALT = 53;

export const GENERATOR_DELAY = { shortest: 3, longest: 12 };
export const DARK_READING_DAYLIGHT = 0.5;
export const GENERATOR_PLACES: readonly number[] = PLACES.map((p, i) => (GENERATOR_NAMES.test(p.name) ? i : -1)).filter((i) => i >= 0);

const generatorSet = new Set(GENERATOR_PLACES);
const cache = new Map<number, PowerOutage[]>();

export interface LightRelief {
  from: number;
  until: number;
  hours: number;
}

const RELIEF_FROM = 18 * HOUR;
let reliefs: readonly LightRelief[] = [];
let reliefStamp = "";

export function setLightRelief(next: readonly LightRelief[]) {
  const kept = next.filter((r) => r.hours > 0 && r.until > r.from);
  const stamp = kept.map((r) => `${r.from}:${r.until}:${r.hours}`).join("|");
  if (stamp === reliefStamp) return;
  reliefStamp = stamp;
  reliefs = kept;
  cache.clear();
}

export function lightReliefHours(zone: number, start: number): number {
  if (reliefs.length === 0 || !POWER_ZONES[zone]?.hostel) return 0;
  const minute = ((start % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (minute < RELIEF_FROM) return 0;
  return reliefs.reduce((most, r) => (start >= r.from && start < r.until ? Math.max(most, r.hours) : most), 0);
}

export function sparedZone(dayIndex: number): number {
  return Math.floor(roll(dayIndex, SPARE_SALT) * POWER_ZONES.length);
}

export function outagesOn(zone: number, dayIndex: number): readonly PowerOutage[] {
  const key = dayIndex * POWER_ZONES.length + zone;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: PowerOutage[] = [];
  for (const w of OUTAGE_WINDOWS) {
    if (sparedZone(dayIndex + w.sparedBy) === zone) continue;
    if (roll(zone, dayIndex, w.salt) >= w.chance) continue;
    const start = dayIndex * MINUTES_PER_DAY + rollBetween(w.from, w.to, zone, dayIndex, w.salt + 1);
    const end = start + rollBetween(w.shortest, w.longest, zone, dayIndex, w.salt + 2) - lightReliefHours(zone, start) * HOUR;
    if (end > start) out.push({ zone, start, end });
  }
  out.sort((a, b) => a.start - b.start);
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, out);
  return out;
}

export function outageAt(zone: number, total: number): PowerOutage | undefined {
  const day = Math.floor(total / MINUTES_PER_DAY);
  const near = [...outagesOn(zone, day - 1), ...outagesOn(zone, day), ...outagesOn(zone, day + 1)];
  const first = near.find((o) => total >= o.start && total < o.end);
  if (!first) return undefined;
  const merged = { ...first };
  for (const o of near) {
    if (o.start <= merged.end && o.end > merged.end && o.start >= merged.start) merged.end = o.end;
    if (o.end >= merged.start && o.start < merged.start) merged.start = o.start;
  }
  return merged;
}

export function nextOutage(zone: number, total: number): PowerOutage | undefined {
  const day = Math.floor(total / MINUTES_PER_DAY);
  for (let d = 0; d <= LOOK_AHEAD_DAYS; d++) {
    const next = outagesOn(zone, day + d).find((o) => o.start > total);
    if (next) return next;
  }
  return undefined;
}

export const zoneHasLight = (zone: number, total: number): boolean => !outageAt(zone, total);

export const hasGenerator = (place: number): boolean => generatorSet.has(place);

export function generatorDelay(place: number, outageStart: number, salt = GENERATOR_SALT): number {
  return rollBetween(GENERATOR_DELAY.shortest, GENERATOR_DELAY.longest, place, outageStart, salt);
}

export interface PlaceLight {
  zone: PowerZone;
  nepa: boolean;
  generator: boolean;
  lit: boolean;
  until?: number;
  generatorAt?: number;
}

export function placeLight(place: number, total: number): PlaceLight {
  const zone = powerZoneOfPlace(place);
  const outage = outageAt(zone.index, total);
  if (!outage) return { zone, nepa: true, generator: false, lit: true };
  if (!hasGenerator(place)) return { zone, nepa: false, generator: false, lit: false, until: outage.end };
  const generatorAt = outage.start + generatorDelay(place, outage.start);
  const generator = total >= generatorAt;
  return { zone, nepa: false, generator, lit: generator, until: outage.end, generatorAt };
}

export function screenLit(place: number, total: number): boolean {
  const light = placeLight(place, total);
  if (light.lit) return true;
  if (INTERIORS[place]?.template.id !== "hostel") return false;
  const outage = outageAt(light.zone.index, total);
  return !!outage && total >= outage.start + generatorDelay(place, outage.start, SCREEN_SALT);
}

export function darkIndoors(place: number, t: GameTime): boolean {
  return place >= 0 && daylight(t.minute) < DARK_READING_DAYLIGHT && !placeLight(place, t.total).lit;
}

export function generatorRunning(place: number, total: number): boolean {
  const light = placeLight(place, total);
  return !light.nepa && light.generator;
}

export function darkShare(zone: number, dayIndex: number): number {
  let dark = 0;
  const from = dayIndex * MINUTES_PER_DAY;
  const near = [...outagesOn(zone, dayIndex - 1), ...outagesOn(zone, dayIndex)];
  for (let m = 0; m < MINUTES_PER_DAY; m++) if (near.some((o) => from + m >= o.start && from + m < o.end)) dark++;
  return dark / MINUTES_PER_DAY;
}
