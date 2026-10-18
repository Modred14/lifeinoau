// lib/bet/slipService.js  (SERVER ONLY)
// Sports slips: place one, and let it settle itself as the matches finish. Odds always come from the server's own table, never from the browser.
import { loadLocked, GameError, start, needReq } from "../gameService.js";
import { transferInTx, InsufficientFunds } from "../ledger.js";
import { currentWeek } from "../clock.js";
import { parseId, isOpen, roundOf, HORIZON, minuteAt } from "./fixtures.js";
import { oddsFor, pickWins, MIN_STAKE, MAX_STAKE, MAX_LEGS, payoutOf, totalOddsX } from "./markets.js";
import { resultOf, liveOf } from "./results.js";

const s = (k) => k.toString();
const naira = (k) => "₦" + (BigInt(k) / 100n).toLocaleString("en-NG");
/** The house account. Read first: the upsert only runs the very first time, so busy tables do not all race to create it. */
export const casinoAccount = async (tx) => (await tx.account.findUnique({ where: { systemName: "CASINO" } })) ?? tx.account.upsert({ where: { systemName: "CASINO" }, update: {}, create: { kind: "SYSTEM", systemName: "CASINO" } });

/** What one leg looks like right now: pending, live (with the score so far) or decided. */
export function legState(leg, now) {
  const lv = liveOf(leg.fx, now);
  if (!lv || lv.ph === "pre") return { ...leg, st: "pending" };
  if (lv.ph === "live") return { ...leg, st: "live", m: lv.m, h: lv.h, a: lv.a, winning: pickWins(leg.mk, leg.pk, lv.h, lv.a) };
  const r = resultOf(leg.fx);
  return { ...leg, st: pickWins(leg.mk, leg.pk, r.h, r.a) ? "won" : "lost", h: r.h, a: r.a };
}
/** OPEN / WON / LOST for a list of leg states. One lost leg loses the slip at once, like real accumulators. */
export const slipVerdict = (legs) => (legs.some((l) => l.st === "lost") ? "LOST" : legs.every((l) => l.st === "won") ? "WON" : "OPEN");

export function slipView(row, now) {
  const legs = row.legs.map((l) => legState(l, now)), verdict = row.status === "OPEN" ? slipVerdict(legs) : row.status;
  return { id: s(row.id), stakeKobo: s(row.stakeKobo), odds: row.oddsText, potentialKobo: s(row.potentialKobo), status: row.status, payoutKobo: s(row.payoutKobo), createdAt: row.createdAt.getTime(), settledAt: row.settledAt?.getTime() ?? null, verdict, legs };
}

/** Validate what the browser sent and rebuild every leg from the server's own fixtures and odds. */
export function buildLegs(raw, now) {
  if (!Array.isArray(raw) || raw.length < 1) throw new GameError("Pick at least one match.");
  if (raw.length > MAX_LEGS) throw new GameError(`A slip can hold up to ${MAX_LEGS} matches.`);
  const seen = new Set(), cur = roundOf(now);
  return raw.map((r) => {
    const fx = parseId(r?.fx);
    if (!fx) throw new GameError("One of those matches is no longer listed.", 409);
    if (seen.has(fx.id)) throw new GameError("You can only pick one outcome per match.");
    seen.add(fx.id);
    if (fx.round > cur + HORIZON || !isOpen(fx, now)) throw new GameError(`${fx.home} v ${fx.away} has kicked off. Remove it and try again.`, 409);
    const odds = oddsFor(fx, r.mk, r.pk);
    if (!odds) throw new GameError("That market does not exist.");
    return { fx: fx.id, mk: r.mk, pk: r.pk, odds, home: fx.home, away: fx.away, leagueName: fx.leagueName, ko: fx.ko };
  });
}

export async function placeSlip(db, userId, { legs: raw, stakeNaira, requestId }) {
  needReq(requestId); await start(db, userId); const week = await currentWeek(db), now = Date.now();
  const n = Number(stakeNaira);
  if (!Number.isInteger(n) || n < MIN_STAKE || n > MAX_STAKE) throw new GameError(`Stake between ₦${MIN_STAKE.toLocaleString("en-NG")} and ₦${MAX_STAKE.toLocaleString("en-NG")}.`);
  const legs = buildLegs(raw, now), stake = BigInt(n) * 100n, potential = payoutOf(stake, legs);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "bet:slip", gameWeek: week, createdAt: new Date(Date.now()) } }); // P2002 on replay
      if ((await tx.betSlip.count({ where: { characterId: c.id, status: "OPEN" } })) >= 30) throw new GameError("You have 30 open slips. Wait for some to finish.", 409);
      const house = await casinoAccount(tx);
      await transferInTx(tx, { fromId: c.account.id, toId: house.id, amount: stake, memo: "Bet slip stake", key: `bet:stake:${c.id}:${requestId}`, week });
      const row = await tx.betSlip.create({ data: { characterId: c.id, stakeKobo: stake, oddsText: totalOddsX(legs).toFixed(2), potentialKobo: potential, legs } });
      return { ok: true, slip: slipView(row, now) };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You do not have enough cash for that stake.", 402);
    throw e;
  }
}

/** Settle every slip of this player that is decided, pay the winners and leave a note. Returns what just settled. */
async function settleOpen(db, c, now, week) {
  const open = await db.betSlip.findMany({ where: { characterId: c.id, status: "OPEN" }, orderBy: { id: "asc" }, take: 60 }), done = [];
  for (const row of open) {
    const legs = row.legs.map((l) => legState(l, now)), v = slipVerdict(legs);
    if (v === "OPEN") continue;
    const won = v === "WON";
    const ok = await db.$transaction(async (tx) => {
      const claim = await tx.betSlip.updateMany({ where: { id: row.id, status: "OPEN" }, data: { status: v, payoutKobo: won ? row.potentialKobo : 0n, settledAt: new Date(Date.now()) } });
      if (claim.count !== 1) return false; // someone else settled it
      if (won) { const house = await casinoAccount(tx); await transferInTx(tx, { fromId: house.id, toId: c.account.id, amount: row.potentialKobo, memo: "Bet slip won", key: `bet:win:${row.id}`, week }); }
      // The note is the fallback announcement (if the answer to this request is lost). Its id travels with the answer so the screen
      // can announce the result ONCE: the same toast id from either source, and the answer's copy marks the note read.
      const note = await tx.notification.create({ data: { characterId: c.id, kind: won ? "bet:won" : "bet:lost", body: won ? `Your slip won ${naira(row.potentialKobo)}.` : `Your ${naira(row.stakeKobo)} slip lost.` } });
      return s(note.id);
    });
    if (ok) done.push({ id: s(row.id), status: v, payoutKobo: won ? s(row.potentialKobo) : "0", noteId: ok });
  }
  return done;
}

export async function getSlips(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true, account: { select: { id: true } } } });
  if (!c) throw new GameError("Create a character first.", 404);
  const now = Date.now(), week = await currentWeek(db), settled = await settleOpen(db, c, now, week);
  const rows = await db.betSlip.findMany({ where: { characterId: c.id }, orderBy: { id: "desc" }, take: 40 });
  return { now, slips: rows.map((r) => slipView(r, now)), settled };
}

/** Live scores and results for the matches that are on, or have just finished. */
export function getLive(now = Date.now()) {
  const cur = roundOf(now), out = [];
  for (const r of [cur - 1, cur]) for (let i = 0; i < 8; i++) { const lv = liveOf(`${r}-${i}`, now); if (lv && lv.ph !== "pre") out.push(lv); }
  return { now, live: out };
}
export { minuteAt };