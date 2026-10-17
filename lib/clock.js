// lib/clock.js
// 1 real day = 1 game day, so one week (the game's unit for exams, pay, rent and the market) is 7 real days.
// Server time is the only clock that counts.
// The clock's start date almost never changes, so the running app reads it from the database once a minute instead of on every
// request (a single player action used to read it five or six times). Tests and scripts have no globalThis.db, so they always
// read the real clock.
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const TTL = 60_000;
let shared = null; // { at, t }

/** When the game clock started (ms). Cached like the week: it almost never changes. */
async function startedAt(db, now) {
  const app = !!globalThis.db;
  let e = app ? shared : null;
  if (!e || now - e.at > TTL) {
    const c = await db.gameClock.findUnique({ where: { id: 1 } });
    if (!c) throw new Error("GameClock not seeded");
    e = { at: now, t: c.startedAt.getTime() };
    if (app) shared = e;
  }
  return e.t;
}

export async function currentWeek(db) {
  const now = Date.now();
  return Math.floor((now - (await startedAt(db, now))) / WEEK) + 1;
}

/** The in-game day that `now` falls in: 1 real day = 1 game day, counted from the same start as the weeks. Times are ms. */
export async function dayWindow(db, now = Date.now()) {
  const t = await startedAt(db, now), i = Math.floor((now - t) / DAY);
  return { day: i + 1, start: t + i * DAY, end: t + (i + 1) * DAY };
}