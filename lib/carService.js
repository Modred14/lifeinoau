// lib/carService.js
// Server side of the Ride app: the YK Autos showroom, buying a car, and choosing which owned car you drive.
// Money moves through the ledger like everything else (the price goes to the TRANSPORT account), once per car, whatever happens to the request.
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { GameError, loadLocked, start, needReq } from "./gameService.js";
import { CARS, CAR_PAINTS, carById, forSale, paintFor, publicCar } from "./cars.js";

const FAMILY = "Daddy Benz";

const me = async (db, userId) => {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true, transport: true, activeCar: true, activeCarColor: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  return c;
};

/** The showroom, the player's garage and which car they drive. */
export async function getRides(db, userId) {
  const c = await me(db, userId);
  const owned = await db.ownedCar.findMany({ where: { characterId: c.id }, orderBy: { id: "asc" } });
  return { cars: CARS.map(publicCar), paints: CAR_PAINTS, owned: owned.map((o) => ({ modelId: o.modelId, color: o.color })), active: c.activeCar || "", activeColor: c.activeCarColor || "", family: c.transport === FAMILY };
}

/** The money and ownership of one purchase, inside a transaction that already holds the player's row lock. Exported so the rules can be tested on their own. */
export async function purchaseInTx(tx, c, car, { paint, requestId, week }) {
  const price = BigInt(car.priceNaira) * 100n;
  await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "car", gameWeek: week } }); // P2002 on replay
  if (await tx.ownedCar.findFirst({ where: { characterId: c.id, modelId: car.id } })) throw new GameError("You already own this car.", 409);
  const sink = await tx.account.findUnique({ where: { systemName: "TRANSPORT" } });
  await transferInTx(tx, { fromId: c.account.id, toId: sink.id, amount: price, memo: `YK Autos: ${car.name} (${car.year})`, key: `car:${c.id}:${car.id}`, week });
  await tx.ownedCar.create({ data: { characterId: c.id, modelId: car.id, color: paint, pricePaid: price } }); // the unique key is the last word on a double purchase
  await tx.character.update({ where: { id: c.id }, data: { activeCar: car.id, activeCarColor: paint } });
  return { ok: true, modelId: car.id, color: paint, paidKobo: price.toString(), active: car.id };
}

/** Buy one car: pay its price, own it for good, and drive it from now on. `requestId` makes a repeated request harmless; one car model can be owned once. */
export async function buyCar(db, userId, { modelId, color, requestId }) {
  needReq(requestId);
  const car = carById(modelId); if (!car) throw new GameError("That car is not in the showroom.", 404);
  if (!forSale(car)) throw new GameError("YK Autos has not confirmed a price for this car yet, so it is not for sale.", 409);
  const paint = paintFor(car, color), week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => purchaseInTx(tx, await loadLocked(tx, userId), car, { paint, requestId, week }));
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError(`You cannot afford the ${car.name}.`, 402);
    throw e;
  }
}

/** Which car you drive, inside a transaction holding the player's lock: only one you own, or "" for the family car a Nepo starts with. */
export async function selectInTx(tx, c, id) {
  if (id === "") {
    if (c.transport !== FAMILY) throw new GameError("You do not have a family car.", 409);
    await tx.character.update({ where: { id: c.id }, data: { activeCar: "", activeCarColor: "" } });
    return { ok: true, active: "", color: "" };
  }
  const own = await tx.ownedCar.findFirst({ where: { characterId: c.id, modelId: id } });
  if (!own) throw new GameError("You do not own that car.", 403);
  await tx.character.update({ where: { id: c.id }, data: { activeCar: id, activeCarColor: own.color } });
  return { ok: true, active: id, color: own.color };
}

export const useCar = (db, userId, { modelId }) => db.$transaction(async (tx) => selectInTx(tx, await loadLocked(tx, userId), typeof modelId === "string" ? modelId : ""));