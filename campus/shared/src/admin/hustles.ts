import type { GameTime } from "../clock";
import { INTERIORS, SPOTS, STALLS, interiorAt, type Stall } from "../interiors";
import { skillPay } from "../life";
import { PLACES, PX_PER_METER, nearBuilding, onRoad, type Point } from "../map";
import { isBlocked } from "../movement";
import { CONDITION_POINTS } from "../conditions/sites";
import { POLITICS_POINTS } from "../politics/sites";
import { sitesClear } from "../sites-clear";
import { SOCIAL_POINTS } from "../social/points";
import { randomFor } from "../academics/seed";
import { BED_HALLS } from "./hostel";
import type { AdminRecord, HustleId } from "./record";

const M = PX_PER_METER;

export interface HustleSpec {
  id: HustleId;
  icon: string;
  title: string;
  skill: string;
  start: string;
  where: string;
  how: string;
  seconds: number;
  basePay: number;
  energy: number;
  skillGain: number;
  dailyShifts: number;
  fromHour: number;
  toHour: number;
  weekdays: readonly number[];
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKEND = [5, 6];

export const HUSTLES: Record<HustleId, HustleSpec> = {
  typing: {
    id: "typing",
    icon: "📝",
    title: "Typing and printing",
    skill: "Typing",
    start: "Start shift: typing and printing",
    where: "Business centre",
    how: "Stand at any business centre kiosk and type assignments for students.",
    seconds: 30,
    basePay: 500,
    energy: 8,
    skillGain: 3,
    dailyShifts: 4,
    fromHour: 8,
    toHour: 20,
    weekdays: EVERY_DAY,
  },
  tray: {
    id: "tray",
    icon: "💸",
    title: "Recharge cards and data",
    skill: "Sales",
    start: "Sell recharge cards here",
    where: "Hostel front",
    how: "Stand with your tray in front of a hostel. Morning and evening rush pay more.",
    seconds: 25,
    basePay: 40,
    energy: 6,
    skillGain: 2,
    dailyShifts: 6,
    fromHour: 6,
    toHour: 23,
    weekdays: EVERY_DAY,
  },
  hair: {
    id: "hair",
    icon: "💼",
    title: "Hair and barbing",
    skill: "Hair",
    start: "Start shift: hair and barbing",
    where: "Any hostel room",
    how: "Make hair or barb inside a hostel on Saturday and Sunday.",
    seconds: 40,
    basePay: 1200,
    energy: 12,
    skillGain: 3,
    dailyShifts: 3,
    fromHour: 9,
    toHour: 19,
    weekdays: WEEKEND,
  },
};

export const HUSTLE_LIMITS = {
  reach: 3.5 * M,
  leave: 5 * M,
  energySpare: 5,
  maxSkill: 100,
} as const;

export const TRAY_TRAFFIC = {
  byHour: [0, 0, 0, 0, 0, 0, 7, 9, 6, 3, 3, 3, 4, 4, 3, 3, 5, 7, 9, 10, 9, 7, 5, 0],
  jitterMin: 0.6,
  jitterSpread: 0.8,
} as const;

const PITCH = { fromM: 8, toM: 18, stepM: 1, turns: 16, roadClearM: 1.5, buildingClearM: 1.5, stallClearM: 5 };
const CENTRE_NAME = /business centre/i;
const HOURS_PER_DAY = 24;

export const HUSTLE_TEXT = {
  place: (spec: HustleSpec) => `Go to ${spec.where.toLowerCase()} first.`,
  days: (spec: HustleSpec) => `${spec.title} na weekend work. Come back Saturday or Sunday.`,
  hours: (spec: HustleSpec) => `${spec.title} runs ${spec.fromHour}:00 to ${spec.toHour}:00.`,
  cap: (spec: HustleSpec) => `You don do ${spec.dailyShifts} shifts today. Body no be firewood.`,
  tired: "You too tire for this. Rest small first.",
  busy: "Finish what you dey do first.",
  started: (spec: HustleSpec) => `${spec.icon} Shift started. Stay here for ${spec.seconds} seconds.`,
  left: "You waka comot before the shift finish. No pay.",
  quiet: "Nobody buy this round. Try the morning or evening rush.",
  paid: (spec: HustleSpec, pay: number, pocket: number) => `💰 ${spec.title}: ₦${pay.toLocaleString("en-NG")}${pocket < pay ? ` (₦${(pay - pocket).toLocaleString("en-NG")} to your loan)` : ""}. ${spec.skill} skill up!`,
};

export const BUSINESS_CENTRES: readonly Stall[] = STALLS.filter((stall) => stall.roadside && CENTRE_NAME.test(stall.name));

const standOf = (stall: Stall): Point => ({ x: SPOTS[stall.spot].sx, y: SPOTS[stall.spot].sy });

export function nearestBusinessCentre(x: number, y: number): { index: number; at: Point; d: number } | undefined {
  let best: { index: number; at: Point; d: number } | undefined;
  BUSINESS_CENTRES.forEach((stall, index) => {
    const at = standOf(stall);
    const d = Math.hypot(at.x - x, at.y - y);
    if (!best || d < best.d) best = { index, at, d };
  });
  return best;
}

export function atBusinessCentre(x: number, y: number): boolean {
  if (interiorAt(x, y)) return false;
  const near = nearestBusinessCentre(x, y);
  return near !== undefined && near.d <= HUSTLE_LIMITS.reach;
}

const OTHER_SITES: readonly (readonly Point[])[] = [POLITICS_POINTS, CONDITION_POINTS, SOCIAL_POINTS];

function pitchFor(door: Point, taken: readonly Point[]): Point {
  const P = PITCH;
  for (let r = P.fromM; r <= P.toM; r += P.stepM) {
    for (let k = 0; k < P.turns; k++) {
      const a = (k / P.turns) * Math.PI * 2 + r;
      const x = door.x + Math.cos(a) * r * M;
      const y = door.y + Math.sin(a) * r * M;
      if (isBlocked(x, y) || onRoad(x, y, P.roadClearM * M) || nearBuilding(x, y, P.buildingClearM * M)) continue;
      if ([...STALLS, ...taken].some((s) => Math.hypot(s.x - x, s.y - y) < P.stallClearM * M) || !sitesClear(x, y, OTHER_SITES)) continue;
      return { x, y };
    }
  }
  return { ...door };
}

export const HOSTEL_PITCHES: readonly { place: number; name: string; at: Point }[] = BED_HALLS.reduce<{ place: number; name: string; at: Point }[]>((out, hall) => {
  out.push({ place: hall.place, name: hall.name, at: pitchFor(PLACES[hall.place].door, out.map((p) => p.at)) });
  return out;
}, []);

export function hustleSite(id: HustleId, x: number, y: number): number | undefined {
  const inside = interiorAt(x, y);
  if (id === "hair") return inside && INTERIORS[inside.place]?.template.id === "hostel" ? inside.place : undefined;
  if (inside) return undefined;
  if (id === "typing") {
    const near = nearestBusinessCentre(x, y);
    return near && near.d <= HUSTLE_LIMITS.reach ? near.index : undefined;
  }
  return HOSTEL_PITCHES.find((pitch) => Math.hypot(pitch.at.x - x, pitch.at.y - y) <= HUSTLE_LIMITS.reach)?.place;
}

export function trayCustomers(place: number, dayIndex: number, hour: number): number {
  const base = TRAY_TRAFFIC.byHour[((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY] ?? 0;
  const jitter = TRAY_TRAFFIC.jitterMin + randomFor(`tray:${place}:${dayIndex}:${hour}`)() * TRAY_TRAFFIC.jitterSpread;
  return Math.round(base * jitter);
}

export function hustlePay(id: HustleId, skill: number, site: number, t: GameTime): number {
  const spec = HUSTLES[id];
  const heads = id === "tray" ? trayCustomers(site, t.dayIndex, t.hour) : 1;
  return Math.round(spec.basePay * heads * skillPay(skill));
}

export const hustleShiftsToday = (record: AdminRecord, id: HustleId, dayIndex: number) => (record.hustle.day === dayIndex ? record.hustle.done[id] : 0);

export function hustleRefusal(id: HustleId, record: AdminRecord, t: GameTime, energy: number): string | undefined {
  const spec = HUSTLES[id];
  if (!spec.weekdays.includes(t.weekday)) return HUSTLE_TEXT.days(spec);
  if (t.hour < spec.fromHour || t.hour >= spec.toHour) return HUSTLE_TEXT.hours(spec);
  if (hustleShiftsToday(record, id, t.dayIndex) >= spec.dailyShifts) return HUSTLE_TEXT.cap(spec);
  if (energy < spec.energy + HUSTLE_LIMITS.energySpare) return HUSTLE_TEXT.tired;
  return undefined;
}

export function finishHustle(record: AdminRecord, id: HustleId, dayIndex: number) {
  if (record.hustle.day !== dayIndex) record.hustle = { day: dayIndex, done: { typing: 0, tray: 0, hair: 0 } };
  record.hustle.done[id]++;
  record.skills[id] = Math.min(HUSTLE_LIMITS.maxSkill, record.skills[id] + HUSTLES[id].skillGain);
}
