import { DAYS, type GameTime } from "../clock";
import { PLACES, type Point } from "../map";
import type { BannerArt } from "../banner-art";
import { KINDS } from "./bill";
import { allShowsFor, calendarFor, type CalendarEvent } from "./calendar";
import { pitchMatchesFor, pitchTitle, pitchVenue, type PitchMatch } from "./league";
import { VIEWING_PLACES, matchesFor, type Match } from "./matches";
import { SOCIAL_SITES } from "../social/place";
import type { Show } from "./types";

export interface WhatsOnItem {
  id: string;
  type: "show" | "match" | "pitch" | "event";
  title: string;
  detail: string;
  venue: string;
  place: number;
  door: Point;
  dayIndex: number;
  start: number;
  startTotal: number;
  endTotal: number;
  fee: number;
  live: boolean;
  big: boolean;
  color: number;
  go?: Point;
}

const BANNER_DAYS = 2;
const WHATS_ON_DAYS = 2;
const MATCH_COLOR = 0x14532d;
const BIG_MATCH_COLOR = 0x7f1d1d;
const LIGHT_INK = 0xfdf6e3;
const DARK_INK = 0x1b1b1e;
const GOLD = 0xffd166;
const VIEWING_NAME = "viewing centre";
const BIG_KINDS = new Set<Show["kind"]>(["concert", "freshers", "dinner", "pageant"]);
const PITCH_COLOR = 0x166534;
const CUP_COLOR = 0x854d0e;
const FREE_TOUCHLINE = "Free at the touchline";
const FREE_OUTDOOR = "Free. Just show up.";
const PITCH_DAY = "FACULTY FOOTBALL";
const OUTDOOR_KINDS = new Set<CalendarEvent["kind"]>(["oldschool", "games", "signout", "gyration"]);

const SPOTS_AT: Record<PitchMatch["ground"], Point | undefined> = { sports: SOCIAL_SITES.benches.sports, bowl: SOCIAL_SITES.benches.bowl };
const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const dayName = (dayIndex: number) => DAYS[((dayIndex % 7) + 7) % 7].slice(0, 3);
const gate = (fee: number) => (fee > 0 ? `Gate ₦${fee.toLocaleString("en-NG")}` : "Free entry");
const luminance = (c: number) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

function nearestViewing(from?: Point): number {
  if (!from || !VIEWING_PLACES.length) return VIEWING_PLACES[0] ?? -1;
  return VIEWING_PLACES.reduce((best, i) => (Math.hypot(PLACES[i].door.x - from.x, PLACES[i].door.y - from.y) < Math.hypot(PLACES[best].door.x - from.x, PLACES[best].door.y - from.y) ? i : best));
}

function upcoming<T extends { endTotal: number; startTotal: number }>(t: GameTime, days: number, forDay: (dayIndex: number) => T[]): T[] {
  const out: T[] = [];
  for (let d = 0; d < days; d++) for (const item of forDay(t.dayIndex + d)) if (item.endTotal > t.total) out.push(item);
  return out.sort((a, b) => a.startTotal - b.startTotal);
}

export function showBanners(t: GameTime): BannerArt[] {
  const shows = upcoming(t, BANNER_DAYS, allShowsFor).map((s): BannerArt => {
    const ink = luminance(s.color) > 0.55 ? DARK_INK : LIGHT_INK;
    return {
      id: `show:${s.key}`,
      tone: "show",
      title: s.title,
      lines: [s.act, `${dayName(s.dayIndex)} ${clock(s.start)} · ${PLACES[s.place].name}`],
      footer: gate(s.fee),
      color: s.color,
      ink,
      accent: GOLD,
      weight: BIG_KINDS.has(s.kind) || s.special ? 3 : s.fee > 0 ? 2 : 1,
      near: s.place,
    };
  });
  const matches = upcoming(t, BANNER_DAYS, matchesFor)
    .filter((m) => m.tier !== "normal")
    .map((m): BannerArt => ({
      id: `match:${m.key}`,
      tone: "sport",
      title: "MATCH DAY",
      lines: [`${m.home.name} v ${m.away.name}`, `${m.competition} · ${dayName(m.dayIndex)} ${clock(m.kickoff)}`],
      footer: `Hall viewing centres · ${gate(m.fee)}`,
      color: m.tier === "final" ? BIG_MATCH_COLOR : MATCH_COLOR,
      ink: LIGHT_INK,
      accent: GOLD,
      weight: m.tier === "final" ? 3 : 2,
      near: VIEWING_PLACES.length ? VIEWING_PLACES[m.dayIndex % VIEWING_PLACES.length] : undefined,
    }));
  const pitch = upcoming(t, BANNER_DAYS, pitchMatchesFor).map((m): BannerArt => ({
    id: `pitch:${m.key}`,
    tone: "sport",
    title: m.stage === "league" ? PITCH_DAY : m.competition.toUpperCase(),
    lines: [pitchTitle(m, t.total), `${dayName(m.dayIndex)} ${clock(m.kickoff)} · ${pitchVenue(m)}`],
    footer: FREE_TOUCHLINE,
    color: m.stage === "league" || m.stage === "novelty" ? PITCH_COLOR : CUP_COLOR,
    ink: LIGHT_INK,
    accent: GOLD,
    weight: m.stage === "final" ? 3 : m.stage === "league" ? 1 : 2,
    near: m.place,
  }));
  const outdoor = upcoming(t, BANNER_DAYS, calendarFor)
    .filter((e) => OUTDOOR_KINDS.has(e.kind))
    .map((e): BannerArt => ({
      id: `event:${e.key}`,
      tone: "show",
      title: e.title,
      lines: [e.detail, `${dayName(e.dayIndex)} ${clock(e.start)} · ${e.where}`],
      footer: FREE_OUTDOOR,
      color: e.color,
      ink: luminance(e.color) > 0.55 ? DARK_INK : LIGHT_INK,
      accent: GOLD,
      weight: e.big ? 2 : 1,
      near: e.place,
    }));
  return [...shows, ...matches, ...pitch, ...outdoor];
}

function pitchItem(m: PitchMatch, t: GameTime): WhatsOnItem {
  const bench = SPOTS_AT[m.ground];
  return {
    id: m.key,
    type: "pitch",
    title: pitchTitle(m, t.total),
    detail: m.competition,
    venue: pitchVenue(m),
    place: m.place,
    door: PLACES[m.place].door,
    dayIndex: m.dayIndex,
    start: m.kickoff,
    startTotal: m.startTotal,
    endTotal: m.endTotal,
    fee: 0,
    live: t.total >= m.startTotal && t.total < m.endTotal,
    big: m.stage !== "league",
    color: m.stage === "league" || m.stage === "novelty" ? PITCH_COLOR : CUP_COLOR,
    go: bench,
  };
}

function eventItem(e: CalendarEvent, t: GameTime): WhatsOnItem {
  return {
    id: e.key,
    type: "event",
    title: e.title,
    detail: e.detail,
    venue: e.where,
    place: e.place,
    door: PLACES[e.place].door,
    dayIndex: e.dayIndex,
    start: e.start,
    startTotal: e.startTotal,
    endTotal: e.endTotal,
    fee: 0,
    live: t.total >= e.startTotal && t.total < e.endTotal,
    big: e.big,
    color: e.color,
    go: e.at,
  };
}

export function pitchOn(t: GameTime, days = WHATS_ON_DAYS): WhatsOnItem[] {
  return upcoming(t, days, pitchMatchesFor).map((m) => pitchItem(m, t));
}

export function eventsOn(t: GameTime, days = WHATS_ON_DAYS): WhatsOnItem[] {
  return upcoming(t, days, calendarFor).filter((e) => OUTDOOR_KINDS.has(e.kind)).map((e) => eventItem(e, t));
}

function matchItem(m: Match, t: GameTime, place: number): WhatsOnItem {
  const hall = PLACES[place];
  return {
    id: m.key,
    type: "match",
    title: `${m.home.name} v ${m.away.name}`,
    detail: m.competition,
    venue: `${hall.name} ${VIEWING_NAME}`,
    place,
    door: hall.door,
    dayIndex: m.dayIndex,
    start: m.kickoff,
    startTotal: m.startTotal,
    endTotal: m.endTotal,
    fee: m.fee,
    live: t.total >= m.startTotal && t.total < m.endTotal,
    big: m.tier !== "normal",
    color: m.tier === "final" ? BIG_MATCH_COLOR : MATCH_COLOR,
  };
}

export function whatsOn(t: GameTime, from?: Point): WhatsOnItem[] {
  const shows = upcoming(t, WHATS_ON_DAYS, allShowsFor).map((s): WhatsOnItem => ({
    id: s.key,
    type: "show",
    title: s.title,
    detail: `${KINDS[s.kind].label} · ${s.act}`,
    venue: PLACES[s.place].name,
    place: s.place,
    door: PLACES[s.place].door,
    dayIndex: s.dayIndex,
    start: s.start,
    startTotal: s.startTotal,
    endTotal: s.endTotal,
    fee: s.fee,
    live: t.total >= s.startTotal,
    big: BIG_KINDS.has(s.kind),
    color: s.color,
  }));
  const place = nearestViewing(from);
  const matches = place < 0 ? [] : upcoming(t, WHATS_ON_DAYS, matchesFor).map((m) => matchItem(m, t, place));
  return [...shows, ...matches, ...pitchOn(t), ...eventsOn(t)].sort((a, b) => a.startTotal - b.startTotal);
}
