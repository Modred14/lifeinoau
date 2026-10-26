// lib/roomService.js
// The player's room: what they own, what is standing where, and buying and selling. Money only moves through the ledger.
import { currentWeek } from "./clock.js";
import { GameError, loadLocked } from "./gameService.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { ITEMS, MAX_ITEMS, inShop, priceKobo, sellKobo, roomScore, starterFor, starterPlan, isFixture, isOutdoor, canGoOutside } from "./furniture.js";
import { roomFor, grimeFor, fits, autoPlace, consistent, placementIssue, isOutside } from "./room.js";

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

/** The room as this player sees it: its size and look, who shares it, and how rough it has got this session. */
async function roomOf(tx, c) { const week = await currentWeek(tx); return { ...roomFor(c.hostel, c.id), grime: grimeFor(c.hostel, week - c.sessionStartWeek) }; }

const tally = (keys) => JSON.stringify(Object.entries(keys.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})).sort());
/**
 * Makes sure the room holds exactly what this home comes with, and that everything stands where it legally can. On a first visit it adds the
 * free starter set. A player who moved in under an older set (before hostels got their own rooms), or has just moved to another home, is moved
 * to the new one once: free starter items are swapped, anything they bought is kept (it stays where it was if it still fits, otherwise it moves
 * to a free spot or into storage; a generator always ends up outside).
 */
async function ensureStarter(tx, c, room) {
  const plan = starterPlan(c.hostel, room.occupants), want = plan.map(([k]) => k), have = await rows(tx, c.id), free = have.filter((r) => r.paid === 0n);
  if (have.length && tally(free.map((r) => r.key)) === tally(want) && consistent(room, have.map(toItem))) return;
  const bought = have.filter((r) => r.paid > 0n), placed = [];
  if (free.length) await tx.roomItem.deleteMany({ where: { id: { in: free.map((r) => r.id) } } });
  for (const [key, zone] of plan) {
    const spot = autoPlace(room, placed, key, zone), row = await tx.roomItem.create({ data: { characterId: c.id, key, placed: !!spot, x: spot?.x ?? null, z: spot?.z ?? null, rot: spot?.rot ?? 0, paid: 0n } });
    if (spot) placed.push({ id: row.id.toString(), key, placed: true, ...spot });
  }
  for (const r of bought) {
    let spot = r.placed && r.x != null && fits(room, placed, r.key, r.x, r.z, r.rot, r.id) ? { x: r.x, z: r.z, rot: r.rot } : autoPlace(room, placed, r.key);
    if (spot) placed.push({ id: r.id.toString(), key: r.key, placed: true, ...spot });
    if (!!spot !== r.placed || (spot && (spot.x !== r.x || spot.z !== r.z || spot.rot !== r.rot))) await tx.roomItem.update({ where: { id: r.id }, data: { placed: !!spot, x: spot?.x ?? null, z: spot?.z ?? null, rot: spot?.rot ?? 0 } });
  }
}

/**
 * A short fingerprint of where everything stands. Every answer carries it, so a second device (or the same player in another tab) can tell with one
 * cheap request whether the compound changed: GET /api/room?rev=<this> answers { same: true } while nothing moved. (Not a secret: it is only a counter.)
 */
export function revOf(items) {
  let h = 2166136261;
  for (const i of items) for (const ch of `${i.id}:${i.key}:${i.placed ? 1 : 0}:${i.x}:${i.z}:${i.rot};`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36) + "." + items.length;
}
const withRev = (v) => ({ ...v, rev: revOf(v.items) });

async function view(tx, c, room) {
  const items = (await rows(tx, c.id)).map(toItem), acc = await tx.account.findUnique({ where: { id: c.account.id } });
  return withRev({ room, items, score: roomScore(items), balanceKobo: acc.balance.toString() });
}

/**
 * Choosing where to live and getting the furniture that comes with it are ONE step. The hostel is saved and the starter furniture is
 * created in the same transaction, so no request can ever see a home without its furniture (and /api/room can never run in between
 * and fail with "Choose where to live first"). Returns false if the player had already chosen (a double tap), true if this call did it.
 */
export async function chooseHostelWithRoom(db, characterId, hostel) {
  return db.$transaction(async (tx) => {
    const done = await tx.character.updateMany({ where: { id: characterId, hostel: "" }, data: { hostel } }); // guards a double-click race
    if (!done.count) return false;
    const c = await tx.character.findUnique({ where: { id: characterId }, include: { account: true } });
    await ensureStarter(tx, c, await roomOf(tx, c));
    return true;
  });
}

/** Has anything in the room moved since `rev`? Cheap: one read, no locks. Returns { same: true, rev } or the whole room. */
export async function getRoomIfChanged(db, userId, rev) {
  const v = await getRoom(db, userId);
  return rev && rev === v.rev ? { same: true, rev: v.rev } : v;
}

export async function getRoom(db, userId) {
  // Fast path: nearly every visit only LOOKS at the room, so read it without a transaction or a row lock. Only if the starter furniture
  // is missing or out of date (a first visit, or a changed hostel) does it fall through to the locked version below, which fixes that.
  const b = await db.character.findUnique({ where: { userId }, include: { account: true } });
  if (b?.hostel) {
    const room = await roomOf(db, b), have = await rows(db, b.id), free = have.filter((r) => r.paid === 0n);
    if (have.length && tally(free.map((r) => r.key)) === tally(starterFor(b.hostel, room.occupants)) && consistent(room, have.map(toItem))) {
      const items = have.map(toItem);
      return withRev({ room, items, score: roomScore(items), balanceKobo: b.account.balance.toString() });
    }
  }
  return db.$transaction(async (tx) => { const c = await lockChar(tx, userId), room = await roomOf(tx, c); await ensureStarter(tx, c, room); return view(tx, c, room); });
}

export async function buyItem(db, userId, { key, requestId }) {
  needReq(requestId); if (!inShop(key)) throw new GameError("That item is not in the shop.");
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await currentWeek(db);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), room = await roomOf(tx, c), ledgerKey = `furn:${c.id}:${requestId}`;
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

/**
 * Put an owned item in the home or out on the compound. With x, z and rot it goes exactly there (every rule checked: see placementIssue in lib/room.js);
 * without them it takes the best free spot. `where` is "inside" or "outside" for a weatherproof piece (a chair, sofa, table ...) that is being carried
 * in or out: it goes to the best free spot there. The things that come with the home (the toilet, the shower, the dining table) cannot be moved.
 */
export function placeItem(db, userId, { id, x, z, rot, where }) {
  const itemId = idOf(id);
  if (where !== undefined && where !== "inside" && where !== "outside") throw new GameError("Say inside or outside.");
  if ((x === undefined) !== (z === undefined)) throw new GameError("Give both x and z, or neither.");
  return db.$transaction(async (tx) => {
    const c = await lockChar(tx, userId), room = await roomOf(tx, c), all = (await rows(tx, c.id)).map(toItem), it = all.find((i) => i.id === itemId.toString());
    if (!it) throw new GameError("That item does not exist.", 404);
    if (isFixture(it.key)) throw new GameError(`${ITEMS[it.key].name} is part of the home. It cannot be moved.`, 409);
    const rest = all.filter((i) => i.id !== it.id);
    let spot;
    if (x !== undefined) spot = { x, z, rot: rot ?? 0 };
    else if (where === "outside") {
      if (!canGoOutside(it.key)) throw new GameError(`${ITEMS[it.key].name} stays indoors: the weather would ruin it.`, 409);
      spot = autoPlace(room, rest, it.key, null, { outdoors: true });
      if (!spot) throw new GameError("There is no space left on your compound.", 409);
    } else if (where === "inside") {
      if (isOutdoor(it.key)) throw new GameError(`${ITEMS[it.key].name} is a garden piece. It stays outside.`, 409);
      spot = autoPlace(room, rest, it.key);
      if (!spot) throw new GameError("There is no space left inside your home.", 409);
    } else spot = autoPlace(room, rest, it.key) ?? (canGoOutside(it.key) ? autoPlace(room, rest, it.key, null, { outdoors: true }) : null); // a weatherproof piece with no room indoors goes out on the compound
    if (!spot) throw new GameError("There is no space left in your room.", 409);
    const why = placementIssue(room, all, it.key, spot.x, spot.z, spot.rot, it.id);
    if (why) throw new GameError(why, 409);
    await tx.roomItem.update({ where: { id: itemId }, data: { placed: true, x: spot.x, z: spot.z, rot: spot.rot } });
    return view(tx, c, room);
  });
}

/** Take an item out of the room (or off the compound) into storage. Free. The home's own fixtures stay where they are. */
export function storeItem(db, userId, { id }) {
  const itemId = idOf(id);
  return db.$transaction(async (tx) => {
    const c = await lockChar(tx, userId), room = await roomOf(tx, c);
    const it = await tx.roomItem.findFirst({ where: { id: itemId, characterId: c.id } });
    if (!it) throw new GameError("That item does not exist.", 404);
    if (isFixture(it.key)) throw new GameError(`${ITEMS[it.key].name} is part of the home. It cannot be stored.`, 409);
    await tx.roomItem.updateMany({ where: { id: itemId, characterId: c.id }, data: { placed: false, x: null, z: null, rot: 0 } });
    return view(tx, c, room);
  });
}

/** Sell for 60% of what was paid. Free starter items cannot be sold. */
export async function sellItem(db, userId, { id }) {
  const itemId = idOf(id), week = await currentWeek(db);
  return db.$transaction(async (tx) => {
    const c = await loadLocked(tx, userId), room = await roomOf(tx, c);
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

/** Right after a move: the room of the new home (its starter furniture in, the player's own things moved over), read inside the move's transaction. */
export async function roomAfterMove(tx, c) {
  const room = await roomOf(tx, c);
  await ensureStarter(tx, c, room);
  return view(tx, c, room);
}

/**
 * What other players may see of someone's home from outside: the plot and the pieces standing on the compound, nothing from inside the house.
 * Read-only, by character name; a closed account has no compound. The same persisted rows the owner edits, so a change shows for everyone at the next read.
 */
export async function getCompound(db, name) {
  const nm = String(name ?? "").trim().slice(0, 40);
  if (!nm) throw new GameError("Say whose compound.", 400);
  const c = await db.character.findFirst({ where: { name: { equals: nm, mode: "insensitive" } }, include: { user: { select: { status: true } } } });
  if (!c || !c.hostel || c.user?.status === "DELETED") throw new GameError("There is no such home.", 404);
  const room = roomFor(c.hostel, c.id), out = (await rows(db, c.id)).map(toItem).filter((i) => i.placed && i.x != null && isOutside(room, i)).map(({ id, key, x, z, rot }) => ({ id, key, x, z, rot }));
  return { owner: c.name, hostel: c.hostel, room: { w: room.w, d: room.d, layout: room.layout ?? null, theme: room.theme }, items: out, rev: revOf(out) };
}
