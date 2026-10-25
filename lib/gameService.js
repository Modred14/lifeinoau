// lib/gameService.js
import { currentWeek, dayWindow, serverNow } from "./clock.js";
import { settleInTx, settleCharacter, isJailed, isSuspended, isExpelled, jailedMessage, suspendedMessage, expelledMessage, suspensionFields, expulsionFields, custodyFields, CUSTODY_PLACE, CUSTODY_NAME } from "./discipline.js";
import { catchUp } from "./tick.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { resolveAction, resolveCall, resolveRisky, resolveExam, cgpa, classify, SESSION_WEEKS, arrestStats, bailFor, seizureFor, riskyJailMinutes, escalate, HUSTLE, hustleStatus, hustleBlock } from "./engine.js";
import { roll } from "./rng.js";
import { VENUES, partyFor, resolveNight } from "./parties.js";
import { coursesFor } from "./curriculum.js";
import { resolveCourseExam } from "./courses.js";
import { syncAchievements, earnedTitles, markAchievementsDirty } from "./achievementService.js";
import { cached, invalidate, scopeOf } from "./cache.js";
import { unreadNotes } from "./notifications.js";
import { activeIncident } from "./lectureIncident.js";
import { STARTING_ALLOWANCE, allowedHostels, P2P, feeFor, cleanText, transferCooldownRemaining } from "./rules.js";
import { netWorthOf } from "./bankRules.js"; // the one definition of net worth (cash + savings + business + investments)
import * as chat from "./chatCore.js";
import { settingsOf } from "./settings.js";
import { titleFor } from "./sugRoles.js"; // the Students' Union office a player holds right now (clock-checked), shown beside their name

export class GameError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

/**
 * The one guard every state-changing action goes through. Locks the player's row (one action at a time per player), settles anything whose
 * deadline has passed (a finished sentence, suspension or expulsion, the daily energy refill), then refuses by the stored deadlines and the
 * server's clock alone: expelled and suspended players cannot act, and a player in Floor O (N-QRS Custody) cannot act either unless the
 * caller allows it (paying bail, settling a game already in play). Nothing the browser sends can change the answer.
 */
export async function loadLocked(tx, userId, { allowJailed = false, allowSuspended = false } = {}) {
  const base = await tx.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${base.id} FOR UPDATE`; // one action at a time per player
  const c = await tx.character.findUnique({ where: { id: base.id }, include: { account: true, faculty: true } });
  if (!c.hostel) throw new GameError("Choose where to live first.", 409);
  const now = serverNow();
  await settleInTx(tx, c, { now, week: await currentWeek(tx), dayStart: (await dayWindow(tx, now)).start });
  if (isExpelled(c, now)) throw new GameError(expelledMessage(c, now), 403);
  markAchievementsDirty(c.id); // this action may change cash or stats: the next state read re-checks achievements
  if (isSuspended(c, now) && !allowSuspended) throw new GameError(suspendedMessage(c, now), 403);
  if (isJailed(c, now) && !allowJailed) throw new GameError(jailedMessage(c, now), 403);
  return c;
}

/**
 * Where the player stands with the hustle limits right now (see hustleStatus in lib/engine.js). The rows come from the ActionLog, which is
 * written in the same transaction as the hustle itself, so a hustle that failed never counts. `skipRequestId` leaves out the request
 * being processed (its row is already written when the check runs).
 */
export async function hustleToday(db, characterId, skipRequestId) {
  const now = Date.now(), day = await dayWindow(db, now);
  const rows = await db.actionLog.findMany({ where: { characterId, action: { in: ["hustle", "risky"] }, createdAt: { gte: new Date(Math.min(day.start, now - HUSTLE.safe.gapMs)) } },
    select: { action: true, createdAt: true, requestId: true } });
  return hustleStatus(rows.filter((r) => r.requestId !== skipRequestId), day.start, day.end);
}
/** Throws if this hustle is not allowed right now. The player's row is locked, so two quick requests cannot both pass. */
export async function guardHustle(tx, c, kind, requestId) {
  const why = hustleBlock(kind, await hustleToday(tx, c.id, requestId), Date.now());
  if (why) throw new GameError(why, 429);
}

export async function getState(db, userId) {
  // One read to get the character (the old code read it twice), then a settle that is a no-op unless a deadline has passed or a new day began,
  // then a catch-up that is a no-op unless a new week began. Time comes from the server only.
  let ch = await db.character.findUnique({ where: { userId }, include: { account: true, faculty: true } });
  if (!ch) throw new GameError("Create a character first.", 404);
  if (await settleCharacter(db, ch.id, { known: ch })) ch = await db.character.findUnique({ where: { id: ch.id }, include: { account: true, faculty: true } });
  const t = await catchUp(db, ch.id);
  if (t.processed) ch = await db.character.findUnique({ where: { id: ch.id }, include: { account: true, faculty: true } }); // the week moved: read it again
  const week = t.week, now = serverNow();
  const { account, faculty, userId: _u, ...rest } = ch;
  // Independent reads run side by side instead of one after another. Achievements are checked at most every 20 seconds per player
  // (and straight away after any action), then the unread notes are read so a fresh award still shows at once.
  const [rs, fz, notifications, hustle, lectureIncident] = await Promise.all([
    db.examResult.findMany({ where: { characterId: ch.id, gameWeek: { gte: ch.restartWeek ?? 0 } }, orderBy: { gameWeek: "desc" }, take: 100, // results from before a restart (after an expulsion) are kept but no longer count
      select: { gameWeek: true, level: true, score: true, gradePoint: true, cheated: true, caught: true, missed: true } }),
    isJailed(ch, now) ? db.floorZero.findFirst({ where: { characterId: ch.id, status: "JAILED" }, orderBy: { id: "desc" } }) : null,
    syncAchievements(db, ch.id, week, { maxAgeMs: 20_000 }).then(() => unreadNotes(db, ch.id)),
    hustleToday(db, ch.id),
    activeIncident(db, ch.id, now), // an N-QRS response that is still running: a screen that reconnects picks the sequence up where it is
  ]);
  const cw = week - ch.joinedWeek + 1, g = cgpa(rs.map((r) => r.gradePoint));
  const academics = { cgpa: g, standing: g == null ? null : classify(g), weeksLeftInSession: Math.max(0, ch.sessionStartWeek + SESSION_WEEKS - week),
    nextExamWeek: week + ((6 - (cw % 6)) % 6), satThisWeek: rs.some((r) => r.gameWeek === week), recent: rs.slice(0, 6) };
  // serverNow lets every screen show countdowns against the SERVER's clock, so two devices with different clocks still agree
  return { serverNow: now, week, notifications, hostels: ch.hostel ? null : allowedHostels(ch.class, ch.gender, ch.level), academics,
    // A player whose jailedUntil is still in the future is ALWAYS shown the custody screen, even if their FloorZero row is missing (old data, a half-finished arrest):
    // without this fallback the home screen found no `floorZero` and drew the room instead of Floor O.
    floorZero: fz ? { startedAt: fz.startedAt, releaseAt: fz.releaseAt, location: fz.location ?? CUSTODY_PLACE, billKobo: bailFor(fz.releaseAt, now).toString() }
      : isJailed(ch, now) ? { startedAt: null, releaseAt: ch.jailedUntil, location: CUSTODY_PLACE, billKobo: bailFor(ch.jailedUntil, now).toString() } : null,
    hustle, lectureIncident, character: { ...rest, faculty: faculty.name }, balanceKobo: account.balance.toString(), calledThisWeek: ch.lastParentCallWeek >= week };
}

/** One plain action (rest, hustle) for a player whose row is already locked. Shared by the home screen and the building activities (lib/activityService.js). */
export async function actionInTx(tx, c, name, requestId, week) {
  const r = resolveAction(c, name, roll);
  if (r.error) throw new GameError(r.error);
  const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
  const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } });
  const key = `act:${c.id}:${requestId}`;
  await tx.actionLog.create({ data: { characterId: c.id, requestId, action: name, gameWeek: week, createdAt: new Date(Date.now()) } }); // P2002 on replay
  if (name === "hustle") await guardHustle(tx, c, "safe", requestId); // twice per in-game day, 6 hours apart
  if (r.earn) await transferInTx(tx, { fromId: world.id, toId: c.account.id, amount: r.earn, memo: r.memo, key, week });
  if (r.spend) await transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount: r.spend, memo: r.memo, key, week });
  await tx.character.update({ where: { id: c.id }, data: r.stats });
  return { ok: true, name, stats: r.stats, earnedKobo: (r.earn ?? 0n).toString() };
}

export async function doAction(db, userId, name, requestId) {
  if (!/^[\w-]{8,64}$/.test(requestId ?? "")) throw new GameError("Missing requestId.");
  if (name === "class" || name === "study") throw new GameError("Pick a course on the Courses screen to attend or study.");
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await catchUp(db, base.id);
  const week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      return actionInTx(tx, c, name, requestId, week);
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true }; // already processed: report success, change nothing
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    throw e;
  }
}

export async function callParent(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await catchUp(db, base.id);
  const week = await currentWeek(db);
  return db.$transaction(async (tx) => {
    const c = await loadLocked(tx, userId);
    const r = resolveCall(c, week, roll, STARTING_ALLOWANCE[c.class]);
    if (r.error) throw new GameError(r.error, 409);
    if (r.gift > 0n) {
      const parents = await tx.account.findUnique({ where: { systemName: "PARENTS" } });
      await transferInTx(tx, { fromId: parents.id, toId: c.account.id, amount: r.gift, memo: "Gift from parent", key: `gift:${c.id}:${week}`, week });
    }
    await tx.character.update({ where: { id: c.id }, data: { lastParentCallWeek: week, happiness: r.happiness } });
    return { ok: true, gift: r.gift.toString() };
  });
}

const needReq = (id) => { if (!/^[\w-]{8,64}$/.test(id ?? "")) throw new GameError("Missing requestId."); };
/** A new strike and what it costs: from 3 strikes a 2 hour suspension, at 5 an expulsion of 5 hours, after which the player starts again from 100L. */
const sanction = (strikes, now = serverNow()) => { const e = escalate(strikes); return { strikes, ...(e === "EXPELLED" ? expulsionFields(now) : e === "SUSPENDED" ? suspensionFields(now) : {}) }; };
async function start(db, userId) {
  const b = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!b) throw new GameError("Create a character first.", 404);
  await catchUp(db, b.id); return currentWeek(db);
}

/** One risky hustle for a player whose row is already locked: paid, or caught and moved to Floor O. */
export async function riskyInTx(tx, c, requestId, week) {
  await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "risky", gameWeek: week, createdAt: new Date(Date.now()) } }); // P2002 on replay
  await guardHustle(tx, c, "risky", requestId); // once per in-game day
  const r = resolveRisky(c, roll); if (r.error) throw new GameError(r.error);
  const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
  if (!r.caught) {
    await transferInTx(tx, { fromId: world.id, toId: c.account.id, amount: r.earn, memo: "Risky hustle", key: `act:${c.id}:${requestId}`, week });
    await tx.character.update({ where: { id: c.id }, data: r.stats });
    return { ok: true, caught: false, earnedKobo: r.earn.toString() };
  }
  await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${c.account.id} FOR UPDATE`; // freeze cash while we compute the seizure
  const acc = await tx.account.findUnique({ where: { id: c.account.id } });
  const dsa = await tx.account.findUnique({ where: { systemName: "DSA" } });
  const seized = seizureFor(acc.balance);
  if (seized > 0n) await transferInTx(tx, { fromId: acc.id, toId: dsa.id, amount: seized, memo: "QRS seizure", key: `seize:${c.id}:${requestId}`, week });
  const now = serverNow(), releaseAt = new Date(now + riskyJailMinutes(roll) * 60_000), bill = bailFor(releaseAt, now), s = sanction(c.strikes + 1, now);
  // The sentence is served INSIDE Floor O: the custody record keeps when it started, when it ends and where, and the player is moved there
  await tx.floorZero.create({ data: { characterId: c.id, reason: "Risky hustle", startedAt: new Date(now), releaseAt, bill, location: CUSTODY_PLACE } }); // `bill` is the bail at the start; payBail works out the live amount
  await tx.character.update({ where: { id: c.id }, data: { ...arrestStats({ ...c, ...r.stats }), ...custodyFields(now, releaseAt), ...s } });
  return { ok: true, caught: true, seizedKobo: seized.toString(), billKobo: bill.toString(), releaseAt, strikes: s.strikes, suspended: !!s.suspendedUntil, expelled: !!s.expelled };
}

export async function doRisky(db, userId, requestId) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      return riskyInTx(tx, c, requestId, week);
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}

/** The exam for a player whose row is already locked. */
export async function examInTx(tx, c, cheat, requestId, week) {
  const cw = week - c.joinedWeek + 1;
  if (cw <= 0 || cw % 6 !== 0) throw new GameError("There is no exam this week.", 409);
  await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "exam", gameWeek: week } });
  // The exam covers your four courses. Attendance and preparation in each one decide how you do.
  const courses = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty));
  const rows = await tx.courseProgress.findMany({ where: { characterId: c.id, sessionStartWeek: c.sessionStartWeek } });
  const r = courses.length ? resolveCourseExam(c, courses, Object.fromEntries(rows.map((x) => [x.code, x])), week - c.sessionStartWeek + 1, cheat, roll)
    : resolveExam(c, Number(c.faculty.difficulty), cheat, roll);
  await tx.examResult.create({ data: { characterId: c.id, gameWeek: week, level: c.level, score: r.score, gradePoint: r.gradePoint, cheated: cheat, caught: r.caught, ...(r.perCourse ? { detail: r.perCourse } : {}) } });
  const s = r.caught ? sanction(c.strikes + 1) : {};
  await tx.character.update({ where: { id: c.id }, data: { ...r.stats, ...s } });
  return { ok: true, score: r.score, gradePoint: r.gradePoint, caught: r.caught, perCourse: r.perCourse ?? null, suspended: !!s.suspendedUntil, expelled: !!s.expelled };
}

export async function sitExam(db, userId, cheat, requestId) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      return examInTx(tx, await loadLocked(tx, userId), cheat === true, requestId, week);
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}

/** Pay to leave Floor O early. The price is N3,500 per minute of the sentence still to serve, worked out HERE from the server clock: nothing the client sends matters. */
export async function payBail(db, userId) {
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true, allowSuspended: true }); // a suspended player can still pay to leave Floor O; also frees a player whose time is already up
      const fz = await tx.floorZero.findFirst({ where: { characterId: c.id, status: "JAILED" }, orderBy: { id: "desc" } });
      if (!c.jailedUntil) {
        if (!fz && await tx.floorZero.findFirst({ where: { characterId: c.id, status: "SERVED", releaseAt: { gte: new Date(Date.now() - 60_000) } } })) return { ok: true, paidKobo: "0", served: true }; // the time ran out as they tapped: free, nothing to pay
        throw new GameError(`You are not in ${CUSTODY_NAME}.`, 409);
      }
      // No FloorZero row but jailedUntil is set (old data): the sentence on the character row is still enforced everywhere, so it can still be paid off.
      const releaseAt = fz?.releaseAt ?? c.jailedUntil;
      const due = bailFor(releaseAt, Date.now());
      if (due <= 0n) { // the last minute ran out while this request was being handled: they are free, and owe nothing
        await tx.floorZero.updateMany({ where: { characterId: c.id, status: "JAILED" }, data: { status: "SERVED" } });
        await tx.character.update({ where: { id: c.id }, data: { jailedUntil: null, inPlace: "", inX: null, inZ: null, inAt: null } });
        return { ok: true, paidKobo: "0", served: true };
      }
      const dsa = await tx.account.findUnique({ where: { systemName: "DSA" } });
      await transferInTx(tx, { fromId: c.account.id, toId: dsa.id, amount: due, memo: "Floor O bill", key: fz ? `bail:${fz.id}` : `bail:c${c.id}:${+c.jailedUntil}`, week });
      await tx.floorZero.updateMany({ where: { characterId: c.id, status: "JAILED" }, data: { status: "PAID" } });
      if (fz) await tx.floorZero.update({ where: { id: fz.id }, data: { bill: due } }); // keep what was actually paid
      await tx.character.update({ where: { id: c.id }, data: { jailedUntil: null, inPlace: "", inX: null, inZ: null, inAt: null } }); // free: forget where they stood in the cell
      return { ok: true, paidKobo: due.toString() };
    });
  } catch (e) { if (e instanceof InsufficientFunds) throw new GameError("You cannot afford the bail. Wait out your sentence.", 402); throw e; }
}

const byName = (tx, name) => tx.character.findFirst({ where: { name: { equals: String(name ?? ""), mode: "insensitive" } }, include: { account: true } });
const blocked = (tx, a, b) => tx.block.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
const me = async (db, userId) => { const c = await db.character.findUnique({ where: { userId } }); if (!c) throw new GameError("Create a character first.", 404); return c; };

export async function searchPlayers(db, userId, q) {
  await me(db, userId); const s = cleanText(q, 20); if (s.length < 2) return { players: [] };
  const rows = await db.character.findMany({ where: { name: { startsWith: s, mode: "insensitive" }, user: { status: { not: "DELETED" } } }, take: 40, select: { name: true, level: true, settings: true, faculty: { select: { name: true } } } }); // archived accounts are never listed
  return { players: rows.filter((r) => settingsOf(r).privacy.searchable).slice(0, 15).map((r) => ({ name: r.name, level: r.level, faculty: r.faculty.name })) }; // a player who switched "appear in search" off is not listed
}

/** What a profile says about love. Only a babe or a fiance is public: a sneaky link is a secret. */
async function publicStatus(db, id) {
  const b = await db.bond.findFirst({ where: { kind: { in: ["BABE", "ENGAGED"] }, OR: [{ lowId: id }, { highId: id }] } });
  if (!b) return "Single";
  const p = await db.character.findUnique({ where: { id: b.lowId === id ? b.highId : b.lowId }, select: { name: true } });
  return `${b.kind === "ENGAGED" ? "Engaged to" : "Dating"} ${p?.name ?? "someone"}`;
}

/** Public profile. Never exposes email, health, suspicion, strikes or arrests. */
export async function getProfile(db, userId, name) {
  await me(db, userId); const c = await byName(db, name); if (!c) throw new GameError("No player with that name.", 404);
  const avg = await db.examResult.aggregate({ where: { characterId: c.id, gameWeek: { gte: c.restartWeek ?? 0 } }, _avg: { gradePoint: true } });
  const biz = await db.business.aggregate({ _sum: { capital: true }, where: { characterId: c.id, status: "ACTIVE" } });
  const inv = await db.holding.aggregate({ _sum: { valueKobo: true }, where: { characterId: c.id } });
  const sav = await db.savingsAccount.findUnique({ where: { characterId: c.id }, select: { balance: true } }); // the Bank app's savings
  return { name: c.name, gender: c.gender, faculty: (await db.faculty.findUnique({ where: { id: c.facultyId } })).name, level: c.level, class: c.class,
    personalities: c.personalities, popularity: c.popularity, cgpa: avg._avg.gradePoint == null ? null : Math.round(avg._avg.gradePoint * 100) / 100,
    netWorthKobo: netWorthOf({ cash: c.account.balance, savings: sav?.balance ?? 0n, business: biz._sum.capital ?? 0n, investments: inv._sum.valueKobo ?? 0n }).total.toString(), graduated: c.graduated, classification: c.classification, achievements: await earnedTitles(db, c.id, c.gender), relationship: c.userId === userId || settingsOf(c).privacy.showRelationship ? await publicStatus(db, c.id) : null, office: await titleFor(db, c.id), look: c.look ?? null };
}

// ---- Messages. The work is in lib/chatCore.js (shared with the realtime server). These wrappers turn its errors into GameErrors for the API routes.
// Each result may carry a `notify` object: the route sends it to the realtime server AFTER answering the player (see lib/realtimeNotify.js).
const asGame = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof chat.ChatError) throw new GameError(e.message, e.status); throw e; } };

/** Plain-HTTP way to send a message (the realtime server normally does this over the socket). */
export const sendMessage = (db, userId, { to, body, replyToId }) => asGame(async () => {
  const me = await chat.whoAmI(db, userId), r = await chat.sendText(db, me, to, body, { replyToId });
  return { ok: true, id: r.dropped ? null : r.id, at: r.at, notify: r.dropped ? null : { type: "msg", chat: r.chatId, id: r.id } };
});

/** No `withName`: the inbox. With it: that conversation (`before` loads older messages, `after` only the newer ones). */
export const getMessages = (db, userId, withName, opts) => asGame(async () => {
  const me = await chat.whoAmI(db, userId);
  return withName ? chat.getThread(db, me, withName, opts) : chat.getInbox(db, me);
});

/** Just the number for the phone's badge. */
export const unreadCount = (db, userId) => asGame(async () => ({ unread: await chat.unreadTotal(db, await chat.whoAmI(db, userId)) }));

export const readMessages = (db, userId, { with: name, upTo }) => asGame(async () => {
  const me = await chat.whoAmI(db, userId), r = await chat.markRead(db, me, name, upTo);
  return { ok: true, notify: r && { type: "read", byId: me.id, by: me.name, peerId: r.peer.id, peerName: r.peer.name, upTo: r.upTo } };
});

/** How long (ms) this player must still wait before sending money again: one minute after their last transfer (0 = free to send). Failed attempts never start it. */
export async function transferCooldownLeft(tx, characterId) {
  const previous = await tx.actionLog.findFirst({ where: { characterId, action: "transfer" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return transferCooldownRemaining(previous?.createdAt, Date.now());
}

/** What paying `n` whole naira costs the payer: the amount, and the fee that is added on top. */
export const p2pCost = (n) => { const amount = BigInt(n) * 100n; return { amount, fee: feeFor(amount) }; };

/**
 * One player paying another, for a payer (`c`, with their account) whose row is already locked: the money, the fee that is added on top, the "sent you"
 * notification and the money card in their chat, all inside the caller's transaction. Used by Messages (sendMoney) and by an approved Calls request.
 * `requestId` names the payment (it ends up in the ledger key, so repeating it moves nothing twice). Returns { amount, fee, note_ }.
 */
export async function payPlayerInTx(tx, c, r, n, { note = "", requestId, week }) {
  const { amount, fee } = p2pCost(n);
  await transferInTx(tx, { fromId: c.account.id, toId: r.account.id, amount, memo: `To ${r.name}${note ? ": " + note : ""}`, key: `p2p:${c.id}:${requestId}`, week });
  if (fee > 0n) { const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
    await transferInTx(tx, { fromId: c.account.id, toId: world.id, amount: fee, memo: "Transfer fee", key: `fee:${c.id}:${requestId}`, week }); }
  await tx.notification.create({ data: { characterId: r.id, kind: "MONEY", body: `${c.name} sent you ₦${Number(n).toLocaleString("en-NG")}.` } });
  const note_ = await chat.postMoney(tx, c, r, n, note); // the "You sent ₦5,000" card in the chat, saved in the same transaction as the money
  return { amount, fee, note_ };
}

export async function sendMoney(db, userId, { to, amountNaira, memo, requestId }) {
  needReq(requestId);
  const n = Number(amountNaira);
  if (!Number.isInteger(n) || n < P2P.minNaira || n > P2P.maxNaira) throw new GameError("Send a whole amount between ₦100 and ₦5,000,000.");
  const week = await start(db, userId), note = cleanText(memo, 80);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true }), r = await byName(tx, to); // sending money is a phone action: custody stops you leaving, not paying
      if (!r) throw new GameError("No player with that name.", 404);
      if (r.id === c.id) throw new GameError("You cannot send money to yourself.");
      if (await blocked(tx, c.id, r.id)) throw new GameError("You cannot send money to this player.", 403);
      const priorRequest = await tx.actionLog.findUnique({ where: { characterId_requestId: { characterId: c.id, requestId } }, select: { action: true } });
      if (priorRequest?.action === "transfer") return { ok: true, duplicate: true };
      // loadLocked serializes all requests for this player. ActionLog rows are committed only alongside successful transfers, so failures never start the cooldown.
      const remaining = await transferCooldownLeft(tx, c.id);
      if (remaining > 0) throw new GameError(`Please wait ${Math.ceil(remaining / 1000)} seconds before sending money again.`, 429);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "transfer", gameWeek: week } }); // P2002 on replay
      const { amount, fee, note_ } = await payPlayerInTx(tx, c, r, n, { note, requestId, week });
      return { ok: true, sentKobo: amount.toString(), feeKobo: fee.toString(), msg: note_ && { id: note_.id, at: note_.at, chat: note_.chatId }, notify: note_ && { type: "msg", chat: note_.chatId, id: note_.id } };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that. The 2% fee is added on top.", 402);
    throw e;
  }
}

/** block, unblock or report another player. A report copies the last 20 messages into itself; `alsoBlock` blocks them in the same step. */
export const safety = (db, userId, { action, name, reason, alsoBlock }) => asGame(async () => {
  const me = await chat.whoAmI(db, userId);
  if (action === "block" || action === "unblock") {
    const p = await chat.setBlock(db, me, name, action === "block");
    return { ok: true, notify: { type: action, blockerId: me.id, blockedId: p.id } };
  }
  if (action === "report") {
    const p = await chat.reportPlayer(db, me, name, reason);
    if (alsoBlock) { await chat.setBlock(db, me, name, true); return { ok: true, blocked: true, notify: { type: "block", blockerId: me.id, blockedId: p.id } }; }
    return { ok: true };
  }
  throw new GameError("Unknown action.");
});

export async function listParties(db, userId) {
  const base = await me(db, userId), week = await currentWeek(db);
  const [nights, mine] = await Promise.all([cached(`nights:${scopeOf(db)}:${week}`, 5_000, () => db.partyNight.findMany({ where: { gameWeek: week } })), db.partyTicket.findFirst({ where: { characterId: base.id, gameWeek: week } })]);
  const count = new Map(nights.map((n) => [n.venue, n.attendees]));
  return { week, wentOut: !!mine, parties: Object.keys(VENUES).map((v) => { const p = partyFor(v, week);
    return { venue: v, theme: p.theme, headliner: p.headliner, night: p.night, priceKobo: p.priceKobo.toString(), capacity: p.capacity, attendees: count.get(v) ?? 0, going: mine?.venue === v }; }) };
}

export async function attendParty(db, userId, venue, requestId) {
  needReq(requestId);
  if (!VENUES[venue]) throw new GameError("Unknown venue.");
  const week = await start(db, userId), party = partyFor(venue, week);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "party", gameWeek: week } }); // P2002 on replay
      if (await tx.partyTicket.findFirst({ where: { characterId: c.id, gameWeek: week } })) throw new GameError("You already went out this week. Rest up.", 409);
      const n = resolveNight(c, roll); if (n.error) throw new GameError(n.error);
      const claimed = await tx.$queryRaw`INSERT INTO "PartyNight" ("venue","gameWeek","attendees") VALUES (${venue}, ${week}, 1)
        ON CONFLICT ("venue","gameWeek") DO UPDATE SET "attendees" = "PartyNight"."attendees" + 1 WHERE "PartyNight"."attendees" < ${party.capacity} RETURNING "attendees"`;
      if (!claimed.length) throw new GameError(`${venue} is sold out this week. Try another venue.`, 409);
      const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } });
      await transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount: party.priceKobo, memo: `${venue} ticket`, key: `ticket:${c.id}:${week}`, week });
      let extra = n.costKobo;
      if (extra > 0n) { // drinks / stolen phone: never more than the player has left
        const fresh = await tx.account.findUnique({ where: { id: c.account.id } }); if (extra > fresh.balance) extra = fresh.balance;
        if (extra > 0n) await transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount: extra, memo: n.title, key: `night:${c.id}:${week}`, week });
      }
      await tx.partyTicket.create({ data: { characterId: c.id, venue, gameWeek: week, pricePaid: party.priceKobo } });
      await tx.character.update({ where: { id: c.id }, data: n.stats });
      if (n.note) await tx.notification.create({ data: { characterId: c.id, kind: "SOCIAL", body: n.note } });
      return { ok: true, venue, title: n.title, note: n.note, paidKobo: party.priceKobo.toString(), extraKobo: extra.toString() };
    }).then((out) => { invalidate("nights:"); return out; });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford the ticket.", 402);
    throw e;
  }
}

export { start, needReq, sanction };
