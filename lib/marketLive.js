// lib/marketLive.js
// The ONE live market of this server process: created on first use, shared by every request, and rebuilt from the database after a restart.
// Both the website (Vercel functions) and the realtime server (realtime/server.js) use this file, so they compute identical prices from
// the same secret key and the same stored genesis, and neither ever "owns" the market: any process can be killed at any moment.
import { createMarket, TICK_MS } from "./marketEngine.js";
import { marketStore } from "./marketStore.js";
import { PRODUCTS, priceKobo as legacyPriceKobo } from "./market.js";
import { currentWeek } from "./clock.js";

/** The secret key. MARKET_SEED is what the old market used; SESSION_SECRET is the fallback, because the website and the realtime server already share it. */
export function marketSecret() {
  const s = process.env.MARKET_SEED || process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("Set MARKET_SEED (or SESSION_SECRET): without a secret key the market's prices could be worked out in advance.");
  return "dev-seed";
}

const engines = new WeakMap(); // db -> market
let forced = null; // tests: use this market whatever the db is

/** The market for this database. Await `.ready()` on it (getMarket does) before reading a price. */
export function marketFor(db, opts = {}) {
  if (forced) return forced;
  let m = engines.get(db);
  if (!m) {
    m = createMarket({
      store: marketStore(db), secret: opts.secret ?? marketSecret(), now: opts.now,
      // the very first start only: the old weekly market's last prices are where the live one begins, so no holding changes value on the day this ships
      anchors: async () => { const w = await currentWeek(db); return Object.fromEntries(Object.keys(PRODUCTS).map((k) => [k, legacyPriceKobo(k, w)])); },
    });
    engines.set(db, m);
  }
  return m;
}
export async function getMarket(db) { return (await marketFor(db).ready()); }
export function useMarketForTests(m) { forced = m; }

// ---- one snapshot a second, however many players ask ----
let snapAt = -1, snapVal = null, snapOf = null;
export function snapshot(m) {
  const tick = Math.floor(m.now() / TICK_MS);
  if (snapOf !== m || tick !== snapAt) { snapVal = m.snapshot(tick * TICK_MS); snapAt = tick; snapOf = m; }
  return snapVal;
}

/** The charts a screen draws: 5 minutes (a point a second), 1 hour (a point a minute), 24 hours (a point every 10 minutes). */
export const RANGES = { "5m": { n: 300, step: TICK_MS }, "1h": { n: 61, step: 60_000 }, "24h": { n: 145, step: 600_000 } };
export function charts(m, range = "5m") {
  const r = RANGES[range] ?? RANGES["5m"], to = Math.floor(m.now() / TICK_MS) * TICK_MS, out = {};
  for (const k of m.keys) out[k] = m.series(k, to, r.n, r.step);
  return { range: RANGES[range] ? range : "5m", step: r.step, series: out };
}

// ---- mark-to-market of stored holdings (net worth and the Forbes list read Holding.valueKobo) ----
const lastRefresh = new WeakMap();
/**
 * Re-value every open holding at the current price in ONE statement (only the rows whose value changed are written).
 * Called from the realtime server every few minutes and, throttled, when a leaderboard is built.
 */
export async function refreshHoldingValues(db, { minGapMs = 120_000, market = null } = {}) {
  const now = Date.now();
  if (now - (lastRefresh.get(db) ?? 0) < minGapMs) return 0;
  lastRefresh.set(db, now);
  const m = market ? await market.ready() : await getMarket(db), p = m.snapshot().prices;
  const cases = Object.keys(PRODUCTS).map((k) => `WHEN '${k}' THEN ${Math.max(1, Math.trunc(Number(p[k])))}`).join(" ");
  // NUMERIC arithmetic, clamped to what a bigint holds: units x price can pass 9.2e18 for someone who bought at a tiny price that later soared,
  // and one overflowing row must never make the statement fail for everybody else.
  const expr = `LEAST(FLOOR("unitsMicro"::numeric * (CASE "product" ${cases} ELSE 0 END) / 1000000), 9000000000000000000)::bigint`;
  return db.$executeRawUnsafe(`UPDATE "Holding" SET "valueKobo" = ${expr} WHERE "unitsMicro" > 0 AND "valueKobo" IS DISTINCT FROM ${expr}`);
}
