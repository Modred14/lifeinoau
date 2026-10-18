// lib/sleepService.js: lying down in your own bed and waking up. The server keeps the moment you lay down; waking works out the rest.
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { isJailed } from "./discipline.js";
import { SLEEP, BED_KEYS, wakeResult, sleepBlock, msToFull, sleepRate } from "./sleep.js";

const now = () => Date.now();

/** Bed the player owns and has placed in their room, or null. */
async function ownBed(tx, characterId, bedId) {
  if (bedId == null || !/^\d{1,18}$/.test(String(bedId))) return null;
  const it = await tx.roomItem.findFirst({ where: { id: BigInt(bedId), characterId, placed: true } });
  return it && BED_KEYS.includes(it.key) ? it : null;
}
const activeShift = (tx, characterId) => tx.jobShift.findFirst({ where: { characterId, status: "ACTIVE", endsAt: { gt: new Date(now()) } } });

export async function getSleep(db, userId) {
  const c = await db.character.findUnique({ where: { userId } });
  if (!c) throw new GameError("Create a character first.", 404);
  return { serverNow: now(), sleeping: !!c.sleepingSince, bedId: c.sleepingBed ?? null, since: c.sleepingSince?.toISOString() ?? null, energy: c.energy, perSecond: SLEEP.perSecond, durationMs: SLEEP.durationMs };
}

export async function startSleep(db, userId, { bedId, requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true }); // jailed is checked below with a clearer message
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "sleep", gameWeek: week } }); // P2002 on replay
      const bed = await ownBed(tx, c.id, bedId);
      if (!bed) throw new GameError("Go to a bed in your own room to sleep.", 403);
      const why = sleepBlock(c, { asleep: !!c.sleepingSince, jailed: isJailed(c, now()), shift: !!(await activeShift(tx, c.id)), hustling: !!(await tx.hustleRun.findFirst({ where: { characterId: c.id, status: "ACTIVE" } })) });
      if (why) throw new GameError(why, 409);
      const t = new Date(now());
      await tx.character.update({ where: { id: c.id }, data: { sleepingSince: t, sleepingBed: String(bed.id) } });
      return { ok: true, since: t.toISOString(), serverNow: +t, bedKey: bed.key, perSecond: sleepRate(c, bed.key), msToFull: msToFull(c, bed.key), durationMs: SLEEP.durationMs };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}

/** Wake up. The energy comes from the time the SERVER saw you lie down, never from the browser.
 *  The grace forgives the request's own travel time, so a sleep the screen showed as finished is finished here too. */
export async function wake(db, userId, { requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true, allowSuspended: true });
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "wake", gameWeek: week } });
      if (!c.sleepingSince) return { ok: true, awake: true, restored: 0, energy: c.energy };
      // the bed comes from what the server stored when the player lay down, not from this request
      const bed = await ownBed(tx, c.id, c.sleepingBed), r = wakeResult(c, bed?.key ?? "single_bed", +c.sleepingSince, now(), SLEEP.graceMs);
      await tx.character.update({ where: { id: c.id }, data: { sleepingSince: null, sleepingBed: null, energy: r.energy, health: r.health } });
      return { ok: true, seconds: r.seconds, minutes: r.minutes, restored: r.restored, energy: r.energy, health: r.health, rested: r.rested };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}