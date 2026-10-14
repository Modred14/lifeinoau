// lib/housingService.js
// The Housing app on the phone: which homes a player can rent, what moving into each costs today, and the move itself.
// Moving takes effect at once: the rent for the rest of the session is paid up front (any rent already paid up front for the old home is
// given back), the character's home changes, and the room is rebuilt for the new home in the same transaction. Money only moves through the ledger.
import { currentWeek } from "./clock.js";
import { catchUp } from "./tick.js";
import { GameError, loadLocked } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { roomAfterMove } from "./roomService.js";
import { roomFor } from "./room.js";
import { SESSION_WEEKS, schoolHalls, PRIVATE_HOMES, FLATS, canLiveIn, sessionRentOf, rentOf, occupancyText, aboutHome, isSchoolHostel, movePricing } from "./rules.js";

const needReq = (id) => { if (!/^[\w-]{8,64}$/.test(id ?? "")) throw new GameError("Missing requestId."); };
const BEDROOMS = { "1-Bedroom Flat": 1, "2-Bedroom Flat": 2, Ojaja: 1, "Off-campus": 1 };
const KIND = (h) => (FLATS.includes(h) ? "flat" : isSchoolHostel(h) ? "school" : "private");

/** Every home this player may live in, priciest first among the private ones, school halls last. */
export function homesFor(c, week) {
  const list = [...PRIVATE_HOMES, ...schoolHalls(c.gender)];
  return list.map((hostel) => {
    const p = movePricing({ from: c.hostel, to: hostel, week, sessionStart: c.sessionStartWeek, paidUntil: c.rentPaidUntilWeek });
    const room = roomFor(hostel, c.id);
    return {
      hostel, kind: KIND(hostel), bedrooms: BEDROOMS[hostel] ?? 0, layout: room.layout ?? null, w: room.w, d: room.d,
      sessionRent: sessionRentOf(hostel), weeklyRent: rentOf(hostel), occupancy: occupancyText(hostel), about: aboutHome(hostel),
      current: hostel === c.hostel, weeksLeft: p.weeks, chargeKobo: p.chargeKobo.toString(), refundKobo: p.refundKobo.toString(), netKobo: p.netKobo.toString(),
    };
  }).sort((a, b) => (a.kind === "school") - (b.kind === "school") || b.sessionRent - a.sessionRent);
}

const blocker = (c) => (c.graduated ? "You have graduated, so you no longer pay student rent and cannot rent a new home." : null);

export async function getHousing(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await catchUp(db, base.id); // this week's rent is collected before the prices are worked out
  const [c, week] = [await db.character.findUnique({ where: { id: base.id }, include: { account: true } }), await currentWeek(db)];
  if (!c.hostel) throw new GameError("Choose where to live first.", 409);
  return { week, hostel: c.hostel, weeksInSession: SESSION_WEEKS, balanceKobo: c.account.balance.toString(), blocked: blocker(c), homes: homesFor(c, week) };
}

export async function moveHome(db, userId, { hostel, requestId }) {
  needReq(requestId);
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await catchUp(db, base.id);
  const week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), key = `move:${c.id}:${requestId}`;
      if (blocker(c)) throw new GameError(blocker(c), 409);
      if (typeof hostel !== "string" || !canLiveIn(c.gender, hostel)) throw new GameError("That home is not available to you.", 400);
      if (await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } })) return { ...(await roomAfterMove(tx, c)), hostel: c.hostel, duplicate: true }; // a replay moves nobody twice
      if (c.hostel === hostel) throw new GameError("You already live there.", 409);
      const p = movePricing({ from: c.hostel, to: hostel, week, sessionStart: c.sessionStartWeek, paidUntil: c.rentPaidUntilWeek });
      const landlords = await tx.account.findUnique({ where: { systemName: "LANDLORDS" } });
      if (p.netKobo > 0n) await transferInTx(tx, { fromId: c.account.id, toId: landlords.id, amount: p.netKobo, memo: `Moved to ${hostel}: rent for the last ${p.weeks} week(s) of the session`, key, week });
      else if (p.netKobo < 0n) await transferInTx(tx, { fromId: landlords.id, toId: c.account.id, amount: -p.netKobo, memo: `Moved to ${hostel}: rent paid back`, key, week });
      await tx.character.update({ where: { id: c.id }, data: { hostel, rentPaidUntilWeek: p.prepaidUntil } });
      c.hostel = hostel; c.rentPaidUntilWeek = p.prepaidUntil;
      return { ...(await roomAfterMove(tx, c)), hostel, paidKobo: p.netKobo.toString(), weeks: p.weeks };
    });
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford the rent for that home.", 402);
    throw e;
  }
}
