// lib/wardrobeService.js
// Server side of the Offishall Store and the wardrobe. The browser only says WHICH item; the price, the ownership, the money and the outfit rules are all decided here.
//  - buyItem: one purchase per item per player, paid from the bank balance through the ledger (the price is the catalog's, never the browser's).
//  - equipOutfit / wearStarter: only items the player owns, and only a complete outfit (a set, or a top AND a bottom). The result is saved in Character.look.wear,
//    which every screen that draws the player reads, so the new clothes show on the map, in buildings, to other players, in profiles and in profile pictures.
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { GameError, loadLocked, start, needReq } from "./gameService.js";
import { cleanLook, lookKey, withoutWear } from "./look.js";
import { itemById, fitsGender, priceKobo, checkWear, CATALOG } from "./wardrobe.js";

const naira = (kobo) => "₦" + (BigInt(kobo) / 100n).toLocaleString("en-NG");

/** Lock the player's row (one change at a time). Changing clothes is cosmetic, so it works for everyone, jailed or suspended players included. */
async function lockCharacter(tx, userId) {
  const base = await tx.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${base.id} FOR UPDATE`;
  return tx.character.findUnique({ where: { id: base.id } });
}

const view = (c, rows, balance) => {
  const look = cleanLook(c.look, c.gender);
  return {
    gender: c.gender === "F" ? "F" : "M",
    balanceKobo: balance == null ? null : String(balance),
    owned: rows.map((r) => ({ id: r.itemId, paidKobo: String(r.pricePaid), at: r.createdAt })).filter((r) => itemById(r.id)), // an id the catalog no longer has is kept in the table but not shown
    wear: look.wear ?? null,
    look,
    lookKey: lookKey(look, c.gender),
  };
};

/** The shop and wardrobe state of this player. The catalog itself is shared code (lib/wardrobe.js), so only what is personal is sent. */
export async function getWardrobe(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, include: { account: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  const rows = await db.wardrobeItem.findMany({ where: { characterId: c.id }, orderBy: { id: "asc" } });
  return view(c, rows, c.account?.balance);
}

/** Buy one item. `requestId` makes a repeated request harmless; an item can be bought once, and the same key can never charge twice. */
export async function buyItem(db, userId, { itemId, requestId }) {
  needReq(requestId);
  const item = itemById(itemId);
  if (!item) throw new GameError("That item is not in the Offishall Store.", 404);
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { allowJailed: true, allowSuspended: true });
      if (!fitsGender(item, c.gender)) throw new GameError(`${item.name} is not made for your character's body type.`, 409);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "wardrobe", gameWeek: week } }); // P2002 on a repeated request
      if (await tx.wardrobeItem.findFirst({ where: { characterId: c.id, itemId: item.id } })) throw new GameError(`You already own ${item.name}.`, 409);
      const price = priceKobo(item);
      const sink = (await tx.account.findUnique({ where: { systemName: "RETAIL" } })) ?? (await tx.account.create({ data: { kind: "SYSTEM", systemName: "RETAIL" } })); // the migration and the seed create it; this is only for a database that has neither
      await transferInTx(tx, { fromId: c.account.id, toId: sink.id, amount: price, memo: `Offishall Store: ${item.name}`, key: `wardrobe:${c.id}:${item.id}`, week });
      await tx.wardrobeItem.create({ data: { characterId: c.id, itemId: item.id, pricePaid: price } }); // the unique key is the last word on a double purchase
      return { ok: true, itemId: item.id, paidKobo: price.toString() };
    });
  } catch (e) {
    if (e.code === "P2002" && String(e.meta?.target ?? "").includes("systemName")) throw new GameError("The store is busy. Try again.", 503); // two first-ever purchases created the store account at once: nothing was charged
    if (e.code === "P2002") return { ok: true, duplicate: true }; // the same request again (or the same item bought twice at once): nothing more was charged
    if (e instanceof InsufficientFunds) throw new GameError(`You need ${naira(priceKobo(item))} in your bank to buy ${item.name}.`, 402);
    throw e;
  }
}

/** Wear an outfit made only of owned items: one set, or one top and one bottom. Anything else is refused and nothing is saved. */
export async function equipOutfit(db, userId, { ids }) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2 || ids.some((i) => typeof i !== "string")) throw new GameError("Choose a complete outfit.");
  return db.$transaction(async (tx) => {
    const c = await lockCharacter(tx, userId);
    const owned = new Set((await tx.wardrobeItem.findMany({ where: { characterId: c.id }, select: { itemId: true } })).map((r) => r.itemId));
    const missing = ids.find((i) => !owned.has(i));
    if (missing) throw new GameError(`You do not own ${itemById(missing)?.name ?? "that item"}. Buy it in the Offishall Store first.`, 403);
    const fit = checkWear(ids, c.gender);
    if (!fit.ok) throw new GameError(fit.reason, 409);
    const look = cleanLook({ ...cleanLook(c.look, c.gender), wear: fit.ids }, c.gender);
    await tx.character.update({ where: { id: c.id }, data: { look } });
    return { ok: true, wear: look.wear, look, lookKey: lookKey(look, c.gender), gender: c.gender };
  });
}

/** Go back to the starter outfit (the clothes the character was created in): always a complete outfit. Nothing owned is lost. */
export async function wearStarter(db, userId) {
  return db.$transaction(async (tx) => {
    const c = await lockCharacter(tx, userId);
    const look = cleanLook(withoutWear(cleanLook(c.look, c.gender)), c.gender);
    await tx.character.update({ where: { id: c.id }, data: { look } });
    return { ok: true, wear: null, look, lookKey: lookKey(look, c.gender), gender: c.gender };
  });
}

export const CATALOG_SIZE = CATALOG.length;
