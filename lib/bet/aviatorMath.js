// lib/bet/aviatorMath.js
// Aviator as the real thing works: the multiplier climbs from 1.00x along an exponential curve and the plane can fly away at ANY moment.
// P(plane is still up at x) = RTP / x, so half of all flights are gone before 2x, 1 in 10 before 1.1x, and about 3% leave instantly.
// PURE (browser + server share the curve).
export const RTP = 0.97;
export const K = 0.065; // growth per second: 2x at about 10.7s, 10x at about 35s
export const MAX_CRASH = 1000;
export const MIN_STAKE = 100, MAX_STAKE = 100_000, MAX_WIN_KOBO = 500_000_000n; // ₦5,000,000 a flight, like a real operator's cap

/** Multiplier (in hundredths: 250 = 2.50x) after `sec` seconds of flight. */
export const centiAt = (sec) => Math.max(100, Math.floor(100 * Math.exp(K * Math.max(0, sec)) + 1e-9));
/** Seconds of flight needed to reach a multiplier in hundredths. */
export const secAt = (centi) => Math.log(Math.max(100, centi) / 100) / K;
/** Turn one uniform draw u in [0,1) into the crash multiplier in hundredths (100 = instant crash). */
export function crashFromUniform(u) {
  const x = RTP / (1 - u); // inverse of P(crash >= x) = RTP / x
  return x < 1 ? 100 : Math.min(MAX_CRASH * 100, Math.floor(x * 100));
}
/** The highest multiplier a stake may reach before the win cap stops the flight (hundredths). */
export const capCenti = (stakeKobo) => { const c = (MAX_WIN_KOBO * 100n) / BigInt(stakeKobo); return Number(c > BigInt(MAX_CRASH * 100) ? BigInt(MAX_CRASH * 100) : c); };
export const payout = (stakeKobo, centi) => (BigInt(stakeKobo) * BigInt(centi)) / 100n;
export const fmtX = (centi) => (centi / 100).toFixed(2) + "x";
export const tier = (centi) => (centi < 200 ? "low" : centi < 1000 ? "mid" : "high");