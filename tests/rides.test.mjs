// tests/rides.test.mjs
// YK Autos: the showroom data, the purchase rules (price charged once, ownership kept, no double purchase, no sale without a verified price),
// which car you may drive, and what "has a car" means for travel. Pure Node over the in-memory database.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import { CARS, CAR_PAINTS, carById, forSale, paintFor, publicCar } from "../lib/cars.js";
import { purchaseInTx, selectInTx } from "../lib/carService.js";
import { InsufficientFunds } from "../lib/ledger.js";
import { ownsCar } from "../lib/travel.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

// ---- the showroom ----
chk("ten cars, with unique ids", CARS.length === 10 && new Set(CARS.map((c) => c.id)).size === 10);
chk("every car has a name, a year, a condition, a body, a shape and specs", CARS.every((c) => c.name && c.year >= 2005 && c.condition && c.body && c.shape && c.specs.length >= 3));
chk("a priced car says where the price is from; an unpriced one is not for sale", CARS.every((c) => (c.priceNaira == null) === !forSale(c) && (c.priceNaira == null ? c.basis == null : (c.basis === "listings" || c.basis === "estimate") && c.note.length > 20)));
const priced = CARS.filter(forSale);
chk("the cheap cars cost far less than the luxury ones", carById("corolla-2011").priceNaira < carById("camry-2014").priceNaira && carById("camry-2014").priceNaira * 10 < carById("huracan-2025").priceNaira && carById("huracan-2025").priceNaira < carById("urus-2025").priceNaira);
chk("prices are whole naira and reach the screen as kobo text", priced.every((c) => Number.isSafeInteger(c.priceNaira)) && publicCar(carById("corolla-2011")).priceKobo === "700000000" && publicCar(carById("cybertruck-2024")).priceKobo === null);
chk("paint: a picked paint is used, junk falls back, a fixed paint wins", paintFor(carById("corolla-2011"), "#2c5aa0") === "#2c5aa0" && paintFor(carById("corolla-2011"), "red; drop table") === CAR_PAINTS[0].id && paintFor(carById("cybertruck-2024"), "#2c5aa0") === "#aeb3ba");

// ---- buying ----
const car = carById("corolla-2011"), price = BigInt(car.priceNaira) * 100n;
function world(balance) {
  const db = makeDb(["account", "ledgerEntry", "actionLog", "ownedCar", "character"], { unique: { actionLog: ["characterId", "requestId"], ownedCar: ["characterId", "modelId"], ledgerEntry: ["idempotencyKey"] } });
  return db.$transaction(async (tx) => {
    await tx.account.create({ data: { id: "pa", kind: "PLAYER", balance } }); await tx.account.create({ data: { id: "sink", kind: "SYSTEM", systemName: "TRANSPORT", balance: 0n } });
    await tx.character.create({ data: { id: "c1", transport: "Trek", activeCar: "", activeCarColor: "" } }); return db;
  });
}
const buy = (db, requestId, c = car, paint = "#2c5aa0") => db.$transaction((tx) => purchaseInTx(tx, { id: "c1", account: { id: "pa" } }, c, { paint, requestId, week: 3 }));
const T = (db) => db.T();

{ const db = await world(price + 5_000_00n); const r = await buy(db, "r1");
  chk("a purchase charges the price once and records the ownership", r.ok && r.paidKobo === price.toString() && T(db).account.find((a) => a.id === "pa").balance === 500_000n && T(db).ownedCar.length === 1 && T(db).ledgerEntry.length === 1);
  chk("the bought car becomes the one you drive, in the paint you chose", T(db).character[0].activeCar === car.id && T(db).character[0].activeCarColor === "#2c5aa0" && ownsCar(T(db).character[0]));
  chk("the price went to the TRANSPORT account with a clear memo", T(db).ledgerEntry[0].creditAccountId === "sink" && /YK Autos: Toyota Corolla/.test(T(db).ledgerEntry[0].memo));
  let e1; try { await buy(db, "r1"); } catch (e) { e1 = e; }
  chk("the same request again (a retry or a double click) is a harmless duplicate and charges nothing", e1?.code === "P2002" && T(db).ownedCar.length === 1 && T(db).ledgerEntry.length === 1 && T(db).account.find((a) => a.id === "pa").balance === 500_000n);
  let e2; try { await buy(db, "r2"); } catch (e) { e2 = e; }
  chk("a NEW request for a car you already own is refused and charges nothing", /already own/.test(e2?.message) && e2.status === 409 && T(db).ledgerEntry.length === 1 && T(db).account.find((a) => a.id === "pa").balance === 500_000n); }

{ const db = await world(price - 1n); let e; try { await buy(db, "r1"); } catch (x) { e = x; }
  chk("not enough money: refused, nothing is charged, nothing is owned, no half-finished record", e instanceof InsufficientFunds && T(db).ownedCar.length === 0 && T(db).ledgerEntry.length === 0 && T(db).actionLog.length === 0 && T(db).account.find((a) => a.id === "pa").balance === price - 1n && T(db).character[0].activeCar === ""); }

{ // loadLocked takes SELECT ... FOR UPDATE on the player's row, so one player's actions run one at a time. The in-memory database has no row locks,
  // so this stands one in: transactions queue up. (The same-car unique key on OwnedCar and the ledger's idempotency key are the second line of defence in Postgres.)
  const db = await world(price * 5n), orig = db.$transaction; let q = Promise.resolve(); db.$transaction = (fn) => { const r = q.then(() => orig(fn)); q = r.catch(() => {}); return r; };
  const p = await Promise.allSettled([buy(db, "a"), buy(db, "b"), buy(db, "c")]);
  chk("three different requests at once for the same car: exactly one purchase, charged once, the others refused", p.filter((x) => x.status === "fulfilled").length === 1 && p.filter((x) => x.status === "rejected" && x.reason.status === 409).length === 2 && T(db).ownedCar.length === 1 && T(db).ledgerEntry.length === 1 && T(db).account.find((a) => a.id === "pa").balance === price * 4n); }

// ---- which car you drive ----
{ const db = await world(price * 5n); await buy(db, "r1"); const other = carById("camry-2014"); await buy(db, "r2", other, "#e8e8e8");
  chk("buying a second car makes it the one you drive", T(db).character[0].activeCar === other.id);
  const sel = (id) => db.$transaction((tx) => selectInTx(tx, { id: "c1", transport: "Trek" }, id));
  const r = await sel(car.id);
  chk("you can switch to a car you own, and its own paint comes with it", r.active === car.id && T(db).character[0].activeCar === car.id && T(db).character[0].activeCarColor === "#2c5aa0");
  let e; try { await sel("huracan-2025"); } catch (x) { e = x; }
  chk("you cannot drive a car you do not own", e?.status === 403 && T(db).character[0].activeCar === car.id);
  let e3; try { await sel(""); } catch (x) { e3 = x; }
  chk("only a player with a family car can go back to it", e3?.status === 409);
  chk("the family car comes back for a Nepo", (await db.$transaction((tx) => selectInTx(tx, { id: "c1", transport: "Daddy Benz" }, ""))).active === "" && T(db).character[0].activeCar === ""); }

// ---- travel ----
chk("has a car: the family car, or a chosen car; not an empty garage", ownsCar({ transport: "Daddy Benz" }) && ownsCar({ transport: "Trek", activeCar: "camry-2014" }) && !ownsCar({ transport: "Keke", activeCar: "" }) && !ownsCar(null));
process.exit(bad ? 1 : 0);
