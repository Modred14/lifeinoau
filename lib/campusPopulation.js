// lib/campusPopulation.js
// THE CAMPUS POPULATION SHOWN IN THE HEADER ("6,248 people on campus"). Pure rules, no database and no server-only imports, so they are easy to test and
// safe to import in the browser too. lib/campusPopulationService.js loads and writes the numbers; docs/CAMPUS-POPULATION.md explains the whole feature.
//
//   people on campus  =  BASE_POPULATION  +  registered accounts  +  today's simulated arrivals
//
// * BASE_POPULATION is simulated (the students, staff and visitors who are "always there").
// * Registered accounts are the REAL accounts (lib/campusPopulationService.js: registeredAccounts). They are added once. Players who are online right now are
//   deliberately NOT added again: every one of them is already a registered account, so adding them would count the same person twice.
// * Today's simulated arrivals grow by a random 11 to 22 each time a real player genuinely enters the game, and start again from 0 on the next calendar day
//   in the game's time zone (West Africa Time, lib/campus-clock.js).
//
// Simulated numbers live in their own tables (CampusArrivalDay, CampusEntry). They are never mixed into real accounts or analytics, and real data is never
// changed by them. Do not "improve" that: see the rules at the end of docs/CAMPUS-POPULATION.md before changing anything here.
import { GAME_TIME_ZONE } from "./campus-clock.js";

export const BASE_POPULATION = 5000;
/** Each counted game entry adds a whole number from ARRIVAL_MIN to ARRIVAL_MAX, both included. The number is drawn on the server, never sent by a browser. */
export const ARRIVAL_MIN = 11;
export const ARRIVAL_MAX = 22;
/**
 * What makes an entry "genuine": a player's entry is counted at most once per cool-down. A refresh, a retry, a second tab, a reconnect or a repeated request
 * inside the cool-down adds nothing, whatever the browser sends. Change it with CAMPUS_ENTRY_COOLDOWN_MIN (minutes).
 */
export const ENTRY_COOLDOWN_MS = 30 * 60_000;

const num = (v, ok, fallback) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && ok(n) ? n : fallback; };

/** The cool-down in force: ENTRY_COOLDOWN_MS, or CAMPUS_ENTRY_COOLDOWN_MIN minutes when that holds a sensible value (1 to 1440). */
export function entryCooldownMs(env = typeof process !== "undefined" ? process.env : {}) {
  return Math.round(num(env.CAMPUS_ENTRY_COOLDOWN_MIN, (n) => n >= 1 && n <= 1440, ENTRY_COOLDOWN_MS / 60_000) * 60_000);
}

/** The calendar day of `at` in the game's time zone, as "2026-11-20". This is the key the daily arrivals are stored under, so the day rolls over at game midnight. */
export function dayKey(at = Date.now(), zone = GAME_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(+at));
}

/** A whole number from ARRIVAL_MIN to ARRIVAL_MAX inclusive. `draw(min, max)` must return a whole number from min to max inclusive (the server passes its secure generator). */
export function arrivalSize(draw) {
  const n = draw(ARRIVAL_MIN, ARRIVAL_MAX);
  if (!Number.isInteger(n) || n < ARRIVAL_MIN || n > ARRIVAL_MAX) throw new Error(`arrival out of range: ${n}`);
  return n;
}

const count = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/** The number in the header. registered and arrivals come from the database (anything that is not a positive number counts as 0). */
export const populationOf = ({ registered = 0, arrivals = 0 } = {}) => BASE_POPULATION + count(registered) + count(arrivals);

/** "6,248 people on campus" (the same grouping everywhere, whatever language the phone is set to). */
export const formatPeople = (n) => `${formatCount(n)} people on campus`;
export const formatCount = (n) => count(n).toLocaleString("en-US");
