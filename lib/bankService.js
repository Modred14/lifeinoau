// lib/bankService.js
// The Bank app on the server. Every rule is enforced here; the screens only ask.
//
//  - Spendable money is the player's Account.balance (the wallet the whole game uses). Savings are held in the SAVINGS system account of the ledger
//    (like BUSINESS and MARKET hold business capital and investments), and SavingsAccount says how much of it is the player's. Nothing else may
//    touch either number: both change only here, in the same transaction as the ledger entry that explains them.
//  - Every change is one database transaction behind the player's row lock (one action at a time per player), with an ActionLog row per request id
//    (a double tap or a retry is answered "duplicate" and moves nothing) and a ledger key that is unique as well.
//  - Balances are re-checked under the lock, inside SQL (UPDATE ... WHERE balance >= amount), so they can never go negative, and the database
//    has CHECKs and a trigger for the same rules (see the migration 20261024030000_bank_calls).
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { refreshHoldingValues } from "./marketLive.js";
import { BANK, parseNaira, cleanGoalName, netWorthOf, splitSavings, goalPct, accountNumber, cardTierOf, describeEntry, HISTORY_FILTERS } from "./bankRules.js";

const s = (k) => (k ?? 0n).toString();
const fmt = (k) => "₦" + (BigInt(k) / 100n).toLocaleString("en-NG");

/** The SAVINGS system account. The migration creates it; this makes it on first use if a database was seeded by hand. (ON CONFLICT: never an aborted transaction.) */
export async function savingsPool(db) {
  let a = await db.account.findUnique({ where: { systemName: "SAVINGS" } });
  if (!a) {
    await db.$executeRaw`INSERT INTO "Account" ("id", "kind", "systemName", "balance") VALUES ('sys_savings', 'SYSTEM', 'SAVINGS', 0) ON CONFLICT ("systemName") DO NOTHING`;
    a = await db.account.findUnique({ where: { systemName: "SAVINGS" } });
  }
  return a;
}

const goalView = (g) => ({ id: s(g.id), name: g.name, targetKobo: s(g.targetKobo), savedKobo: s(g.savedKobo), status: g.status, pct: goalPct(g), createdAt: g.createdAt, achievedAt: g.achievedAt });
const openGoals = (db, characterId) => db.savingsGoal.findMany({ where: { characterId, status: { in: ["ACTIVE", "ACHIEVED"] } }, orderBy: { id: "asc" } });

/** Everything the Bank screen shows at once. */
export async function getBank(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId); // catches the player up, which also marks their investments to market (so net worth is current)
  if (globalThis.db) await refreshHoldingValues(db).catch(() => {}); // investments are priced live: the same throttled re-valuation the FORBES board does, so the Bank and the board never drift apart
  const c = await db.character.findUnique({ where: { id: base.id }, include: { account: true } });
  const [sav, goals, biz, inv] = await Promise.all([
    db.savingsAccount.findUnique({ where: { characterId: c.id } }),
    openGoals(db, c.id),
    db.business.aggregate({ _sum: { capital: true }, where: { characterId: c.id, status: "ACTIVE" } }),
    db.holding.aggregate({ _sum: { valueKobo: true }, where: { characterId: c.id } }),
  ]);
  const savings = sav?.balance ?? 0n, split = splitSavings(savings, goals);
  const nw = netWorthOf({ cash: c.account.balance, savings, business: biz._sum.capital ?? 0n, investments: inv._sum.valueKobo ?? 0n });
  const recent = (await statement(db, c.account.id, { limit: 5 })).rows;
  return {
    week,
    card: { holder: c.name, number: accountNumber(c.id), tier: cardTierOf(c.class), cls: c.class },
    availableKobo: s(c.account.balance), savingsKobo: s(savings), freeSavingsKobo: s(split.free), setAsideKobo: s(split.earmarked),
    netWorth: { totalKobo: s(nw.total), parts: { cash: s(nw.cash), savings: s(nw.savings), business: s(nw.business), investments: s(nw.investments) } },
    goals: goals.map(goalView), limits: { minNaira: BANK.minNaira, maxNaira: BANK.maxNaira, maxGoals: BANK.maxGoals, goalMinNaira: BANK.goalMinNaira, goalMaxNaira: BANK.goalMaxNaira },
    recent,
  };
}

/** One page of the statement for an account: newest first. `cursor` is the id of the last row already shown. */
async function statement(db, accountId, { cursor, filter = "all", limit = BANK.historyPage } = {}) {
  const f = HISTORY_FILTERS.includes(filter) ? filter : "all";
  const lim = Math.min(Math.max(Number(limit) || BANK.historyPage, 1), 100);
  const mine = [{ debitAccountId: accountId }, { creditAccountId: accountId }];
  let where = { OR: mine };
  if (f === "in") where = { creditAccountId: accountId };
  else if (f === "out") where = { debitAccountId: accountId };
  else if (f === "transfers") where = { OR: mine, idempotencyKey: { startsWith: "p2p:" } };
  else if (f === "savings") { const pool = await savingsPool(db); where = { OR: [{ debitAccountId: accountId, creditAccountId: pool.id }, { creditAccountId: accountId, debitAccountId: pool.id }] }; }
  if (cursor != null && cursor !== "") { if (!/^\d{1,18}$/.test(String(cursor))) throw new GameError("Bad page."); where = { AND: [where, { id: { lt: BigInt(cursor) } }] }; }
  const rows = await db.ledgerEntry.findMany({ where, orderBy: { id: "desc" }, take: lim + 1 });
  const page = rows.slice(0, lim);
  const ids = [...new Set(page.map((r) => (r.debitAccountId === accountId ? r.creditAccountId : r.debitAccountId)))];
  const others = ids.length ? await db.account.findMany({ where: { id: { in: ids } }, select: { id: true, systemName: true, character: { select: { name: true } } } }) : [];
  const byId = new Map(others.map((a) => [a.id, a]));
  return { rows: page.map((r) => describeEntry(r, accountId, byId.get(r.debitAccountId === accountId ? r.creditAccountId : r.debitAccountId) ?? null)),
    next: rows.length > lim ? s(page[page.length - 1].id) : null };
}

export async function getHistory(db, userId, { cursor, filter, limit } = {}) {
  const c = await db.character.findUnique({ where: { userId }, include: { account: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  return statement(db, c.account.id, { cursor, filter, limit });
}

// ---------- changes ----------
/** Runs `fn(tx, c, week)` as one transaction for a player whose row is locked, once per requestId. A replay answers { ok: true, duplicate: true }. */
async function change(db, userId, requestId, action, fn) {
  needReq(requestId);
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true }); // banking is a phone action: custody stops you leaving, not saving
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action, gameWeek: week } }); // P2002 on replay
      return fn(tx, c, week);
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You do not have enough money in your account for that.", 402);
    throw e;
  }
}

const amountOf = (v, what) => { const p = parseNaira(v, { what }); if (p.error) throw new GameError(p.error); return p.n; };
async function achieve(tx, c, g, now = new Date()) {
  await tx.savingsGoal.update({ where: { id: g.id }, data: { status: "ACHIEVED", achievedAt: now } });
  await tx.notification.create({ data: { characterId: c.id, kind: "MONEY", body: `🎯 Goal reached: ${g.name}. ${fmt(g.targetKobo)} is set aside.` } });
}
async function needGoal(tx, c, goalId, statuses = ["ACTIVE"]) {
  if (!/^\d{1,18}$/.test(String(goalId ?? ""))) throw new GameError("Pick one of your savings goals.");
  const g = await tx.savingsGoal.findFirst({ where: { id: BigInt(goalId), characterId: c.id, status: { in: statuses } } });
  if (!g) throw new GameError("That savings goal was not found.", 404);
  return g;
}

/** Move money from the spendable balance into savings, optionally straight into a goal (up to what that goal still needs; the rest stays free). */
export function deposit(db, userId, { amountNaira, goalId, requestId } = {}) {
  const n = amountOf(amountNaira, "amount");
  return change(db, userId, requestId, "bank:deposit", async (tx, c, week) => {
    const amount = BigInt(n) * 100n, pool = await savingsPool(tx);
    const goal = goalId != null && goalId !== "" ? await needGoal(tx, c, goalId, ["ACTIVE"]) : null;
    await transferInTx(tx, { fromId: c.account.id, toId: pool.id, amount, memo: "Savings deposit", key: `save:in:${c.id}:${requestId}`, week }); // refuses an overdraft, atomically
    const [row] = await tx.$queryRaw`INSERT INTO "SavingsAccount" ("characterId", "balance") VALUES (${c.id}, ${amount}) ON CONFLICT ("characterId") DO UPDATE SET "balance" = "SavingsAccount"."balance" + ${amount}, "updatedAt" = now() RETURNING "balance"`;
    let set = 0n;
    if (goal) {
      const room = BigInt(goal.targetKobo) - BigInt(goal.savedKobo); set = amount < room ? amount : room;
      if (set > 0n) { await tx.savingsGoal.update({ where: { id: goal.id }, data: { savedKobo: { increment: set } } }); if (BigInt(goal.savedKobo) + set >= BigInt(goal.targetKobo)) await achieve(tx, c, goal); }
    }
    return { ok: true, savedKobo: s(amount), setAsideKobo: s(set), savingsKobo: s(row.balance) };
  });
}

/** Move money from savings back to the spendable balance. From a goal it takes that goal's money; otherwise only the savings that are not set aside. */
export function withdraw(db, userId, { amountNaira, goalId, requestId } = {}) {
  const n = amountOf(amountNaira, "amount");
  return change(db, userId, requestId, "bank:withdraw", async (tx, c, week) => {
    const amount = BigInt(n) * 100n, pool = await savingsPool(tx);
    const goals = await openGoals(tx, c.id), sav = await tx.savingsAccount.findUnique({ where: { characterId: c.id } }), split = splitSavings(sav?.balance ?? 0n, goals);
    if (goalId != null && goalId !== "") {
      const g = goals.find((x) => String(x.id) === String(goalId));
      if (!g) throw new GameError("That savings goal was not found.", 404);
      if (amount > BigInt(g.savedKobo)) throw new GameError(`That goal only holds ${fmt(g.savedKobo)}.`, 409);
      await tx.savingsGoal.update({ where: { id: g.id }, data: { savedKobo: { decrement: amount }, ...(g.status === "ACHIEVED" && BigInt(g.savedKobo) - amount < BigInt(g.targetKobo) ? { status: "ACTIVE", achievedAt: null } : {}) } });
    } else if (amount > split.free) {
      throw new GameError(split.free > 0n ? `Only ${fmt(split.free)} of your savings is free. The rest is set aside for goals: withdraw from a goal to use it.` : sav?.balance > 0n ? "All your savings are set aside for goals. Withdraw from a goal to use them." : "You have no savings to withdraw.", 409);
    }
    const rows = await tx.$queryRaw`UPDATE "SavingsAccount" SET "balance" = "balance" - ${amount}, "updatedAt" = now() WHERE "characterId" = ${c.id} AND "balance" >= ${amount} RETURNING "balance"`;
    if (!rows.length) throw new GameError("You do not have that much in savings.", 409);
    await transferInTx(tx, { fromId: pool.id, toId: c.account.id, amount, memo: "Savings withdrawal", key: `save:out:${c.id}:${requestId}`, week });
    return { ok: true, withdrawnKobo: s(amount), savingsKobo: s(rows[0].balance) };
  });
}

export function createGoal(db, userId, { name, targetNaira, requestId } = {}) {
  const label = cleanGoalName(name); if (!label) throw new GameError("Give your goal a name.");
  const p = parseNaira(targetNaira, { min: BANK.goalMinNaira, max: BANK.goalMaxNaira, what: "target" }); if (p.error) throw new GameError(p.error);
  return change(db, userId, requestId, "bank:goal", async (tx, c) => {
    if ((await openGoals(tx, c.id)).length >= BANK.maxGoals) throw new GameError(`You can have ${BANK.maxGoals} savings goals at a time. Close one first.`, 409);
    const g = await tx.savingsGoal.create({ data: { characterId: c.id, name: label, targetKobo: BigInt(p.n) * 100n } });
    return { ok: true, goal: goalView(g) };
  });
}

/** Set aside part of the free savings for a goal. No money moves: it only changes what the savings are for. */
export function fundGoal(db, userId, { goalId, amountNaira, requestId } = {}) {
  const n = amountOf(amountNaira, "amount");
  return change(db, userId, requestId, "bank:fund", async (tx, c) => {
    const amount = BigInt(n) * 100n, g = await needGoal(tx, c, goalId, ["ACTIVE"]);
    const sav = await tx.savingsAccount.findUnique({ where: { characterId: c.id } }), split = splitSavings(sav?.balance ?? 0n, await openGoals(tx, c.id));
    if (amount > split.free) throw new GameError(split.free > 0n ? `Only ${fmt(split.free)} of your savings is free to set aside.` : "You have no free savings to set aside. Save some money first.", 409);
    const room = BigInt(g.targetKobo) - BigInt(g.savedKobo);
    if (amount > room) throw new GameError(`This goal only needs ${fmt(room)} more.`, 409);
    const saved = BigInt(g.savedKobo) + amount;
    await tx.savingsGoal.update({ where: { id: g.id }, data: { savedKobo: saved } });
    if (saved >= BigInt(g.targetKobo)) await achieve(tx, c, g);
    return { ok: true, goalId: s(g.id), savedKobo: s(saved) };
  });
}

/** Close a goal. Whatever was set aside for it goes back to the free savings (nothing leaves the savings account). */
export function closeGoal(db, userId, { goalId, requestId } = {}) {
  return change(db, userId, requestId, "bank:goalclose", async (tx, c) => {
    const g = await needGoal(tx, c, goalId, ["ACTIVE", "ACHIEVED"]);
    await tx.savingsGoal.update({ where: { id: g.id }, data: { status: "CLOSED", closedAt: new Date() } });
    return { ok: true, releasedKobo: s(g.savedKobo) };
  });
}

/** One dispatcher for POST /api/bank. */
export function bankAction(db, userId, body = {}) {
  const b = body ?? {};
  switch (b.action) {
    case "deposit": return deposit(db, userId, b);
    case "withdraw": return withdraw(db, userId, b);
    case "goal.create": return createGoal(db, userId, b);
    case "goal.fund": return fundGoal(db, userId, b);
    case "goal.close": return closeGoal(db, userId, b);
    default: throw new GameError("Unknown action.");
  }
}

/** Audit: the savings the players own add up to what the SAVINGS account holds in the ledger, and no goal holds more than its player's savings. */
export async function verifySavings(db) {
  const [r] = await db.$queryRaw`SELECT
    COALESCE((SELECT SUM(amount) FROM "LedgerEntry" l JOIN "Account" a ON a.id = l."creditAccountId" WHERE a."systemName" = 'SAVINGS'), 0) -
    COALESCE((SELECT SUM(amount) FROM "LedgerEntry" l JOIN "Account" a ON a.id = l."debitAccountId" WHERE a."systemName" = 'SAVINGS'), 0) AS ledger,
    COALESCE((SELECT SUM(balance) FROM "SavingsAccount"), 0) AS owned`;
  const over = await db.$queryRaw`SELECT s."characterId" FROM "SavingsAccount" s WHERE s.balance < COALESCE((SELECT SUM("savedKobo") FROM "SavingsGoal" g WHERE g."characterId" = s."characterId" AND g.status <> 'CLOSED'), 0)`;
  return { ok: BigInt(r.ledger) === BigInt(r.owned) && over.length === 0, ledger: BigInt(r.ledger), owned: BigInt(r.owned), goalsOverBalance: over.length };
}
