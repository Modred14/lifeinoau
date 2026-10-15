// lib/bet/rouletteService.js  (SERVER ONLY)
// European roulette. One request = one spin: the server checks the bets, takes the stake, draws the number and pays back.
import { randomInt } from "node:crypto";
import { loadLocked, GameError, start, needReq } from "../gameService.js";
import { transferInTx, InsufficientFunds } from "../ledger.js";
import { currentWeek } from "../clock.js";
import { casinoAccount } from "./slipService.js";
import { coverage, settle, colorOf, MIN_CHIP, MAX_STAKE, MAX_BETS } from "./rouletteMath.js";

const s = (k) => k.toString();

export async function spin(db, userId, { bets: raw, requestId }) {
  needReq(requestId); await start(db, userId); const week = await currentWeek(db);
  if (!Array.isArray(raw) || !raw.length) throw new GameError("Place a chip on the table first.");
  if (raw.length > MAX_BETS) throw new GameError(`At most ${MAX_BETS} bets per spin.`);
  let total = 0;
  const bets = raw.map((b) => {
    const chip = Number(b?.chip);
    if (!coverage(b)) throw new GameError("One of those bets is not on the table.");
    if (!Number.isInteger(chip) || chip < MIN_CHIP) throw new GameError(`The smallest chip is ₦${MIN_CHIP}.`);
    total += chip; return { type: b.type, ref: String(b.ref), chip: BigInt(chip) * 100n };
  });
  if (total > MAX_STAKE) throw new GameError(`The table limit is ₦${MAX_STAKE.toLocaleString("en-NG")} a spin.`);
  const stake = BigInt(total) * 100n;
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "roulette:spin", gameWeek: week } }); // P2002 on replay
      const house = await casinoAccount(tx);
      await transferInTx(tx, { fromId: c.account.id, toId: house.id, amount: stake, memo: "Roulette stake", key: `rl:stake:${c.id}:${requestId}`, week });
      const number = randomInt(37), r = settle(bets, number);
      if (r.paid > 0n) await transferInTx(tx, { fromId: house.id, toId: c.account.id, amount: r.paid, memo: "Roulette win", key: `rl:win:${c.id}:${requestId}`, week });
      await tx.casinoRound.create({ data: { characterId: c.id, game: "ROULETTE", stakeKobo: stake, status: r.paid > stake ? "WON" : "LOST", payoutKobo: r.paid, data: { n: number }, settledAt: new Date() } });
      return { ok: true, number, color: colorOf(number), stakeKobo: s(stake), paidKobo: s(r.paid), wins: r.wins };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You do not have enough cash for that.", 402);
    throw e;
  }
}

export async function getRoulette(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  const rows = await db.casinoRound.findMany({ where: { characterId: c.id, game: "ROULETTE" }, orderBy: { id: "desc" }, take: 20, select: { data: true } });
  return { history: rows.map((r) => r.data?.n).filter((n) => Number.isInteger(n)) };
}