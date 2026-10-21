// lib/investService.js
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { currentWeek } from "./clock.js";
import { PRODUCTS, EARLY_SALE_PENALTY_PCT, FEE_PCT, marketNews, price, priceKobo, history, unitsFor, valueOf, investCap } from "./market.js";
const N = (n) => BigInt(n) * 100n, s = (k) => k.toString();

export async function getInvestments(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true, level: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId), hs = await db.holding.findMany({ where: { characterId: base.id } });
  let invested = 0n;
  const holdings = hs.filter((h) => h.unitsMicro > 0n).map((h) => { const P = PRODUCTS[h.product], v = valueOf(h.unitsMicro, priceKobo(h.product, week)); invested += v;
    return { product: h.product, name: P.name, valueKobo: s(v), costKobo: s(h.costKobo), pnlKobo: s(v - h.costKobo), lockedWeeks: Math.max(0, h.lastBuyWeek + P.lock - week) }; });
  return { week, news: marketNews(week), capKobo: s(investCap(base.level)), investedKobo: s(invested), feePercent: Number(FEE_PCT), earlyPenaltyPercent: Number(EARLY_SALE_PENALTY_PCT),
    products: Object.entries(PRODUCTS).map(([key, P]) => ({ key, name: P.name, risk: P.risk, blurb: P.blurb, lock: P.lock, priceKobo: s(priceKobo(key, week)),
      changePct: Math.round((price(key, week) / price(key, Math.max(0, week - 1)) - 1) * 1000) / 10, history: history(key, week, 12).map((x) => Math.round(x * 100) / 100) })), holdings };
}

export async function invest(db, userId, { action, product, amountNaira, percent, requestId }) {
  needReq(requestId); const P = PRODUCTS[product]; if (!P) throw new GameError("Unknown product.");
  if (action !== "buy" && action !== "sell") throw new GameError("Unknown action.");
  await start(db, userId); const week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true }); // investing is a phone action: custody stops you leaving, not trading
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "invest:" + action, gameWeek: week } }); // P2002 on replay
      const pk = priceKobo(product, week), market = await tx.account.findUnique({ where: { systemName: "MARKET" } }), world = await tx.account.findUnique({ where: { systemName: "WORLD" } });
      const mine = await tx.holding.findFirst({ where: { characterId: c.id, product } });
      if (action === "buy") {
        const n = Number(amountNaira); if (!Number.isInteger(n) || n < 1_000 || n > 5_000_000) throw new GameError("Invest between ₦1,000 and ₦5,000,000 at a time.");
        const amount = N(n), fee = (amount * FEE_PCT) / 100n, all = await tx.holding.findMany({ where: { characterId: c.id } });
        const have = all.reduce((t, h) => t + valueOf(h.unitsMicro, priceKobo(h.product, week)), 0n), cap = investCap(c.level);
        if (have + amount > cap) throw new GameError(`Your limit at ${c.level}L is ${"₦" + (cap / 100n).toLocaleString("en-NG")} invested in total. You have room for ${"₦" + ((cap - have > 0n ? cap - have : 0n) / 100n).toLocaleString("en-NG")}.`, 409);
        await transferInTx(tx, { fromId: c.account.id, toId: market.id, amount, memo: `Bought ${P.name}`, key: `inv:${c.id}:${requestId}`, week });
        if (fee > 0n) await transferInTx(tx, { fromId: c.account.id, toId: world.id, amount: fee, memo: "Brokerage fee", key: `invfee:${c.id}:${requestId}`, week });
        const units = (mine?.unitsMicro ?? 0n) + unitsFor(amount, pk), data = { unitsMicro: units, costKobo: (mine?.costKobo ?? 0n) + amount, lastBuyWeek: week, valueKobo: valueOf(units, pk) };
        mine ? await tx.holding.update({ where: { id: mine.id }, data }) : await tx.holding.create({ data: { characterId: c.id, product, ...data } });
        return { ok: true, note: `Bought ${P.name}. Fee ₦${(fee / 100n).toLocaleString("en-NG")}.` };
      }
      const pc = Number(percent); if (!mine || mine.unitsMicro <= 0n) throw new GameError("You do not hold that.", 404);
      if (!Number.isInteger(pc) || pc < 1 || pc > 100) throw new GameError("Choose 1 to 100 percent.");
      const sold = pc === 100 ? mine.unitsMicro : (mine.unitsMicro * BigInt(pc)) / 100n; if (sold <= 0n) throw new GameError("That amount is too small to sell.");
      const value = valueOf(sold, pk), early = week < mine.lastBuyWeek + P.lock, penalty = early ? (value * EARLY_SALE_PENALTY_PCT) / 100n : 0n, fee = (value * FEE_PCT) / 100n, net = value - penalty - fee;
      if (net > 0n) await transferInTx(tx, { fromId: market.id, toId: c.account.id, amount: net, memo: `Sold ${P.name}`, key: `invout:${c.id}:${requestId}`, week });
      const left = mine.unitsMicro - sold, costOut = pc === 100 ? mine.costKobo : (mine.costKobo * sold) / mine.unitsMicro;
      await tx.holding.update({ where: { id: mine.id }, data: { unitsMicro: left, costKobo: mine.costKobo - costOut, valueKobo: valueOf(left, pk) } });
      return { ok: true, note: `Sold. You received ₦${(net / 100n).toLocaleString("en-NG")}${early ? ` after a ${EARLY_SALE_PENALTY_PCT}% early-sale penalty` : ""}.`, netKobo: s(net), profitKobo: s(net - costOut) };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that (the 1% fee is added on top).", 402);
    throw e;
  }
}
