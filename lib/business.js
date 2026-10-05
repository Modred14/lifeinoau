// lib/business.js
// Businesses. Capital sits in the BUSINESS system account, so the ledger always shows how much money is locked inside businesses.
const N = (n) => BigInt(n) * 100n;
export const TYPES = {
  POS:      { label: "POS business",      cost: 200_000,   vol: 0.15 }, BARBER:  { label: "Barber shop",       cost: 250_000,   vol: 0.20 },
  FOOD:     { label: "Food business",     cost: 300_000,   vol: 0.25 }, DELIVERY:{ label: "Delivery business", cost: 350_000,   vol: 0.30 },
  SALON:    { label: "Salon",             cost: 400_000,   vol: 0.25 }, FASHION: { label: "Fashion brand",     cost: 500_000,   vol: 0.35 },
  CLOTHING: { label: "Clothing business", cost: 450_000,   vol: 0.30 }, EVENTS:  { label: "Event company",     cost: 600_000,   vol: 0.60 },
  AGENCY:   { label: "Digital agency",    cost: 700_000,   vol: 0.40 }, TECH:    { label: "Tech company",      cost: 1_000_000, vol: 0.55 },
};
export const MAX_LEVEL = 5, MAX_EMPLOYEES = 8;
export const maxBusinesses = (playerLevel) => Math.max(1, Math.floor(playerLevel / 100));
export const reserveFor = (type) => N(Math.round(TYPES[type].cost * 0.2)); // can't withdraw below this
export const upgradeCost = (type, level) => N(Math.round(TYPES[type].cost * 1.6 ** level)); // level -> level+1, paid from the business's own capital

/** One game week of trading. Pure: randomness injected. Returns revenue, expenses, net (kobo, can be negative) and an optional event. */
export function weekly(b, roll) {
  const T = TYPES[b.type], cost = T.cost, revMul = 1 + 0.6 * (b.level - 1), fixMul = 1.3 ** (b.level - 1); // revenue grows slowly; costs AND wages grow faster, so upgrades are a real choice
  const rep = 1 + (b.reputation - 50) / 250, noise = 1 + (roll(-100, 100) / 100) * T.vol, r = roll(1, 100);
  let ev = 1, hike = 1, event = null;
  if (r <= 8) { ev = 1.4; event = "went viral and sales jumped"; } else if (r <= 16) { ev = 0.7; event = "lost sales to a power outage"; } else if (r <= 22) { hike = 1.15; event = "paid more after supplier prices rose"; }
  const revenue = N(Math.round((cost * 0.13 + b.employees * cost * 0.085) * revMul * rep * noise * ev));
  const expenses = N(Math.round((cost * 0.083 * fixMul + b.employees * cost * 0.067 * fixMul) * hike)); // wages scale with level too
  return { revenue, expenses, net: revenue - expenses, event };
}
export const nextReputation = (rep, net) => Math.max(10, Math.min(100, rep + (net > 0n ? 1 : -2)));
/** Apply a week's result to a business: profit is created, losses eat capital, and at zero capital it goes bankrupt. */
export function settle(b, res) {
  if (res.net >= 0n) return { capital: b.capital + res.net, ledger: { dir: "profit", amount: res.net }, bankrupt: false, reputation: nextReputation(b.reputation, res.net) };
  const loss = -res.net, paid = loss > b.capital ? b.capital : loss, capital = b.capital - paid;
  return { capital, ledger: { dir: "loss", amount: paid }, bankrupt: capital === 0n, reputation: nextReputation(b.reputation, res.net) };
}
