// lib/admin.js
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { currentWeek } from "./clock.js";
import { cleanText } from "./rules.js";

export class AdminError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
/** Non-admins get a 404, so the panel's existence is not revealed. Roles are set only from the server (scripts/make-admin.js). */
export async function requireAdmin(db, userId) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!u || u.role !== "ADMIN") throw new AdminError("Not found.", 404);
  return u;
}
const audit = (db, actorId, action, target, detail) => db.auditLog.create({ data: { actorId, action, target: target ?? null, detail: detail ?? null } });
const str = (v) => (v == null ? "0" : v.toString());

export async function overview(db) {
  const [players, byClass, jailed, expelled, openReports, ledgerRows, cash] = await Promise.all([
    db.character.count(), db.character.groupBy({ by: ["class"], _count: { _all: true } }),
    db.character.count({ where: { jailedUntil: { gt: new Date() } } }), db.character.count({ where: { expelled: true } }),
    db.report.count({ where: { status: "OPEN" } }), db.ledgerEntry.count(), db.account.aggregate({ _sum: { balance: true }, where: { kind: "PLAYER" } })]);
  const J = `LEFT JOIN (SELECT "creditAccountId" id, SUM(amount) s FROM "LedgerEntry" GROUP BY 1) c ON c.id=a.id
             LEFT JOIN (SELECT "debitAccountId" id, SUM(amount) s FROM "LedgerEntry" GROUP BY 1) d ON d.id=a.id`;
  const mismatches = await db.$queryRawUnsafe(`SELECT a.id, a.balance::bigint AS cached, (COALESCE(c.s,0)-COALESCE(d.s,0))::bigint AS ledger FROM "Account" a ${J}
    WHERE a.kind='PLAYER' AND a.balance <> COALESCE(c.s,0)-COALESCE(d.s,0) LIMIT 50`);
  const system = await db.$queryRawUnsafe(`SELECT a."systemName" AS name, (COALESCE(c.s,0)-COALESCE(d.s,0))::bigint AS balance FROM "Account" a ${J} WHERE a.kind='SYSTEM' ORDER BY 1`);
  const poolRow = system.find((x) => x.name === "BUSINESS"), capSum = (await db.business.aggregate({ _sum: { capital: true } }))._sum.capital ?? 0n;
  const businessOk = BigInt(poolRow?.balance ?? 0) === capSum;
  return { players, byClass: Object.fromEntries(byClass.map((g) => [g.class, g._count._all])), jailed, expelled, openReports, ledgerRows,
    playerCashKobo: str(cash._sum.balance), systemBalancesKobo: system.map((s) => ({ name: s.name, balance: str(s.balance) })),
    integrity: { ok: mismatches.length === 0 && businessOk, businessOk, businessCapitalKobo: str(capSum), mismatches: mismatches.map((m) => ({ id: m.id, cached: str(m.cached), ledger: str(m.ledger) })) } };
}

export async function listReports(db, status = "OPEN") {
  const rows = await db.report.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 50 });
  const ids = [...new Set(rows.flatMap((r) => [r.reporterId, r.targetId]))];
  const names = new Map((await db.character.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return { reports: rows.map((r) => ({ id: r.id.toString(), reporter: names.get(r.reporterId), target: names.get(r.targetId), reason: r.reason, at: r.createdAt })) };
}

export async function resolveReport(db, adminId, { id, action, note }) {
  if (!["dismiss", "actioned", "suspend"].includes(action)) throw new AdminError("Unknown action.");
  const text = cleanText(note, 300); if (text.length < 5) throw new AdminError("Add a short note explaining the decision.");
  const week = await currentWeek(db);
  return db.$transaction(async (tx) => {
    const r = await tx.report.findUnique({ where: { id: BigInt(id) } });
    if (!r || r.status !== "OPEN") throw new AdminError("Report not found or already handled.", 404);
    if (action === "suspend") await tx.character.update({ where: { id: r.targetId }, data: { suspendedUntilWeek: week + 2 } });
    await tx.report.update({ where: { id: r.id }, data: { status: action === "dismiss" ? "DISMISSED" : "ACTIONED" } });
    await audit(tx, adminId, "RESOLVE_REPORT:" + action, r.targetId, { reportId: id, note: text });
    return { ok: true };
  });
}

/** Admins can read messages only through an open report, only the last 20 between the two parties, and every read is logged. */
export async function reportMessages(db, adminId, id) {
  const r = await db.report.findUnique({ where: { id: BigInt(id) } });
  if (!r) throw new AdminError("Report not found.", 404);
  const msgs = await db.message.findMany({ where: { OR: [{ fromId: r.reporterId, toId: r.targetId }, { fromId: r.targetId, toId: r.reporterId }] }, orderBy: { createdAt: "desc" }, take: 20 });
  await audit(db, adminId, "VIEW_REPORT_MESSAGES", r.targetId, { reportId: id, count: msgs.length });
  return { messages: msgs.reverse().map((m) => ({ fromReporter: m.fromId === r.reporterId, body: m.body, at: m.createdAt })) };
}

export async function inspectPlayer(db, adminId, name) {
  const c = await db.character.findFirst({ where: { name: { equals: String(name ?? ""), mode: "insensitive" } }, include: { account: true, faculty: true } });
  if (!c) throw new AdminError("No player with that name.", 404);
  const [ledger, arrests] = await Promise.all([
    db.ledgerEntry.findMany({ where: { OR: [{ debitAccountId: c.account.id }, { creditAccountId: c.account.id }] }, orderBy: { id: "desc" }, take: 20 }),
    db.floorZero.findMany({ where: { characterId: c.id }, orderBy: { id: "desc" }, take: 5 })]);
  await audit(db, adminId, "VIEW_PLAYER", c.id, { name: c.name });
  return { name: c.name, class: c.class, faculty: c.faculty.name, level: c.level, strikes: c.strikes, expelled: c.expelled, graduated: c.graduated, suspension: c.suspendedUntilWeek,
    stats: { health: c.health, energy: c.energy, happiness: c.happiness, academics: c.academics, popularity: c.popularity, suspicion: c.suspicion }, balanceKobo: c.account.balance.toString(),
    ledger: ledger.map((e) => ({ amountKobo: e.amount.toString(), dir: e.creditAccountId === c.account.id ? "in" : "out", memo: e.memo, week: e.gameWeek })),
    arrests: arrests.map((a) => ({ reason: a.reason, status: a.status, billKobo: a.bill.toString() })) };
}

/** The ONLY way an admin can change money: a normal ledger entry against WORLD plus an audit row, in one transaction. */
export async function adjustMoney(db, adminId, { name, direction, amountNaira, reason, requestId }) {
  const n = Number(amountNaira), why = cleanText(reason, 200);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new AdminError("Amount must be a whole number from ₦1 to ₦1,000,000.");
  if (!["credit", "debit"].includes(direction)) throw new AdminError("Direction must be credit or debit.");
  if (why.length < 10) throw new AdminError("A clear reason (10+ characters) is required.");
  if (!/^[\w-]{8,64}$/.test(requestId ?? "")) throw new AdminError("Missing requestId.");
  const week = await currentWeek(db), amount = BigInt(n) * 100n;
  try {
    return await db.$transaction(async (tx) => {
      const c = await tx.character.findFirst({ where: { name: { equals: String(name ?? ""), mode: "insensitive" } }, include: { account: true } });
      if (!c) throw new AdminError("No player with that name.", 404);
      const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      const [fromId, toId] = direction === "credit" ? [world.id, c.account.id] : [c.account.id, world.id];
      const key = `admin:${adminId}:${requestId}`;
      if (await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } })) return { ok: true, duplicate: true }; // replay: no second ledger row, no second audit row
      await transferInTx(tx, { fromId, toId, amount, memo: `Admin adjustment: ${why}`, key, week });
      await audit(tx, adminId, "ADJUST_MONEY:" + direction, c.id, { amountKobo: amount.toString(), reason: why, requestId });
      return { ok: true };
    });
  } catch (e) { if (e instanceof InsufficientFunds) throw new AdminError("That player does not have enough money for a debit."); throw e; }
}
