// lib/marketEngine.js
// The LIVE market: prices that move every second, are the same on every server, keep moving while nobody is playing, and cannot be
// predicted or changed by a player. This file is pure maths plus a small cache (no database import: lib/marketLive.js wires it up).
//
// HOW A PRICE IS MADE
//  * Time is cut into BLOCKS of one minute (60 ticks of one second). A price exists for every tick; it is the same for the whole second.
//  * Every random number comes from HMAC-SHA256(secret key, "product|block|..."). The key never leaves the servers, so nobody can work
//    out a future price (a 32-bit seed could be brute-forced; a 256-bit key cannot). The price is a PURE FUNCTION of (key, product,
//    time): any server computes the same number, a restart changes nothing, and the market moves on its own while players are offline.
//  * Once per block each product takes ONE step of a small Markov model (the "block chain"):
//        log price = FAIR VALUE (a random walk with stochastic volatility, faint trends and rare jumps; every move is PERMANENT)
//                  + MICRO-NOISE (a tiny, fast-fading wobble around it: half-life of an hour or so)
//    Volatility moves in REGIMES: CALM (almost flat), NORMAL, UPTREND, DOWNTREND, VOLATILE and, now and then, a BURST: a few minutes of
//    violent noise in which jumps cluster, so a price can double and halve again within five minutes. Volatility clusters, trends are
//    weak next to the noise and as likely down as up, and rare JUMPS (sharp rises and crashes) arrive at random seconds.
//    A shared MARKET MOOD (boom / steady / slump / crash) lasting hours nudges every product by its `beta`, and a crash is rougher.
//  * NO FREE LUNCH. The price is a MARTINGALE apart from its slow growth (`weekPct`): the exact amount that volatility and jumps would add
//    to the AVERAGE price (a price that halves or doubles with equal chance grows by 25% on average) is taken back every minute, and no move
//    ever fades, so a crash does not "bounce back" and a pump does not "give back" on a schedule. Nothing a player can see in the past tells
//    them which way the price goes next; the faint trends and the micro-noise are far too small to pay a 1% fee each way
//    (tests/market-live.test.mjs measures all of this). High volatility still has a price: a very volatile asset's TYPICAL price drifts down
//    over weeks (volatility drag), while a few lucky holders make several times their money. That is what "high risk" means.
//  * Inside a block the seconds are filled in with a Brownian BRIDGE: the path starts at this block's start price, ends exactly at the
//    next block's start price, and wiggles in between (the noise of each second is again keyed, never a repeating pattern).
//    So the chain only needs ONE step per minute, however long the market has been idle: a month offline costs about 43,000 steps.
//  * Prices are multiplicative: +100% doubles a price, -50% halves it, and +100% followed by -50% lands exactly where it started.
//
// PERSISTENCE (see lib/marketStore.js): a GENESIS row (the first block, and each product's starting price: the last weekly price of the
// old market, so nobody's holdings change value on the day this goes live) and one CHECKPOINT per hour. A process that starts (or has been
// away) loads the newest checkpoint and replays at most that hour. Checkpoints only cache what any process would compute anyway, and
// saving one twice is harmless, so there is nothing to lock and nothing that can be reset.
import { createHmac } from "node:crypto";

export const TICK_MS = 1000;
export const BLOCK_TICKS = 60;
export const BLOCK_MS = TICK_MS * BLOCK_TICKS;
export const CHECKPOINT_EVERY = 60; // blocks: one saved state per hour
export const KEEP_HOURS = 72; // hourly checkpoints kept in the database (older ones are pruned)
export const RING = 1500; // blocks of state kept in memory (25 hours): enough for the 24h chart
const RAMP = 4; // a jump takes this many seconds to play out
const LN_MIN = Math.log(1e-9), LN_MAX = Math.log(1e9); // naira per unit (the shown price never goes below 1 kobo, but the hidden level may)
const U32 = 4294967296;
const MODEL_VERSION = 1;
const WARM_BLOCKS = 3 * 1440; // three days of warm-up before the market's first moment

// ---------- regimes ----------
const CALM = 0, NORMAL = 1, UP = 2, DOWN = 3, VOLATILE = 4, BURST = 5;
export const REGIME_NAMES = ["CALM", "NORMAL", "UPTREND", "DOWNTREND", "VOLATILE", "BURST"];
const VOL = [0.35, 1, 1, 1.1, 2.2, 1]; // noise multiplier (a BURST uses the product's own burstX)
const JUMPX = [0.2, 1, 1, 1.2, 2.5, 1]; // jump-rate multiplier (a BURST uses the product's own `bj`: the chance of a jump in each of its minutes)
const SPAN = [[8, 45], [6, 30], [6, 40], [6, 40], [3, 15], [2, 8]]; // minutes a regime lasts (min, max)
// weights of the NEXT regime. Rows: from. Columns: to. The BURST column is scaled by the product's `burst`. Up and down are mirror images.
const FLOW = [
  [0, 5, 2, 2, 1, 0.1],
  [3, 0, 3, 3, 1.5, 0.25],
  [1.5, 3, 0, 3, 1.5, 0.2],
  [1.5, 3, 3, 0, 1.5, 0.2],
  [2, 4, 1.5, 1.5, 0, 0.5],
  [1, 3, 1, 1, 4, 0],
];
// the shared market mood. f = drift (in units of a product's own noise) that each product takes on, times its beta; v = how rough the market is.
// The time-weighted average of f is zero, so a mood is news and colour, not a source of money.
export const MOODS = [
  { key: "BOOM", p: 0.15, f: 0.03, v: 0.9, span: [90, 420], heads: ["Oil prices climb and investors cheer", "A tech funding boom lifts the market", "Remittances surge and spending rises"] },
  { key: "STEADY", p: 0.55, f: 0, v: 1, span: [240, 1200], heads: ["Markets stay quiet as traders wait for news", "A calm session on the exchange", "Investors hold steady"] },
  { key: "SLUMP", p: 0.22, f: -0.015, v: 1.15, span: [90, 480], heads: ["The naira weakens and investors get nervous", "A fuel price hike spooks the market", "Weak earnings drag shares down"] },
  { key: "CRASH", p: 0.08, f: -0.03, v: 1.8, span: [20, 120], heads: ["Panic selling shakes the market", "A banking scare triggers a sell-off"] },
];

// ---------- the products ----------
// sig     noise of one minute (log units). A day of pure noise is about sig * 38.
// weekPct long-run growth of the average price, percent a week (the old market's design: safe things creep up, risky things do not run away)
// sigD    minute-to-minute size of the micro-noise (log units): its typical size is about sigD / sqrt(2 ln2 / hlMin), 0.02% for COOP up to 0.5% for MEME,
//         always below the 1% fee, so trading the wobble can never pay        hlMin   its half-life in minutes
// jumpDay jumps per day (before regime multipliers), each between jLo and jHi in log size; up = chance a jump is a rise
// beta    how much the shared mood moves it      burst  how often a BURST starts      burstX  its noise in a burst      bj  chance of a jump in each minute of one
export const MODEL = {
  COOP: { sig: 0.0002, weekPct: 0.4, sigD: 0.000025, hlMin: 90, jumpDay: 0.1, jLo: 0.002, jHi: 0.006, up: 0.5, beta: 0.05, burst: 0.02, burstX: 2.5, bj: 0.01 },
  BILLS: { sig: 0.0003, weekPct: 0.5, sigD: 0.000037, hlMin: 90, jumpDay: 0.1, jLo: 0.002, jHi: 0.008, up: 0.5, beta: 0.05, burst: 0.02, burstX: 2.5, bj: 0.01 },
  INDEX: { sig: 0.001, weekPct: 0.8, sigD: 0.00023, hlMin: 60, jumpDay: 0.3, jLo: 0.012, jHi: 0.05, up: 0.5, beta: 0.8, burst: 0.15, burstX: 3.5, bj: 0.05 },
  PLOTS: { sig: 0.0007, weekPct: 0.8, sigD: 0.000124, hlMin: 90, jumpDay: 0.15, jLo: 0.01, jHi: 0.04, up: 0.5, beta: 0.5, burst: 0.1, burstX: 3, bj: 0.03 },
  TECH: { sig: 0.0016, weekPct: 0.7, sigD: 0.00053, hlMin: 45, jumpDay: 0.25, jLo: 0.04, jHi: 0.4, up: 0.45, beta: 1.2, burst: 0.7, burstX: 6, bj: 0.07 },
  MEME: { sig: 0.0017, weekPct: 0.75, sigD: 0.00107, hlMin: 30, jumpDay: 0.35, jLo: 0.1, jHi: 0.8, up: 0.5, beta: 1.5, burst: 0.9, burstX: 7, bj: 0.1 },
};
const MAG_POW = 2.4; // jump sizes lean small: size = lo + (hi - lo) * u^MAG_POW

/** Per-block numbers worked out once from a product's model. */
function derive(P) {
  const kDev = Math.LN2 / P.hlMin, rate = P.jumpDay / 1440;
  // E[exp(J) - 1] for one jump, by midpoint quadrature: what one jump adds to the AVERAGE price, which the block then takes back
  let jm = 0; const n = 400;
  for (let i = 0; i < n; i++) {
    const m = P.jLo + (P.jHi - P.jLo) * Math.pow((i + 0.5) / n, MAG_POW);
    jm += P.up * (Math.exp(m) - 1) + (1 - P.up) * (Math.exp(-m) - 1);
  }
  return { kDev, rate, jm: jm / n, lead: Math.log(1 + P.weekPct / 100) / (7 * 1440) }; // lead: log growth of the average price, per block
}
const DERIVED = new Map();
const derived = (P) => { let d = DERIVED.get(P); if (!d) DERIVED.set(P, (d = derive(P))); return d; };

// ---------- keyed randomness ----------
const readWords = (buf) => { const w = new Array(8); for (let i = 0; i < 8; i++) w[i] = buf.readUInt32BE(i * 4); return w; };
/** The real source of randomness: HMAC-SHA256 under a key derived from the server secret. Tests may pass a faster stand-in. */
export function hmacWords(secret) {
  const key = createHmac("sha256", String(secret)).update("oau-live-market/v" + MODEL_VERSION).digest();
  const at = (label) => readWords(createHmac("sha256", key).update(label).digest());
  return { block: (chain, block) => at(`B|${chain}|${block}`), path: (chain, block, c) => at(`P|${chain}|${block}|${c}`) };
}
const half = (w, k) => (k & 1 ? w & 0xffff : w >>> 16) / 65536; // two 16-bit uniforms from one word
const normals = (a, b) => { const r = Math.sqrt(-2 * Math.log((a + 1) / (U32 + 1))), t = (2 * Math.PI * b) / U32; return [r * Math.cos(t), r * Math.sin(t)]; };
const pick = (weights, u) => { let t = 0; for (const x of weights) t += x; let x = u * t; for (let i = 0; i < weights.length; i++) { if (x < weights[i]) return i; x -= weights[i]; } return weights.length - 1; };
const span = (r, u) => r[0] + Math.floor(u * (r[1] - r[0] + 1));
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ---------- the block chain ----------
export function initialState(start, a0) {
  return {
    b: start, v: MODEL_VERSION, m: { r: 1, l: 0, h: 0 },
    p: Object.fromEntries(Object.entries(a0).map(([k, a]) => [k, { a, d: 0, r: NORMAL, l: 0, m: 0 }])),
  };
}

/**
 * The market's first moment. The chain is run through WARM_BLOCKS of keyed "history" that ends at `start`, so that the deviation from fair
 * value, the regimes and the mood are already spread out the way they are in the long run (a market that began perfectly still would drift
 * up on average while its deviations spread). Then each fair value is shifted so that the price at `start` is exactly the given one
 * (naira per unit): nothing a player holds changes value when this market goes live.
 */
export function warmGenesis(model, words, start, prices) {
  const keys = Object.keys(model), ln = Object.fromEntries(keys.map((k) => [k, Math.log(Math.max(0.01, Number(prices[k])))]));
  const g = { start: start - WARM_BLOCKS, a0: ln };
  let s = initialState(g.start, g.a0);
  for (let i = 0; i < WARM_BLOCKS; i++) s = stepState(model, words, g, s);
  const p = {};
  for (const k of keys) { const x = s.p[k], a = x.a + (ln[k] - (x.a + x.d)); p[k] = { ...x, a, d: ln[k] - a }; }
  const s0 = { ...s, b: start, p };
  return { start, a0: Object.fromEntries(keys.map((k) => [k, p[k].a])), s0 };
}

/** One minute of one product. Returns its next state and what happened inside the minute (needed to draw the seconds). */
function stepProduct(P, s, mood, W) {
  const D = derived(P);
  let { r, l, m } = s;
  if (l <= 0) { // the regime has run its course: pick the next one
    const w = FLOW[r].slice(); w[BURST] *= P.burst;
    r = pick(w, half(W[3], 0)); l = span(SPAN[r], half(W[3], 1));
    const mag = half(W[4], 0);
    m = r === UP ? P.sig * (0.04 + 0.08 * mag) : r === DOWN ? -P.sig * (0.04 + 0.08 * mag) : 0; // faint next to the noise, and as likely down as up
  }
  const M = MOODS[mood.r], sigBlk = P.sig * (r === BURST ? P.burstX : VOL[r]) * M.v, [z0, z1] = normals(W[0], W[1]);
  // a jump? W[2] decides whether (and, within the same number, whether it is a rise), W[5] its size and its second inside the minute
  const rate = r === BURST ? P.bj : D.rate * JUMPX[r], x = W[2] / U32;
  let jt = 0, jtick = 0;
  if (x < rate) {
    const size = P.jLo + (P.jHi - P.jLo) * Math.pow(half(W[5], 0), MAG_POW);
    jt = x / rate < P.up ? size : -size; jtick = Math.floor(half(W[5], 1) * (BLOCK_TICKS - RAMP + 1));
  }
  const comp = 0.5 * sigBlk * sigBlk + Math.log(1 + rate * D.jm); // what this minute's noise and jump chance add to the AVERAGE price: taken back
  const a1 = s.a + D.lead + m + P.beta * M.f * P.sig + sigBlk * z0 + jt - comp;
  const d1 = s.d - D.kDev * s.d + P.sigD * z1;
  const lp0 = s.a + s.d, lp1 = clamp(a1 + d1, LN_MIN, LN_MAX), dEnd = lp1 - a1; // lp1 is computed exactly as the next minute computes its own start
  return { next: { a: a1, d: dEnd, r, l: l - 1, m }, info: { lp0, lp1, jt, jtick, sigBlk } };
}

/** The shared mood for this minute, and the next one. */
function stepMood(s, W) {
  let { r, l, h } = s;
  if (l <= 0) { r = pick(MOODS.map((x) => x.p), half(W[3], 0)); l = span(MOODS[r].span, half(W[3], 1)); h = Math.floor(half(W[4], 0) * MOODS[r].heads.length); }
  return { r, l: l - 1, h };
}

/** state at the start of block b -> state at the start of block b + 1. Pure. */
export function stepState(model, words, genesis, s) {
  const b = s.b, M = stepMood(s.m, words.block("M", b));
  const p = {};
  for (const k of Object.keys(s.p)) p[k] = stepProduct(model[k], s.p[k], M, words.block(k, b)).next;
  return { b: b + 1, v: MODEL_VERSION, m: M, p };
}

/** The log price at each of the BLOCK_TICKS + 1 instants of block `s.b` for one product (index 0 = start, last = the next block's start). */
export function blockPath(model, words, genesis, s, key) {
  const P = model[key], mood = s.m.l <= 0 ? stepMood(s.m, words.block("M", s.b)) : s.m;
  const { info } = stepProduct(P, s.p[key], mood, words.block(key, s.b));
  const n = BLOCK_TICKS, sigTick = info.sigBlk / Math.sqrt(n), S = new Float64Array(n + 1);
  for (let c = 0, i = 1; c < 8 && i <= n; c++) {
    const w = words.path(key, s.b, c);
    for (let q = 0; q < 4 && i <= n; q++) { const z = normals(w[2 * q], w[2 * q + 1]); for (let e = 0; e < 2 && i <= n; e++, i++) S[i] = S[i - 1] + z[e]; }
  }
  const out = new Float64Array(n + 1), line = info.lp1 - info.lp0 - info.jt;
  for (let i = 0; i <= n; i++) {
    const bridge = sigTick * (S[i] - (i / n) * S[n]); // zero at both ends
    let j = 0;
    if (info.jt !== 0) { const x = clamp((i - info.jtick) / RAMP, 0, 1); j = info.jt * x * x * (3 - 2 * x); }
    out[i] = clamp(info.lp0 + line * (i / n) + bridge + j, LN_MIN, LN_MAX);
  }
  out[0] = info.lp0; out[n] = info.lp1; // exact joins: the price never jumps between two minutes
  return out;
}

const koboOf = (lp) => Math.max(1, Math.round(Math.exp(lp) * 100));
const isState = (s) => s && typeof s === "object" && Number.isFinite(s.b) && s.m && typeof s.p === "object" && Object.values(s.p).every((x) => x && [x.a, x.d, x.r, x.l, x.m].every(Number.isFinite));

/**
 * The live market for one process. `store` saves and loads the genesis row and the hourly checkpoints (lib/marketStore.js).
 * `anchors()` says what each product costs on the very first day (kobo). `now()` is the server clock (tests freeze it).
 */
export function createMarket({ store, secret, anchors, model = MODEL, now = Date.now, words = null, log = console }) {
  const W = words ?? hmacWords(secret), keys = Object.keys(model);
  let genesis = null, booted = false, ring = new Map(), top = -1, booting = null, pending = [], flushing = false, lastPrune = 0, saved = 0;
  const paths = new Map();
  const blockOf = (t) => Math.floor(t / BLOCK_MS);

  const remember = (s) => { ring.set(s.b, s); if (ring.size > RING) { const old = s.b - RING; for (const k of ring.keys()) { if (k > old) break; ring.delete(k); } } };
  function advanceTo(target) {
    let s = ring.get(top);
    for (let b = top; b < target; b++) {
      s = stepState(model, W, genesis, s); top = s.b; remember(s);
      if (s.b % CHECKPOINT_EVERY === 0 && s.b > saved && target - s.b <= KEEP_HOURS * CHECKPOINT_EVERY) pending.push({ block: s.b, state: s });
    }
  }
  async function flush() {
    if (flushing || !pending.length) return;
    flushing = true;
    try {
      const rows = pending; pending = [];
      await store.saveCheckpoints(rows);
      saved = Math.max(saved, ...rows.map((r) => r.block));
      if (Date.now() - lastPrune > 3_600_000) { lastPrune = Date.now(); await store.prune(top - KEEP_HOURS * CHECKPOINT_EVERY); }
    } catch (e) { log.error?.("[market] could not save checkpoints (prices are unaffected)", e?.message ?? e); }
    finally { flushing = false; }
  }
  async function loadGenesis() {
    let row = await store.loadGenesis();
    if (!row) { // the very first start: the old market's last prices become the first prices of the live one
      const a = await anchors(); // kobo per unit
      row = { ...warmGenesis(model, W, blockOf(now()), Object.fromEntries(keys.map((k) => [k, Math.max(1, Number(a[k])) / 100]))), check: W.block("check", 0)[0] };
      await store.insertGenesis(row); // two processes may race: the first row wins and everyone reads it back
      row = (await store.loadGenesis()) ?? row;
    }
    if (!keys.every((k) => Number.isFinite(row.a0?.[k])) || !Number.isFinite(row.start) || !isState(row.s0)) throw new Error("market genesis row is damaged");
    // Every process must hold the same secret key. A different key would quietly compute different prices, so refuse to start instead.
    if (row.check !== W.block("check", 0)[0]) throw new Error("MARKET_SEED differs from the one this market was created with: refusing to compute prices");
    return row;
  }
  async function boot() {
    genesis = await loadGenesis();
    const target = Math.max(genesis.start, blockOf(now())), from = Math.max(genesis.start, target - RING + 1);
    let cp = await store.loadCheckpoint(from);
    if (cp && (!isState(cp.state) || cp.state.b !== Number(cp.block) || !keys.every((k) => cp.state.p[k]))) { log.warn?.("[market] ignoring a damaged checkpoint at block", cp.block); cp = null; }
    const s0 = cp && Number(cp.block) >= genesis.start ? cp.state : genesis.s0;
    ring = new Map(); remember(s0); top = s0.b; saved = cp ? Number(cp.block) : 0; pending = [];
    advanceTo(target);
    booted = true;
    flush();
  }

  const api = {
    keys, now, blockOf,
    /** Call before using prices (and before a trade). Cheap once warm. Rejects only if the database cannot be read at all. */
    async ready() {
      if (!booted) { booting ??= boot().catch((e) => { booting = null; genesis = null; throw e; }); await booting; }
      const target = blockOf(now()); if (target > top) { advanceTo(target); flush(); }
      return api;
    },
    stateAt(block) { if (block > top) advanceTo(block); const s = ring.get(block); if (!s) throw new RangeError("that time is outside the market's memory"); return s; },
    /** Price in kobo per unit at time t (ms). Synchronous: await ready() first. */
    priceKoboAt(key, t = now()) {
      if (!booted) throw new Error("market not ready");
      const t0 = Math.max(t, genesis.start * BLOCK_MS), b = blockOf(t0), id = key + ":" + b;
      let path = paths.get(id);
      if (!path) { path = blockPath(model, W, genesis, api.stateAt(b), key); paths.set(id, path); if (paths.size > 6 * keys.length * 4) paths.delete(paths.keys().next().value); }
      return koboOf(path[Math.floor((t0 - b * BLOCK_MS) / TICK_MS)]);
    },
    /** `n` prices ending at `to`, `step` ms apart. Times before the market began are left out. Steps of a minute or more only touch block starts. */
    series(key, to = now(), n = 60, step = TICK_MS) {
      const last = Math.floor(to / step) * step, out = [], first = genesis.start * BLOCK_MS;
      let t0 = null;
      for (let i = n - 1; i >= 0; i--) {
        const t = last - i * step; if (t < first) continue;
        if (t0 === null) t0 = t;
        out.push(step >= BLOCK_MS && t % BLOCK_MS === 0 ? koboOf(api.stateAt(blockOf(t)).p[key].a + api.stateAt(blockOf(t)).p[key].d) : api.priceKoboAt(key, t));
      }
      return { t0, step, values: out };
    },
    mood(t = now()) { const s = api.stateAt(Math.max(genesis.start, blockOf(t))), m = s.m.l <= 0 ? stepMood(s.m, W.block("M", s.b)) : s.m; return { regime: MOODS[m.r].key, headline: MOODS[m.r].heads[m.h] ?? MOODS[m.r].heads[0] }; },
    /** What a screen needs in one go: every price, the change over 5 minutes / 1 hour / 24 hours, and the mood. */
    snapshot(t = now()) {
      const tick = Math.floor(t / TICK_MS) * TICK_MS, prices = {}, changes = {}, first = genesis.start * BLOCK_MS;
      for (const k of keys) {
        const p = api.priceKoboAt(k, tick); prices[k] = p;
        const chg = (ms) => { const q = api.priceKoboAt(k, Math.max(first, tick - ms)); return Math.round((p / q - 1) * 10000) / 100; };
        changes[k] = { m5: chg(300_000), h1: chg(3_600_000), d1: chg(86_400_000) };
      }
      return { t: tick, tickMs: TICK_MS, prices, changes, mood: api.mood(tick) };
    },
    /** The small message pushed every second. */
    tick(t = now()) { const tick = Math.floor(t / TICK_MS) * TICK_MS, p = {}; for (const k of keys) p[k] = api.priceKoboAt(k, tick); return { t: tick, p }; },
    genesis: () => genesis, top: () => top,
  };
  return api;
}
