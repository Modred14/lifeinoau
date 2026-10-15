// lib/bet/aviatorService.js  (SERVER ONLY)
// Aviator. The crash point is drawn with the OS random generator the moment the bet is placed and stays on the server until the
// flight is over. The server is the only clock: a cash-out pays the multiplier at the moment it ARRIVES, and a plane that has already
// flown away pays nothing, exactly like the real game.
import { randomInt } from "node:crypto";
import { loadLocked, GameError, start, needReq } from "../gameService.js";
import { transferInTx, InsufficientFunds } from "../ledger.js";
import { currentWeek } from "../clock.js";
import { casinoAccount } from "./slipService.js";
import { centiAt, secAt, crashFromUniform, capCenti, payout, MIN_STAKE, MAX_STAKE } from "./aviatorMath.js";

const s = (k) => k.toString();
const uniform = () => (randomInt(2 ** 31) * 2 ** 21 + randomInt(2 ** 21)) / 2 ** 52;

export function roundView(r) {
  const base = { id: s(r.id), stakeKobo: s(r.stakeKobo), startedAt: r.startedAt.getTime(), autoCenti: r.autoCenti, status: r.status };
  return r.status === "FLYING" ? base : { ...base, crashCenti: r.crashCenti, cashCenti: r.cashCenti, payoutKobo: s(r.payoutKobo) };
}

/** What the flight has become by `now`: nothing yet, an automatic cash-out, or a flight that flew away. Pure. */
export function outcomeAt(r, now) {
  const t0 = r.startedAt.getTime(), cap = capCenti(r.stakeKobo), auto = Math.min(r.autoCenti ?? Infinity, cap);
  if (auto < r.crashCenti) return now >= t0 + secAt(auto) * 1000 ? { status: "WON", cash: auto } : null; // reaches the auto cash-out before it can crash
  return now >= t0 + secAt(r.crashCenti) * 1000 ? { status: "LOST" } : null;
}

async function close(tx, c, r, out, week) {
  const win = out.status === "WON", pay = win ? payout(r.stakeKobo, out.cash) : 0n;
  const claim = await tx.casinoRound.updateMany({ where: { id: r.id, status: "FLYING" }, data: { status: out.status, cashCenti: win ? out.cash : null, payoutKobo: pay, settledAt: new Date() } });
  if (claim.count !== 1) return null;
  if (win) { const house = await casinoAccount(tx); await transferInTx(tx, { fromId: house.id, toId: c.account.id, amount: pay, memo: "Aviator win", key: `av:win:${r.id}`, week }); }
  return await tx.casinoRound.findUnique({ where: { id: r.id } });
}

export async function getAviator(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  const where = { characterId: c.id, game: "AVIATOR" };
  let fly = await db.casinoRound.findFirst({ where: { ...where, status: "FLYING" } });
  // the poll runs about twice a second, so the row lock is only taken when the flight is actually decided
  if (fly && outcomeAt(fly, Date.now())) { await resolveFlying(db, userId).catch(() => null); fly = await db.casinoRound.findFirst({ where: { ...where, status: "FLYING" } }); }
  const hist = await db.casinoRound.findMany({ where: { ...where, status: { not: "FLYING" } }, orderBy: { id: "desc" }, take: 24, select: { id: true, crashCenti: true, status: true, cashCenti: true } });
  const last = fly ? null : await db.casinoRound.findFirst({ where: { ...where, status: { not: "FLYING" } }, orderBy: { id: "desc" } });
  return { now: Date.now(), round: fly ? roundView(fly) : null, last: last ? roundView(last) : null, history: hist.map((h) => ({ id: s(h.id), crashCenti: h.crashCenti, won: h.status === "WON", cashCenti: h.cashCenti })) };
}

/** Settle the player's flight if it is already decided (auto cash-out reached, or the plane flew away). */
async function resolveFlying(db, userId) {
  const week = await currentWeek(db);
  return db.$transaction(async (tx) => {
    const c = await loadLocked(tx, userId, { allowJailed: true });
    const r = await tx.casinoRound.findFirst({ where: { characterId: c.id, game: "AVIATOR", status: "FLYING" } });
    if (!r) return null;
    const out = outcomeAt(r, Date.now());
    return out ? await close(tx, c, r, out, week) : null;
  });
}

export async function aviatorBet(db, userId, { stakeNaira, autoCashout, requestId }) {
  needReq(requestId); await start(db, userId); const week = await currentWeek(db);
  const n = Number(stakeNaira);
  if (!Number.isInteger(n) || n < MIN_STAKE || n > MAX_STAKE) throw new GameError(`Stake between ₦${MIN_STAKE.toLocaleString("en-NG")} and ₦${MAX_STAKE.toLocaleString("en-NG")}.`);
  let auto = null;
  if (autoCashout != null && autoCashout !== "") { const a = Math.round(Number(autoCashout) * 100); if (!Number.isFinite(a) || a < 101 || a > 100000) throw new GameError("Auto cash-out must be between 1.01x and 1000x."); auto = a; }
  const stake = BigInt(n) * 100n;
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "aviator:bet", gameWeek: week } }); // P2002 on replay
      const old = await tx.casinoRound.findFirst({ where: { characterId: c.id, game: "AVIATOR", status: "FLYING" } });
      if (old) { const out = outcomeAt(old, Date.now()); if (!out) throw new GameError("Your plane is still in the air.", 409); await close(tx, c, old, out, week); }
      const house = await casinoAccount(tx);
      await transferInTx(tx, { fromId: c.account.id, toId: house.id, amount: stake, memo: "Aviator stake", key: `av:stake:${c.id}:${requestId}`, week });
      const row = await tx.casinoRound.create({ data: { characterId: c.id, game: "AVIATOR", stakeKobo: stake, crashCenti: crashFromUniform(uniform()), autoCenti: auto } });
      return { ok: true, round: roundView(row), now: row.startedAt.getTime() };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You do not have enough cash for that stake.", 402);
    throw e;
  }
}

export async function aviatorCash(db, userId, { roundId }) {
  const week = await currentWeek(db);
  return db.$transaction(async (tx) => {
    const c = await loadLocked(tx, userId, { allowJailed: true });
    let id; try { id = BigInt(roundId); } catch { throw new GameError("Unknown flight.", 404); }
    const r = await tx.casinoRound.findFirst({ where: { id, characterId: c.id, game: "AVIATOR" } });
    if (!r) throw new GameError("Unknown flight.", 404);
    if (r.status !== "FLYING") return { ok: true, round: roundView(r), already: true };
    const now = Date.now(), out = outcomeAt(r, now) ?? { status: "WON", cash: centiAt((now - r.startedAt.getTime()) / 1000) };
    const done = await close(tx, c, r, out, week), view = roundView(done ?? r);
    // the plane had already flown away when the request arrived: nothing is paid, and the answer says so (the screen puts the cash back)
    if (out.status === "LOST") return { ok: false, late: true, error: `Too late. The plane flew away at ${(r.crashCenti / 100).toFixed(2)}x.`, round: view, now };
    return { ok: true, round: view, now };
  });
}