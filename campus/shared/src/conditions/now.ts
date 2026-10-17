import type { GameTime } from "../clock";
import type { Point } from "../map";
import { nextOutage, outageAt, placeLight } from "./power";
import { isJackingTime, isReadingRoom, nightIndex, npcReaders } from "./reading";
import { DRY_TAPS, dryMorning, isHostel } from "./water";
import { POWER_ZONES, powerZoneAt, powerZoneOfPlace, type PowerZone } from "./zones";

export type LightState = "nepa" | "generator" | "off";

export interface ConditionsNow {
  zone: PowerZone;
  light: LightState;
  lightText: string;
  waterText: string;
  dry: boolean;
  readingText: string;
}

export interface ZoneLight {
  zone: PowerZone;
  on: boolean;
  text: string;
}

const clock = (total: number) => {
  const minute = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};

const LIGHT_TEXT = {
  on: "Light dey",
  onTill: (at: number) => `Light dey. E fit go by ${clock(at)}`,
  off: (until: number) => `No light. NEPA should bring am by ${clock(until)}`,
  generator: (until: number) => `On gen till ${clock(until)}`,
  genSoon: (at: number) => `No light. Gen go start by ${clock(at)}`,
};
const WATER_TEXT = {
  dry: `No water for tap till ${clock(DRY_TAPS.to)}. Carry bucket go the standpipe`,
  flowing: "Water dey rush",
};
const READING_TEXT = {
  open: (readers: number) => `Night reading is on. ${readers} students dey jack here`,
  dark: "Reading room is dark. No light",
};
const SOON_MINUTES = 180;

export function zoneLight(zone: PowerZone, total: number): ZoneLight {
  const outage = outageAt(zone.index, total);
  if (outage) return { zone, on: false, text: LIGHT_TEXT.off(outage.end) };
  const next = nextOutage(zone.index, total);
  return { zone, on: true, text: next && next.start - total <= SOON_MINUTES ? LIGHT_TEXT.onTill(next.start) : LIGHT_TEXT.on };
}

export function campusLight(total: number): ZoneLight[] {
  return POWER_ZONES.map((zone) => zoneLight(zone, total));
}

export function conditionsNow(t: GameTime, place: number, at?: Point): ConditionsNow {
  const zone = place >= 0 ? powerZoneOfPlace(place) : at ? powerZoneAt(at.x, at.y) : POWER_ZONES[0];
  const street = zoneLight(zone, t.total);
  let light: LightState = street.on ? "nepa" : "off";
  let lightText = street.text;
  if (place >= 0 && !street.on) {
    const inside = placeLight(place, t.total);
    if (inside.generator && inside.until !== undefined) {
      light = "generator";
      lightText = LIGHT_TEXT.generator(inside.until);
    } else if (inside.generatorAt !== undefined) lightText = LIGHT_TEXT.genSoon(inside.generatorAt);
  }
  const dry = zone.hostel && t.minute >= DRY_TAPS.from && t.minute < DRY_TAPS.to && dryMorning(zone.index, t.dayIndex);
  const waterText = zone.hostel || (place >= 0 && isHostel(place)) ? (dry ? WATER_TEXT.dry : WATER_TEXT.flowing) : "";
  let readingText = "";
  if (place >= 0 && isReadingRoom(place) && isJackingTime(t.minute)) readingText = light === "off" ? READING_TEXT.dark : READING_TEXT.open(npcReaders(place, nightIndex(t)));
  return { zone, light, lightText, waterText, dry, readingText };
}
