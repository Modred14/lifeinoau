// lib/newLifeService.js
// "Start a new life": delete the player's CHARACTER and everything that belongs to it, and nothing else.
// The account (User: email, password, role) is never touched, so the player simply lands on character creation again. All of it happens in ONE database
// transaction on the server: it either completes or changes nothing.
//   - it needs the exact confirmation token AND the account password, so a stolen tab or a stray request can never reset anyone;
//   - the player is always the logged-in one (taken from the signed cookie by the route), never named in the request;
//   - money stays whole: cash, business capital and invested money go back to the WORLD account through the ledger (no coin is created or lost),
//     and the old ledger rows are kept as history (the player's old Account becomes an empty account that belongs to nobody);
//   - what is public record stays: student election ballots and results, moderation reports, and anything bought with real money (billboards);
//   - the saved preferences are written to the audit log, and character creation hands them to the next character, so settings survive a new life.
import { GameError } from "./gameService.js";
import { check } from "./auth.js";
import { transferInTx } from "./ledger.js";
import { currentWeek } from "./clock.js";
import { cleanSettings, settingsOf } from "./settings.js";
import { NEW_LIFE_CONFIRM, newLifeBlockers } from "./newLifeRules.js";

const ROMANTIC = ["SNEAKY", "BABE", "ENGAGED"];

/** Lock the player's row for the rest of the transaction (one change at a time) and return it with its account. */
async function lockCharacter(tx, userId) {
  const base = await tx.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("There is no life to restart: create a character first.", 404);
  await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${base.id} FOR UPDATE`;
  return tx.character.findUnique({ where: { id: base.id }, include: { account: true } });
}

/** The facts that decide whether a new life may start (read inside the transaction, after the lock). */
async function factsOf(db, c, now) {
  const mine = [{ hostId: c.id }, { guestId: c.id }];
  const [matches, seated, queued, openBets, flyingRounds, candidacies, sugOffices, buyouts] = await Promise.all([
    db.gameMatch.count({ where: { status: { in: ["INVITED", "ACTIVE"] }, OR: mine } }),
    db.gameSeat.count({ where: { characterId: c.id } }),
    db.gameQueue.count({ where: { characterId: c.id } }),
    db.betSlip.count({ where: { characterId: c.id, status: "OPEN" } }),
    db.casinoRound.count({ where: { characterId: c.id, status: "FLYING" } }),
    db.sugCandidate.findMany({ where: { characterId: c.id, status: "ACTIVE" }, select: { cycleId: true } }),
    db.sugAppointment.count({ where: { characterId: c.id, status: "ACTIVE" } }),
    db.clubBuyout.count({ where: { characterId: c.id, endsAt: { gt: new Date(now) } } }),
  ]);
  const sugCandidacies = candidacies.length ? await db.sugCycle.count({ where: { id: { in: candidacies.map((x) => x.cycleId) }, status: "LIVE" } }) : 0;
  return { jailedUntil: c.jailedUntil, suspendedUntil: c.suspendedUntil, expelled: c.expelled, expelledUntil: c.expelledUntil, matches, seated, queued, openBets, flyingRounds, sugCandidacies, sugOffices, buyouts };
}

/** What stands in the way (the Settings dialog asks before it lets the player go on). Changes nothing. */
export async function newLifeCheck(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true, name: true, jailedUntil: true, suspendedUntil: true, expelled: true, expelledUntil: true } });
  if (!c) throw new GameError("There is no life to restart: create a character first.", 404);
  return { name: c.name, blockers: newLifeBlockers(await factsOf(db, c, Date.now()), Date.now()) };
}

/** The preferences a player had when they last started a new life, for the character they create next (or null). */
export async function carriedSettings(db, userId) {
  const row = await db.auditLog.findFirst({ where: { action: "NEW_LIFE", target: userId }, orderBy: { createdAt: "desc" } });
  return row?.detail?.settings ? cleanSettings(row.detail.settings) : null;
}

/** Move the old life's money out through the ledger, so the books still add up. */
async function closeMoney(tx, c, week) {
  const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
  if (!world) throw new GameError("The game is not ready yet. Try again in a moment.", 503);
  const sweep = async (from, amount, memo, key) => { if (amount > 0n) await transferInTx(tx, { fromId: from.id, toId: world.id, amount, memo, key, week }); };

  const businesses = await tx.business.findMany({ where: { characterId: c.id, status: "ACTIVE" } });
  if (businesses.length) {
    const pool = await tx.account.findUnique({ where: { systemName: "BUSINESS" } });
    if (pool) for (const b of businesses) await sweep(pool, BigInt(b.capital), "New life: business closed", `newlife:biz:${b.id}`);
  }
  const holdings = (await tx.holding.findMany({ where: { characterId: c.id } })).filter((h) => BigInt(h.unitsMicro) > 0n && BigInt(h.costKobo) > 0n);
  if (holdings.length) {
    const market = await tx.account.findUnique({ where: { systemName: "MARKET" } });
    if (market) for (const h of holdings) await sweep(market, BigInt(h.costKobo), "New life: investments closed", `newlife:inv:${c.id}:${h.product}`);
  }
  const saved = await tx.savingsAccount.findUnique({ where: { characterId: c.id } }); // the Bank app's savings are held by the SAVINGS account: they go back through the ledger too
  if (saved && BigInt(saved.balance) > 0n) { const pool = await tx.account.findUnique({ where: { systemName: "SAVINGS" } }); if (pool) await sweep(pool, BigInt(saved.balance), "New life: savings closed", `newlife:savings:${c.id}`); }
  const acc = c.account && (await tx.account.findUnique({ where: { id: c.account.id } }));
  if (acc) await sweep(acc, BigInt(acc.balance), "New life: account closed", `newlife:cash:${c.id}`);
}

/** Tell the partners of romantic bonds that the link ended (the bond rows themselves are removed below). */
async function tellPartners(tx, c, bonds) {
  for (const b of bonds) {
    if (!ROMANTIC.includes(b.kind)) continue;
    const other = b.lowId === c.id ? b.highId : b.lowId;
    await tx.notification.create({ data: { characterId: other, kind: "SOCIAL", body: `💔 ${c.name} started a new life. Your link with them has ended.` } });
  }
}

/** Remove the player's character and everything that belongs to it. Returns { ok: true }. */
export async function startNewLife(db, userId, { password, confirm } = {}) {
  if (confirm !== NEW_LIFE_CONFIRM) throw new GameError("Please confirm that you want to start a new life.", 400);
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !(await check(String(password ?? ""), u.passwordHash))) throw new GameError("Your password is not right.", 403); // checked before anything is locked
  return db.$transaction(async (tx) => {
    const c = await lockCharacter(tx, userId), now = Date.now();
    const blockers = newLifeBlockers(await factsOf(tx, c, now), now);
    if (blockers.length) throw new GameError(blockers[0], 409);
    const week = await currentWeek(tx), id = c.id;
    await closeMoney(tx, c, week);

    // relationships with other players: the bond rows go, the partner is told
    const bonds = await tx.bond.findMany({ where: { OR: [{ lowId: id }, { highId: id }] } });
    const bondIds = bonds.map((b) => b.id);
    await tellPartners(tx, c, bonds);
    await tx.loveRequest.deleteMany({ where: { OR: [{ fromId: id }, { toId: id }, ...(bondIds.length ? [{ bondId: { in: bondIds } }] : [])] } });
    if (bondIds.length) { await tx.bondEvent.deleteMany({ where: { bondId: { in: bondIds } } }); await tx.bond.deleteMany({ where: { id: { in: bondIds } } }); }
    // chats: the conversations this player was part of (and their messages)
    const chats = await tx.chat.findMany({ where: { OR: [{ aId: id }, { bId: id }] }, select: { id: true } });
    if (chats.length) { const ids = chats.map((x) => x.id); await tx.message.deleteMany({ where: { chatId: { in: ids } } }); await tx.chat.deleteMany({ where: { id: { in: ids } } }); }
    await tx.block.deleteMany({ where: { OR: [{ blockerId: id }, { blockedId: id }] } });

    // everything else that is keyed by this character
    for (const m of ["notification", "actionLog", "activityRun", "floorZero", "lectureEncounter", "examResult", "presence", "partyTicket", "relationship", "pregnancy", "achievement",
      "business", "holding", "marketTrade", "courseProgress", "roomItem", "wardrobeItem", "betSlip", "casinoRound", "campusAssessment", "jobShift", "hustleRun", "classTest", "ownedCar", "clubTransaction",
      "clubBuyout", "clubVip", "gameQueue", "gameSeat", "savingsGoal", "savingsAccount", "phoneLine"]) await tx[m].deleteMany({ where: { characterId: id } }); // goals go before the savings row they are set aside from
    await tx.phoneCall.deleteMany({ where: { OR: [{ callerId: id }, { calleeId: id }] } }); // call history (an unanswered ring or a pending ask goes with it: no money was moved)
    await tx.clubEvent.deleteMany({ where: { actorId: id } });

    // the old account keeps its ledger history but now belongs to nobody (its balance was moved out above)
    if (c.account) await tx.account.update({ where: { id: c.account.id }, data: { characterId: null } });
    await tx.character.delete({ where: { id } });
    await tx.auditLog.create({ data: { actorId: id, action: "NEW_LIFE", target: userId, detail: { name: c.name, class: c.class, level: c.level, week, settings: settingsOf(c) } } });
    return { ok: true };
  });
}
