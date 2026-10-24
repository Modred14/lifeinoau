// lib/adminOverview.js
// The dashboard's front page. Every number comes from the database (nothing is sampled or invented) and each carries its definition in `definitions`.
//
// "ACTIVE" in the charts means: performed at least one recorded game action. The game records actions in ActionLog and building activities in ActivityRun,
// and those are the two tables counted. Walking around the map or merely having the game open is NOT counted there; that is what ONLINE (live presence,
// lib/adminPresence.js) is for. Registrations are counted by UTC calendar day.
import { jsonSafe } from "./adminCore.js";
import { NOW } from "./adminSql.js";
import { presenceList } from "./adminPresence.js";
import { economyStats } from "./adminEconomy.js";
import { getBoard } from "./leaderboards.js";
import { currentWeek } from "./clock.js";

const day = (d) => new Date(d).toISOString().slice(0, 10);
function fill(rows, days, key = "n") {
  const m = new Map(rows.map((r) => [day(r.d), Number(r[key])])), out = [], t0 = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  for (let i = days - 1; i >= 0; i--) { const d = day(t0 - i * 86_400_000); out.push({ day: d, n: m.get(d) ?? 0 }); }
  return out;
}

const ACTIVE = `(SELECT "characterId" AS id, "createdAt" AS at FROM "ActionLog" UNION ALL SELECT "characterId", "startedAt" FROM "ActivityRun")`;
const LAST = `GREATEST(u."lastActiveAt", u."lastLoginAt", al.last, ar.last, p."lastSeen")`;

export async function dashboard(db, { days = 30 } = {}) {
  const span = Math.min(90, Math.max(7, days)), since = new Date(Date.now() - span * 86_400_000), t0 = Date.now();
  const [presence, econ, reg, dau, windows, seg, accounts, mod, recentTx, recentAdmin, gameNow, failed, mism, sys, week] = await Promise.all([
    presenceList(db),
    economyStats(db),
    db.$queryRawUnsafe(`SELECT date_trunc('day', "createdAt") AS d, COUNT(*)::int AS n FROM "User" WHERE "createdAt" >= $1 GROUP BY 1`, since),
    db.$queryRawUnsafe(`SELECT date_trunc('day', at) AS d, COUNT(DISTINCT id)::int AS n FROM ${ACTIVE} x WHERE at >= $1 GROUP BY 1`, since),
    db.$queryRawUnsafe(`SELECT COUNT(DISTINCT id) FILTER (WHERE at > ${NOW} - interval '24 hours')::int AS dau, COUNT(DISTINCT id) FILTER (WHERE at > ${NOW} - interval '7 days')::int AS wau, COUNT(DISTINCT id) FILTER (WHERE at > ${NOW} - interval '30 days')::int AS mau FROM ${ACTIVE} x`),
    db.$queryRawUnsafe(`SELECT COUNT(*) FILTER (WHERE u."createdAt" > ${NOW} - interval '7 days')::int AS "newThisWeek",
        COUNT(*) FILTER (WHERE u."createdAt" <= ${NOW} - interval '7 days' AND ${LAST} > ${NOW} - interval '7 days')::int AS returning,
        COUNT(*) FILTER (WHERE ${LAST} IS NULL OR ${LAST} < ${NOW} - interval '14 days')::int AS inactive
      FROM "User" u JOIN "Character" c ON c."userId" = u.id LEFT JOIN "Presence" p ON p."characterId" = c.id
      LEFT JOIN (SELECT "characterId", MAX("createdAt") AS last FROM "ActionLog" GROUP BY 1) al ON al."characterId" = c.id
      LEFT JOIN (SELECT "characterId", MAX("startedAt") AS last FROM "ActivityRun" GROUP BY 1) ar ON ar."characterId" = c.id WHERE u.status <> 'DELETED'`),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS total, COUNT(c.id)::int AS "withCharacter", COUNT(*) FILTER (WHERE u.status = 'DELETED')::int AS archived,
        COUNT(*) FILTER (WHERE u.status = 'SUSPENDED' AND (u."statusUntil" IS NULL OR u."statusUntil" > ${NOW}))::int AS suspended, MIN(u."createdAt") AS "firstAt" FROM "User" u LEFT JOIN "Character" c ON c."userId" = u.id`),
    db.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM "Character" WHERE "suspendedUntil" > ${NOW})::int AS "academicSuspended", (SELECT COUNT(*) FROM "Character" WHERE expelled AND ("expelledUntil" IS NULL OR "expelledUntil" > ${NOW}))::int AS expelled,
        (SELECT COUNT(*) FROM "Character" WHERE "jailedUntil" > ${NOW})::int AS jailed, (SELECT COUNT(*) FROM "Report" WHERE status = 'OPEN')::int AS "openReports",
        (SELECT COUNT(*) FROM "AuditLog" WHERE status = 'OK' AND "createdAt" > ${NOW} - interval '7 days' AND (action LIKE 'ACCOUNT:%' OR action = 'WARN' OR action LIKE 'GAME:%' OR action LIKE 'RESOLVE_REPORT%'))::int AS "actions7d"`),
    db.$queryRawUnsafe(`SELECT le.id, le."createdAt", le.memo, le.amount::text AS amount, COALESCE(dc.name, d."systemName") AS "from", COALESCE(cc.name, cr."systemName") AS "to" FROM "LedgerEntry" le
        JOIN "Account" d ON d.id = le."debitAccountId" JOIN "Account" cr ON cr.id = le."creditAccountId" LEFT JOIN "Character" dc ON dc.id = d."characterId" LEFT JOIN "Character" cc ON cc.id = cr."characterId" ORDER BY le.id DESC LIMIT 8`),
    db.$queryRawUnsafe(`SELECT a.id, a."createdAt", a.action, a.status, COALESCE(ac.name, au.email, a."actorId") AS actor, COALESCE(tc.name, tu.name, a.target) AS target FROM "AuditLog" a LEFT JOIN "User" au ON au.id = a."actorId" LEFT JOIN "Character" ac ON ac."userId" = au.id
        LEFT JOIN "Character" tc ON tc.id = a.target LEFT JOIN "Character" tu ON tu."userId" = a.target ORDER BY a.id DESC LIMIT 8`),
    db.$queryRawUnsafe(`SELECT action, COUNT(*)::int AS n FROM "ActionLog" WHERE "createdAt" > ${NOW} - interval '24 hours' GROUP BY 1 ORDER BY n DESC LIMIT 8`),
    db.$queryRawUnsafe(`SELECT COUNT(*) FILTER (WHERE "createdAt" > ${NOW} - interval '24 hours')::int AS "last24h", COUNT(*) FILTER (WHERE "createdAt" > ${NOW} - interval '7 days')::int AS "last7d" FROM "AuditLog" WHERE status = 'FAILED'`),
    db.$queryRawUnsafe(`SELECT a.id, a.balance::text AS cached, (COALESCE(c.s, 0) - COALESCE(d.s, 0))::text AS ledger FROM "Account" a
        LEFT JOIN (SELECT "creditAccountId" id, SUM(amount) s FROM "LedgerEntry" GROUP BY 1) c ON c.id = a.id LEFT JOIN (SELECT "debitAccountId" id, SUM(amount) s FROM "LedgerEntry" GROUP BY 1) d ON d.id = a.id
        WHERE a.kind = 'PLAYER' AND a.balance <> COALESCE(c.s, 0) - COALESCE(d.s, 0) LIMIT 20`),
    db.$queryRawUnsafe(`SELECT (SELECT COALESCE(SUM(capital), 0) FROM "Business")::text AS capital, (SELECT COUNT(*) FROM "LedgerEntry")::text AS entries`),
    currentWeek(db).catch(() => null),
  ]);
  const dbMs = Date.now() - t0;
  const pool = econ.system.find((s) => s.name === "BUSINESS"), poolOk = pool == null || BigInt(pool.balance) === BigInt(sys[0].capital);
  let forbes = [];
  try { forbes = (await getBoard(db, "forbes")).rows.slice(0, 5); } catch { /* the board failing must not take the dashboard down */ }
  const a = accounts[0], w = windows[0], s = seg[0];
  return jsonSafe({
    generatedAt: new Date(), week, spanDays: span,
    players: { accounts: a.total, withCharacter: a.withCharacter, archived: a.archived, suspended: a.suspended, firstAccountAt: a.firstAt, newThisWeek: s.newThisWeek, returning: s.returning, inactive: s.inactive,
      dau: w[0]?.dau ?? w.dau, wau: w[0]?.wau ?? w.wau, mau: w[0]?.mau ?? w.mau },
    online: { ...presence.counts, realtime: presence.realtime },
    registrations: fill(reg, span), activeByDay: fill(dau, span),
    economy: { totalKobo: econ.totalKobo, medianKobo: econ.medianKobo, maxKobo: econ.maxKobo, archivedKobo: econ.archivedKobo, distribution: econ.distribution, system: econ.system, wealthy: econ.wealthy.slice(0, 5) },
    forbes, recentTransactions: recentTx, recentAdmin: recentAdmin.map((r) => ({ ...r, id: String(r.id) })), gameNow,
    moderation: mod[0],
    health: { database: { ok: true, latencyMs: dbMs }, ledger: { ok: mism.length === 0 && poolOk, mismatches: mism, businessPoolOk: poolOk, entries: sys[0].entries }, realtime: presence.realtime, failedAdminOps: failed[0] },
    definitions: {
      accounts: "Every row in the account table, including accounts that never created a character and archived (deleted) ones.",
      online: "Players with a live signal right now: a fresh building/map heartbeat or request (ONLINE), an open chat socket with no recent activity (IDLE), a signal in the last 15 minutes that has gone quiet (DISCONNECTED).",
      active: "A player who performed at least one recorded game action (action log or building activity). DAU/WAU/MAU = distinct such players in the last 24 hours / 7 days / 30 days.",
      returning: "Registered more than 7 days ago and active (any signal) in the last 7 days.",
      inactive: "Has a character but no signal at all for 14 days or more (or ever).",
      registrations: "New accounts per UTC calendar day.",
      ledger: "Every player's stored balance must equal their credits minus debits in the ledger, and the BUSINESS pool must equal all business capital.",
    },
  });
}
