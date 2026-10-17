// lib/clock.js
// The migrated campus clock uses two real seconds per game minute.
// Server time is the only clock that counts.
// The clock's start date almost never changes, so the running app reads it from the database once a minute instead of on every
// request (a single player action used to read it five or six times). Tests and scripts have no globalThis.db, so they always
// read the real clock.
import { weekAt, CAMPUS_MINUTE_MS } from "./campus-clock.js";
const DAY = 86_400_000;
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

export async function currentWeek(db) {
  const now = Date.now();
  return weekAt(await startedAt(db, now), now);
}

/** The in-game day that `now` falls in, counted from the campus epoch. Times are ms. */
export async function dayWindow(db, now = Date.now()) {
  const c = await startedAt(db, now), t = new Date(c.campusEpoch ?? c.startedAt).getTime(), dayMs = c.campusEpoch ? CAMPUS_MINUTE_MS * 1440 : DAY, i = Math.floor((now - t) / dayMs);
  return { day: i + 1, start: t + i * dayMs, end: t + (i + 1) * dayMs };
}
