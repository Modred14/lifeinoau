// lib/discipline.js
// Academic discipline, Floor O (N-QRS Custody) and the daily energy refill, in one place.
//
// Everything here is REAL time and lives in the database as absolute timestamps. Nothing depends on a timer, a browser, or a process staying up:
//   suspension  at most 2 real hours      suspendedAt / suspendedUntil
//   expulsion   at most 5 real hours      expelledAt  / expelledUntil, then the player starts again at 100L
//   custody     the sentence in FloorZero  jailedUntil, held at placeId "floor0" the whole time
//   energy      refilled once per in-game day (24 real hours from the clock's epoch)   energyRefilledAt
// Whether a penalty is active is always decided by comparing its stored deadline with the server's clock (isSuspended, isExpelled, isJailed),
// so an expired penalty can never stay active, and no refresh or API call can shorten or skip a running one. `settleInTx` then tidies the
// rows (clears the expired fields, releases the prisoner, restarts the expelled player, refills energy) the first time the player is touched.
import { currentWeek, dayWindow } from "./clock.js";
import { waitText } from "./engine.js";

export const HOUR_MS = 3_600_000;
export const SUSPENSION_MS = 2 * HOUR_MS;
export const EXPULSION_MS = 5 * HOUR_MS;
/** The map place id of Floor O. Players serving a sentence are held here. */
export const CUSTODY_PLACE = "floor0";
export const CUSTODY_NAME = "Floor O (N-QRS Custody)";
/** After an expulsion ends the player starts again at this level. */
export const RESTART_LEVEL = 100;

const ms = (d) => (d == null ? null : +new Date(d));

// ---- is it active right now? (pure: the stored deadline against `now`) ----
export const isJailed = (c, now = Date.now()) => ms(c?.jailedUntil) > now;
export const isSuspended = (c, now = Date.now()) => ms(c?.suspendedUntil) > now;
/** Expelled and the period has not ended. An expelled row with no deadline yet counts as expelled until settleInTx gives it one. */
export const isExpelled = (c, now = Date.now()) => !!c?.expelled && (c.expelledUntil == null || ms(c.expelledUntil) > now);
/** Anything that keeps the player from roaming, working, travelling or spending. (Custody is checked separately because bail is allowed.) */
export const isRestricted = (c, now = Date.now()) => isJailed(c, now) || isSuspended(c, now) || isExpelled(c, now);

// ---- the fields to write when a penalty starts ----
/** A suspension starting at `now`. A suspension already running is never extended: it is 2 hours at most. */
export const suspensionFields = (now, c = null) => (c && isSuspended(c, now) ? {} : { suspendedAt: new Date(now), suspendedUntil: new Date(now + SUSPENSION_MS) });
export const expulsionFields = (now) => ({ expelled: true, expelledAt: new Date(now), expelledUntil: new Date(now + EXPULSION_MS) });
/** The player's own row when they are taken into custody: held at Floor O, off the road, until `releaseAt`. */
export const custodyFields = (now, releaseAt) => ({ jailedUntil: releaseAt, placeId: CUSTODY_PLACE, placeAt: new Date(now), inPlace: "", inX: null, inZ: null, inAt: null, tripAt: null, tripMode: "", tripX: null, tripZ: null, tripH: null });

// ---- what to tell the player ----
export const jailedMessage = (c, now = Date.now()) => `You are in ${CUSTODY_NAME} for another ${waitText(ms(c.jailedUntil) - now)}. Pay the bail or wait out your sentence.`;
export const suspendedMessage = (c, now = Date.now()) => `You are suspended for another ${waitText(ms(c.suspendedUntil) - now)}.`;
export const expelledMessage = (c, now = Date.now()) => `You have been expelled. You can start again from ${RESTART_LEVEL}L in ${c.expelledUntil == null ? waitText(EXPULSION_MS) : waitText(ms(c.expelledUntil) - now)}.`;

// ---- what is due ----
/** Which housekeeping is due for this row (pure). `dayStart` is the start (ms) of the current in-game day. */
export function dueFor(c, now, dayStart) {
  const exp = !!c.expelled;
  return {
    jail: c.jailedUntil != null && ms(c.jailedUntil) <= now,
    suspension: c.suspendedUntil != null && ms(c.suspendedUntil) <= now,
    expulsionStart: exp && c.expelledUntil == null,
    expulsionEnd: exp && c.expelledUntil != null && ms(c.expelledUntil) <= now,
    energy: !exp && (c.energyRefilledAt == null || ms(c.energyRefilledAt) < dayStart),
  };
}
export const anyDue = (d) => Object.values(d).some(Boolean);

/** The columns settling needs, for the cheap "is anything due?" read. */
export const DUE_SELECT = { id: true, jailedUntil: true, suspendedUntil: true, expelled: true, expelledUntil: true, energyRefilledAt: true };

/**
 * Apply everything that is due to a character row that is LOCKED in this transaction, and make `c` match the database afterwards.
 *   jail over        release (the row and the FloorZero record); the player stays at Floor O's gate, free to leave
 *   suspension over  cleared
 *   expulsion over   the player starts again: level 100, a fresh session and exam count from this week, no strikes or failed sessions,
 *                    CGPA counted from here (older exam results are KEPT, they just stop counting). Account, money, businesses,
 *                    relationships, messages, achievements and every other record are untouched.
 *   a new day        energy back to 100
 */
export async function settleInTx(tx, c, { now, week, dayStart }) {
  const due = dueFor(c, now, dayStart);
  if (!anyDue(due)) return c;
  const data = {};
  if (due.jail) {
    data.jailedUntil = null;
    await tx.floorZero.updateMany({ where: { characterId: c.id, status: "JAILED", releaseAt: { lte: new Date(now) } }, data: { status: "SERVED" } });
  }
  if (due.suspension) {
    Object.assign(data, { suspendedAt: null, suspendedUntil: null });
    await tx.notification.create({ data: { characterId: c.id, kind: "ACADEMIC", body: "Your suspension is over. Welcome back." } });
  }
  if (due.expulsionStart) Object.assign(data, { expelledAt: new Date(now), expelledUntil: new Date(now + EXPULSION_MS) });
  if (due.expulsionEnd) {
    Object.assign(data, {
      expelled: false, expelledAt: null, expelledUntil: null, suspendedAt: null, suspendedUntil: null,
      level: RESTART_LEVEL, sessionStartWeek: week, joinedWeek: week, restartWeek: week, failedSessions: 0, strikes: 0,
      lastTickWeek: week, missedCallStreak: 0, lastParentCallWeek: week - 1, // nothing to catch up on for the weeks away, and no "missed call" penalty
    });
    // Only the progress of the session that starts now is cleared (it may share its start week with the aborted one). Past sessions stay.
    await tx.courseProgress.deleteMany({ where: { characterId: c.id, sessionStartWeek: week } });
    await tx.notification.create({ data: { characterId: c.id, kind: "ACADEMIC", body: `Your expulsion is over. You are starting again from ${RESTART_LEVEL}L. Your money, home and relationships are as you left them.` } });
  }
  if (due.energy || due.expulsionEnd) Object.assign(data, { energy: 100, energyRefilledAt: new Date(now) });
  await tx.character.update({ where: { id: c.id }, data });
  return Object.assign(c, data);
}

/**
 * The same, for a player we are only reading (their state, a login): one cheap read, and a locked transaction only when something is
 * actually due. `known` is a row the caller has already read (it needs the DUE_SELECT columns). Returns true when something changed.
 */
export async function settleCharacter(db, characterId, { now = Date.now(), known = null } = {}) {
  const day = await dayWindow(db, now);
  const pre = known ?? await db.character.findUnique({ where: { id: characterId }, select: DUE_SELECT });
  if (!pre || !anyDue(dueFor(pre, now, day.start))) return false;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${characterId} FOR UPDATE`;
    const c = await tx.character.findUnique({ where: { id: characterId } });
    if (!c) return false;
    await settleInTx(tx, c, { now, week: await currentWeek(tx), dayStart: day.start });
    return true; // another request may have settled it first, in which case this was a harmless no-op
  });
}