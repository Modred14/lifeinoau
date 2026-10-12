// lib/roomService.js
// The player's room: what they own, what is standing where, and buying and selling. Money only moves through the ledger.
import { currentWeek } from "./clock.js";
import { GameError, loadLocked } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { ITEMS, STARTER, MAX_ITEMS, isItem, priceKobo, sellKobo, roomScore } from "./furniture.js";
import { roomFor, fits, autoPlace } from "./room.js";

const needReq = (id) => { if (!/^[\w-]{8,64}$/.test(id ?? "")) throw new GameError("Missing requestId."); };
const toItem = (r) => ({ id: r.id.toString(), key: r.key, placed: r.placed, x: r.x, z: r.z, rot: r.rot, paidKobo: r.paid.toString() });
const rows = (tx, characterId) => tx.roomItem.findMany({ where: { characterId }, orderBy: { id: "asc" } });

/** Locks the player's row (one change at a time) without the jail and suspension checks: you can always look at your room. */
async function lockChar(tx, userId) {
  const b = await tx.character.findUnique({ where: { userId }, select: { id: true } });
  if (!b) throw new GameError("Create a character first.", 404);
  await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${b.id} FOR UPDATE`;
  const c = await tx.character.findUnique({ where: { id: b.id }, include: { account: true } });
  if (!c.hostel) throw new GameError("Choose where to live first.", 409);
  return c;
}

/** First visit: the room comes with a bed, wardrobe, desk and chair, free. */
async function ensureStarter(tx, c, room) {
  if ((await tx.roomItem.count({ where: { characterId: c.id } })) > 0) return;
  const placed = [];
  for (const key of STARTER) {
    const spot = autoPlace(room, placed, key), row = await tx.roomItem.create({ data: { characterId: c.id, key, placed: !!spot, x: spot?.x ?? null, z: spot?.z ?? null, rot: spot?.rot ?? 0, paid: 0n } });
    if (spot) placed.push({ id: row.id.toString(), key, placed: true, ...spot });
  }
}

async function view(tx, c, room) {
  const items = (await rows(tx, c.id)).map(toItem), acc = await tx.account.findUnique({ where: { id: c.account.id } });
  return { room, items, score: roomScore(items), balanceKobo: acc.balance.toString() };
}

export function getRoom(db, userId) {
  return db.$transaction(async (tx) => { const c = await lockChar(tx, userId), room = roomFor(c.hostel); await ensureStarter(tx, c, room); return view(tx, c, room); });
}

export async function buyItem(db, userId, { key, requestId }) {
  needReq(requestId); if (!isItem(key)) throw new GameError("That item is not in the shop.");
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), room = roomFor(c.hostel), ledgerKey = `furn:${c.id}:${requestId}`;
      await ensureStarter(tx, c, room);
      const v = await view(tx, c, room);
      if (await tx.ledgerEntry.findUnique({ where: { idempotencyKey: ledgerKey } })) return { ...v, duplicate: true }; // a replay buys nothing twice
      if (v.items.length >= MAX_ITEMS) throw new GameError("Your storage is full. Sell something first.", 409);
      const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } }), price = priceKobo(key);
      await transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount: price, memo: `Furniture: ${ITEMS[key].name}`, key: ledgerKey, week });
      const spot = autoPlace(room, v.items, key);
      const row = await tx.roomItem.create({ data: { characterId: c.id, key, placed: !!spot, x: spot?.x ?? null, z: spot?.z ?? null, rot: spot?.rot ?? 0, paid: price } });
      return { ...(await view(tx, c, room)), boughtId: row.id.toString(), placed: !!spot };
    });
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    throw e;
  }
}

const idOf = (id) => { if (!/^\d{1,18}$/.test(String(id ?? ""))) throw new GameError("That item does not exist.", 404); return BigInt(id); };

/** Put an owned item in the room. With x, z and rot it goes exactly there (checked); without them it takes the best free spot. */
export function placeItem(db, userId, { id, x, z, rot }) {
  const itemId = idOf(id);
  return db.$transaction(async (tx) => {
    const c = await lockChar(tx, userId), room = roomFor(c.hostel), all = (await rows(tx, c.id)).map(toItem), it = all.find((i) => i.id === itemId.toString());
    if (!it) throw new GameError("That item does not exist.", 404);
    const spot = x === undefined ? autoPlace(room, all.filter((i) => i.id !== it.id), it.key) : { x, z, rot: rot ?? 0 };
    if (!spot) throw new GameError("There is no space left in your room.", 409);
    if (!fits(room, all, it.key, spot.x, spot.z, spot.rot, it.id)) throw new GameError("It does not fit there.", 409);
    await tx.roomItem.update({ where: { id: itemId }, data: { placed: true, x: spot.x, z: spot.z, rot: spot.rot } });
    return view(tx, c, room);
  });
}

/** Take an item out of the room into storage. Free. */
export function storeItem(db, userId, { id }) {
  const itemId = idOf(id);
  return db.$transaction(async (tx) => {
    const c = await lockChar(tx, userId), room = roomFor(c.hostel);
    const r = await tx.roomItem.updateMany({ where: { id: itemId, characterId: c.id }, data: { placed: false, x: null, z: null, rot: 0 } });
    if (!r.count) throw new GameError("That item does not exist.", 404);
    return view(tx, c, room);
  });
}

/** Sell for 60% of what was paid. Free starter items cannot be sold. */
export async function sellItem(db, userId, { id }) {
  const itemId = idOf(id), week = await currentWeek(db);
  return db.$transaction(async (tx) => {
    const c = await loadLocked(tx, userId), room = roomFor(c.hostel);
    const it = await tx.roomItem.findFirst({ where: { id: itemId, characterId: c.id } });
    if (!it) throw new GameError("That item does not exist.", 404);
    const back = sellKobo(it.paid);
    if (back <= 0n) throw new GameError("Starter furniture cannot be sold.", 409);
    await tx.roomItem.delete({ where: { id: itemId } }); // gone before the money moves, so a replay finds nothing to sell twice
    const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } });
    await transferInTx(tx, { fromId: venues.id, toId: c.account.id, amount: back, memo: `Sold: ${ITEMS[it.key]?.name ?? it.key}`, key: `furn-sell:${c.id}:${it.id}`, week });
    return { ...(await view(tx, c, room)), soldKobo: back.toString() };
  });
}