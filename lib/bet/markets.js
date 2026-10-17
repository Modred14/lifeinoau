// lib/bet/markets.js
// Markets, fair probabilities (a Poisson goals model) and the odds a player is shown. PURE: used by the browser and the server.
// The house keeps a margin like a real bookmaker, and results are drawn from the SAME model (see results.js), so the edge is real.
// Odds are kept as whole hundredths (185 = 1.85) so money maths never touches floating point.
export const MARGIN = 0.075;
const MAXG = 9;

const fact = [1]; for (let i = 1; i <= MAXG; i++) fact[i] = fact[i - 1] * i;
const pois = (l, k) => (Math.exp(-l) * l ** k) / fact[k];
const gridCache = new WeakMap();
/** P(home k, away j) for every scoreline up to MAXG. */
function grid(fx) {
  let g = gridCache.get(fx);
  if (g) return g;
  g = []; let sum = 0;
  for (let h = 0; h <= MAXG; h++) { g[h] = []; for (let a = 0; a <= MAXG; a++) { g[h][a] = pois(fx.lh, h) * pois(fx.la, a); sum += g[h][a]; } }
  for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) g[h][a] /= sum;
  gridCache.set(fx, g);
  return g;
}
const prob = (fx, pred) => { const g = grid(fx); let p = 0; for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) if (pred(h, a)) p += g[h][a]; return p; };

/** Every market: how its picks are named and how a final score decides each one. */
export const MARKETS = {
  "1x2": { name: "Match result", picks: { h: ["1", (h, a) => h > a], d: ["X", (h, a) => h === a], a: ["2", (h, a) => h < a] }, margin: MARGIN },
  dc: { name: "Double chance", picks: { hd: ["1X", (h, a) => h >= a], ha: ["12", (h, a) => h !== a], da: ["X2", (h, a) => h <= a] }, margin: MARGIN - 0.02 },
  ou15: { name: "Over / Under 1.5", picks: { o: ["Over 1.5", (h, a) => h + a >= 2], u: ["Under 1.5", (h, a) => h + a <= 1] }, margin: 0.06 },
  ou25: { name: "Over / Under 2.5", picks: { o: ["Over 2.5", (h, a) => h + a >= 3], u: ["Under 2.5", (h, a) => h + a <= 2] }, margin: 0.06 },
  ou35: { name: "Over / Under 3.5", picks: { o: ["Over 3.5", (h, a) => h + a >= 4], u: ["Under 3.5", (h, a) => h + a <= 3] }, margin: 0.06 },
  gg: { name: "Both teams to score", picks: { y: ["GG", (h, a) => h > 0 && a > 0], n: ["NG", (h, a) => h === 0 || a === 0] }, margin: 0.06 },
};
export const MARKET_ORDER = ["1x2", "dc", "ou25", "gg", "ou15", "ou35"];

/** Odds in hundredths for one pick (null if the market or pick does not exist). */
export function oddsFor(fx, mk, pk) {
  const M = Object.hasOwn(MARKETS, mk) ? MARKETS[mk] : null; if (!M || !Object.hasOwn(M.picks, pk)) return null; // own names only ("constructor" is not a market)
  const p = prob(fx, M.picks[pk][1]);
  return Math.max(105, Math.min(5000, Math.round(100 / (p * (1 + M.margin)))));
}
export const allOdds = (fx) => Object.fromEntries(Object.keys(MARKETS).map((mk) => [mk, Object.fromEntries(Object.keys(MARKETS[mk].picks).map((pk) => [pk, oddsFor(fx, mk, pk)]))]));
const pickOf = (mk, pk) => (Object.hasOwn(MARKETS, mk) && Object.hasOwn(MARKETS[mk].picks, pk) ? MARKETS[mk].picks[pk] : null);
export const pickWins = (mk, pk, h, a) => !!pickOf(mk, pk)?.[1](h, a);
export const pickName = (mk, pk) => pickOf(mk, pk)?.[0] ?? "?";
export const marketName = (mk) => (Object.hasOwn(MARKETS, mk) ? MARKETS[mk].name : "");

/** Probability helper for the results simulation. */
export const scoreProbs = (fx) => grid(fx);

// ---- slip maths (all in kobo and hundredths, BigInt) ----
export const MIN_STAKE = 100, MAX_STAKE = 500_000, MAX_LEGS = 12, MAX_WIN_KOBO = 5_000_000_00n * 4n; // ₦20,000,000 per slip, like a real book's cap
/** Total odds in hundredths of a slip: the product of every leg, kept exact. */
export function totalOdds(legs) { let n = 1n, d = 1n; for (const l of legs) { n *= BigInt(l.odds); d *= 100n; } return { n, d }; }
export const totalOddsX = (legs) => { const { n, d } = totalOdds(legs); return Number((n * 100n) / d) / 100; };
/** Paid on the total odds as shown (rounded down to two places), so the number on the slip is exactly what you win. */
export function payoutOf(stakeKobo, legs) { const { n, d } = totalOdds(legs); const w = (BigInt(stakeKobo) * ((n * 100n) / d)) / 100n; return w > MAX_WIN_KOBO ? MAX_WIN_KOBO : w; }