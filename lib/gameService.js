// lib/gameService.js
import { currentWeek } from "./clock.js";
import { catchUp } from "./tick.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { resolveAction, resolveCall, resolveRisky, resolveExam, cgpa, classify, SESSION_WEEKS, arrestStats, billFor, seizureFor, jailMinutes, escalate } from "./engine.js";
import { roll } from "./rng.js";
import { VENUES, partyFor, resolveNight } from "./parties.js";
import { syncAchievements, earnedTitles } from "./achievementService.js";
import { unreadNotes } from "./notifications.js";
import { STARTING_ALLOWANCE, allowedHostels, P2P, feeFor, cleanText } from "./rules.js";

export class GameError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

export async function loadLocked(tx, userId, { allowJailed = false } = {}) {
  const base = await tx.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${base.id} FOR UPDATE`; // one action at a time per player
  const c = await tx.character.findUnique({ where: { id: base.id }, include: { account: true, faculty: true } });
  if (!c.hostel) throw new GameError("Choose where to live first.", 409);
  if (c.expelled) throw new GameError("You have been expelled. Your story ends here.", 403);
  const week = await currentWeek(tx);
  if (c.suspendedUntilWeek > week) throw new GameError(`You are suspended until week ${c.suspendedUntilWeek}.`, 403);
  if (c.jailedUntil && c.jailedUntil <= new Date()) { // sentence served: release lazily
    await tx.character.update({ where: { id: c.id }, data: { jailedUntil: null } });
    await tx.floorZero.updateMany({ where: { characterId: c.id, status: "JAILED" }, data: { status: "SERVED" } });
    c.jailedUntil = null;
  }
  if (c.jailedUntil && !allowJailed) throw new GameError("You are in Floor 0. Pay the bill or wait.", 403);
  return c;
}

export async function getState(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  await catchUp(db, c.id);
  const ch = await db.character.findUnique({ where: { id: c.id }, include: { account: true, faculty: true } });
  const week = await currentWeek(db);
  const { account, faculty, userId: _u, ...rest } = ch;
  const rs = await db.examResult.findMany({ where: { characterId: c.id }, orderBy: { gameWeek: "desc" }, take: 100,
    select: { gameWeek: true, level: true, score: true, gradePoint: true, cheated: true, caught: true, missed: true } });
  const cw = week - ch.joinedWeek + 1, g = cgpa(rs.map((r) => r.gradePoint));
  const academics = { cgpa: g, standing: g == null ? null : classify(g), weeksLeftInSession: Math.max(0, ch.sessionStartWeek + SESSION_WEEKS - week),
    nextExamWeek: week + ((6 - (cw % 6)) % 6), satThisWeek: rs.some((r) => r.gameWeek === week), recent: rs.slice(0, 6) };
  const fz = await db.floorZero.findFirst({ where: { characterId: c.id, status: "JAILED" } });
  await syncAchievements(db, c.id, week); // before reading notifications, so a new award shows immediately
  const notifications = await unreadNotes(db, c.id);
  return { week, notifications, hostels: ch.hostel ? null : allowedHostels(ch.class, ch.gender, ch.level), academics, floorZero: fz && { releaseAt: fz.releaseAt, billKobo: fz.bill.toString() }, character: { ...rest, faculty: faculty.name }, balanceKobo: account.balance.toString(), calledThisWeek: ch.lastParentCallWeek >= week };
}

export async function doAction(db, userId, name, requestId) {
  if (!/^[\w-]{8,64}$/.test(requestId ?? "")) throw new GameError("Missing requestId.");
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await catchUp(db, base.id);
  const week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      const r = resolveAction(c, name, roll);
      if (r.error) throw new GameError(r.error);
      const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } });
      const key = `act:${c.id}:${requestId}`;
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: name, gameWeek: week } }); // P2002 on replay
      if (r.earn) await transferInTx(tx, { fromId: world.id, toId: c.account.id, amount: r.earn, memo: r.memo, key, week });
      if (r.spend) await transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount: r.spend, memo: r.memo, key, week });
      await tx.character.update({ where: { id: c.id }, data: r.stats });
      return { ok: true, name, stats: r.stats };
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
const sanction = (strikes, week) => { const e = escalate(strikes); return { strikes, expelled: e === "EXPELLED", ...(e === "SUSPENDED" ? { suspendedUntilWeek: week + 2 } : {}) }; };
async function start(db, userId) {
  const b = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!b) throw new GameError("Create a character first.", 404);
  await catchUp(db, b.id); return currentWeek(db);
}

export async function doRisky(db, userId, requestId) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "risky", gameWeek: week } });
      const r = resolveRisky(c, roll); if (r.error) throw new GameError(r.error);
      const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      if (!r.caught) {
        if (r.earn > 0n) await transferInTx(tx, { fromId: world.id, toId: c.account.id, amount: r.earn, memo: "Risky hustle", key: `act:${c.id}:${requestId}`, week });
        await tx.character.update({ where: { id: c.id }, data: r.stats });
        return { ok: true, caught: false, earnedKobo: (r.earn ?? 0n).toString() };
      }
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${c.account.id} FOR UPDATE`; // freeze cash while we compute the seizure
      const acc = await tx.account.findUnique({ where: { id: c.account.id } });
      const dsa = await tx.account.findUnique({ where: { systemName: "DSA" } });
      const seized = seizureFor(acc.balance);
      if (seized > 0n) await transferInTx(tx, { fromId: acc.id, toId: dsa.id, amount: seized, memo: "DSA seizure", key: `seize:${c.id}:${requestId}`, week });
      const bill = billFor(acc.balance - seized), releaseAt = new Date(Date.now() + jailMinutes(roll) * 60_000), s = sanction(c.strikes + 1, week);
      await tx.floorZero.create({ data: { characterId: c.id, reason: "Risky hustle", releaseAt, bill } });
      await tx.character.update({ where: { id: c.id }, data: { ...arrestStats({ ...c, ...r.stats }), jailedUntil: releaseAt, ...s } });
      return { ok: true, caught: true, seizedKobo: seized.toString(), billKobo: bill.toString(), releaseAt, strikes: s.strikes, suspended: !!s.suspendedUntilWeek, expelled: s.expelled };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}

export async function sitExam(db, userId, cheat, requestId) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), cw = week - c.joinedWeek + 1;
      if (cw <= 0 || cw % 6 !== 0) throw new GameError("There is no exam this week.", 409);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "exam", gameWeek: week } });
      const r = resolveExam(c, Number(c.faculty.difficulty), cheat === true, roll);
      await tx.examResult.create({ data: { characterId: c.id, gameWeek: week, level: c.level, score: r.score, gradePoint: r.gradePoint, cheated: cheat === true, caught: r.caught } });
      const s = r.caught ? sanction(c.strikes + 1, week) : {};
      await tx.character.update({ where: { id: c.id }, data: { ...r.stats, ...s } });
      return { ok: true, score: r.score, gradePoint: r.gradePoint, caught: r.caught, suspended: !!s.suspendedUntilWeek, expelled: !!s.expelled };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}

export async function payBail(db, userId) {
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true });
      const fz = await tx.floorZero.findFirst({ where: { characterId: c.id, status: "JAILED" } });
      if (!fz || !c.jailedUntil) throw new GameError("You are not in Floor 0.", 409);
      const dsa = await tx.account.findUnique({ where: { systemName: "DSA" } });
      await transferInTx(tx, { fromId: c.account.id, toId: dsa.id, amount: fz.bill, memo: "Floor 0 bill", key: `bail:${fz.id}`, week });
      await tx.floorZero.update({ where: { id: fz.id }, data: { status: "PAID" } });
      await tx.character.update({ where: { id: c.id }, data: { jailedUntil: null } });
      return { ok: true, paidKobo: fz.bill.toString() };
    });
  } catch (e) { if (e instanceof InsufficientFunds) throw new GameError("You cannot afford the bill. Wait out your sentence.", 402); throw e; }
}

const byName = (tx, name) => tx.character.findFirst({ where: { name: { equals: String(name ?? ""), mode: "insensitive" } }, include: { account: true } });
const blocked = (tx, a, b) => tx.block.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
const me = async (db, userId) => { const c = await db.character.findUnique({ where: { userId } }); if (!c) throw new GameError("Create a character first.", 404); return c; };

export async function searchPlayers(db, userId, q) {
  await me(db, userId); const s = cleanText(q, 20); if (s.length < 2) return { players: [] };
  const rows = await db.character.findMany({ where: { name: { startsWith: s, mode: "insensitive" } }, take: 15, select: { name: true, level: true, faculty: { select: { name: true } } } });
  return { players: rows.map((r) => ({ name: r.name, level: r.level, faculty: r.faculty.name })) };
}

/** Public profile. Never exposes email, health, suspicion, strikes or arrests. */
export async function getProfile(db, userId, name) {
  await me(db, userId); const c = await byName(db, name); if (!c) throw new GameError("No player with that name.", 404);
  const avg = await db.examResult.aggregate({ where: { characterId: c.id }, _avg: { gradePoint: true } });
  const biz = await db.business.aggregate({ _sum: { capital: true }, where: { characterId: c.id, status: "ACTIVE" } });
  const inv = await db.holding.aggregate({ _sum: { valueKobo: true }, where: { characterId: c.id } });
  return { name: c.name, gender: c.gender, faculty: (await db.faculty.findUnique({ where: { id: c.facultyId } })).name, level: c.level, class: c.class,
    personalities: c.personalities, popularity: c.popularity, cgpa: avg._avg.gradePoint == null ? null : Math.round(avg._avg.gradePoint * 100) / 100,
    netWorthKobo: (c.account.balance + (biz._sum.capital ?? 0n) + (inv._sum.valueKobo ?? 0n)).toString(), graduated: c.graduated, classification: c.classification, achievements: await earnedTitles(db, c.id, c.gender), relationship: "Single" };
}

export async function sendMessage(db, userId, { to, body }) {
  const c = await me(db, userId), text = cleanText(body, 500);
  if (!text) throw new GameError("Write a message first.");
  const r = await byName(db, to); if (!r) throw new GameError("No player with that name.", 404);
  if (r.id === c.id) throw new GameError("You cannot message yourself.");
  if (await blocked(db, c.id, r.id)) throw new GameError("You cannot message this player.", 403);
  const recent = await db.message.count({ where: { fromId: c.id, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  if (recent >= 10) throw new GameError("Slow down. You can send 10 messages a minute.", 429);
  await db.message.create({ data: { fromId: c.id, toId: r.id, body: text } });
  return { ok: true };
}

export async function getMessages(db, userId, withName) {
  const c = await me(db, userId);
  if (withName) {
    const r = await byName(db, withName); if (!r) throw new GameError("No player with that name.", 404);
    const msgs = await db.message.findMany({ where: { OR: [{ fromId: c.id, toId: r.id }, { fromId: r.id, toId: c.id }] }, orderBy: { createdAt: "desc" }, take: 50 });
    await db.message.updateMany({ where: { fromId: r.id, toId: c.id, readAt: null }, data: { readAt: new Date() } });
    return { with: r.name, messages: msgs.reverse().map((m) => ({ mine: m.fromId === c.id, body: m.body, at: m.createdAt })) };
  }
  const rows = await db.message.findMany({ where: { OR: [{ fromId: c.id }, { toId: c.id }] }, orderBy: { createdAt: "desc" }, take: 200 });
  const seen = new Map();
  for (const m of rows) { const other = m.fromId === c.id ? m.toId : m.fromId; const e = seen.get(other) ?? { other, last: m.body, at: m.createdAt, unread: 0 }; if (m.toId === c.id && !m.readAt) e.unread++; seen.set(other, e); }
  const people = await db.character.findMany({ where: { id: { in: [...seen.keys()] } }, select: { id: true, name: true } });
  const nm = new Map(people.map((p) => [p.id, p.name]));
  return { conversations: [...seen.values()].map((e) => ({ name: nm.get(e.other), last: e.last, at: e.at, unread: e.unread })) };
}

export async function sendMoney(db, userId, { to, amountNaira, memo, requestId }) {
  needReq(requestId);
  const n = Number(amountNaira);
  if (!Number.isInteger(n) || n < P2P.minNaira || n > P2P.maxNaira) throw new GameError("Send a whole amount between ₦100 and ₦5,000,000.");
  const week = await start(db, userId), note = cleanText(memo, 80);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), r = await byName(tx, to);
      if (!r) throw new GameError("No player with that name.", 404);
      if (r.id === c.id) throw new GameError("You cannot send money to yourself.");
      if (await blocked(tx, c.id, r.id)) throw new GameError("You cannot send money to this player.", 403);
      const amount = BigInt(n) * 100n, fee = feeFor(amount);
      const sent = await tx.ledgerEntry.aggregate({ _sum: { amount: true }, where: { debitAccountId: c.account.id, idempotencyKey: { startsWith: "p2p:" }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
      if ((sent._sum.amount ?? 0n) + amount > P2P.dailyKobo) throw new GameError("Daily transfer limit reached (₦10,000,000).", 429);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "transfer", gameWeek: week } }); // P2002 on replay
      await transferInTx(tx, { fromId: c.account.id, toId: r.account.id, amount, memo: `To ${r.name}${note ? ": " + note : ""}`, key: `p2p:${c.id}:${requestId}`, week });
      if (fee > 0n) { const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
        await transferInTx(tx, { fromId: c.account.id, toId: world.id, amount: fee, memo: "Transfer fee", key: `fee:${c.id}:${requestId}`, week }); }
      await tx.notification.create({ data: { characterId: r.id, kind: "MONEY", body: `${c.name} sent you ₦${n.toLocaleString("en-NG")}.` } });
      return { ok: true, sentKobo: amount.toString(), feeKobo: fee.toString() };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that. The 2% fee is added on top.", 402);
    throw e;
  }
}

export async function safety(db, userId, { action, name, reason }) {
  const c = await me(db, userId), r = await byName(db, name);
  if (!r || r.id === c.id) throw new GameError("No such player.", 404);
  if (action === "block") { await db.block.upsert({ where: { blockerId_blockedId: { blockerId: c.id, blockedId: r.id } }, update: {}, create: { blockerId: c.id, blockedId: r.id } }); return { ok: true }; }
  if (action === "report") { const text = cleanText(reason, 300); if (text.length < 5) throw new GameError("Tell us what happened (a few words).");
    await db.report.create({ data: { reporterId: c.id, targetId: r.id, reason: text } }); return { ok: true }; }
  throw new GameError("Unknown action.");
}

export async function listParties(db, userId) {
  const base = await me(db, userId), week = await currentWeek(db);
  const [nights, mine] = await Promise.all([db.partyNight.findMany({ where: { gameWeek: week } }), db.partyTicket.findFirst({ where: { characterId: base.id, gameWeek: week } })]);
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
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford the ticket.", 402);
    throw e;
  }
}

export { start, needReq };
