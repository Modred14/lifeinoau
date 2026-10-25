// lib/callService.js
// The Calls app on the server.
//
//  CALLING HOME. One request: the parent's answer is decided here (lib/callRules.js has the odds and cooldowns), any gift is paid through the ledger from the
//  PARENTS account in the same transaction, and the call is stored finished. An answered call counts as the weekly "calling home" (lastParentCallWeek),
//  exactly like the Home button, so the missed-call streak in the weekly tick stays honest. The screens play the ringing; the money is already settled.
//
//  CALLING A PLAYER. A real, stored state machine: RINGING -> ANSWERED -> ENDED (or DECLINED / MISSED / CANCELLED).
//   - You can ring only a player whose game is open (PhoneLine heartbeat); otherwise you get "unavailable" and the Messages fallback.
//   - A request for money is made by the caller during an answered call; it moves NOTHING by itself. Only the callee's own approval (their authenticated
//     request, under their own locks) pays, through the same payPlayerInTx and cooldown as a Messages transfer, fee included.
//   - Time never needs a job: a call that has run out of time is settled by whichever side looks at it next (expiryOf in callRules.js).
//   - The database allows one live call per caller and per callee (partial unique indexes), so two simultaneous dials cannot both connect.
//   Lock order everywhere: Character rows (sorted by id) -> the PhoneCall row -> Account rows (sorted, inside transferInTx). One order, no deadlocks.
import { roll } from "./rng.js";
import { loadLocked, GameError, start, needReq, payPlayerInTx, p2pCost, transferCooldownLeft, searchPlayers } from "./gameService.js";
import { transferInTx } from "./ledger.js";
import { isSuspended, isExpelled } from "./discipline.js";
import { gateOf } from "./accountGate.js"; // a closed or suspended ACCOUNT (an administrator's decision) cannot take calls either
import { parseNaira } from "./bankRules.js";
import {
  PARENT_CALL, PLAYER_CALL, LIVE, isLive, isOnline, expiryOf, dialBlock, askBlock, allowanceFor, parentName,
  resolveParentCall, parentStatusOf, isAnsweredOutcome, parentCooldownLeft, waitLabel,
} from "./callRules.js";

const s = (k) => (k == null ? null : k.toString());
const iso = (d) => (d ? new Date(d).toISOString() : null);
const fmt = (k) => "₦" + (BigInt(k) / 100n).toLocaleString("en-NG");
const byName = (db, name) => db.character.findFirst({ where: { name: { equals: String(name ?? "").trim(), mode: "insensitive" } } });
const blockedBetween = (db, a, b) => db.block.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
const lockChars = (tx, ids) => tx.$queryRaw`SELECT id FROM "Character" WHERE id = ANY(${[...new Set(ids.filter(Boolean))]}::text[]) ORDER BY id FOR UPDATE`;
const meOf = async (db, userId) => { const c = await db.character.findUnique({ where: { userId }, select: { id: true, name: true, class: true } }); if (!c) throw new GameError("Create a character first.", 404); return c; };
/** A refusal that is part of the call's story (it ended, it was already answered ...), not an error: nothing is thrown, so the settled state is saved. */
const soft = (message, call, meId, extra = {}) => ({ ok: false, message, call: call ? view(call, meId) : null, ...extra });

// ---------- views (what the browser gets) ----------
/** A player call from one side's point of view. Nothing about the other player's money is ever in it. */
export function view(call, meId) {
  const caller = call.callerId === meId;
  const ask = call.askKobo != null ? BigInt(call.askKobo) : null;
  return {
    id: call.id, kind: call.kind, role: caller ? "caller" : "callee", peer: caller ? call.calleeName : call.callerName,
    status: call.status, endReason: call.endReason ?? null, createdAt: iso(call.createdAt), ringingAt: iso(call.ringingAt), ringUntil: iso(call.ringUntil),
    answeredAt: iso(call.answeredAt), endedAt: iso(call.endedAt), idleUntil: iso(call.idleUntil),
    askKobo: s(ask), askStatus: call.askStatus, askUntil: iso(call.askUntil), paidKobo: s(call.paidKobo), feeKobo: s(call.feeKobo),
    costKobo: ask != null ? s(ask + p2pCost(Number(ask / 100n)).fee) : null, // what approving costs the callee: the amount plus the fee
    outcome: call.outcome ?? null, line: call.line ?? null,
  };
}

// ---------- presence ----------
/** "My game is open": written at most every 10 seconds per player, however often they poll. */
export async function beat(db, characterId, now = new Date()) {
  await db.$executeRaw`INSERT INTO "PhoneLine" ("characterId", "seenAt") VALUES (${characterId}, ${now}) ON CONFLICT ("characterId") DO UPDATE SET "seenAt" = ${now} WHERE "PhoneLine"."seenAt" < ${new Date(now.getTime() - 10_000)}`;
}

// ---------- time ----------
/** Applies a run-out deadline to a live call (once, even if both players look at the same moment). Works on a client or inside a transaction. */
export async function settle(tx, call, now = new Date()) {
  const ex = expiryOf(call, now.getTime());
  if (!ex) return call;
  const data = { status: ex.status, endReason: ex.endReason, endedAt: new Date(ex.at), ...(ex.askStatus ? { askStatus: ex.askStatus, decidedAt: new Date(ex.at) } : {}) };
  const r = await tx.phoneCall.updateMany({ where: { id: call.id, status: call.status, askStatus: call.askStatus }, data });
  if (!r.count) return tx.phoneCall.findUnique({ where: { id: call.id } }); // the other side settled it first
  if (ex.status === "MISSED") await tx.notification.create({ data: { characterId: call.calleeId, kind: "SOCIAL", body: `Missed call from ${call.callerName}.` } });
  return { ...call, ...data };
}

const liveWhere = (id) => ({ kind: "PLAYER", status: { in: LIVE }, OR: [{ callerId: id }, { calleeId: id }] });

/** What the phone asks every few seconds: am I on a call, is someone ringing me, did my last call just end? Also says "my game is open". */
export async function pollCalls(db, userId) {
  const me = await meOf(db, userId), now = new Date();
  await beat(db, me.id, now);
  let live = await db.phoneCall.findFirst({ where: liveWhere(me.id), orderBy: { createdAt: "desc" } });
  if (live) live = await settle(db, live, now);
  if (live && !isLive(live)) live = null;
  if (live && live.calleeId === me.id && live.status === "RINGING" && !live.ringingAt) { // the callee's phone has now shown it: the caller's screen changes from "Calling" to "Ringing"
    await db.phoneCall.updateMany({ where: { id: live.id, ringingAt: null, status: "RINGING" }, data: { ringingAt: now } });
    live = { ...live, ringingAt: now };
  }
  let last = null;
  if (!live) {
    const l = await db.phoneCall.findFirst({ where: { kind: "PLAYER", endedAt: { gte: new Date(now.getTime() - PLAYER_CALL.resultShowMs) }, OR: [{ callerId: me.id }, { calleeId: me.id }] }, orderBy: { endedAt: "desc" } });
    if (l && (l.callerId === me.id || l.answeredAt)) last = l; // the callee sees an ending only if they actually took the call (a miss is a notification and a line in Recents)
  }
  return { serverNow: now.getTime(), active: live ? view(live, me.id) : null, last: last ? view(last, me.id) : null };
}

// ---------- calling home ----------
/** Call Mummy / Daddy for support. One request, settled here; the browser plays it as calling -> ringing -> answered / declined -> ended. */
export async function callParent(db, userId, { requestId } = {}) {
  needReq(requestId);
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true }), now = new Date(), pname = parentName(c.id);
      const same = await tx.phoneCall.findUnique({ where: { callerId_requestId: { callerId: c.id, requestId } } });
      if (same) return { ok: true, replayed: true, call: view(same, c.id), giftKobo: s(same.paidKobo ?? 0n), balanceKobo: s(c.account.balance) };
      const last = await tx.phoneCall.findFirst({ where: { callerId: c.id, kind: "PARENT" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, outcome: true } });
      const wait = parentCooldownLeft(last, now.getTime());
      if (wait > 0) throw new GameError(`${pname} is not free right now. Try calling again in ${waitLabel(wait)}.`, 429);
      if ((await tx.phoneCall.count({ where: { callerId: c.id, kind: "PARENT", gameWeek: week } })) >= PARENT_CALL.maxCallsPerWeek) throw new GameError("You have called home a lot this week. Give them a break until next week.", 429);
      const parents = await tx.account.findUnique({ where: { systemName: "PARENTS" } });
      const given = await tx.ledgerEntry.aggregate({ _sum: { amount: true }, where: { debitAccountId: parents.id, creditAccountId: c.account.id, gameWeek: week } }); // gifts from home this week, from any road
      const r = resolveParentCall({ allowance: allowanceFor(c.class), balance: c.account.balance, missedStreak: c.missedCallStreak ?? 0, givenThisWeek: given._sum.amount ?? 0n, roll });
      const answered = isAnsweredOutcome(r.outcome), gift = r.giftKobo;
      const call = await tx.phoneCall.create({ data: {
        kind: "PARENT", callerId: c.id, callerName: c.name, calleeId: null, calleeName: pname, requestId, status: parentStatusOf(r.outcome), endReason: r.outcome,
        createdAt: now, ringUntil: now, answeredAt: answered ? now : null, endedAt: now, gameWeek: week, outcome: r.outcome, line: r.line,
        askKobo: gift > 0n ? gift : null, paidKobo: gift > 0n ? gift : null, askStatus: r.outcome === "GIVEN" ? "APPROVED" : r.outcome === "REFUSED" ? "REJECTED" : "NONE", decidedAt: answered ? now : null } });
      if (gift > 0n) await transferInTx(tx, { fromId: parents.id, toId: c.account.id, amount: gift, memo: "Gift from parent", key: `gift:call:${call.id}`, week });
      if (answered) await tx.character.update({ where: { id: c.id }, data: { lastParentCallWeek: week, happiness: Math.max(0, Math.min(100, c.happiness + r.happiness)) } }); // counts as calling home this week
      const bal = await tx.account.findUnique({ where: { id: c.account.id }, select: { balance: true } });
      return { ok: true, call: view(call, c.id), giftKobo: s(gift), balanceKobo: s(bal.balance), calledThisWeek: answered || c.lastParentCallWeek >= week };
    });
  } catch (e) {
    if (e.code === "P2002") { const c = await meOf(db, userId); const same = await db.phoneCall.findUnique({ where: { callerId_requestId: { callerId: c.id, requestId } } }); if (same) return { ok: true, replayed: true, call: view(same, c.id), giftKobo: s(same.paidKobo ?? 0n) }; }
    throw e;
  }
}

// ---------- calling a player ----------
/** Ring another player. Returns { ok, call } when it is ringing, or { ok: false, unavailable, reason, message } when they cannot be reached (no call is made). */
export async function dial(db, userId, { to, requestId } = {}) {
  needReq(requestId);
  const me = await meOf(db, userId), week = await start(db, userId);
  const peer = await byName(db, to);
  if (!peer) throw new GameError("No player with that name.", 404);
  if (peer.id === me.id) throw new GameError("You cannot call yourself.");
  const unavailable = (reason, message, extra = {}) => ({ ok: false, unavailable: true, reason, message, peer: peer.name, ...extra });
  try {
    return await db.$transaction(async (tx) => {
      await lockChars(tx, [me.id, peer.id]);
      const c = await loadLocked(tx, userId, { allowJailed: true }), now = new Date();
      const same = await tx.phoneCall.findUnique({ where: { callerId_requestId: { callerId: c.id, requestId } } });
      if (same) return { ok: true, replayed: true, call: view(same, c.id) };
      if (await blockedBetween(tx, c.id, peer.id)) throw new GameError("You cannot call this player.", 403);
      for (const x of await tx.phoneCall.findMany({ where: { OR: [liveWhere(c.id), liveWhere(peer.id)] } })) await settle(tx, x, now); // clear anything that has run out first
      if (await tx.phoneCall.findFirst({ where: liveWhere(c.id) })) throw new GameError("You are already on a call. Hang up first.", 409);
      const [callsLastHour, lastToPeer] = await Promise.all([
        tx.phoneCall.count({ where: { callerId: c.id, kind: "PLAYER", createdAt: { gte: new Date(now.getTime() - 3_600_000) } } }),
        tx.phoneCall.findFirst({ where: { callerId: c.id, calleeId: peer.id, kind: "PLAYER" }, orderBy: { createdAt: "desc" }, select: { status: true, askStatus: true, createdAt: true, endedAt: true } }),
      ]);
      const stop = dialBlock({ callsLastHour, lastToPeer, peerName: peer.name }, now.getTime());
      if (stop) throw new GameError(stop, 429);
      const fresh = await tx.character.findUnique({ where: { id: peer.id }, select: { suspendedUntil: true, expelled: true, expelledUntil: true } });
      const account = await tx.user.findUnique({ where: { id: peer.userId }, select: { status: true, statusUntil: true, statusReason: true } });
      if (!gateOf(account, now.getTime()).ok || isSuspended(fresh, now.getTime()) || isExpelled(fresh, now.getTime())) return unavailable("unavailable", `${peer.name} cannot take calls right now.`);
      const line = await tx.phoneLine.findUnique({ where: { characterId: peer.id } });
      if (!isOnline(line?.seenAt, now.getTime())) {
        const recent = await tx.notification.findFirst({ where: { characterId: peer.id, kind: "SOCIAL", body: { startsWith: `${c.name} tried to call you` }, createdAt: { gte: new Date(now.getTime() - PLAYER_CALL.missedNoteMs) } }, select: { id: true } });
        if (!recent) await tx.notification.create({ data: { characterId: peer.id, kind: "SOCIAL", body: `${c.name} tried to call you.` } }); // at most one note per ten minutes from the same caller
        return unavailable("offline", `${peer.name} is offline right now. Send a message instead.`, { lastSeenAt: iso(line?.seenAt) });
      }
      if (await tx.phoneCall.findFirst({ where: liveWhere(peer.id) })) return unavailable("busy", `${peer.name} is on another call. Try again in a moment.`);
      const call = await tx.phoneCall.create({ data: { kind: "PLAYER", callerId: c.id, callerName: c.name, calleeId: peer.id, calleeName: peer.name, requestId, status: "RINGING", createdAt: now, ringUntil: new Date(now.getTime() + PLAYER_CALL.ringMs), gameWeek: week } });
      return { ok: true, call: view(call, c.id) };
    });
  } catch (e) {
    if (e.code === "P2002") return unavailable("busy", `${peer.name} is on another call. Try again in a moment.`); // the database refused a second live call: someone connected first
    throw e;
  }
}

/** Opens one call for one of its two players: both characters locked (sorted), then the call row, then settled if its time ran out. fn(tx, c, call, week, now). */
async function withCall(db, userId, callId, fn) {
  const me = await meOf(db, userId), id = String(callId ?? "");
  if (!/^[\w-]{8,40}$/.test(id)) throw new GameError("That call was not found.", 404);
  const base = await db.phoneCall.findUnique({ where: { id } });
  if (!base || base.kind !== "PLAYER" || (base.callerId !== me.id && base.calleeId !== me.id)) throw new GameError("That call was not found.", 404); // not yours: the same answer as a call that does not exist
  const week = await start(db, userId);
  return db.$transaction(async (tx) => {
    await lockChars(tx, [base.callerId, base.calleeId]);
    const c = await loadLocked(tx, userId, { allowJailed: true });
    await tx.$queryRaw`SELECT id FROM "PhoneCall" WHERE id = ${id} FOR UPDATE`;
    const now = new Date(), call = await settle(tx, await tx.phoneCall.findUnique({ where: { id } }), now);
    return fn(tx, c, call, week, now);
  });
}
const finish = (tx, call, data, now) => tx.phoneCall.update({ where: { id: call.id }, data: { endedAt: now, ...data } });

/** The callee picks up. */
export const answer = (db, userId, { callId } = {}) => withCall(db, userId, callId, async (tx, c, call, week, now) => {
  if (call.calleeId !== c.id) throw new GameError("Only the person being called can answer.", 403);
  if (call.status !== "RINGING") return soft(call.status === "MISSED" ? "You missed this call." : "This call has ended.", call, c.id);
  const up = await tx.phoneCall.update({ where: { id: call.id }, data: { status: "ANSWERED", answeredAt: now, ringingAt: call.ringingAt ?? now, idleUntil: new Date(now.getTime() + PLAYER_CALL.idleMs) } });
  return { ok: true, call: view(up, c.id) };
});

/** Hang up, decline or cancel: what it means depends on where the call is. Never moves money. */
export const end = (db, userId, { callId } = {}) => withCall(db, userId, callId, async (tx, c, call, week, now) => {
  if (!isLive(call)) return { ok: true, call: view(call, c.id) }; // already over: hanging up twice is fine
  const caller = call.callerId === c.id;
  if (call.status === "RINGING") return { ok: true, call: view(await finish(tx, call, caller ? { status: "CANCELLED", endReason: "CANCELLED" } : { status: "DECLINED", endReason: "DECLINED" }, now), c.id) };
  const pending = call.askStatus === "PENDING"; // hanging up on a question: the caller withdraws it, the callee turns it down
  return { ok: true, call: view(await finish(tx, call, { status: "ENDED", endReason: "HUNG_UP", ...(pending ? { askStatus: caller ? "CANCELLED" : "REJECTED", decidedAt: now } : {}) }, now), c.id) };
});

/** The caller asks for an amount, once per call. This only records the question: nothing is taken from anyone. */
export const ask = (db, userId, { callId, amountNaira } = {}) => {
  const p = parseNaira(amountNaira, { min: PLAYER_CALL.askMinNaira, max: PLAYER_CALL.askMaxNaira, what: "amount" });
  if (p.error) throw new GameError(p.error);
  return withCall(db, userId, callId, async (tx, c, call, week, now) => {
    if (call.callerId !== c.id) throw new GameError("Only the person who made the call can ask for money.", 403);
    if (call.status !== "ANSWERED") return soft("This call has ended.", call, c.id);
    if (call.askStatus !== "NONE") return soft("You have already asked on this call.", call, c.id);
    const day = { gte: new Date(now.getTime() - 86_400_000) };
    const [asksToday, asksToPeerToday] = await Promise.all([
      tx.phoneCall.count({ where: { callerId: c.id, kind: "PLAYER", askStatus: { not: "NONE" }, askAt: day } }),
      tx.phoneCall.count({ where: { callerId: c.id, calleeId: call.calleeId, kind: "PLAYER", askStatus: { not: "NONE" }, askAt: day } }),
    ]);
    const stop = askBlock({ asksToday, asksToPeerToday });
    if (stop) throw new GameError(stop, 429);
    const up = await tx.phoneCall.update({ where: { id: call.id }, data: { askKobo: BigInt(p.n) * 100n, askStatus: "PENDING", askAt: now, askUntil: new Date(now.getTime() + PLAYER_CALL.askMs), idleUntil: null } });
    return { ok: true, call: view(up, c.id) };
  });
};

/** The callee's decision on the question. Approve is the ONLY road by which money moves, and it is the callee's own request, under their own locks. */
export const decide = (db, userId, { callId, approve } = {}) => withCall(db, userId, callId, async (tx, c, call, week, now) => {
  if (call.calleeId !== c.id) throw new GameError("Only the person who was called can decide this.", 403);
  if (call.status !== "ANSWERED" || call.askStatus !== "PENDING") return soft(call.askStatus === "EXPIRED" ? "That request ran out of time." : "There is nothing to decide on this call.", call, c.id);
  if (!approve) return { ok: true, call: view(await finish(tx, call, { status: "ENDED", endReason: "REJECTED", askStatus: "REJECTED", decidedAt: now }, now), c.id) };
  const fail = async (message, endReason) => soft(message, await finish(tx, call, { status: "ENDED", endReason, askStatus: "FAILED", decidedAt: now }, now), c.id, { failed: true });
  const wait = await transferCooldownLeft(tx, c.id); // the same one-minute rule as a Messages transfer: the request stays open, so the callee can approve again
  if (wait > 0) return soft(`Please wait ${Math.ceil(wait / 1000)} seconds before sending money again.`, call, c.id, { retryInMs: wait });
  const payee = await tx.character.findUnique({ where: { id: call.callerId }, include: { account: true } });
  if (!payee) return fail("This player is no longer around.", "GONE");
  if (await blockedBetween(tx, c.id, payee.id)) return fail("You cannot send money to this player.", "BLOCKED");
  const n = Number(BigInt(call.askKobo) / 100n), { amount, fee } = p2pCost(n);
  const bal = (await tx.account.findUnique({ where: { id: c.account.id }, select: { balance: true } })).balance;
  if (bal < amount + fee) return fail(`You cannot afford ${fmt(amount)} plus the ${fmt(fee)} fee.`, "INSUFFICIENT_FUNDS"); // checked before any money moves, so a refusal never leaves half a payment
  await tx.actionLog.create({ data: { characterId: c.id, requestId: `call-${call.id}`, action: "transfer", gameWeek: week } }); // starts the same cooldown as any transfer
  const paid = await payPlayerInTx(tx, c, payee, n, { note: PLAYER_CALL.note, requestId: `call-${call.id}`, week });
  const up = await finish(tx, call, { status: "ENDED", endReason: "PAID", askStatus: "APPROVED", decidedAt: now, paidKobo: paid.amount, feeKobo: paid.fee }, now);
  return { ok: true, call: view(up, c.id), sentKobo: s(paid.amount), feeKobo: s(paid.fee) };
});

// ---------- lists ----------
/** Recent calls (both kinds, both directions), newest first. `cursor` is the createdAt of the last row already shown. */
export async function callHistory(db, userId, { cursor, limit = 30 } = {}) {
  const me = await meOf(db, userId), lim = Math.min(Math.max(Number(limit) || 30, 1), 60);
  const before = cursor ? new Date(cursor) : null;
  if (cursor && Number.isNaN(before.getTime())) throw new GameError("Bad page.");
  const rows = await db.phoneCall.findMany({ where: { OR: [{ callerId: me.id }, { calleeId: me.id }], ...(before ? { createdAt: { lt: before } } : {}) }, orderBy: { createdAt: "desc" }, take: lim + 1 });
  const page = rows.slice(0, lim);
  return { calls: page.map((r) => ({ ...view(r, me.id), direction: r.callerId === me.id ? "outgoing" : "incoming", seconds: r.answeredAt && r.endedAt ? Math.max(0, Math.round((new Date(r.endedAt) - new Date(r.answeredAt)) / 1000)) : 0 })),
    next: rows.length > lim ? iso(page[page.length - 1].createdAt) : null };
}

/** The Calls home screen: how the call home stands, the people you called lately and whether they are online. */
export async function callHome(db, userId) {
  const me = await meOf(db, userId), week = await start(db, userId), now = Date.now();
  const char = await db.character.findUnique({ where: { id: me.id }, include: { account: true } });
  const [lastHome, thisWeek, parents] = await Promise.all([
    db.phoneCall.findFirst({ where: { callerId: me.id, kind: "PARENT" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, outcome: true, line: true, paidKobo: true } }),
    db.phoneCall.count({ where: { callerId: me.id, kind: "PARENT", gameWeek: week } }),
    db.account.findUnique({ where: { systemName: "PARENTS" } }),
  ]);
  const given = await db.ledgerEntry.aggregate({ _sum: { amount: true }, where: { debitAccountId: parents.id, creditAccountId: char.account.id, gameWeek: week } });
  const rows = await db.phoneCall.findMany({ where: { kind: "PLAYER", OR: [{ callerId: me.id }, { calleeId: me.id }] }, orderBy: { createdAt: "desc" }, take: 30, select: { callerId: true, calleeId: true, callerName: true, calleeName: true } });
  const seen = new Map();
  for (const r of rows) { const id = r.callerId === me.id ? r.calleeId : r.callerId, name = r.callerId === me.id ? r.calleeName : r.callerName; if (!seen.has(id) && seen.size < 6) seen.set(id, name); }
  const lines = seen.size ? await db.phoneLine.findMany({ where: { characterId: { in: [...seen.keys()] } } }) : [];
  const at = new Map(lines.map((l) => [l.characterId, l.seenAt]));
  const cap = (allowanceFor(char.class) * BigInt(PARENT_CALL.weeklyGiftCapPct)) / 100n;
  return {
    parent: { name: parentName(me.id), waitMs: parentCooldownLeft(lastHome, now), last: lastHome ? { at: iso(lastHome.createdAt), outcome: lastHome.outcome, line: lastHome.line, giftKobo: s(lastHome.paidKobo ?? 0n) } : null,
      callsThisWeek: thisWeek, maxCallsPerWeek: PARENT_CALL.maxCallsPerWeek, giftsThisWeekKobo: s(given._sum.amount ?? 0n), weeklyCapKobo: s(cap), missedStreak: char.missedCallStreak ?? 0 },
    recents: [...seen].map(([id, name]) => ({ name, online: isOnline(at.get(id), now) })),
    limits: { askMinNaira: PLAYER_CALL.askMinNaira, askMaxNaira: PLAYER_CALL.askMaxNaira, ringSeconds: PLAYER_CALL.ringMs / 1000, askSeconds: PLAYER_CALL.askMs / 1000 },
    serverNow: now,
  };
}

/** Find players to call (the same search as Messages: it respects each player's "appear in search" setting), each marked online or not. */
export async function findPeople(db, userId, q) {
  const { players } = await searchPlayers(db, userId, q);
  if (!players.length) return { players: [] };
  const rows = await db.character.findMany({ where: { name: { in: players.map((p) => p.name) } }, select: { id: true, name: true } });
  const idOf = new Map(rows.map((r) => [r.name, r.id])), lines = await db.phoneLine.findMany({ where: { characterId: { in: rows.map((r) => r.id) } } });
  const at = new Map(lines.map((l) => [l.characterId, l.seenAt])), now = Date.now();
  return { players: players.map((p) => ({ ...p, online: isOnline(at.get(idOf.get(p.name)), now) })) };
}

/** One dispatcher for POST /api/calls. */
export function callAction(db, userId, body = {}) {
  const b = body ?? {};
  switch (b.action) {
    case "parent": return callParent(db, userId, b);
    case "dial": return dial(db, userId, b);
    case "answer": return answer(db, userId, b);
    case "end": return end(db, userId, b);
    case "ask": return ask(db, userId, b);
    case "approve": return decide(db, userId, { callId: b.callId, approve: true });
    case "reject": return decide(db, userId, { callId: b.callId, approve: false });
    default: throw new GameError("Unknown action.");
  }
}
