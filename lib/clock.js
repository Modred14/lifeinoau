// lib/clock.js
// The game clock is strictly 1:1 with real time (see lib/campus-clock.js). Server time is the only clock that counts: nothing here reads a
// time sent by a browser, and every deadline in the game is stored as an absolute timestamp, never as a timer.
// The clock's start date almost never changes, so the running app reads it from the database once a minute instead of on every
// request (a single player action used to read it five or six times). Tests and scripts have no globalThis.db, so they always
// read the real clock.
import { weekAt, GAME_DAY_MS, gameMidnightAtOrBefore } from "./campus-clock.js";
const DAY = GAME_DAY_MS;
const TTL = 60_000;
let shared = null; // { at, t }

/** When the game clock started (ms). Cached like the week: it almost never changes. */
async function startedAt(db, now) {
  const app = !!globalThis.db;
  let e = app ? shared : null;
  if (!e || now - e.at > TTL) {
    const c = await db.gameClock.findUnique({ where: { id: 1 } });
    if (!c) throw new Error("GameClock not seeded");
    e = { at: now, clock: c };
    if (app) shared = e;
  }
  return e.clock;
}

/** The authoritative "now" (ms): the app server's clock. The one place to change if time ever has to come from somewhere else (the database, say). */
export const serverNow = () => Date.now();

export async function currentWeek(db) {
  const now = Date.now();
  return weekAt(await startedAt(db, now), now);
}

/**
 * The in-game day that `now` falls in. A game day runs from one game midnight (12:00 AM West Africa Time, see lib/campus-clock.js) to the next, so
 * `day.start` is exactly where the clock on every screen reads 12:00 AM, and "minutes into the day" (gameMinuteOfDay) agrees with it. Day 1 is the day
 * the clock's epoch falls in; days are counted from there. Times are ms.
 */
export async function dayWindow(db, now = Date.now()) {
  const c = await startedAt(db, now), first = gameMidnightAtOrBefore(new Date(c.campusEpoch ?? c.startedAt).getTime());
  const start = gameMidnightAtOrBefore(now), end = gameMidnightAtOrBefore(start + DAY * 1.5);
  return { day: Math.round((start - first) / DAY) + 1, start, end };
}