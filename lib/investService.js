// lib/investService.js
// Buying and selling in the LIVE market (lib/marketEngine.js). The rules that keep it honest:
//  * The price of an order is the SERVER's price at the instant the order runs, read while this player's row is locked. The browser never
//    sends a price that is used; at most it sends the price the player SAW (`seenKobo`), and if the real price has moved more than
//    MAX_SLIP_PCT away from that, the order is refused (so nobody is filled at a price they did not agree to, and a stale screen cannot trade).
//  * One order at a time per player (the Character row lock in loadLocked), and one order per requestId (ActionLog's unique key),
//    so double taps, retries and parallel requests can neither double-spend nor trade on a balance somebody else just used.
//  * Money moves only through the ledger (transferInTx), inside the same database transaction as the holding and the trade record:
//    either all of it happens or none of it does.
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { currentWeek } from "./clock.js";
import { PRODUCTS, EARLY_SALE_PENALTY_PCT, FEE_PCT, unitsFor, valueOf, investCap } from "./market.js";
import { getMarket, snapshot } from "./marketLive.js";
const N = (n) => BigInt(n) * 100n, s = (k) => k.toString();
export const MAX_SLIP_PCT = 5; // an order is refused if the price moved this much (percent) from the price the player saw
const BIGINT_MAX = 9_000_000_000_000_000_000n, fit = (v) => (v > BIGINT_MAX ? BIGINT_MAX : v); // a stored value can never overflow the database column, whatever a price does
const naira = (kobo) => "₦" + (BigInt(kobo) / 100n).toLocaleString("en-NG");

/** What the player holds, valued at one instant. Every number a screen needs for the portfolio, as kobo strings. */
export function portfolioOf(rows, price) {
  let value = 0n, cost = 0n, realised = 0n, fees = 0n;
  const holdings = [];
  for (const h of rows) {
    realised += BigInt(h.realisedKobo ?? 0n); fees += BigInt(h.feesKobo ?? 0n);
    if (BigInt(h.unitsMicro) <= 0n) continue;
    const P = PRODUCTS[h.product]; if (!P) continue;
    const v = valueOf(h.unitsMicro, price(h.product));
    value += v; cost += BigInt(h.costKobo);
    holdings.push({ product: h.product, name: P.name, unitsMicro: s(h.unitsMicro), valueKobo: s(v), costKobo: s(h.costKobo), pnlKobo: s(v - h.costKobo),
      realisedKobo: s(h.realisedKobo ?? 0n), feesKobo: s(h.feesKobo ?? 0n), lastBuyWeek: h.lastBuyWeek });
  }
  const unrealised = value - cost;
  return { holdings, totals: { valueKobo: s(value), costKobo: s(cost), unrealisedKobo: s(unrealised), realisedKobo: s(realised), feesKobo: s(fees), totalPnlKobo: s(unrealised + realised - fees) } };
}

const lockedWeeks = (h, week) => Math.max(0, h.lastBuyWeek + PRODUCTS[h.product].lock - week);

export async function getInvestments(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true, level: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const [market, week] = [await getMarket(db), await currentWeek(db)], snap = snapshot(market);
  const rows = await db.holding.findMany({ where: { characterId: base.id } }), pf = portfolioOf(rows, (k) => snap.prices[k]);
  for (const h of rows) { // keep the stored valuation (net worth, Forbes) close to the live one; at most one write per holding, and only when this screen opens
    const v = BigInt(h.unitsMicro) > 0n && PRODUCTS[h.product] ? valueOf(h.unitsMicro, snap.prices[h.product]) : null;
    if (v !== null && v !== BigInt(h.valueKobo ?? 0n)) await db.holding.update({ where: { id: h.id }, data: { valueKobo: fit(v) } }).catch(() => {});
  }
  const holdings = pf.holdings.map((h) => ({ ...h, lockedWeeks: lockedWeeks(h, week) }));
  return {
    serverNow: Date.now(), tickMs: snap.tickMs, t: snap.t, week, news: snap.mood, capKobo: s(investCap(base.level)), investedKobo: pf.totals.valueKobo,
    feePercent: Number(FEE_PCT), earlyPenaltyPercent: Number(EARLY_SALE_PENALTY_PCT), maxSlipPercent: MAX_SLIP_PCT,
    products: Object.entries(PRODUCTS).map(([key, P]) => ({ key, name: P.name, risk: P.risk, blurb: P.blurb, lock: P.lock, priceKobo: s(snap.prices[key]), changes: snap.changes[key], changePct: snap.changes[key].h1 })),
    holdings, totals: pf.totals,
  };
}

export async function invest(db, userId, { action, product, amountNaira, percent, requestId, seenKobo }) {
  needReq(requestId); const P = PRODUCTS[product]; if (!P) throw new GameError("Unknown product.");
  if (action !== "buy" && action !== "sell") throw new GameError("Unknown action.");
  // everything the browser sent is checked before any lock is taken
  let n = 0, pc = 0;
  if (action === "buy") { n = Number(amountNaira); if (!Number.isInteger(n) || n < 1_000 || n > 5_000_000) throw new GameError("Invest between ₦1,000 and ₦5,000,000 at a time."); }
  else { pc = Number(percent); if (!Number.isInteger(pc) || pc < 1 || pc > 100) throw new GameError("Choose 1 to 100 percent."); }
  const seen = seenKobo == null ? null : Number(seenKobo);
  if (seen !== null && (!Number.isSafeInteger(seen) || seen < 1)) throw new GameError("That price is not valid.");
  const market = await getMarket(db); await start(db, userId); const week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true }); // investing is a phone action: custody stops you leaving, not trading
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "invest:" + action, gameWeek: week } }); // P2002 on replay
      // The price is read NOW, with the player locked: this is the price the order is filled at. One instant for every product, so the limit check below is consistent.
      const t = market.now(), px = (k) => BigInt(market.priceKoboAt(k, t)), pk = px(product);
      if (seen !== null && Math.abs(Number(pk) - seen) * 100 > seen * MAX_SLIP_PCT)
        throw Object.assign(new GameError(`The price of ${P.name} moved from ${naira(seen)} to ${naira(pk)}. Check it and try again.`, 409), { priceKobo: s(pk) });
      const mkt = await tx.account.findUnique({ where: { systemName: "MARKET" } }), world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      const mine = await tx.holding.findFirst({ where: { characterId: c.id, product } });
      if (action === "buy") {
        const amount = N(n), fee = (amount * FEE_PCT) / 100n, all = await tx.holding.findMany({ where: { characterId: c.id } });
        const have = all.reduce((tot, h) => tot + (PRODUCTS[h.product] ? valueOf(h.unitsMicro, px(h.product)) : 0n), 0n), cap = investCap(c.level);
        if (have + amount > cap) throw new GameError(`Your limit at ${c.level}L is ${"₦" + (cap / 100n).toLocaleString("en-NG")} invested in total. You have room for ${"₦" + ((cap - have > 0n ? cap - have : 0n) / 100n).toLocaleString("en-NG")}.`, 409);
        const bought = unitsFor(amount, pk); if (bought <= 0n) throw new GameError("That amount is too small at this price.");
        await transferInTx(tx, { fromId: c.account.id, toId: mkt.id, amount, memo: `Bought ${P.name}`, key: `inv:${c.id}:${requestId}`, week });
        if (fee > 0n) await transferInTx(tx, { fromId: c.account.id, toId: world.id, amount: fee, memo: "Brokerage fee", key: `invfee:${c.id}:${requestId}`, week });
        const units = (mine?.unitsMicro ?? 0n) + bought;
        const data = { unitsMicro: units, costKobo: (mine?.costKobo ?? 0n) + amount, lastBuyWeek: week, valueKobo: fit(valueOf(units, pk)), feesKobo: (mine?.feesKobo ?? 0n) + fee };
        if (mine) await tx.holding.update({ where: { id: mine.id }, data }); else await tx.holding.create({ data: { characterId: c.id, product, realisedKobo: 0n, ...data } });
        await tx.marketTrade.create({ data: { characterId: c.id, product, side: "BUY", unitsMicro: bought, priceKobo: pk, grossKobo: amount, feeKobo: fee, requestId } });
        const rows = await tx.holding.findMany({ where: { characterId: c.id } });
        return { ok: true, note: `Bought ${P.name} at ${naira(pk)}. Fee ₦${(fee / 100n).toLocaleString("en-NG")}.`, priceKobo: s(pk), unitsMicro: s(bought), spentKobo: s(amount + fee), portfolio: portfolioOf(rows, px) };
      }
      if (!mine || mine.unitsMicro <= 0n) throw new GameError("You do not hold that.", 404);
      const sold = pc === 100 ? mine.unitsMicro : (mine.unitsMicro * BigInt(pc)) / 100n; if (sold <= 0n) throw new GameError("That amount is too small to sell.");
      const value = valueOf(sold, pk), early = week < mine.lastBuyWeek + P.lock, penalty = early ? (value * EARLY_SALE_PENALTY_PCT) / 100n : 0n, fee = (value * FEE_PCT) / 100n, net = value - penalty - fee;
      if (net > 0n) await transferInTx(tx, { fromId: mkt.id, toId: c.account.id, amount: net, memo: `Sold ${P.name}`, key: `invout:${c.id}:${requestId}`, week });
      const left = mine.unitsMicro - sold, costOut = pc === 100 ? mine.costKobo : (mine.costKobo * sold) / mine.unitsMicro, realised = value - costOut;
      await tx.holding.update({ where: { id: mine.id }, data: { unitsMicro: left, costKobo: mine.costKobo - costOut, valueKobo: fit(valueOf(left, pk)), realisedKobo: (mine.realisedKobo ?? 0n) + realised, feesKobo: (mine.feesKobo ?? 0n) + fee + penalty } });
      await tx.marketTrade.create({ data: { characterId: c.id, product, side: "SELL", unitsMicro: sold, priceKobo: pk, grossKobo: value, feeKobo: fee, penaltyKobo: penalty, realisedKobo: realised, requestId } });
      const rows = await tx.holding.findMany({ where: { characterId: c.id } });
      return { ok: true, note: `Sold at ${naira(pk)}. You received ₦${(net / 100n).toLocaleString("en-NG")}${early ? ` after a ${EARLY_SALE_PENALTY_PCT}% early-sale penalty` : ""}.`,
        priceKobo: s(pk), netKobo: s(net), profitKobo: s(net - costOut), realisedKobo: s(realised), portfolio: portfolioOf(rows, px) };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that (the 1% fee is added on top).", 402);
    throw e;
  }
}
