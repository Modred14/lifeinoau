// tests/market-live.test.mjs: the live market engine (lib/marketEngine.js)
// Everything here is deterministic (fixed seeds, a frozen clock), so a pass is a pass every time. Run: node tests/market-live.test.mjs
import assert from "node:assert/strict";
import { createMarket, MODEL, stepState, warmGenesis, BLOCK_MS, TICK_MS, KEEP_HOURS } from "../lib/marketEngine.js";
import { fastWords, memStore, ANCHORS } from "./market-words.mjs";

const KEYS = Object.keys(MODEL), ok = (m) => console.log("OK  ", m);
const quiet = { error() {}, warn() {} };
const T0 = Date.UTC(2026, 9, 24, 12, 0, 30); // a fixed "now", 30 seconds into a minute
let clock = T0;
const make = (store, secret = "test-secret", extra = {}) => createMarket({ store, secret, anchors: async () => ANCHORS, now: () => clock, log: quiet, ...extra });
const settle = () => new Promise((r) => setTimeout(r, 25)); // lets the fire-and-forget checkpoint save finish
const lnr = (a, b) => Math.log(a / b);

// ===== 1. every process computes the same prices; a restart changes nothing; a wrong key is refused =====
{
  clock = T0; const store = memStore(), A = make(store), B = make(store);
  await Promise.all([A.ready(), B.ready()]);
  for (let i = 0; i < 300; i++) for (const k of KEYS) assert.equal(A.priceKoboAt(k, T0 + i * 7919), B.priceKoboAt(k, T0 + i * 7919));
  ok("two processes sharing one database compute identical prices (300 instants x 6 products)");

  for (const k of KEYS) assert.equal(A.priceKoboAt(k, A.genesis().start * BLOCK_MS), ANCHORS[k], k + " starts exactly where the old market ended");
  ok("the live market starts at the old market's last prices: nobody's holdings change value when it goes live");

  const other = make(memStore(), "a-different-secret"); await other.ready();
  assert.ok(KEYS.some((k) => other.priceKoboAt(k, T0 + 3_600_000) !== A.priceKoboAt(k, T0 + 3_600_000)));
  await assert.rejects(() => make(store, "a-different-secret").ready(), /MARKET_SEED/);
  ok("another secret key gives other prices, and a process holding the wrong key refuses to start on this market");

  // 20 simultaneous first calls start the market once
  clock = T0; const s2 = memStore(), C = make(s2); await Promise.all(Array.from({ length: 20 }, () => C.ready()));
  assert.equal(s2.calls.insertGenesis, 1); ok("20 simultaneous first requests create the market once");
}

// ===== 2. two servers starting at the same moment: the first genesis row wins and both read it back =====
{
  clock = T0; const store = memStore(), A = make(store), B = make(store, "test-secret", { now: () => clock + 90_000 });
  await Promise.all([A.ready(), B.ready()]);
  assert.equal(store.calls.insertGenesis, 2); assert.equal(A.genesis().start, B.genesis().start);
  clock = T0 + 5 * 60_000; for (const k of KEYS) assert.equal(A.priceKoboAt(k, clock), B.priceKoboAt(k, clock));
  ok("a race to create the market ends with one market (the first row wins)"); clock = T0;
}

// ===== 3. the market moves on while nobody is watching, and a restart picks up exactly where it was =====
{
  clock = T0; const store = memStore(), A = make(store); await A.ready();
  const before = Object.fromEntries(KEYS.map((k) => [k, A.priceKoboAt(k, T0)]));
  clock = T0 + 3 * 86_400_000; await A.ready(); await settle(); // three days with no player and no request in between
  assert.ok(KEYS.some((k) => A.priceKoboAt(k, clock) !== before[k]));
  assert.ok(store.cps.size >= 60, "an hourly checkpoint was saved: " + store.cps.size);
  clock += 300_000; await A.ready();
  const B = make(store); await B.ready(); // "the server restarted": a brand new process on the same database
  for (let t = clock - 300_000; t <= clock; t += 1000) for (const k of KEYS) assert.equal(A.priceKoboAt(k, t), B.priceKoboAt(k, t), `${k} at ${t}`);
  assert.ok(store.calls.loadCheckpoint >= 1);
  ok("after 3 idle days and a restart, every price over the last 5 minutes is identical (nothing reset, nothing replayed from scratch)");

  // a damaged checkpoint is ignored, not trusted
  const newest = Math.max(...store.cps.keys()); const victim = [...store.cps.keys()].sort((a, b) => a - b).filter((b) => b <= B.top() - 1500).pop();
  store.cps.set(victim, { b: 1, junk: true });
  const C = make(store); await C.ready();
  for (const k of KEYS) assert.equal(C.priceKoboAt(k, clock), A.priceKoboAt(k, clock));
  assert.ok(newest > 0); ok("a damaged checkpoint is ignored and the market is rebuilt correctly from the older state");
}

// ===== 4. a long absence is cheap =====
{
  clock = T0; const store = memStore(), A = make(store); await A.ready();
  clock = T0 + 30 * 86_400_000; const t0 = performance.now(); await A.ready(); const ms = performance.now() - t0; await settle();
  for (const k of KEYS) { const p = A.priceKoboAt(k, clock); assert.ok(Number.isInteger(p) && p >= 1, `${k} ${p}`); }
  assert.ok(ms < 20_000, "30 days of catching up took " + ms.toFixed(0) + " ms");
  assert.ok(store.cps.size <= KEEP_HOURS + 2, "old checkpoints are not piling up: " + store.cps.size);
  ok(`30 days offline: one call, ${ms.toFixed(0)} ms, ${store.cps.size} checkpoints kept`); clock = T0;
}

// ===== 5. continuity: a price never jumps between seconds or at a minute boundary, and the snapshot agrees with the prices =====
{
  clock = T0; const store = memStore(), A = make(store); await A.ready(); clock = T0 + 6 * 3_600_000; await A.ready();
  const LIM = { COOP: 0.004, BILLS: 0.005, INDEX: 0.05, PLOTS: 0.03, TECH: 0.25, MEME: 0.45 }; // per second, in log terms
  const start = Math.ceil((clock - 5 * 3_600_000) / BLOCK_MS) * BLOCK_MS;
  for (const k of KEYS) {
    let worst = 0, boundary = 0, flat = 0, n = 0;
    for (let t = start; t < start + 4 * 3_600_000; t += TICK_MS) {
      const m = Math.abs(lnr(A.priceKoboAt(k, t + TICK_MS), A.priceKoboAt(k, t))); worst = Math.max(worst, m); if ((t + TICK_MS) % BLOCK_MS === 0) boundary = Math.max(boundary, m);
      n++; if (m === 0) flat++;
    }
    assert.ok(worst < LIM[k], `${k} moved ${(worst * 100).toFixed(2)}% in one second`);
    assert.ok(boundary < LIM[k], `${k} jumped at a minute boundary`);
    assert.ok(flat < n, k + " never moves");
  }
  const snap = A.snapshot(), tk = A.tick(); for (const k of KEYS) assert.equal(snap.prices[k], tk.p[k]);
  const five = A.series("MEME", clock, 5, 1000).values; assert.deepEqual(five, [4, 3, 2, 1, 0].map((i) => A.priceKoboAt("MEME", Math.floor(clock / 1000) * 1000 - i * 1000)));
  assert.ok(Math.abs(snap.changes.MEME.m5 - Math.round((snap.prices.MEME / A.priceKoboAt("MEME", snap.t - 300_000) - 1) * 10000) / 100) < 1e-9);
  ok("4 hours of seconds: no price ever jumps between two seconds or across a minute boundary; ticks, series and snapshot agree");
}

// ===== statistics: fast keyed generator, minute resolution =====
const cache = new Map();
function minutes(seed, key, days) { // log price at each minute
  const id = `${seed}|${key}|${days}`; if (cache.has(id)) return cache.get(id);
  const sub = { [key]: MODEL[key] }, W = fastWords(seed * 7919 + 1), g = warmGenesis(sub, W, 1_000_000, { [key]: 100 });
  let s = g.s0; const out = new Float64Array(days * 1440 + 1); out[0] = s.p[key].a + s.p[key].d;
  for (let b = 0; b < days * 1440; b++) { s = stepState(sub, W, g, s); out[b + 1] = s.p[key].a + s.p[key].d; }
  cache.set(id, out); return out;
}
const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs) => sd(xs) / Math.sqrt(xs.length);

// ===== 6. different assets have different volatility, in the order of their risk =====
{
  const vol = {}; for (const k of KEYS) { const r = []; for (let seed = 1; seed <= 4; seed++) { const lp = minutes(seed, k, 3); for (let i = 1; i < lp.length; i++) r.push(lp[i] - lp[i - 1]); } vol[k] = sd(r); }
  const order = ["COOP", "BILLS", "PLOTS", "INDEX", "TECH", "MEME"];
  for (let i = 1; i < order.length; i++) assert.ok(vol[order[i]] > vol[order[i - 1]] * 1.2, `${order[i]} (${vol[order[i]]}) should be clearly more volatile than ${order[i - 1]} (${vol[order[i - 1]]})`);
  ok("minute volatility rises with risk: " + order.map((k) => k + " " + (vol[k] * 100).toFixed(3) + "%").join(" < "));
}

// ===== 7. the shape of a price: frequent small moves, calm spells, fat tails, no cycles =====
{
  for (const k of ["INDEX", "TECH", "MEME"]) {
    const w10 = [], r1 = []; for (let seed = 1; seed <= 6; seed++) { const lp = minutes(seed, k, 7); for (let i = 10; i < lp.length; i += 10) w10.push(lp[i] - lp[i - 10]); for (let i = 1; i < lp.length; i++) r1.push(lp[i] - lp[i - 1]); }
    const s10 = sd(w10), calm = w10.filter((x) => Math.abs(x) < 0.4 * s10).length / w10.length, wild = w10.filter((x) => Math.abs(x) > 3 * s10).length / w10.length;
    const m = mean(r1), kurt = mean(r1.map((x) => ((x - m) / sd(r1)) ** 4));
    assert.ok(calm > 0.2, `${k}: spells of relative calm (${calm.toFixed(2)})`); assert.ok(wild > 0.001, `${k}: sharp moves exist (${wild.toFixed(4)})`); assert.ok(kurt > 6, `${k}: fat tails (kurtosis ${kurt.toFixed(1)})`);
  }
  // no cycle, no alternating pattern: autocorrelation of minute returns stays near zero at every lag up to 3 hours
  for (const k of ["INDEX", "TECH", "MEME"]) {
    const rs = []; for (let seed = 1; seed <= 6; seed++) { const lp = minutes(seed, k, 7), r = []; for (let i = 1; i < lp.length; i++) r.push(lp[i] - lp[i - 1]); rs.push(r); }
    let worst = 0, worstLag = 0;
    for (let lag = 1; lag <= 180; lag++) { let num = 0, den = 0; for (const r of rs) { const m = mean(r); for (let i = lag; i < r.length; i++) num += (r[i] - m) * (r[i - lag] - m); for (let i = 0; i < r.length; i++) den += (r[i] - m) ** 2; } const rho = num / den; if (Math.abs(rho) > worst) { worst = Math.abs(rho); worstLag = lag; } }
    assert.ok(worst < 0.1, `${k}: autocorrelation ${worst.toFixed(3)} at lag ${worstLag} minutes`);
  }
  ok("calm spells and sharp moves both occur, tails are fat, and minute returns show no cycle or alternation at any lag up to 3 hours");
}

// ===== 8. sharp rises and crashes exist for risky assets and not for safe ones =====
{
  const count = (k, seeds, days) => { let up = 0, down = 0, last = -1e9, lastD = -1e9;
    for (let seed = 1; seed <= seeds; seed++) { const lp = minutes(seed, k, days); last = lastD = -1e9;
      for (let i = 5; i < lp.length; i++) { let mn = Infinity, mx = -Infinity; for (let j = i - 5; j < i; j++) { mn = Math.min(mn, lp[j]); mx = Math.max(mx, lp[j]); }
        if (lp[i] - mn >= Math.log(2) && i - last > 30) { up++; last = i; } if (lp[i] - mx <= Math.log(0.5) && i - lastD > 30) { down++; lastD = i; } } }
    return { up, down }; };
  for (const k of ["COOP", "BILLS", "PLOTS", "INDEX"]) { const c = count(k, 20, 7); assert.deepEqual(c, { up: 0, down: 0 }, k + " must not double or halve within minutes"); }
  const meme = count("MEME", 60, 8);
  assert.ok(meme.up >= 3, "MEME doubled within 5 minutes " + meme.up + " times in 480 days"); assert.ok(meme.down >= 3, "MEME halved within 5 minutes " + meme.down + " times");
  ok(`in 480 simulated days MemeCoin doubled within 5 minutes ${meme.up} times and halved ${meme.down} times; the safe products never did`);
}

// ===== 9. no free lunch: nothing a player can see makes money after fees =====
{
  // (a) the average price goes nowhere but its slow growth, however volatile the asset is
  for (const k of KEYS) {
    const ratio = []; for (let seed = 1; seed <= 60; seed++) { const lp = minutes(seed, k, 4); ratio.push(Math.exp(lp[lp.length - 1] - lp[0])); }
    const growth = Math.pow(1 + MODEL[k].weekPct / 100, 4 / 7), m = mean(ratio), tol = Math.max(0.01, 3 * se(ratio));
    assert.ok(Math.abs(m - growth) < tol, `${k}: average price after 4 days x${m.toFixed(3)} but its growth says x${growth.toFixed(3)} (+-${tol.toFixed(3)})`);
  }
  // (b) trading rules on what is visible lose to the 1% fee each way (a round trip keeps about 98%)
  const NET = 0.98;
  const strategies = {
    "momentum: buy after a strong 10-minute rise, hold 10 minutes": (lp, i, s10) => (lp[i] - lp[i - 10] > 2 * s10 ? 10 : 0),
    "reversal: buy after a sharp 10-minute fall, hold 30 minutes": (lp, i, s10) => (lp[i] - lp[i - 10] < -2 * s10 ? 30 : 0),
    "buy a crash: down 30% or more within 5 minutes, hold a day": (lp, i) => (lp[i] - Math.max(...lp.slice(i - 5, i)) < Math.log(0.7) ? 1440 : 0),
    "buy a pump: up 40% or more within 5 minutes, hold 30 minutes": (lp, i) => (lp[i] - Math.min(...lp.slice(i - 5, i)) > Math.log(1.4) ? 30 : 0),
  };
  for (const k of ["INDEX", "TECH", "MEME"]) for (const [name, rule] of Object.entries(strategies)) {
    const gains = []; for (let seed = 1; seed <= 24; seed++) { const lp = minutes(seed, k, 8), r = []; for (let i = 10; i < lp.length; i += 10) r.push(lp[i] - lp[i - 10]); const s10 = sd(r);
      for (let i = 12; i < lp.length - 1500; i++) { const hold = rule(lp, i, s10); if (hold) { gains.push(Math.exp(lp[i + hold] - lp[i]) * NET); i += hold; } } }
    if (gains.length < 8) continue; // too rare to say anything: not a worry
    assert.ok(mean(gains) < 1 + 3 * se(gains), `${k} "${name}": x${mean(gains).toFixed(3)} after fees over ${gains.length} trades`);
  }
  ok("average price follows its stated growth for every product, and four visible-pattern strategies (momentum, reversal, buy-the-crash, buy-the-pump) do not beat the fees");
}

// ===== 10. +100% doubles a price, -50% halves it =====
{
  const p = 12345, up = Math.round(p * (1 + 100 / 100)), down = Math.round(up * (1 - 50 / 100)); assert.equal(up, 2 * p); assert.equal(down, p);
  ok("+100% doubles a price, then -50% brings it back exactly");
}
console.log("DONE");
