// lib/relationshipService.js
// The Love app on the server. Real players only: every change involves two characters, so both rows are locked together (always in
// the same order, so two people acting on each other at once can never deadlock), every request carries a requestId (a replay changes
// nothing twice) and money only moves through the ledger.
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { roll } from "./rng.js";
import { PRIVATE_HOMES, canLiveIn, movePricing } from "./rules.js";
import { roomAfterMove } from "./roomService.js";
import {
  ACTIVITY, INVITES, ASKS, COUPLE, LABEL, MAX_OPEN_REQUESTS, REQUEST_WEEKS, RECONCILE_WEEKS, CAUGHT, COST, PREGNANCY_RISK,
  clamp, otherOf, pairIds, startKind, affectionNow, moodOf, progress, limitKey, doneThisWeek, whyNotActivity, whyNotAsk, catchChance, outcome, ringOf, REQUEST_TEXT, NOTES,
} from "./relationships.js";

const N = (n) => BigInt(n) * 100n;
const SOCIAL = "SOCIAL";
const bigId = (id) => { if (!/^\d{1,18}$/.test(String(id ?? ""))) throw new GameError("That does not exist.", 404); return BigInt(id); };
const note = (tx, characterId, body) => tx.notification.create({ data: { characterId, kind: SOCIAL, body } });
const memory = (tx, bondId, week, body) => tx.bondEvent.create({ data: { bondId, gameWeek: week, body } });
const inFloorO = (c) => !!c.jailedUntil && c.jailedUntil > new Date();
const lockIds = (tx, ids) => tx.$queryRaw`SELECT id FROM "Character" WHERE id = ANY(${[...new Set(ids)]}::text[]) ORDER BY id FOR UPDATE`;
const involves = (b, id) => b.lowId === id || b.highId === id;
const mine = (id) => ({ OR: [{ lowId: id }, { highId: id }] });
const blockedPair = (tx, a, b) => tx.block.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
const livesTogether = (bond, a, b) => !!bond.together && !!bond.homeHostel && a.hostel === bond.homeHostel && b.hostel === bond.homeHostel;
const stat = (c, patch) => ({ energy: clamp(c.energy + (patch.energy ?? 0)), happiness: clamp(c.happiness + (patch.happiness ?? 0)), popularity: clamp(c.popularity + (patch.popularity ?? 0)) });

// ---------------------------------------------------------------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------------------------------------------------------------

/** Who each of these players is with right now: their babe or fiance (a bond) and how many sneaky links they keep. */
async function partnersOf(tx, ids) {
  const rows = await tx.bond.findMany({ where: { kind: { in: [...COUPLE, "SNEAKY"] }, OR: [{ lowId: { in: ids } }, { highId: { in: ids } }] } });
  const couple = new Map(), sneaky = new Map();
  for (const b of rows) for (const id of [b.lowId, b.highId]) {
    if (!ids.includes(id)) continue;
    if (COUPLE.includes(b.kind)) couple.set(id, b); else sneaky.set(id, (sneaky.get(id) ?? 0) + 1);
  }
  return { couple, sneaky };
}

/** The question every "can I?" button asks, answered for one bond. null means yes, text is the reason it is greyed out. */
function canMap(bond, me, them, week, p) {
  const ctxFor = (extra = {}) => ({
    me: me.id, week, energy: me.energy, myGender: me.gender, theirGender: them.gender, myHostel: me.hostel, offCampus: PRIVATE_HOMES.includes(me.hostel),
    hasBabe: !!p.couple.get(me.id) && p.couple.get(me.id).id !== bond.id, theyHaveBabe: !!p.couple.get(them.id) && p.couple.get(them.id).id !== bond.id,
    mySneaky: p.sneaky.get(me.id) ?? 0, theirSneaky: p.sneaky.get(them.id) ?? 0, together: livesTogether(bond, me, them), ...extra,
  });
  const can = {};
  for (const k of Object.keys(ACTIVITY)) can[k] = whyNotActivity(bond, k, ctxFor());
  for (const k of ASKS) can[k] = whyNotAsk(bond, k, ctxFor());
  if (them.expelled) for (const k of ["date", "visit", "hang", "night"]) can[k] = can[k] ?? "They are no longer around.";
  if (inFloorO(them)) for (const k of ["date", "visit", "hang", "night"]) can[k] = can[k] ?? `${them.name} is in Floor O right now.`;
  return can;
}

export async function getRelationship(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId);
  const c = await db.character.findUnique({ where: { id: base.id }, select: { id: true, name: true, gender: true, hostel: true, energy: true, luck: true, popularity: true, level: true } });
  // requests nobody answered in time quietly lapse
  await db.loveRequest.updateMany({ where: { status: "PENDING", gameWeek: { lt: week - REQUEST_WEEKS }, OR: [{ fromId: c.id }, { toId: c.id }] }, data: { status: "EXPIRED", answeredAt: new Date() } });
  const [bonds, requests, preg] = await Promise.all([
    db.bond.findMany({ where: mine(c.id), orderBy: { id: "asc" } }),
    db.loveRequest.findMany({ where: { status: "PENDING", OR: [{ fromId: c.id }, { toId: c.id }] }, orderBy: { id: "desc" }, take: 60 }),
    db.pregnancy.findFirst({ where: { characterId: c.id, status: "PENDING" } }),
  ]);
  const ids = [...new Set(bonds.map((b) => otherOf(b, c.id)))];
  const [people, partners, events] = await Promise.all([
    db.character.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, gender: true, level: true, hostel: true, energy: true, expelled: true, jailedUntil: true, faculty: { select: { name: true } } } }),
    partnersOf(db, [c.id, ...ids]),
    bonds.length ? db.bondEvent.findMany({ where: { bondId: { in: bonds.map((b) => b.id) } }, orderBy: { id: "desc" }, take: 80 }) : [],
  ]);
  const who = new Map(people.map((p) => [p.id, p]));
  const evBy = new Map();
  for (const e of events) { const a = evBy.get(e.bondId) ?? []; if (a.length < 6) a.push({ week: e.gameWeek, text: e.body }); evBy.set(e.bondId, a); }
  const reqBy = new Map();
  for (const r of requests) {
    const t = r.fromId === c.id ? who.get(r.toId) : who.get(r.fromId);
    const row = { id: String(r.id), bondId: String(r.bondId), kind: r.kind, variant: r.variant, mine: r.fromId === c.id, from: r.fromId === c.id ? c.name : t?.name, to: r.fromId === c.id ? t?.name : c.name, week: r.gameWeek, expiresWeek: r.gameWeek + REQUEST_WEEKS };
    row.text = REQUEST_TEXT[r.kind]?.(row.from ?? "Someone");
    const a = reqBy.get(r.bondId) ?? []; a.push(row); reqBy.set(r.bondId, a);
  }
  const out = [];
  for (const b of bonds) {
    const o = who.get(otherOf(b, c.id)); if (!o) continue;
    const together = livesTogether(b, c, o), aff = b.kind === "EX" ? 0 : affectionNow(b, week, together), pr = progress(b);
    const pend = reqBy.get(b.id) ?? [];
    out.push({
      id: String(b.id), name: o.name, gender: o.gender, faculty: o.faculty.name, level: o.level, kind: b.kind, label: LABEL[b.kind], prevKind: b.prevKind,
      affection: aff, mood: moodOf(aff), weeks: Math.max(0, week - b.kindWeek), startedWeek: b.startedWeek, together,
      dates: b.dates, meals: b.meals, visits: b.visits, progress: pr.items, ready: pr.ready,
      done: Object.fromEntries(Object.keys(ACTIVITY).map((k) => [k, doneThisWeek(b, k, c.id, week)])),
      cheat: b.cheatedBy ? { by: b.cheatedBy === c.id ? "me" : "them", week: b.cheatedWeek, strikes: b.strikes } : null,
      endedWeek: b.endedWeek, endedByMe: b.endedBy === c.id, canReconcileUntil: b.kind === "EX" ? (b.endedWeek ?? 0) + RECONCILE_WEEKS : null,
      can: canMap(b, c, o, week, partners), pending: pend, memories: evBy.get(b.id) ?? [],
    });
  }
  // players you have really talked to (a message each way) and not started anything with yet
  const talked = await db.message.findMany({ where: { OR: [{ fromId: c.id }, { toId: c.id }] }, select: { fromId: true, toId: true }, orderBy: { createdAt: "desc" }, take: 800 });
  const sent = new Set(), got = new Set();
  for (const m of talked) { if (m.fromId === c.id) sent.add(m.toId); else got.add(m.fromId); }
  const have = new Set(ids), both = [...sent].filter((id) => got.has(id) && !have.has(id)).slice(0, 40);
  let discover = [];
  if (both.length) {
    const [rows, blocks] = await Promise.all([
      db.character.findMany({ where: { id: { in: both } }, select: { id: true, name: true, gender: true, level: true, faculty: { select: { name: true } } } }),
      db.block.findMany({ where: { OR: [{ blockerId: c.id, blockedId: { in: both } }, { blockedId: c.id, blockerId: { in: both } }] }, select: { blockerId: true, blockedId: true } }),
    ]);
    const bad = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
    discover = rows.filter((r) => !bad.has(r.id)).map((r) => ({ name: r.name, gender: r.gender, faculty: r.faculty.name, level: r.level, kind: startKind(c.gender, r.gender) }));
  }
  return {
    week, partnerIsPregnant: c.gender === "M",
    me: { name: c.name, gender: c.gender, hostel: c.hostel, offCampus: PRIVATE_HOMES.includes(c.hostel) },
    bonds: out, requests: [...reqBy.values()].flat().sort((a, b) => Number(b.id) - Number(a.id)), discover,
    pregnancy: preg && { decideBy: preg.decideBy, weeksLeft: Math.max(0, preg.decideBy - week + 1) },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Opens a transaction body for one bond: finds it, locks both players (and the babes they might get caught by, when it is a sneaky link),
 * runs the usual jail / suspension checks on the caller and hands back fresh rows.
 */
async function pairTx(tx, userId, bondId) {
  const base = await tx.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const b0 = await tx.bond.findUnique({ where: { id: bondId } });
  if (!b0 || !involves(b0, base.id)) throw new GameError("That person is not in your Love list.", 404);
  let ids = [b0.lowId, b0.highId];
  if (b0.kind === "SNEAKY") { const p = await partnersOf(tx, ids); ids = [...ids, ...[...p.couple.values()].map((x) => [x.lowId, x.highId]).flat()]; }
  await lockIds(tx, ids);
  const c = await loadLocked(tx, userId);
  const bond = await tx.bond.findUnique({ where: { id: bondId } });
  if (!bond) throw new GameError("That person is not in your Love list.", 404);
  const them = await tx.character.findUnique({ where: { id: otherOf(bond, c.id) }, include: { account: true } });
  if (await blockedPair(tx, c.id, them.id)) throw new GameError("You cannot do that with this player.", 403);
  return { c, them, bond };
}

const needTogether = (them) => {
  if (them.expelled) throw new GameError(`${them.name} is no longer around.`, 409);
  if (inFloorO(them)) throw new GameError(`${them.name} is in Floor O right now.`, 409);
};

/** A sneaky link while you have a babe: the babe may find out. Returns who was caught. */
async function sneakyCheck(tx, { bond, actor, other, activity, solo, week }) {
  if (bond.kind !== "SNEAKY") return [];
  const caught = [];
  for (const p of solo ? [actor] : [actor, other]) {
    const babe = await tx.bond.findFirst({ where: { id: { not: bond.id }, kind: { in: COUPLE }, ...mine(p.id) } });
    if (!babe) continue;
    const q = await tx.character.findUnique({ where: { id: otherOf(babe, p.id) } });
    if (!q) continue;
    const chance = catchChance(activity, { luck: p.luck, popularity: p.popularity, together: livesTogether(babe, p, q), sameHall: p.hostel === q.hostel });
    if (roll(1, 100) > chance) continue;
    const sneaky = p.id === actor.id ? other : actor, strikes = babe.strikes + 1, over = strikes >= 2;
    await tx.bond.update({ where: { id: babe.id }, data: {
      affection: clamp(babe.affection - CAUGHT.affection), strikes, cheatedBy: over ? null : p.id, cheatedWeek: week, lastCheater: p.id,
      ...(over ? { kind: "EX", prevKind: babe.kind, endedWeek: week, endedBy: q.id, together: false } : {}),
    } });
    if (over) await tx.loveRequest.updateMany({ where: { bondId: babe.id, status: "PENDING" }, data: { status: "CANCELLED", answeredAt: new Date() } });
    const pf = await tx.character.findUnique({ where: { id: p.id } }), qf = await tx.character.findUnique({ where: { id: q.id } });
    await tx.character.update({ where: { id: p.id }, data: { happiness: clamp(pf.happiness - CAUGHT.happiness), popularity: clamp(pf.popularity - CAUGHT.popularity) } });
    await tx.character.update({ where: { id: q.id }, data: { happiness: clamp(qf.happiness - CAUGHT.babeHappiness) } });
    await memory(tx, babe.id, week, over ? `${p.name} was caught with ${sneaky.name} again. ${q.name} ended it.` : `${q.name} caught ${p.name} with ${sneaky.name}.`);
    await note(tx, q.id, over ? `You caught ${p.name} with ${sneaky.name} again. You ended it.` : `You caught ${p.name} with ${sneaky.name}. Forgive them or end it.`);
    await note(tx, p.id, over ? `${q.name} caught you with ${sneaky.name} again and ended it.` : `${q.name} caught you with ${sneaky.name}. They have to forgive you.`);
    await note(tx, sneaky.id, `Word got out that you and ${p.name} are together. ${q.name} knows.`);
    caught.push({ cheater: p.name, by: q.name, with: sneaky.name, over, mine: p.id === actor.id });
  }
  return caught;
}

/** Apply a finished activity to the bond and to both players. Money is paid by `payer` (the one who invited or bought). */
async function finishActivity(tx, { c, them, bond, activity, week, variant, tier, payer, venues, key, bothTired = true, solo }) {
  const o = outcome(activity, { variant, tier }); if (o.error) throw new GameError(o.error);
  const a = ACTIVITY[activity];
  if (o.costKobo > 0n) await transferInTx(tx, { fromId: payer.account.id, toId: venues.id, amount: o.costKobo, memo: `${a.label}${payer.id === c.id ? "" : " (with " + c.name + ")"}`, key, week });
  const together = livesTogether(bond, c, them);
  const aff = clamp(affectionNow(bond, week, together) + o.aff);
  const done = { ...(bond.done ?? {}), [limitKey(activity, c.id)]: week };
  await tx.bond.update({ where: { id: bond.id }, data: { affection: aff, lastWeek: week, done, ...(o.counts ? { [o.counts]: bond[o.counts] + 1 } : {}) } });
  await tx.character.update({ where: { id: c.id }, data: stat(c, { energy: -o.energy, happiness: o.happy }) });
  if (!solo || o.happy) await tx.character.update({ where: { id: them.id }, data: stat(them, { energy: solo ? 0 : -o.energy, happiness: o.happy }) });
  return { aff, o };
}

export async function relate(db, userId, body = {}) {
  const { action, requestId } = body; needReq(requestId);
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const log = (c) => tx.actionLog.create({ data: { characterId: c.id, requestId, action: "love:" + action, gameWeek: week } }); // P2002 on replay
      const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } });
      const ctxOf = async (c, bond, them) => {
        const p = await partnersOf(tx, [c.id, them.id]);
        return { me: c.id, week, energy: c.energy, myGender: c.gender, theirGender: them.gender, myHostel: c.hostel, offCampus: PRIVATE_HOMES.includes(c.hostel),
          hasBabe: !!p.couple.get(c.id) && p.couple.get(c.id).id !== bond.id, theyHaveBabe: !!p.couple.get(them.id) && p.couple.get(them.id).id !== bond.id,
          mySneaky: p.sneaky.get(c.id) ?? 0, theirSneaky: p.sneaky.get(them.id) ?? 0, together: livesTogether(bond, c, them) };
      };

      // ---- start something with a player you have talked to ----
      if (action === "add") {
        const name = String(body.name ?? "").trim().slice(0, 30);
        const base = await tx.character.findUnique({ where: { userId }, select: { id: true } });
        if (!base) throw new GameError("Create a character first.", 404);
        const target = name && await tx.character.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
        if (!target || target.id === base.id) throw new GameError("No player with that name.", 404);
        await lockIds(tx, [base.id, target.id]);
        const c = await loadLocked(tx, userId); await log(c);
        const them = await tx.character.findUnique({ where: { id: target.id } });
        if (await blockedPair(tx, c.id, them.id)) throw new GameError("You cannot do that with this player.", 403);
        const [lowId, highId] = pairIds(c.id, them.id);
        if (await tx.bond.findUnique({ where: { lowId_highId: { lowId, highId } } })) throw new GameError("You two are already in your Love lists.", 409);
        const [a, b] = await Promise.all([tx.message.count({ where: { fromId: c.id, toId: them.id } }), tx.message.count({ where: { fromId: them.id, toId: c.id } })]);
        if (!a || !b) throw new GameError("You can only start something with a player you have talked to. Message each other first.", 409);
        const [mineN, theirsN] = await Promise.all([tx.bond.count({ where: mine(c.id) }), tx.bond.count({ where: mine(them.id) })]);
        if (mineN >= 30) throw new GameError("Your Love list is full. Remove someone first.", 409);
        if (theirsN >= 30) throw new GameError(`${them.name}'s Love list is full.`, 409);
        const kind = startKind(c.gender, them.gender);
        const bond = await tx.bond.create({ data: { lowId, highId, kind, startedWeek: week, kindWeek: week, lastWeek: week } });
        await memory(tx, bond.id, week, kind === "BESTIE" ? "You became besties." : "You started talking.");
        await note(tx, them.id, `${c.name} added you in Love as ${kind === "BESTIE" ? "a bestie" : "someone they are talking to"}.`);
        return { ok: true, id: String(bond.id), kind, note: kind === "BESTIE" ? `${them.name} is your bestie now.` : `You started talking to ${them.name}.` };
      }

      // ---- answer a request: accept, decline or cancel your own ----
      if (action === "answer" || action === "cancel") {
        const reqId = bigId(body.id), r0 = await tx.loveRequest.findUnique({ where: { id: reqId } });
        if (!r0) throw new GameError("That request does not exist.", 404);
        const { c, them, bond } = await pairTx(tx, userId, r0.bondId); await log(c);
        const r = await tx.loveRequest.findUnique({ where: { id: reqId } });
        const closed = (status) => tx.loveRequest.update({ where: { id: reqId }, data: { status, answeredAt: new Date() } });
        if (r.status !== "PENDING") throw new GameError("That request is already closed.", 409);
        if (action === "cancel") {
          if (r.fromId !== c.id) throw new GameError("That is not your request.", 403);
          await closed("CANCELLED"); return { ok: true, note: "Request taken back." };
        }
        if (r.toId !== c.id) throw new GameError("That request is not for you.", 403);
        if (r.gameWeek + REQUEST_WEEKS < week) { await closed("EXPIRED"); throw new GameError("That request has lapsed.", 410); }
        const from = them; // the one who asked
        if (!body.accept) {
          await closed("DECLINED");
          const sting = r.kind === "PROPOSE" ? { happiness: -10 } : ["BABE", "SNEAKY", "RECONCILE"].includes(r.kind) ? { happiness: -4 } : {};
          if (sting.happiness) await tx.character.update({ where: { id: from.id }, data: stat(from, sting) });
          await note(tx, from.id, `${c.name} said not right now.`);
          return { ok: true, note: "Declined." };
        }
        const kind = r.kind, lower = kind.toLowerCase(), ctx = await ctxOf(from, bond, c); // ctx from the asker's side
        // ----- joint activities -----
        if (INVITES.includes(lower)) {
          needTogether(from);
          const why = whyNotActivity(bond, lower, { ...(await ctxOf(c, bond, from)) }) ?? (from.energy < ACTIVITY[lower].energy ? `${from.name} is too tired right now.` : null);
          if (why) throw new GameError(why, 409);
          if (lower === "night" && (await tx.pregnancy.findFirst({ where: { characterId: { in: [c.id, from.id] }, status: "PENDING" } }))) throw new GameError("Sort out what is happening first.", 409);
          const payer = await tx.character.findUnique({ where: { id: from.id }, include: { account: true } });
          let fin;
          try { fin = await finishActivity(tx, { c: from, them: c, bond, activity: lower, week, variant: r.variant, payer, venues, key: `love:${r.id}` }); }
          catch (e) { if (e instanceof InsufficientFunds) throw new GameError(`${from.name} cannot cover it right now.`, 402); throw e; }
          // finishActivity ran from the asker's side: the energy/happiness it gave "c" went to the asker and "them" to the accepter. Good: both covered.
          await closed("ACCEPTED");
          await memory(tx, bond.id, week, { date: `${from.name} took ${c.name} on a date.`, visit: `${c.name} visited ${from.name}.`, hang: "You two hung out.", night: "A night in." }[lower]);
          await note(tx, from.id, `${c.name} said yes.`);
          let pregnant = false;
          if (lower === "night" && c.gender !== from.gender && roll(1, 100) <= PREGNANCY_RISK[r.variant === "safe" ? "safe" : "risky"]) {
            const noPending = !(await tx.pregnancy.findFirst({ where: { characterId: { in: [c.id, from.id] }, status: "PENDING" } }));
            if (noPending) {
              pregnant = true;
              for (const p of [c, from]) {
                await tx.pregnancy.create({ data: { characterId: p.id, relationshipId: bond.id, startedWeek: week, decideBy: week + 2 } });
                const q = p.id === c.id ? from : c;
                await note(tx, p.id, p.gender === "F" ? "You think you might be pregnant. You have 2 game weeks to decide what to do." : `${q.name} says she is pregnant. You have 2 game weeks to decide together what to do.`);
              }
            }
          }
          const caught = await sneakyCheck(tx, { bond, actor: from, other: c, activity: lower, solo: false, week });
          return { ok: true, note: { date: "Date on. You two had a lovely evening.", visit: "You went over. Good vibes.", hang: "You hung out.", night: "A night in." }[lower], pregnancy: pregnant, caught: caught.map((x) => ({ ...x, mine: x.cheater === c.name })), affection: fin.aff };
        }
        // ----- status asks -----
        const why = whyNotAsk(bond, kind, ctx);
        if (why) throw new GameError(why, 409);
        if (kind === "BABE" || kind === "SNEAKY") {
          needTogether(from);
          await tx.bond.update({ where: { id: bond.id }, data: { kind, prevKind: null, kindWeek: week, lastWeek: week, affection: clamp(affectionNow(bond, week) + 10), ...(kind === "BABE" ? { everBabe: true } : {}) } });
          await tx.character.update({ where: { id: c.id }, data: stat(c, { happiness: 10 }) });
          await tx.character.update({ where: { id: from.id }, data: stat(from, { happiness: 10 }) });
          await closed("ACCEPTED");
          if (kind === "BABE") await tx.loveRequest.updateMany({ where: { kind: "BABE", status: "PENDING", bondId: { not: bond.id }, OR: [{ fromId: { in: [c.id, from.id] } }, { toId: { in: [c.id, from.id] } }] }, data: { status: "CANCELLED", answeredAt: new Date() } });
          await memory(tx, bond.id, week, kind === "BABE" ? "You became babes." : "You became sneaky links.");
          await note(tx, from.id, kind === "BABE" ? `${c.name} said yes. You are babes now.` : `${c.name} said yes. Keep it quiet.`);
          return { ok: true, note: kind === "BABE" ? `${from.name} is your babe now.` : `${from.name} is your sneaky link now. Be careful.` };
        }
        if (kind === "PROPOSE") {
          const ring = ringOf(r.variant); if (!ring) throw new GameError("The ring is missing from the request.");
          const payer = await tx.character.findUnique({ where: { id: from.id }, include: { account: true } });
          try { await transferInTx(tx, { fromId: payer.account.id, toId: venues.id, amount: ring.costKobo, memo: "Engagement ring", key: `love:${r.id}`, week }); }
          catch (e) { if (e instanceof InsufficientFunds) throw new GameError(`${from.name} cannot cover the ring right now.`, 402); throw e; }
          await tx.bond.update({ where: { id: bond.id }, data: { kind: "ENGAGED", kindWeek: week, lastWeek: week, everEngaged: true, affection: clamp(affectionNow(bond, week, livesTogether(bond, c, from)) + ring.aff) } });
          for (const p of [c, from]) await tx.character.update({ where: { id: p.id }, data: stat(p, { happiness: 15, popularity: 2 }) });
          await closed("ACCEPTED");
          await memory(tx, bond.id, week, `${from.name} proposed. ${c.name} said yes.`);
          await note(tx, from.id, `${c.name} said yes. You are engaged.`);
          return { ok: true, note: `You said yes. You are engaged to ${from.name}.` };
        }
        if (kind === "MOVEIN") {
          needTogether(from);
          const host = from, mover = c, target = host.hostel;
          if (!PRIVATE_HOMES.includes(target)) throw new GameError(`${host.name} no longer lives off campus.`, 409);
          if (!canLiveIn(mover.gender, target)) throw new GameError("You cannot live there.", 409);
          if (mover.graduated) throw new GameError("You have graduated, so you cannot rent a new home.", 409);
          let paidKobo = 0n, prepaidUntil = mover.rentPaidUntilWeek;
          if (mover.hostel !== target) {
            const p = movePricing({ from: mover.hostel, to: target, week, sessionStart: mover.sessionStartWeek, paidUntil: mover.rentPaidUntilWeek });
            const landlords = await tx.account.findUnique({ where: { systemName: "LANDLORDS" } });
            const hostFull = await tx.character.findUnique({ where: { id: host.id }, include: { account: true } });
            const payer = r.variant === "cover" ? hostFull : mover, key = `love:${r.id}`;
            try {
              if (p.netKobo > 0n) await transferInTx(tx, { fromId: payer.account.id, toId: landlords.id, amount: p.netKobo, memo: `Moved in with ${host.name} (${target}): rent for the rest of the session`, key, week });
              else if (p.netKobo < 0n) await transferInTx(tx, { fromId: landlords.id, toId: mover.account.id, amount: -p.netKobo, memo: `Moved in with ${host.name}: rent paid back`, key, week });
            } catch (e) { if (e instanceof InsufficientFunds) throw new GameError(payer.id === mover.id ? "You cannot afford the rent." : `${host.name} cannot cover the rent right now.`, 402); throw e; }
            paidKobo = p.netKobo; prepaidUntil = p.prepaidUntil;
            await tx.character.update({ where: { id: mover.id }, data: { hostel: target, rentPaidUntilWeek: prepaidUntil } });
            mover.hostel = target; mover.rentPaidUntilWeek = prepaidUntil;
            await roomAfterMove(tx, mover);
          }
          await tx.bond.update({ where: { id: bond.id }, data: { together: true, homeHostel: target, lastWeek: week, affection: clamp(affectionNow(bond, week) + 15) } });
          for (const p of [c, from]) await tx.character.update({ where: { id: p.id }, data: stat(p, { happiness: 12 }) });
          await closed("ACCEPTED");
          await memory(tx, bond.id, week, `${mover.name} moved in with ${host.name}.`);
          await note(tx, from.id, `${c.name} moved in with you.`);
          return { ok: true, note: `You moved in with ${host.name}.`, hostel: target, paidKobo: paidKobo.toString() };
        }
        if (kind === "RECONCILE") {
          const payer = await tx.character.findUnique({ where: { id: from.id }, include: { account: true } });
          try { await transferInTx(tx, { fromId: payer.account.id, toId: venues.id, amount: N(COST.reconcile), memo: "Making up", key: `love:${r.id}`, week }); }
          catch (e) { if (e instanceof InsufficientFunds) throw new GameError(`${from.name} cannot cover it right now.`, 402); throw e; }
          const back = bond.prevKind === "ENGAGED" ? "BABE" : bond.prevKind || startKind(c.gender, from.gender);
          await tx.bond.update({ where: { id: bond.id }, data: { kind: back, prevKind: null, kindWeek: week, lastWeek: week, affection: Math.max(40, Math.floor(bond.affection / 2)), endedWeek: null, endedBy: null, cheatedBy: null } });
          await closed("ACCEPTED");
          await memory(tx, bond.id, week, "You got back together.");
          await note(tx, from.id, `${c.name} said yes. You are back together.`);
          return { ok: true, note: `You and ${from.name} are back together.` };
        }
        throw new GameError("Unknown request.");
      }

      // ---- every other action is about one bond ----
      const { c, them, bond } = await pairTx(tx, userId, bigId(body.id)); await log(c);
      const ctx = await ctxOf(c, bond, them);

      if (action === "note" || action === "food" || action === "gift") {
        const why = whyNotActivity(bond, action, ctx); if (why) throw new GameError(why, 409);
        if (them.expelled) throw new GameError(`${them.name} is no longer around.`, 409);
        let text = null;
        if (action === "note") { text = NOTES[Number(body.line)]; if (!text) throw new GameError("Pick a note to send."); }
        let fin;
        try { fin = await finishActivity(tx, { c, them, bond, activity: action, week, tier: body.tier, payer: c, venues, key: `love:${c.id}:${requestId}`, solo: true }); }
        catch (e) { if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402); throw e; }
        if (text) await tx.message.create({ data: { fromId: c.id, toId: them.id, body: text } });
        const label = { note: "sent a note", food: "bought food for", gift: "sent a gift to" }[action];
        await memory(tx, bond.id, week, action === "note" ? `${c.name} sent ${them.name} a note.` : `${c.name} ${label} ${them.name}.`);
        await note(tx, them.id, action === "note" ? `${c.name} sent you a note.` : action === "food" ? `${c.name} bought you food.` : `${c.name} sent you a gift.`);
        const caught = await sneakyCheck(tx, { bond, actor: c, other: them, activity: action, solo: true, week });
        return { ok: true, note: { note: "Note sent.", food: `You bought ${them.name} food.`, gift: "They loved it." }[action], affection: fin.aff, caught };
      }

      if (action === "request") {
        const kind = String(body.kind ?? "").toUpperCase(), lower = kind.toLowerCase();
        const isInvite = INVITES.includes(lower);
        if (!isInvite && !ASKS.includes(kind)) throw new GameError("Unknown request.");
        const why = isInvite ? whyNotActivity(bond, lower, ctx) : whyNotAsk(bond, kind, ctx);
        if (why) throw new GameError(why, 409);
        if (isInvite || kind === "MOVEIN") needTogether(them);
        let variant = null;
        if (lower === "night") { variant = body.variant === "safe" ? "safe" : "risky"; if (await tx.pregnancy.findFirst({ where: { characterId: { in: [c.id, them.id] }, status: "PENDING" } })) throw new GameError("Sort out what is happening first.", 409); }
        if (kind === "PROPOSE") { variant = String(body.variant ?? ""); const ring = ringOf(variant); if (!ring) throw new GameError("Choose a ring."); if (c.account.balance < ring.costKobo) throw new GameError("You cannot afford that ring.", 402); }
        if (kind === "MOVEIN") variant = body.variant === "own" ? "own" : "cover";
        if (kind === "RECONCILE" && c.account.balance < N(COST.reconcile)) throw new GameError("You cannot afford the gift that goes with it.", 402);
        if (isInvite && c.account.balance < outcome(lower, { variant }).costKobo) throw new GameError("You cannot afford that.", 402);
        if (await tx.loveRequest.findFirst({ where: { bondId: bond.id, kind, status: "PENDING" } })) throw new GameError("You already asked. Wait for their answer.", 409);
        if ((await tx.loveRequest.count({ where: { fromId: c.id, status: "PENDING" } })) >= MAX_OPEN_REQUESTS) throw new GameError("You have too many requests waiting. Cancel some first.", 429);
        const r = await tx.loveRequest.create({ data: { bondId: bond.id, fromId: c.id, toId: them.id, kind, variant, gameWeek: week } });
        await note(tx, them.id, REQUEST_TEXT[kind](c.name) + ". Open Love to answer.");
        return { ok: true, id: String(r.id), note: `Sent to ${them.name}.` };
      }

      if (action === "breakup") {
        if (bond.kind === "EX") throw new GameError("You two are already over.", 409);
        const hit = { ENGAGED: 20, BABE: 10, SNEAKY: 4, TALKING: 3, BESTIE: 3 }[bond.kind];
        await tx.bond.update({ where: { id: bond.id }, data: { kind: "EX", prevKind: bond.kind, endedWeek: week, endedBy: c.id, together: false, cheatedBy: null } });
        await tx.loveRequest.updateMany({ where: { bondId: bond.id, status: "PENDING" }, data: { status: "CANCELLED", answeredAt: new Date() } });
        await tx.character.update({ where: { id: c.id }, data: stat(c, { happiness: -Math.ceil(hit / 2) }) });
        await tx.character.update({ where: { id: them.id }, data: stat(them, { happiness: -hit }) });
        await memory(tx, bond.id, week, `${c.name} ended things.`);
        await note(tx, them.id, `${c.name} ended things with you.`);
        return { ok: true, note: `You ended things with ${them.name}.` };
      }
      if (action === "forgive") {
        if (!bond.cheatedBy || bond.cheatedBy === c.id) throw new GameError("There is nothing to forgive.", 409);
        await tx.bond.update({ where: { id: bond.id }, data: { cheatedBy: null, affection: clamp(bond.affection + CAUGHT.forgiveAffection), lastWeek: week } });
        await memory(tx, bond.id, week, `${c.name} forgave ${them.name}.`);
        await note(tx, them.id, `${c.name} forgave you. Do not do it again.`);
        return { ok: true, note: `You forgave ${them.name}.` };
      }
      if (action === "apologise") {
        if (bond.cheatedBy !== c.id) throw new GameError("There is nothing to apologise for.", 409);
        if ((bond.done ?? {}).apology === week) throw new GameError("You already apologised this week.", 409);
        try { await transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount: N(COST.apology), memo: "Making it up", key: `love:${c.id}:${requestId}`, week }); }
        catch (e) { if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402); throw e; }
        await tx.bond.update({ where: { id: bond.id }, data: { affection: clamp(bond.affection + CAUGHT.apology), done: { ...(bond.done ?? {}), apology: week }, lastWeek: week } });
        await note(tx, them.id, `${c.name} apologised and sent you something nice.`);
        return { ok: true, note: "They know you are sorry." };
      }
      if (action === "fresh") {
        if (bond.kind !== "EX") throw new GameError("You are not broken up.", 409);
        const kind = startKind(c.gender, them.gender);
        await tx.bond.update({ where: { id: bond.id }, data: { kind, prevKind: null, affection: 0, kindWeek: week, lastWeek: week, dates: 0, meals: 0, visits: 0, done: {}, endedWeek: null, endedBy: null, together: false, homeHostel: null, cheatedBy: null, strikes: 0 } });
        await memory(tx, bond.id, week, "You started over as friends.");
        return { ok: true, note: `You and ${them.name} are starting over.` };
      }
      if (action === "remove") {
        if (!["TALKING", "BESTIE", "EX"].includes(bond.kind)) throw new GameError("End it first.", 409);
        await tx.loveRequest.deleteMany({ where: { bondId: bond.id } });
        await tx.bondEvent.deleteMany({ where: { bondId: bond.id } });
        await tx.bond.delete({ where: { id: bond.id } });
        return { ok: true, note: `${them.name} was removed.` };
      }
      throw new GameError("Unknown action.");
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    throw e;
  }
}

/** Neutral, abstract game mechanic. Costs are fixed; consequences are stats, money and reputation. */
export async function decidePregnancy(db, userId, { choice, requestId }) {
  needReq(requestId);
  if (!["keep", "end"].includes(choice)) throw new GameError("Choose an option.");
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "preg:" + choice, gameWeek: week } });
      const p = await tx.pregnancy.findFirst({ where: { characterId: c.id, status: "PENDING" } });
      if (!p) throw new GameError("There is nothing to decide right now.", 404);
      const clinics = await tx.account.findUnique({ where: { systemName: "CLINICS" } });
      const keep = choice === "keep";
      await transferInTx(tx, { fromId: c.account.id, toId: clinics.id, amount: N(keep ? 150_000 : 500_000), memo: keep ? "Baby setup costs" : "Clinic fees", key: `preg:${p.id}`, week });
      await tx.pregnancy.update({ where: { id: p.id }, data: { status: keep ? "KEPT" : "ENDED" } });
      await tx.character.update({ where: { id: c.id }, data: keep
        ? { dependents: c.dependents + 1, happiness: clamp(c.happiness - 5), popularity: clamp(c.popularity - 2) }
        : { happiness: clamp(c.happiness - 12), energy: clamp(c.energy - 10) } });
      await tx.bond.updateMany({ where: { id: p.relationshipId, kind: { not: "EX" } }, data: { affection: keep ? 80 : 40 } });
      return { ok: true, choice };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that option right now.", 402);
    throw e;
  }
}