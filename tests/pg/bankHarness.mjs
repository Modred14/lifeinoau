// tests/pg/bankHarness.mjs: a small harness for the Bank and Calls tests against a REAL PostgreSQL database with every migration applied.
//
//   DATABASE_URL=postgresql://user:pass@localhost:5432/lifeinoau_test node tests/pg/bank.pg.mjs
//
// It empties the game tables before each file, so it REFUSES to run unless the database name contains "test".
// With PG_ADAPTER=1 it uses the driver-adapter client (@prisma/adapter-pg, install it with `npm i --no-save @prisma/adapter-pg pg`), for machines that
// cannot download Prisma's query engine. Otherwise it uses the normal client, exactly like the app.
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { transferInTx } from "../../lib/ledger.js";

const url = process.env.DATABASE_URL ?? "";
const dbName = (url.match(/\/([^/?]+)(\?|$)/) ?? [])[1] ?? "";
if (!/test/i.test(dbName)) { console.error(`Refusing to run: DATABASE_URL must point at a database whose name contains "test" (got "${dbName}"). This harness empties the tables.`); process.exit(2); }

const opts = { transactionOptions: { maxWait: 15_000, timeout: 60_000 } };
/** A new client on the same database (the live-market re-valuation is throttled per client, so a test that needs a fresh one makes its own). */
export const makeClient = () => (process.env.PG_ADAPTER ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), ...opts }) : new PrismaClient(opts));
const PrismaPg = process.env.PG_ADAPTER ? (await import("@prisma/adapter-pg")).PrismaPg : null;
export const db = makeClient();
globalThis.db = db; // lib/clock.js reads the clock row once a minute when the app's client is global: the tests always want the live row

export { assert };
let n = 0;
export const rq = () => `req-${Date.now().toString(36)}-${(++n).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let passed = 0;
export const ok = (label, extra = "") => { passed++; console.log(`OK   ${label}${extra ? " " + extra : ""}`); };
export const done = async () => { console.log(`\n${passed} checks passed`); await db.$disconnect(); };

const SYSTEM = ["WORLD", "LANDLORDS", "PARENTS", "DSA", "TRANSPORT", "VENUES", "CLINICS", "BUSINESS", "MARKET", "RETAIL", "SUG", "SAVINGS"];
/** Empty every game table and seed what a fresh database has: the clock, a faculty and the system accounts. */
export async function reset() {
  const t = await db.$queryRaw`SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${t.map((x) => `"${x.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await db.gameClock.create({ data: { id: 1, startedAt: new Date(), campusEpoch: new Date(), campusStartWeek: 1 } });
  await db.faculty.create({ data: { name: "Technology", difficulty: 1 } });
  for (const name of SYSTEM) await db.account.create({ data: { kind: "SYSTEM", systemName: name } });
}

let seq = 0;
/** A player with a character and an account funded through the ledger (so the cached balance equals the ledger sum). `balanceNaira` is in naira. */
export async function player(name, { balanceNaira = 0, char = {} } = {}) {
  const user = await db.user.create({ data: { email: `${name.toLowerCase()}${++seq}@test.local`, passwordHash: "x", isAdult: true } });
  const faculty = await db.faculty.findFirst();
  const c = await db.character.create({ data: { userId: user.id, name, gender: "M", class: "MAPO", personalities: [], facultyId: faculty.id, luck: 50, riskTolerance: 50,
    hostel: "Awo", lastTickWeek: 1, joinedWeek: 1, sessionStartWeek: 1, lastParentCallWeek: 1, ...char } });
  const acc = await db.account.create({ data: { kind: "PLAYER", characterId: c.id } });
  if (balanceNaira > 0) { const world = await db.account.findUnique({ where: { systemName: "WORLD" } });
    await transferInTx(db, { fromId: world.id, toId: acc.id, amount: BigInt(balanceNaira) * 100n, memo: "Test funds", key: `fund:${c.id}:${rq()}`, week: 1 }); }
  return { uid: user.id, id: c.id, accountId: acc.id, name };
}
export const balance = async (p) => (await db.account.findUnique({ where: { id: p.accountId } })).balance;
export const savings = async (p) => (await db.savingsAccount.findUnique({ where: { characterId: p.id } }))?.balance ?? 0n;
export const char = (p) => db.character.findUnique({ where: { id: p.id } });
export const naira = (n) => BigInt(n) * 100n;

/** Runs fn and expects it to throw with a message matching `re` (and optionally an HTTP-style status). */
export async function denied(label, fn, re, status) {
  try { await fn(); } catch (e) {
    assert.match(String(e.message), re, `${label}: wrong refusal "${e.message}"`);
    if (status) assert.equal(e.status, status, `${label}: wrong status ${e.status}`);
    return ok(`${label} refused`, `(${e.message})`);
  }
  assert.fail(`${label}: expected a refusal but it went through`);
}

/** The whole money system must always add up: every player's cached balance equals their ledger sum, and the savings add up. */
export async function books() {
  const bad = await db.$queryRaw`SELECT a.id, a.balance::bigint AS cached, (COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "creditAccountId" = a.id), 0) - COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "debitAccountId" = a.id), 0))::bigint AS ledger FROM "Account" a WHERE a.kind = 'PLAYER' AND a.balance <> (COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "creditAccountId" = a.id), 0) - COALESCE((SELECT SUM(amount) FROM "LedgerEntry" WHERE "debitAccountId" = a.id), 0))`;
  assert.equal(bad.length, 0, "cached balances differ from the ledger: " + JSON.stringify(bad, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const { verifySavings } = await import("../../lib/bankService.js");
  const v = await verifySavings(db); assert.ok(v.ok, "savings do not match the ledger " + JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x)));
  return true;
}
