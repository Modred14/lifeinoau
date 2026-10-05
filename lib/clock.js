// lib/clock.js
// 1 real day = 1 game week. Server time is the only clock that counts.
const DAY = 86_400_000;
export async function currentWeek(db) {
  const c = await db.gameClock.findUnique({ where: { id: 1 } });
  if (!c) throw new Error("GameClock not seeded");
  return Math.floor((Date.now() - c.startedAt.getTime()) / DAY) + 1;
}
