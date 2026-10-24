// tests/inv.test.mjs: buying and selling in the live market (lib/investService.js)
// A controllable price source stands in for the market engine (the engine itself is tested in tests/market-live.test.mjs), and an in-memory
// database stands in for Postgres. It emulates what the real one guarantees: a transaction that takes the player's row lock (SELECT ... FOR UPDATE)
// makes every other transaction for that player wait, and a transaction that throws is rolled back completely. Run: node tests/inv.test.mjs
import assert from "node:assert/strict";
import { getInvestments, invest, MAX_SLIP_PCT } from "../lib/investService.js";
import { useMarketForTests } from "../lib/marketLive.js";
import { GAME_WEEK_MS } from "../lib/campus-clock.js";
import { investCap } from "../lib/market.js";

const M = (n) => BigInt(n) * 100n, ok = (m) => console.log("OK  ", m);
let week = 8;
const A = { p: { id: "p", kind: "PLAYER", balance: M(10_000_000) }, K: { id: "K", kind: "SYSTEM", balance: 0n }, W: { id: "W", kind: "SYSTEM", balance: 0n } };
const sys = { MARKET: A.K, WORLD: A.W };
const C = { id: "c1", userId: "u1", gender: "M", hostel: "Awo", expelled: false, graduated: false, suspendedUntilWeek: 0, jailedUntil: null, level: 100, lastTickWeek: week, personalities: [], account: A.p, faculty: { name: "Law" } };
let L = [], AL = [], H = [], TR = [], hid = 1n, tid = 1n;

// ---- the price source ----
let T = Date.now();
const P = { COOP: 12400, BILLS: 13200, INDEX: 10000, PLOTS: 15100, TECH: 9100, MEME: 2500 }; // kobo per unit
const market = {
  keys: Object.keys(P), now: () => T, ready: async () => market, priceKoboAt: (k) => P[k],
  snapshot: () => ({ t: Math.floor(T / 1000) * 1000, tickMs: 1000, prices: { ...P }, changes: Object.fromEntries(Object.keys(P).map((k) => [k, { m5: 0, h1: 0, d1: 0 }])), mood: { regime: "STEADY", headline: "Quiet" } }),
};
const setPrice = (k, kobo) => { P[k] = kobo; T += 1000; }; // a new second: the shared one-second snapshot is rebuilt
useMarketForTests(market);

// ---- the database ----
let held = false; const queue = []; // the player's row lock
const lock = () => new Promise((go) => { if (!held) { held = true; go(); } else queue.push(go); });
const unlock = () => { const n = queue.shift(); if (n) n(); else held = false; };
const world = () => structuredClone({ A, L, AL, H, TR, C });
const restore = (s) => { for (const k of Object.keys(s.A)) Object.assign(A[k], s.A[k]); L = s.L; AL = s.AL; H = s.H; TR = s.TR; Object.assign(C, s.C); };
const dup = () => Object.assign(new Error("Unique constraint"), { code: "P2002" });
const mkTx = () => ({
  $queryRaw: async (strings) => { if (String(strings[0]).includes('"Character"')) await tx.$lockMe(); return []; },
  gameClock: { findUnique: async () => ({ startedAt: new Date(Date.now() - (week - 1) * GAME_WEEK_MS - 1000) }) },
  character: { findUnique: async () => ({ ...C, account: A.p }), update: async ({ data }) => Object.assign(C, data) },
  account: {
    findUnique: async ({ where }) => ({ ...(where.systemName ? sys[where.systemName] : A[where.id]) }),
    update: async ({ where, data }) => { const d = data.balance; if (d.decrement) A[where.id].balance -= d.decrement; if (d.increment) A[where.id].balance += d.increment; },
  },
  ledgerEntry: { findUnique: async ({ where }) => L.find((e) => e.idempotencyKey == where.idempotencyKey), create: async ({ data }) => (L.push(data), data) },
  actionLog: { create: async ({ data }) => { if (AL.find((a) => a.requestId == data.requestId)) throw dup(); AL.push(data); } },
  marketTrade: { create: async ({ data }) => { if (TR.find((t) => t.requestId == data.requestId && t.characterId == data.characterId)) throw dup(); TR.push({ id: tid++, ...data }); } },
  holding: {
    findMany: async ({ where } = {}) => H.filter((h) => !where?.characterId || h.characterId === where.characterId),
    findFirst: async ({ where }) => H.find((h) => h.product == where.product && h.characterId === where.characterId) ?? null,
    create: async ({ data }) => { H.push({ id: hid++, ...data }); },
    update: async ({ where, data }) => Object.assign(H.find((h) => h.id == where.id), data),
  },
});
const tx = mkTx();
let snapshot = null;
const db = {
  ...tx,
  $transaction: async (fn) => {
    const mine = mkTx(); let locked = false, snap = null;
    mine.$lockMe = async () => { if (!locked) { await lock(); locked = true; snap = world(); } };
    mine.$queryRaw = async (strings) => { if (String(strings[0]).includes('"Character"')) await mine.$lockMe(); return []; };
    try { return await fn(mine); } catch (e) { if (locked) restore(snap); throw e; } finally { if (locked) unlock(); }
  },
};
const rid = (() => { let n = 0; return () => "req-" + String(++n).padStart(8, "0"); })();
const buy = (product, amountNaira, extra = {}) => invest(db, "u1", { action: "buy", product, amountNaira, requestId: rid(), ...extra });
const sell = (product, percent, extra = {}) => invest(db, "u1", { action: "sell", product, percent, requestId: rid(), ...extra });
const near = (a, b, tol = 2n, m = "") => assert.ok((a > b ? a - b : b - a) <= tol, `${m} ${a} is not within ${tol} kobo of ${b}`); // units and values are rounded down to whole micro-units / kobo
const cash = () => A.p.balance, fails = async (p, status, re) => { try { await p; } catch (e) { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return e; } assert.fail("expected a refusal with status " + status); };
const ledgerCash = () => L.reduce((t, e) => t + (e.creditAccountId === "p" ? e.amount : 0n) - (e.debitAccountId === "p" ? e.amount : 0n), 0n); // what the ledger says the player gained

// ===== 1. trading is open the moment the app is =====
const g = await getInvestments(db, "u1");
assert.equal(g.products.length, 6); assert.equal(g.holdings.length, 0); assert.equal(g.totals.totalPnlKobo, "0"); assert.equal(g.products.find((p) => p.key === "INDEX").priceKobo, "10000");
assert.ok(Number.isFinite(g.serverNow) && g.tickMs === 1000);
const first = await buy("INDEX", 100_000);
assert.ok(first.ok && !first.duplicate); ok("a new player's very first request is a buy, and it executes (no market hours, no waiting, no queue)");

// ===== 2. a buy: cash, holding, trade record, all at the server's price =====
{
  assert.equal(cash(), M(10_000_000) - M(101_000)); // ₦100,000 + 1% fee
  const h = H[0]; assert.equal(h.unitsMicro, 1_000_000_000n); assert.equal(h.costKobo, M(100_000)); assert.equal(h.feesKobo, M(1_000));
  assert.equal(TR.length, 1); assert.equal(TR[0].priceKobo, 10000n); assert.equal(TR[0].side, "BUY");
  assert.equal(first.portfolio.totals.valueKobo, M(100_000).toString());
  ok("buy ₦100,000 at ₦100.00: 1,000 units, ₦101,000 leaves the account, trade recorded at 10000 kobo");
}

// ===== 3. +100% doubles the price; -50% halves it; profit and loss follow exactly =====
setPrice("INDEX", 20000); // +100%
{
  const v = await getInvestments(db, "u1");
  assert.equal(v.holdings[0].valueKobo, M(200_000).toString()); assert.equal(v.totals.unrealisedKobo, M(100_000).toString()); assert.equal(v.products.find((p) => p.key === "INDEX").priceKobo, "20000");
  assert.equal(H[0].valueKobo, M(200_000), "the stored valuation (net worth, Forbes) follows the live price");
  ok("price +100%: the holding is worth exactly double, unrealised profit equals the amount invested");
}
const c0 = cash(); const s1 = await sell("INDEX", 50);
{
  assert.equal(cash() - c0, M(99_000)); // ₦100,000 gross - 1% fee
  assert.equal(s1.realisedKobo, M(50_000).toString()); assert.equal(H[0].unitsMicro, 500_000_000n); assert.equal(H[0].costKobo, M(50_000));
  assert.equal(H[0].realisedKobo, M(50_000)); assert.equal(H[0].feesKobo, M(1_000) + M(1_000));
  const t = s1.portfolio.totals; assert.equal(t.unrealisedKobo, M(50_000).toString()); assert.equal(t.realisedKobo, M(50_000).toString()); assert.equal(t.totalPnlKobo, (M(50_000) + M(50_000) - M(2_000)).toString());
  ok("sell half at double: ₦99,000 received, realised +₦50,000, unrealised +₦50,000 still riding, fees counted");
}
setPrice("INDEX", 10000); // -50%
{
  const v = await getInvestments(db, "u1"); assert.equal(v.holdings[0].valueKobo, M(50_000).toString()); assert.equal(v.totals.unrealisedKobo, "0");
  assert.equal(v.totals.totalPnlKobo, (M(50_000) - M(2_000)).toString());
  ok("price -50%: back to the cost, unrealised profit 0, only the realised gain less fees remains");
}
const c1 = cash(); const s2 = await sell("INDEX", 100);
{
  assert.equal(cash() - c1, M(49_500)); assert.equal(H[0].unitsMicro, 0n); assert.equal(H[0].costKobo, 0n); assert.equal(s2.realisedKobo, "0");
  const t = s2.portfolio.totals; assert.equal(t.valueKobo, "0"); assert.equal(t.realisedKobo, M(50_000).toString()); assert.equal(t.feesKobo, M(2_500).toString());
  assert.equal(cash() - M(10_000_000), BigInt(t.totalPnlKobo), "the cash really gained equals the total profit the portfolio reports");
  assert.equal(cash() - M(10_000_000), ledgerCash());
  ok("closing the position: the closed position keeps its realised P/L, and total P/L after fees equals the cash actually gained (" + (Number(cash() - M(10_000_000)) / 100) + " naira)");
}

// ===== 4. a crash: unrealised loss, and the loss is real when sold =====
{
  await buy("MEME", 50_000); assert.equal(H.find((h) => h.product === "MEME").unitsMicro, 2_000_000_000n); // 2,000 units at ₦25.00
  setPrice("MEME", 1250); // -50%
  const v = await getInvestments(db, "u1"); assert.equal(v.holdings[0].valueKobo, M(25_000).toString()); assert.equal(v.holdings[0].pnlKobo, (-M(25_000)).toString());
  const before = cash(), r = await sell("MEME", 100); assert.equal(cash() - before, M(25_000) - M(250)); assert.equal(r.realisedKobo, (-M(25_000)).toString());
  ok("a 50% crash: unrealised -₦25,000, selling realises exactly that loss (plus the 1% fee)");
  setPrice("MEME", 2500);
}

// ===== 5. one order per request id =====
{
  const id = rid(), b0 = cash(); const a = await invest(db, "u1", { action: "buy", product: "BILLS", amountNaira: 50_000, requestId: id }); const spent = b0 - cash();
  const again = await invest(db, "u1", { action: "buy", product: "BILLS", amountNaira: 50_000, requestId: id });
  assert.ok(a.ok && again.duplicate); assert.equal(b0 - cash(), spent); assert.equal(TR.filter((t) => t.requestId === id).length, 1);
  ok("the same request sent twice trades once"); await sell("BILLS", 100);
}

// ===== 6. the browser cannot set a price, and cannot trade on a stale one =====
{
  const r = await buy("INDEX", 10_000, { priceKobo: 1, price: 1, unitsMicro: "999999999999", executedAt: 0, seenKobo: undefined });
  assert.equal(TR.at(-1).priceKobo, 10000n, "filled at the server's price, not at the 1 kobo the browser sent"); assert.equal(r.priceKobo, "10000");
  const spent = cash(), n = TR.length;
  const e = await fails(buy("INDEX", 10_000, { seenKobo: 8000 }), 409, /moved/); assert.equal(e.priceKobo, "10000");
  assert.equal(cash(), spent); assert.equal(TR.length, n); assert.equal(AL.length, new Set(AL.map((a) => a.requestId)).size);
  setPrice("INDEX", 10400); const okSlip = await buy("INDEX", 10_000, { seenKobo: 10000 }); assert.equal(okSlip.priceKobo, "10400");
  await fails(sell("INDEX", 100, { seenKobo: 5000 }), 409, /moved/);
  const retry = rid(), fresh = await invest(db, "u1", { action: "buy", product: "INDEX", amountNaira: 10_000, requestId: retry, seenKobo: 10_400 }); assert.ok(fresh.ok);
  assert.ok(MAX_SLIP_PCT >= 1); await sell("INDEX", 100);
  ok("a price sent by the browser is ignored (filled at the server's); an order is refused if the real price moved more than " + MAX_SLIP_PCT + "% from the price the player saw, and nothing is half-done");
}
{ // a refused order frees its request id: the same id can be retried at the new price
  setPrice("INDEX", 10000); const id = rid(); await fails(invest(db, "u1", { action: "buy", product: "INDEX", amountNaira: 5_000, requestId: id, seenKobo: 5000 }), 409);
  const again = await invest(db, "u1", { action: "buy", product: "INDEX", amountNaira: 5_000, requestId: id, seenKobo: 10000 }); assert.ok(again.ok && !again.duplicate); await sell("INDEX", 100);
  ok("a refused order does not use up its request id");
}

// ===== 7. bad input, bad ownership, not enough money =====
{
  await fails(buy("INDEX", 500), 400, /1,000/); await fails(buy("INDEX", 5_000_001), 400); await fails(buy("INDEX", 1500.5), 400); await fails(buy("INDEX", -5000), 400); await fails(buy("INDEX", "lots"), 400); await fails(buy("INDEX", null), 400);
  await fails(buy("NOPE", 5000), 400, /Unknown product/); await fails(invest(db, "u1", { action: "short", product: "INDEX", amountNaira: 5000, requestId: rid() }), 400);
  await fails(invest(db, "u1", { action: "buy", product: "INDEX", amountNaira: 5000 }), 400, /requestId/); await fails(invest(db, "u1", { action: "buy", product: "INDEX", amountNaira: 5000, requestId: "x" }), 400);
  await fails(sell("TECH", 50), 404, /do not hold/); await fails(sell("INDEX", 0), 400); await fails(sell("INDEX", 101), 400); await fails(sell("INDEX", 50.5), 400); await fails(sell("INDEX", "all"), 400);
  await fails(buy("INDEX", 5000, { seenKobo: -3 }), 400); await fails(buy("INDEX", 5000, { seenKobo: "abc" }), 400);
  assert.ok([...H].every((h) => h.unitsMicro >= 0n && h.costKobo >= 0n));
  const keep = A.p.balance; A.p.balance = M(500); const n = L.length;
  await fails(buy("INDEX", 10_000), 402, /cannot afford/); assert.equal(A.p.balance, M(500)); assert.equal(L.length, n); assert.equal(TR.at(-1).requestId !== undefined, true);
  A.p.balance = M(10_100); await buy("INDEX", 10_000); assert.equal(A.p.balance, 0n); await fails(buy("INDEX", 1_000), 402); // exactly enough works, one kobo less does not
  A.p.balance = keep; await sell("INDEX", 100);
  ok("below the minimum, fractions, negatives, text, unknown product or action, no request id, selling what you do not hold, and an unaffordable order are all refused with nothing changed");
}

// ===== 8. the total-invested limit counts holdings at their LIVE value =====
{
  await buy("INDEX", 200_000); setPrice("INDEX", 40000); // worth ₦800,000 now
  const room = investCap(C.level) - H.find((h) => h.product === "INDEX").unitsMicro * 40000n / 1_000_000n;
  await fails(buy("PLOTS", Number((room + M(1)) / 100n)), 409, /limit/); await buy("PLOTS", Number(room / 100n / 2n));
  await sell("INDEX", 100); await sell("PLOTS", 100); setPrice("INDEX", 10000);
  ok("the investment limit is measured at today's prices: a holding that doubled twice uses up more of the limit");
}

// ===== 9. lock period and early-sale penalty still apply (a week is a game week) =====
{
  const before = cash(); await buy("COOP", 100_000); const r = await sell("COOP", 100); assert.match(r.note, /5% early-sale penalty/);
  near(cash() - before, -M(101_000) + (M(100_000) - M(5_000) - M(1_000)), 2n, "cash: paid 101,000, got back about 94,000");
  near(BigInt(r.netKobo), M(100_000) - M(5_000) - M(1_000), 2n, "net after penalty and fee");
  await buy("COOP", 100_000); week += 3; C.lastTickWeek = week; const r2 = await sell("COOP", 100); assert.doesNotMatch(r2.note, /penalty/); near(BigInt(r2.netKobo), M(100_000) - M(1_000), 2n, "net after the fee only");
  week -= 3; C.lastTickWeek = week;
  ok("selling inside a lock period costs the 5% penalty; after the lock it does not");
}

// ===== 10. concurrent orders =====
{
  // (a) six parallel buys that together cost more than the balance: exactly the ones that fit go through
  A.p.balance = M(250_000); const before = H.length, trades = TR.length;
  const rs = await Promise.allSettled(Array.from({ length: 6 }, () => buy("PLOTS", 100_000)));
  const done = rs.filter((x) => x.status === "fulfilled"), no = rs.filter((x) => x.status === "rejected");
  assert.equal(done.length, 2); assert.equal(no.length, 4); assert.ok(no.every((x) => x.reason.status === 402));
  assert.equal(A.p.balance, M(250_000) - 2n * M(101_000)); assert.equal(TR.length - trades, 2); assert.ok(A.p.balance >= 0n);
  assert.equal(H.filter((h) => h.product === "PLOTS").length, 1); assert.equal(H.find((h) => h.product === "PLOTS").costKobo, 2n * M(100_000)); void before;
  ok("6 simultaneous ₦100,000 buys with ₦250,000 in the account: exactly 2 succeed, 4 are refused for lack of money, the balance never goes negative");

  // (b) the same request sent six times at once
  A.p.balance = M(1_000_000); const id = rid(), n0 = TR.length, c0 = cash();
  const rs2 = await Promise.all(Array.from({ length: 6 }, () => invest(db, "u1", { action: "buy", product: "TECH", amountNaira: 100_000, requestId: id })));
  assert.equal(rs2.filter((x) => !x.duplicate).length, 1); assert.equal(TR.length - n0, 1); assert.equal(c0 - cash(), M(101_000));
  ok("the same order sent 6 times at once is executed once and charged once");

  // (c) parallel sells of the same holding: it can only be sold once
  const held0 = H.find((h) => h.product === "TECH").unitsMicro; assert.ok(held0 > 0n); const c1 = cash();
  const ss = await Promise.allSettled(Array.from({ length: 5 }, () => sell("TECH", 100)));
  assert.equal(ss.filter((x) => x.status === "fulfilled").length, 1); assert.ok(ss.filter((x) => x.status === "rejected").every((x) => x.reason.status === 404));
  assert.equal(H.find((h) => h.product === "TECH").unitsMicro, 0n); assert.ok(cash() - c1 > 0n && cash() - c1 < M(100_000));
  ok("5 simultaneous 'sell all' orders: sold once, the other four find nothing left to sell");

  // (d) a storm of mixed orders while the price moves: the books stay balanced
  A.p.balance = M(2_000_000); const startCash = cash(), startLedger = ledgerCash(), keys = ["INDEX", "TECH", "MEME", "COOP"]; let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const jobs = []; for (let i = 0; i < 60; i++) { const k = keys[Math.floor(rnd() * keys.length)]; jobs.push(rnd() < 0.55 ? () => buy(k, 1000 + Math.floor(rnd() * 150_000)) : () => sell(k, 1 + Math.floor(rnd() * 100))); if (i % 7 === 0) jobs.push(async () => setPrice(k, Math.max(100, Math.round(P[k] * (0.4 + rnd() * 2.2))))); }
  const out = await Promise.allSettled(jobs.map((j) => j()));
  assert.ok(out.some((x) => x.status === "fulfilled")); assert.ok(out.filter((x) => x.status === "rejected").every((x) => [402, 404, 409, 400].includes(x.reason.status)), "only clean refusals");
  assert.ok(A.p.balance >= 0n); assert.ok(H.every((h) => h.unitsMicro >= 0n && h.costKobo >= 0n)); assert.equal(cash() - startCash, ledgerCash() - startLedger, "the account balance equals what the ledger says");
  assert.equal(new Set(AL.map((a) => a.requestId)).size, AL.length); assert.equal(new Set(TR.map((t) => t.requestId)).size, TR.length);
  const bought = TR.filter((t) => t.side === "BUY").length, soldN = TR.filter((t) => t.side === "SELL").length; assert.ok(bought > 3 && soldN > 3, `${bought} buys, ${soldN} sells`);
  ok(`60 mixed orders in parallel while prices swing: ${bought} buys and ${soldN} sells executed, the rest refused cleanly; balance == ledger, no negative units`);
}

// ===== 11. the stored valuation follows the live price (net worth, Forbes) =====
{
  A.p.balance = M(5_000_000); const k = "PLOTS"; if (!H.find((h) => h.product === k && h.unitsMicro > 0n)) await buy(k, 50_000);
  setPrice(k, 33333); await getInvestments(db, "u1"); const h = H.find((x) => x.product === k && x.unitsMicro > 0n); assert.equal(h.valueKobo, (h.unitsMicro * 33333n) / 1_000_000n);
  ok("opening the Invest app re-values the stored holding at the live price");
}
console.log("DONE");
