// lib/adminEconomy.js
// Administrator control of the economy. Money moves ONLY through the ledger, exactly like everywhere else in the game:
//   credit  WORLD -> player      debit  player -> WORLD      set  whichever of the two reaches the balance asked for
// There is NO ceiling on an administrator's amount: it is parsed as exact text into BigInt kobo (never a float, never rounded) and the only limit is
// the largest value a Postgres bigint can hold, checked against the real balance, under a row lock, before anything is written.
// Every operation is ONE transaction holding the balance change, the ledger entry and its audit row (administrator, recipient, amount, reason,
// previous balance, new balance, request id), and a repeated request id changes nothing.
import { transferInTx } from "./ledger.js";
import { currentWeek } from "./clock.js";
import { AdminError, INT64_MAX, REQUEST_ID, parseKobo, exactKobo, formatKobo, runAdminOp, reasonOf, paged, page, str, int, oneOf, dateOf, jsonSafe, writeAudit } from "./adminCore.js";
import { where, orderBy, like, NOW } from "./adminSql.js";
import { resolveAudience } from "./adminAudience.js";
import { cleanText } from "./rules.js";

const ID = /^[A-Za-z0-9_-]{5,40}$/;
export const MODES = ["credit", "debit", "set"];
export const BULK_CHUNK = 50;

/** Give, take or set one player's money. `requestId` makes it safe to send twice. */
/** `amount` is what a person typed (naira, as text). `amountKobo` is for code that already holds exact kobo (the group reward). */
export async function moneyOp(db, adminId, { characterId, mode, amount, amountKobo, reason, message, requestId, notify = true }) {
  if (!ID.test(String(characterId ?? ""))) throw new AdminError("Choose a player.");
  if (!MODES.includes(mode)) throw new AdminError("Choose credit, debit or set.");
  if (!REQUEST_ID.test(String(requestId ?? ""))) throw new AdminError("Missing requestId.");
  const kobo = amountKobo != null ? exactKobo(amountKobo, { allowZero: mode === "set" }) : parseKobo(amount, { allowZero: mode === "set" }), why = reasonOf(reason), note = cleanText(message, 160);
  const week = await currentWeek(db);
  return runAdminOp(db, adminId, { action: "MONEY:" + mode, target: characterId, requestId, detail: { mode, amountKobo: kobo.toString(), reason: why } }, async (tx) => {
    const c = await tx.character.findUnique({ where: { id: characterId }, select: { id: true, name: true, account: { select: { id: true } }, user: { select: { status: true } } } });
    if (!c?.account) throw new AdminError("No such player.", 404);
    if (c.user?.status === "DELETED") throw new AdminError("This account is closed. Restore it before changing its money.", 409);
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${c.account.id} FOR UPDATE`; // nobody else moves this balance until we finish
    const before = (await tx.account.findUnique({ where: { id: c.account.id } })).balance;
    let dir = mode, delta = kobo;
    if (mode === "set") { delta = kobo - before; dir = delta >= 0n ? "credit" : "debit"; if (delta < 0n) delta = -delta; }
    const detail = { mode, direction: dir, reason: why, recipient: c.name, requestedKobo: kobo.toString(), amountKobo: delta.toString(), previousBalanceKobo: before.toString(), newBalanceKobo: before.toString() };
    if (delta === 0n) return { target: c.id, detail: { ...detail, unchanged: true }, result: { unchanged: true, previousBalanceKobo: before.toString(), newBalanceKobo: before.toString() } };
    if (dir === "credit" && before + delta > INT64_MAX) throw new AdminError(`That would take ${c.name}'s balance past ${formatKobo(INT64_MAX)}, the largest amount the database can hold. Nothing was changed.`);
    if (dir === "debit" && before < delta) throw new AdminError(`${c.name} only has ${formatKobo(before)}. To take everything, set the balance to 0.`);
    const world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
    if (!world) throw new AdminError("The WORLD account is missing.", 500);
    const [fromId, toId] = dir === "credit" ? [world.id, c.account.id] : [c.account.id, world.id];
    const entry = await transferInTx(tx, { fromId, toId, amount: delta, memo: `Admin adjustment: ${why}`, key: `admin:${adminId}:${requestId}`, week });
    const after = dir === "credit" ? before + delta : before - delta;
    if (notify) {
      const body = note || (dir === "credit" ? `An administrator added ${formatKobo(delta)} to your account.` : `An administrator took ${formatKobo(delta)} from your account.`);
      await tx.notification.create({ data: { characterId: c.id, kind: "ADMIN", body: mode === "set" && !note ? `An administrator set your balance to ${formatKobo(after)}.` : body } });
    }
    detail.newBalanceKobo = after.toString(); detail.ledgerId = String(entry.id);
    return { target: c.id, detail, result: { previousBalanceKobo: before.toString(), newBalanceKobo: after.toString(), amountKobo: delta.toString(), direction: dir, ledgerId: String(entry.id) } };
  });
}

/** A group reward, preview step: who would get it and how much that is in total. Changes nothing. */
export async function bulkPreview(db, { audience, amount }) {
  const { ids, label, missing } = await resolveAudience(db, audience);
  const kobo = amount == null || amount === "" ? null : parseKobo(amount);
  const names = ids.length ? await db.$queryRawUnsafe(`SELECT name FROM "Character" WHERE id = ANY($1::text[]) ORDER BY name LIMIT 8`, ids.slice(0, 200)) : [];
  return { count: ids.length, label, missing, sample: names.map((n) => n.name), eachKobo: kobo?.toString() ?? null, totalKobo: kobo == null ? null : (kobo * BigInt(ids.length)).toString(), confirmText: `GRANT ${ids.length}` };
}

/**
 * A group reward, in pieces of BULK_CHUNK players so no single request runs long. Call it again with the next `offset` until `done`.
 * Safe to repeat or resume: each recipient's request id is `<requestId>:<characterId>`, so nobody is paid twice.
 * Needs the typed confirmation `GRANT <count>` and the count the preview showed, so an audience that changed in between cannot slip through.
 */
export async function bulkGrant(db, adminId, { audience, amount, reason, message, requestId, confirm, expectedCount, offset = 0 }) {
  if (!REQUEST_ID.test(String(requestId ?? "")) || String(requestId).length > 80) throw new AdminError("Missing requestId.");
  const kobo = parseKobo(amount), why = reasonOf(reason);
  const { ids, label } = await resolveAudience(db, audience);
  if (!ids.length) throw new AdminError("Nobody matches that audience.");
  if (Number(expectedCount) !== ids.length) throw new AdminError(`The audience changed: it is now ${ids.length} player${ids.length === 1 ? "" : "s"}. Preview it again before granting.`, 409);
  if (String(confirm ?? "").trim() !== `GRANT ${ids.length}`) throw new AdminError(`Type GRANT ${ids.length} to confirm.`);
  const start = int(offset, { min: 0, fallback: 0 }), slice = ids.slice(start, start + BULK_CHUNK), failed = [];
  let granted = 0, repeated = 0, grantedKobo = 0n;
  for (const id of slice) {
    try {
      const r = await moneyOp(db, adminId, { characterId: id, mode: "credit", amountKobo: kobo, reason: `${why} (group reward)`, message, requestId: `${requestId}:${id}` });
      if (r.duplicate) repeated++; else { granted++; grantedKobo += kobo; }
    } catch (e) { failed.push({ characterId: id, error: e?.message ?? "Failed" }); }
  }
  const next = start + slice.length, done = next >= ids.length;
  if (done) {
    await runAdminOp(db, adminId, { action: "MONEY:BULK", target: null, requestId }, async () => ({
      detail: { audience: label, audienceType: audience.type, players: ids.length, eachKobo: kobo.toString(), totalKobo: (kobo * BigInt(ids.length)).toString(), reason: why },
    }));
  }
  return { ok: true, total: ids.length, processed: next, nextOffset: done ? null : next, done, granted, repeated, grantedKobo: grantedKobo.toString(), failed };
}

// ---------------------------------------------------------------- statistics (all exact: sums are numeric text, never JS numbers)
const BUCKETS = [
  ["₦0", "a.balance = 0"], ["Under ₦10k", "a.balance > 0 AND a.balance < 1000000"], ["₦10k – ₦100k", "a.balance >= 1000000 AND a.balance < 10000000"],
  ["₦100k – ₦1M", "a.balance >= 10000000 AND a.balance < 100000000"], ["₦1M – ₦10M", "a.balance >= 100000000 AND a.balance < 1000000000"],
  ["₦10M – ₦100M", "a.balance >= 1000000000 AND a.balance < 10000000000"], ["₦100M – ₦1B", "a.balance >= 10000000000 AND a.balance < 100000000000"],
  ["₦1B – ₦1T", "a.balance >= 100000000000 AND a.balance < 100000000000000"], ["₦1T and above", "a.balance >= 100000000000000"],
];
const PLAYERS = `FROM "Account" a JOIN "Character" c ON c.id = a."characterId" JOIN "User" u ON u.id = c."userId" WHERE a.kind = 'PLAYER'`;

export async function economyStats(db) {
  const [tot] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS players, COALESCE(SUM(a.balance), 0)::text AS total, COALESCE(MAX(a.balance), 0)::text AS max,
      COALESCE(percentile_disc(0.5) WITHIN GROUP (ORDER BY a.balance), 0)::text AS median, COALESCE(ROUND(AVG(a.balance)), 0)::text AS mean,
      COALESCE(SUM(a.balance) FILTER (WHERE u.status = 'DELETED'), 0)::text AS archived ${PLAYERS}`);
  const dist = await db.$queryRawUnsafe(`SELECT t.i, COUNT(*)::int AS n, COALESCE(SUM(t.balance), 0)::text AS sum FROM (
      SELECT a.balance, CASE ${BUCKETS.map(([, c], i) => `WHEN ${c} THEN ${i}`).join(" ")} END AS i ${PLAYERS}) t GROUP BY t.i`);
  const system = await db.$queryRawUnsafe(`SELECT a."systemName" AS name, (COALESCE(c.s, 0) - COALESCE(d.s, 0))::text AS balance FROM "Account" a
      LEFT JOIN (SELECT "creditAccountId" id, SUM(amount) s FROM "LedgerEntry" GROUP BY 1) c ON c.id = a.id
      LEFT JOIN (SELECT "debitAccountId" id, SUM(amount) s FROM "LedgerEntry" GROUP BY 1) d ON d.id = a.id WHERE a.kind = 'SYSTEM' ORDER BY 1`);
  const medianKobo = BigInt(tot.median);
  const rich = await db.$queryRawUnsafe(`SELECT c.id AS "characterId", c.name, a.balance::text AS balance, u.status ${PLAYERS} ORDER BY a.balance DESC, c.name LIMIT 15`);
  const wealthy = rich.map((r) => {
    const b = BigInt(r.balance), x = medianKobo > 0n ? Number((b * 100n) / medianKobo) / 100 : null;
    return { ...r, timesMedian: x, unusual: b >= 100_000_000n && medianKobo > 0n && b >= medianKobo * 10n };
  });
  const movers = await db.$queryRawUnsafe(`SELECT c.id AS "characterId", c.name, SUM(m.amt)::text AS net, COUNT(*)::int AS entries FROM (
      SELECT "creditAccountId" AS id, amount AS amt FROM "LedgerEntry" WHERE "createdAt" > ${NOW} - interval '24 hours'
      UNION ALL SELECT "debitAccountId", -amount FROM "LedgerEntry" WHERE "createdAt" > ${NOW} - interval '24 hours') m
      JOIN "Account" a ON a.id = m.id AND a.kind = 'PLAYER' JOIN "Character" c ON c.id = a."characterId" GROUP BY c.id, c.name ORDER BY ABS(SUM(m.amt)) DESC LIMIT 10`);
  return {
    players: tot.players, totalKobo: tot.total, maxKobo: tot.max, medianKobo: tot.median, meanKobo: tot.mean, archivedKobo: tot.archived, system,
    distribution: BUCKETS.map(([label], i) => ({ label, players: dist.find((d) => Number(d.i) === i)?.n ?? 0, sumKobo: dist.find((d) => Number(d.i) === i)?.sum ?? "0" })),
    wealthy, movers,
    definitions: {
      total: "Sum of every player account's balance (archived accounts included, shown separately).",
      unusual: "A balance of at least ₦1,000,000 that is at least 10 times the median balance.",
      movers: "Players whose balance changed most in the last 24 hours (credits minus debits in the ledger).",
    },
  };
}

// ---------------------------------------------------------------- transaction history
const TX_SELECT = `le.id, le."createdAt", le.memo, le.amount::text AS amount, le."gameWeek", le."idempotencyKey" AS key,
  COALESCE(dc.name, d."systemName") AS "from", d."characterId" AS "fromId", COALESCE(cc.name, cr."systemName") AS "to", cr."characterId" AS "toId"`;
const TX_FROM = `FROM "LedgerEntry" le JOIN "Account" d ON d.id = le."debitAccountId" JOIN "Account" cr ON cr.id = le."creditAccountId"
  LEFT JOIN "Character" dc ON dc.id = d."characterId" LEFT JOIN "Character" cc ON cc.id = cr."characterId"`;

export async function transactions(db, q) {
  const p = page(q), w = where();
  const who = str(q.player, 40);
  if (who) { if (!ID.test(who)) throw new AdminError("That is not a player id."); w.add(`(d."characterId" = ? OR cr."characterId" = ?)`, who, who); }
  const text = str(q.q, 80);
  if (text) w.add(`le.memo ILIKE ? ESCAPE '\\'`, like(text));
  const kind = oneOf(q.kind, ["admin", "players", "system"]);
  if (kind === "admin") w.add(`le.memo LIKE 'Admin adjustment%'`);
  else if (kind === "players") w.add(`d."characterId" IS NOT NULL AND cr."characterId" IS NOT NULL`);
  else if (kind === "system") w.add(`(d."characterId" IS NULL OR cr."characterId" IS NULL)`);
  if (q.min) w.add(`le.amount >= ?::numeric`, parseKobo(q.min, { what: "Minimum" }).toString());
  if (q.max) w.add(`le.amount <= ?::numeric`, parseKobo(q.max, { what: "Maximum" }).toString());
  const from = dateOf(q.from), to = dateOf(q.to);
  if (from) w.add(`le."createdAt" >= ?`, from);
  if (to) w.add(`le."createdAt" < ?`, new Date(+to + 86_400_000));
  const order = orderBy({ createdAt: 'le."createdAt"', amount: "le.amount" }, q.sort, q.dir ?? "desc", "le.id DESC");
  const [rows, [c]] = await Promise.all([
    db.$queryRawUnsafe(`SELECT ${TX_SELECT} ${TX_FROM} ${w.clause()} ${order} LIMIT ${p.pageSize} OFFSET ${p.offset}`, ...w.values),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n ${TX_FROM} ${w.clause()}`, ...w.values),
  ]);
  return paged(rows.map(shapeTx), c.n, p);
}
const shapeTx = (r) => {
  const m = /^admin:([^:]+):/.exec(r.key ?? "");
  return { id: String(r.id), at: r.createdAt, memo: r.memo, amountKobo: r.amount, from: r.from, fromId: r.fromId, to: r.to, toId: r.toId, week: r.gameWeek, admin: !!m || /^Admin adjustment/.test(r.memo), adminId: m?.[1] ?? null };
};

// ---------------------------------------------------------------- suspicious activity
/**
 * Entries worth a second look, each with the plain-English reasons it was flagged:
 *   LARGE     at least ₦1,000,000 AND at least 20 times the median ledger entry of the last 30 days
 *   ADMIN     money created or removed by an administrator
 *   BURST     the account was in 30 or more ledger entries within one hour
 */
export async function suspicious(db, q) {
  const days = int(q.days, { min: 1, max: 90, fallback: 7 });
  const [m] = await db.$queryRawUnsafe(`SELECT COALESCE(percentile_disc(0.5) WITHIN GROUP (ORDER BY amount), 0)::text AS median FROM "LedgerEntry" WHERE "createdAt" > ${NOW} - interval '30 days'`);
  const median = BigInt(m.median), threshold = [100_000_000n, median * 20n].reduce((a, b) => (a > b ? a : b));
  const since = new Date(Date.now() - days * 86_400_000);
  const bursts = await db.$queryRawUnsafe(`SELECT x.id AS "accountId", c.id AS "characterId", c.name, x.h AS hour, COUNT(*)::int AS entries, SUM(x.amt)::text AS volume FROM (
      SELECT "debitAccountId" AS id, date_trunc('hour', "createdAt") AS h, amount AS amt FROM "LedgerEntry" WHERE "createdAt" > $1
      UNION ALL SELECT "creditAccountId", date_trunc('hour', "createdAt"), amount FROM "LedgerEntry" WHERE "createdAt" > $1) x
      JOIN "Account" a ON a.id = x.id AND a.kind = 'PLAYER' JOIN "Character" c ON c.id = a."characterId" GROUP BY x.id, c.id, c.name, x.h HAVING COUNT(*) >= 30 ORDER BY COUNT(*) DESC LIMIT 50`, since);
  const rows = await db.$queryRawUnsafe(`SELECT ${TX_SELECT} ${TX_FROM} WHERE le."createdAt" > $1 AND (d."characterId" IS NOT NULL OR cr."characterId" IS NOT NULL)
      AND (le.amount >= $2::numeric OR le.memo LIKE 'Admin adjustment%') ORDER BY le."createdAt" DESC LIMIT 200`, since, threshold.toString());
  const entries = rows.map((r) => {
    const t = shapeTx(r), reasons = [];
    if (BigInt(r.amount) >= threshold) reasons.push(`Large: ${formatKobo(r.amount)} is at least ${formatKobo(threshold)}`);
    if (t.admin) reasons.push("Created or removed by an administrator");
    return { ...t, reasons };
  });
  return { days, thresholdKobo: threshold.toString(), medianKobo: median.toString(), entries, bursts: bursts.map((b) => ({ ...b, hour: b.hour })), rules: [
    "Large: at least ₦1,000,000 and at least 20 times the median ledger entry of the last 30 days.",
    "Admin: money created or removed by an administrator.",
    "Burst: one account in 30 or more ledger entries within the same hour.",
  ] };
}
