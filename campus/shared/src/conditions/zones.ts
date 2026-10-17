import { interiorAt } from "../interiors";
import { PLACES } from "../map";

export type PowerZoneId = "academics" | "science" | "centre" | "awo" | "anglomoz" | "fajuyi" | "moremi";

export interface PowerZone {
  id: PowerZoneId;
  index: number;
  name: string;
  hostel: boolean;
}

const ZONE_NAMES: [PowerZoneId, string, boolean][] = [
  ["academics", "Academics", false],
  ["science", "Science and Tech", false],
  ["centre", "SUB and banks", false],
  ["awo", "Awo and ETF", true],
  ["anglomoz", "Anglo-Moz", true],
  ["fajuyi", "Fajuyi and PG Hall", true],
  ["moremi", "Moremi and Alumni", true],
];

const ZONE_RULES: [PowerZoneId, RegExp][] = [
  ["anglomoz", /angola|mozambique/i],
  ["awo", /awolowo|etf/i],
  ["fajuyi", /fajuyi|postgraduate/i],
  ["moremi", /moremi|alumni/i],
  ["science", /engineering|technology|science lab|pharmacy|hslt|geology|chemical|pg lt|booc|ajose|coker/i],
  ["academics", /lecture thea|library|faculty|senate|^aud |amphi|oduduwa|white house/i],
  ["centre", /student union|bank|buka|sports|squash|main bowl|main gate|petrol|restaurant|spectra|white hands|^uba$|church|rccg|eruobodo/i],
];

const DEFAULT_ZONE: PowerZoneId = "academics";

export const POWER_ZONES: readonly PowerZone[] = ZONE_NAMES.map(([id, name, hostel], index) => ({ id, index, name, hostel }));

const BY_ID = new Map(POWER_ZONES.map((z) => [z.id, z]));

export const powerZone = (id: PowerZoneId): PowerZone => BY_ID.get(id) ?? POWER_ZONES[0];

const HOSTEL_ZONES = PLACES.flatMap((p) => {
  const rule = ZONE_RULES.find(([, re]) => re.test(p.name));
  const zone = rule ? powerZone(rule[0]) : undefined;
  return p.kind === "hostel" && zone?.hostel ? [{ place: p, zone }] : [];
});

const PLACE_ZONE: PowerZone[] = PLACES.map((p) => {
  const rule = ZONE_RULES.find(([, re]) => re.test(p.name));
  const zone = powerZone(rule?.[0] ?? DEFAULT_ZONE);
  if (p.kind !== "hostel" || zone.hostel || !HOSTEL_ZONES.length) return zone;
  return HOSTEL_ZONES.reduce((nearest, candidate) =>
    Math.hypot(candidate.place.door.x - p.door.x, candidate.place.door.y - p.door.y) < Math.hypot(nearest.place.door.x - p.door.x, nearest.place.door.y - p.door.y) ? candidate : nearest
  ).zone;
});

export function powerZoneOfPlace(place: number): PowerZone {
  return PLACE_ZONE[place] ?? powerZone(DEFAULT_ZONE);
}

export function powerZoneAt(x: number, y: number): PowerZone {
  const inside = interiorAt(x, y);
  if (inside) return powerZoneOfPlace(inside.place);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < PLACES.length; i++) {
    const d = (PLACES[i].door.x - x) ** 2 + (PLACES[i].door.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return powerZoneOfPlace(best);
}

export function placesInZone(id: PowerZoneId): number[] {
  const out: number[] = [];
  PLACE_ZONE.forEach((z, i) => {
    if (z.id === id) out.push(i);
  });
  return out;
}
