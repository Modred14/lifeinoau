// lib/clock.js
// 1 real day = 1 game day, so one game week (the game's unit for exams, pay, rent and the market) is 7 real days.
// Server time is the only clock that counts.
const DAY = 86_400_000;
const WEEK = 7 * DAY;
export async function currentWeek(db) {
  const c = await db.gameClock.findUnique({ where: { id: 1 } });
  if (!c) throw new Error("GameClock not seeded");
  return Math.floor((Date.now() - c.startedAt.getTime()) / WEEK) + 1;
}