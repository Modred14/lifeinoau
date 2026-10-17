import { EVENTS, MINUTES_PER_DAY } from "../clock";
import { KINDS, MOMENT_TEXT, type MomentId } from "./bill";
import { between, pick, seeded, type Rand } from "./seed";
import { RESERVED_SLOTS, SHOW_PARTY_GAP, VENUE_PLACE, type Show, type ShowKind, type ShowMoment, type VenueId } from "./types";

interface Slot {
  venue: VenueId;
  weekday: number;
  start: number;
  end: number;
  kinds: readonly ShowKind[];
}

const at = (hour: number, minute = 0) => hour * 60 + minute;

export const SHOW_SLOTS: readonly Slot[] = [
  { venue: "amphi", weekday: 0, start: at(19), end: at(21, 30), kinds: ["talent", "comedy"] },
  { venue: "amphi", weekday: 1, start: at(19), end: at(21, 30), kinds: ["carnival", "concert"] },
  { venue: "amphi", weekday: 2, start: at(19), end: at(22), kinds: ["concert", "comedy"] },
  { venue: "amphi", weekday: 4, start: at(16, 30), end: at(20, 30), kinds: ["freshers", "concert"] },
  { venue: "amphi", weekday: 5, start: at(15, 30), end: at(20, 30), kinds: ["concert", "carnival"] },
  { venue: "amphi", weekday: 6, start: at(16), end: at(19), kinds: ["gospel"] },
  { venue: "amphi", weekday: 6, start: at(20), end: at(22, 30), kinds: ["movie"] },
  { venue: "oduduwa", weekday: 0, start: at(16), end: at(18), kinds: ["lecture"] },
  { venue: "oduduwa", weekday: 1, start: at(19), end: at(21, 30), kinds: ["play"] },
  { venue: "oduduwa", weekday: 2, start: at(17), end: at(19, 30), kinds: ["quiz", "lecture"] },
  { venue: "oduduwa", weekday: 3, start: at(18), end: at(21), kinds: ["gospel", "play"] },
  { venue: "oduduwa", weekday: 4, start: at(17), end: at(20, 30), kinds: ["dinner"] },
  { venue: "oduduwa", weekday: 5, start: at(16, 30), end: at(20, 30), kinds: ["pageant", "dinner"] },
  { venue: "oduduwa", weekday: 6, start: at(17), end: at(19, 30), kinds: ["play", "movie"] },
];

const OPENER_AT = 3;
const MOMENT_WINDOW = [0.2, 0.85] as const;
const MOMENTS_PER_SHOW = [2, 3] as const;
const CACHE_DAYS = 32;

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

function blocked(slot: Slot): boolean {
  if (RESERVED_SLOTS.some((r) => r.venue === slot.venue && r.weekday === slot.weekday && overlaps(slot.start, slot.end, r.start, r.end))) return true;
  return EVENTS.some((e) => e.id === "party" && e.weekdays.includes(slot.weekday) && overlaps(slot.start, slot.end + SHOW_PARTY_GAP, e.start, e.end));
}

function momentsFor(rand: Rand, kind: ShowKind, act: string, length: number): ShowMoment[] {
  const spec = KINDS[kind];
  const say = (id: MomentId, when: number): ShowMoment => ({ at: when, text: MOMENT_TEXT[id].text.replace("{act}", act), fun: MOMENT_TEXT[id].fun });
  const out: ShowMoment[] = spec.opener ? [say(spec.opener, OPENER_AT)] : [];
  const pool = [...spec.moments];
  const count = Math.min(pool.length, between(rand, MOMENTS_PER_SHOW[0], MOMENTS_PER_SHOW[1]));
  const span = (MOMENT_WINDOW[1] - MOMENT_WINDOW[0]) / count;
  for (let i = 0; i < count; i++) {
    const id = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    out.push(say(id, Math.round(length * (MOMENT_WINDOW[0] + span * (i + rand() * 0.8)))));
  }
  return out.sort((a, b) => a.at - b.at);
}

const cache = new Map<number, Show[]>();

export function showsFor(dayIndex: number): Show[] {
  const hit = cache.get(dayIndex);
  if (hit) return hit;
  const weekday = ((dayIndex % 7) + 7) % 7;
  const out: Show[] = [];
  SHOW_SLOTS.forEach((slot, index) => {
    const place = VENUE_PLACE[slot.venue];
    if (slot.weekday !== weekday || place < 0 || blocked(slot)) return;
    const rand = seeded(dayIndex * 53 + index * 7 + 5);
    const kind = pick(rand, slot.kinds);
    const spec = KINDS[kind];
    const act = pick(rand, spec.acts);
    out.push({
      key: `${dayIndex}:${index}`,
      kind,
      title: pick(rand, spec.titles),
      act,
      venue: slot.venue,
      place,
      dayIndex,
      start: slot.start,
      end: slot.end,
      startTotal: dayIndex * MINUTES_PER_DAY + slot.start,
      endTotal: dayIndex * MINUTES_PER_DAY + slot.end,
      fee: pick(rand, spec.fees),
      fun: spec.fun,
      color: pick(rand, spec.colors),
      dance: spec.dance,
      moments: momentsFor(rand, kind, act, slot.end - slot.start),
    });
  });
  out.sort((a, b) => a.start - b.start);
  if (cache.size >= CACHE_DAYS) cache.clear();
  cache.set(dayIndex, out);
  return out;
}
