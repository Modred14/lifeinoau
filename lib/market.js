// lib/market.js
// A shared, fictional market. Prices are a deterministic function of (secret seed, product, week):
// every player sees the same prices, nobody can influence them, and no cron job or price table is needed.
// Set MARKET_SEED to a long random string in production so the series cannot be precomputed from this file.
const salt = () => process.env.MARKET_SEED ?? "dev-seed";
const seed = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const prng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const normal = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); // Box-Muller

// drift/sd/beta are percent per week. beta = how strongly the asset follows the whole market.
export const PRODUCTS = {
  COOP:  { name: "OAU Cooperative Savings", risk: "LOW",    drift: 0.4, sd: 0.15, beta: 0.05, lock: 3, blurb: "Slow and steady. Locked for 3 weeks after each purchase." },
  BILLS: { name: "Treasury Bills",          risk: "LOW",    drift: 0.5, sd: 0.20, beta: 0.05, lock: 2, blurb: "Government paper. Small, dependable gains." },
  INDEX: { name: "Campus Index Fund",       risk: "MEDIUM", drift: 0.8, sd: 3.0,  beta: 0.8,  lock: 0, blurb: "A basket of campus businesses. Follows the market." },
  PLOTS: { name: "Ife Land Plots",          risk: "MEDIUM", drift: 0.8, sd: 2.5,  beta: 0.5,  lock: 4, blurb: "Land rarely disappears. Locked for 4 weeks." },
  TECH:  { name: "Startup Equity",          risk: "HIGH",   drift: 2.0, sd: 10,   beta: 1.2,  lock: 0, jumpP: 0.025, jump: -45, blurb: "Big wins, and some startups simply fail." },
  MEME:  { name: "MemeCoin",                risk: "HIGH",   drift: 3.8, sd: 16,   beta: 1.5,  lock: 0, jumpP: 0.04,  jump: -70, blurb: "Pure speculation. Rug pulls happen." },
};
export const EARLY_SALE_PENALTY_PCT = 5n, FEE_PCT = 1n;

const REGIMES = [
  { key: "BOOM", p: 0.15, m: 4, heads: ["Oil prices climb and investors cheer", "A tech funding boom lifts the market", "Remittances surge and spending rises"] },
  { key: "STEADY", p: 0.55, m: 1, heads: ["Markets stay quiet as traders wait for news", "A calm week on the exchange", "Investors hold steady"] },
  { key: "SLUMP", p: 0.22, m: -3, heads: ["The naira weakens and investors get nervous", "A fuel price hike spooks the market", "Weak earnings drag shares down"] },
  { key: "CRASH", p: 0.08, m: -7, heads: ["Panic selling shakes the market", "A banking scare triggers a sell-off"] },
];
export function marketNews(week) {
  const r = prng(seed(`${salt()}:regime:${week}`)); let u = r(), reg = REGIMES[REGIMES.length - 1];
  for (const x of REGIMES) { if (u < x.p) { reg = x; break; } u -= x.p; }
  return { regime: reg.key, factor: reg.m, headline: reg.heads[Math.floor(r() * reg.heads.length)] };
}
export function weeklyReturnPct(key, week) {
  const P = PRODUCTS[key], r = prng(seed(`${salt()}:${key}:${week}`)); let ret = P.drift + P.beta * marketNews(week).factor + P.sd * normal(r);
  if (P.jumpP && r() < P.jumpP) ret = P.jump;
  return Math.max(-95, ret);
}
const memo = new Map();
export function price(key, week) { // naira per unit, starting at 100 in week 0
  const w = Math.max(0, Math.floor(week)), id = `${salt()}|${key}`; let s = memo.get(id);
  if (!s) memo.set(id, (s = [100]));
  while (s.length <= w) s.push(Math.max(0.01, s[s.length - 1] * (1 + weeklyReturnPct(key, s.length) / 100)));
  return s[w];
}
export const priceKobo = (key, week) => BigInt(Math.max(1, Math.round(price(key, week) * 100)));
export const history = (key, week, n = 12) => Array.from({ length: Math.min(n, week + 1) }, (_, i) => price(key, week - (Math.min(n, week + 1) - 1) + i));
export const clearMarketCache = () => memo.clear();

// Units are stored as integer micro-units so no float ever touches the ledger.
const MICRO = 1_000_000n;
export const unitsFor = (amountKobo, pKobo) => (BigInt(amountKobo) * MICRO) / BigInt(pKobo);
export const valueOf = (unitsMicro, pKobo) => (BigInt(unitsMicro) * BigInt(pKobo)) / MICRO;
/** Cap on total money invested: grows with level, so early players cannot farm the market's positive drift. */
export const investCap = (level) => BigInt(5_000_000) * 100n * BigInt(Math.max(1, Math.floor(level / 100)));