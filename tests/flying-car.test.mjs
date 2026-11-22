// tests/flying-car.test.mjs
// The Tesla Skyhawk flying car: it is in the YK Autos showroom with a verified-by-source price, it can be bought once with the server's money rules, its 3D model is the one the game
// drives (fans stowed on the road, out in the air), and it flies by lib3d/flightphysics.js (vertical take-off, free flight only above the buildings, vertical landing onto a clear road).
import assert from "node:assert/strict";
import * as THREE from "three";
import { makeDb } from "./fakedb.mjs";
import { CARS, carById, forSale, publicCar } from "../lib/cars.js";
import { purchaseInTx } from "../lib/carService.js";
import { InsufficientFunds } from "../lib/ledger.js";
import { ownsCar } from "../lib/travel.js";
import { makeVehicle } from "../lib3d/vehicles.js";
import { CAR_SPECS } from "../lib3d/vehicleSpecs.js";
import { VEHICLE_DIMS } from "../lib3d/vehicleDims.js";
import { VEHICLE_PERFORMANCE } from "../lib/vehiclePerformance.js";
import { carProfile, createCar, stepCar, PROFILES } from "../lib3d/carphysics.js";
import { createAir, canTakeOff, takeOff, land, stepAir, fanOut, isAirborne, CLEARANCE_M, FAN_SECONDS, AIR_TOP } from "../lib3d/flightphysics.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

const ID = "tesla-skyhawk-2026", car = carById(ID);
// ---- the showroom entry ----
chk("the Skyhawk is in the showroom, flagged as a flyer, with its own shape", !!car && car.flies === true && car.shape === "flyer" && /Tesla/.test(car.name) && CARS.filter((c) => c.id === ID).length === 1);
chk("it is for sale at a priced, sourced, premium price above every other car", forSale(car) && car.basis === "estimate" && /Alef/.test(car.note) && CARS.every((c) => c.id === ID || c.priceNaira < car.priceNaira));
chk("the screen is told its price as kobo text and that it flies", publicCar(car).priceKobo === "75000000000" && publicCar(car).shape === "flyer");
chk("every registry knows it: spec, dims, performance, handling", !!CAR_SPECS[ID] && !!VEHICLE_DIMS[ID] && !!VEHICLE_PERFORMANCE[ID] && !!PROFILES[ID] && carProfile(ID).flies === true && CARS.filter((c) => c.id !== ID).every((c) => !carProfile(c.id).flies));

// ---- buying it (the same server rules as every car) ----
const price = BigInt(car.priceNaira) * 100n;
function world(balance) {
  const db = makeDb(["account", "ledgerEntry", "actionLog", "ownedCar", "character"], { unique: { actionLog: ["characterId", "requestId"], ownedCar: ["characterId", "modelId"], ledgerEntry: ["idempotencyKey"] } });
  return db.$transaction(async (tx) => {
    await tx.account.create({ data: { id: "pa", kind: "PLAYER", balance } }); await tx.account.create({ data: { id: "sink", kind: "SYSTEM", systemName: "TRANSPORT", balance: 0n } });
    await tx.character.create({ data: { id: "c1", transport: "Trek", activeCar: "", activeCarColor: "" } }); return db;
  });
}
const buy = (db, requestId) => db.$transaction((tx) => purchaseInTx(tx, { id: "c1", account: { id: "pa" } }, car, { paint: "#e8e8e8", requestId, week: 3 }));
const T = (db) => db.T();
{ const db = await world(price + 1_000_000n); const r = await buy(db, "f1");
  chk("a player with enough money buys it: the price is charged once and ownership recorded", r.ok && r.paidKobo === price.toString() && T(db).account.find((a) => a.id === "pa").balance === 1_000_000n && T(db).ownedCar.length === 1 && T(db).ownedCar[0].modelId === ID);
  chk("it becomes the car they drive, and they now own a car", T(db).character[0].activeCar === ID && ownsCar(T(db).character[0]));
  let e1; try { await buy(db, "f1"); } catch (e) { e1 = e; }
  chk("a repeated request charges nothing more and adds no second car", e1?.code === "P2002" && T(db).ownedCar.length === 1 && T(db).ledgerEntry.length === 1);
  let e2; try { await buy(db, "f2"); } catch (e) { e2 = e; }
  chk("a new request for the same car is refused, nothing charged", e2?.status === 409 && T(db).ownedCar.length === 1 && T(db).account.find((a) => a.id === "pa").balance === 1_000_000n); }
{ const db = await world(price - 1n); let e; try { await buy(db, "p1"); } catch (x) { e = x; }
  chk("a player short by one kobo cannot buy it and nothing changes", e instanceof InsufficientFunds && T(db).ownedCar.length === 0 && T(db).account.find((a) => a.id === "pa").balance === price - 1n && T(db).character[0].activeCar === ""); }

// ---- the model ----
const v = makeVehicle(ID, "#e8e8e8"), box = () => new THREE.Box3().setFromObject(v.root), sz = () => box().getSize(new THREE.Vector3());
chk("it is built by the shared builder: four wheels, two doors, seats, a flight rig of four lift fans", v.wheels.length === 4 && v.front.length === 2 && v.flies === true && v.flight.pods.length === 4 && !!v.doors && v.driver.x > 0 && v.seat.x < 0);
chk("stowed on the road it is the size in the spec, stands on the ground and the fans are out of sight", Math.abs(sz().z - 4.86) < 0.4 && Math.abs(sz().x - 1.96) < 0.4 && Math.abs(box().min.y) < 0.02 && v.flight.pods.every((p) => !p.pivot.visible));
v.flight.deploy(1); const wide = sz().x;
chk("deployed the fans show and the car is wider than stowed", v.flight.pods.every((p) => p.pivot.visible) && wide > 3.2 && wide > 1.5 * 1.96 - 0.1 && Math.abs(box().min.y) < 0.02);
const ph = v.flight.phase; v.flight.spin(0.1, 1); const ph2 = v.flight.phase; v.flight.deploy(0); v.flight.spin(0.1, 1);
chk("the fans spin when out and not when stowed", ph2 > ph && v.flight.phase === ph2);
chk("the model is symmetrical (left and right fans mirror each other)", (() => { v.flight.deploy(1); const xs = v.flight.pods.map((p) => p.pivot.position.x).sort((a, b) => a - b); return Math.abs(xs[0] + xs[3]) < 1e-9 && Math.abs(xs[1] + xs[2]) < 1e-9; })());
v.dispose();

// ---- flying ----
const P = carProfile(ID), mk = () => { const o = Object.assign(createCar({ x: 100, z: 50, ang: 0.5 }), { P, h: 0, lv: 0 }); return o; };
const run = (own, air, inp, secs, ctx = {}, dt = 1 / 60) => { let last = null; for (let t = 0; t < secs; t += dt) { const i = typeof inp === "function" ? inp(t, own, air) : inp; last = stepAir(own, air, i, dt, ctx); } return last; };
{ const own = mk(), air = createAir(), g = carProfile("corolla-2011");
  chk("an ordinary car cannot take off", !canTakeOff({ ...own, P: g }, air, true).ok);
  own.v = 20; chk("it will not take off while moving fast, or from a ramp", !canTakeOff(own, air, true).ok && !(own.v = 0, canTakeOff(own, air, false).ok) && canTakeOff(own, air, true).ok);
  takeOff(own, air); const x0 = own.x, z0 = own.z; run(own, air, { gas: 1, steer: 1 }, 1.0);
  chk("take-off is vertical: the car does not move sideways while the fans deploy", air.state === "takeoff" && Math.abs(own.x - x0) < 1e-9 && Math.abs(own.z - z0) < 1e-9 && fanOut(air) > 0.5);
  run(own, air, { gas: 1 }, 6); chk("it climbs but stays put under the building clearance height", own.h > 5 && own.h < CLEARANCE_M && Math.abs(own.x - x0) < 1e-9 && air.state === "takeoff");
  run(own, air, { gas: 0 }, 6); chk("above the clearance height it is in free flight", own.h >= CLEARANCE_M && air.state === "cruise" && isAirborne(air));
  const hx0 = own.x, hz0 = own.z; run(own, air, { gas: 1 }, 6);
  chk("with the throttle it flies forward along its nose, faster than any road car at that moment, never above its air top speed", Math.hypot(own.x - hx0, own.z - hz0) > 40 && own.v > 25 && own.v <= AIR_TOP + 1e-9);
  const ang0 = own.ang; run(own, air, { gas: 1, steer: 1 }, 2); chk("steering turns it (right is positive)", own.ang > ang0 + 0.3 && Math.abs(own.hx ** 2 + own.hz ** 2 - 1) < 1e-9);
  const alt0 = own.h; run(own, air, { climb: 1 }, 3); const alt1 = own.h; run(own, air, { climb: -1, gas: 0 }, 8); chk("climb and descend change the altitude", alt1 > alt0 + 5 && own.h < alt1 - 8 && air.state === "cruise");
  own.h = air.alt = 100; air.vy = 0; air.state = "cruise"; run(own, air, { climb: 1, gas: 0 }, 70); chk("the ceiling holds", own.h <= 260 + 1e-9 && own.h > 250);
  // landing, from a known height over a known spot
  own.h = air.alt = 70; air.vy = 0; air.state = "cruise"; own.v = 0; land(air); const lx = own.x, lz = own.z;
  run(own, air, {}, 10, { landingClear: () => false });
  chk("with no clear road underneath it stops at the clearance height, says so, and goes back to flying", Math.abs(own.h - CLEARANCE_M) < 1e-6 && air.state === "cruise" && typeof air.why === "string" && /clear road/.test(air.why) && Math.abs(own.x - lx) < 1e-9);
  land(air); run(own, air, {}, 20, { landingClear: () => true });
  chk("over a clear road it lands straight down on the same spot, ends on the ground and hands back to the road physics", air.state === "ground" && own.h === 0 && own.v === 0 && Math.hypot(own.x - lx, own.z - lz) < 1e-6 && !isAirborne(air));
  const x1 = own.x, z1 = own.z; for (let i = 0; i < 120; i++) stepCar(own, { gas: 1 }, 1 / 60, null, own.P);
  chk("after landing the normal car physics drive it again", own.v > 5 && Math.hypot(own.x - x1, own.z - z1) > 3); }
{ const own = mk(), air = createAir(); takeOff(own, air); run(own, air, {}, 3); land(air); run(own, air, {}, 20, { landingClear: () => true });
  chk("a take-off can be abandoned: landing from low down returns to the ground", air.state === "ground" && own.h === 0); }
{ const a = mk(), b = mk(), A = createAir(), B = createAir(); takeOff(a, A); takeOff(b, B); run(a, A, { gas: 1 }, 20, {}, 1 / 30); run(b, B, { gas: 1 }, 20, {}, 1 / 120);
  chk("flight does not depend on the frame rate (30 and 120 fps agree to a metre)", Math.abs(a.h - b.h) < 1 && Math.abs(a.x - b.x) < 1.5 && Math.abs(a.z - b.z) < 1.5); }
console.log(bad ? `\n${bad} FAILED` : "\nall flying-car checks passed"); process.exit(bad ? 1 : 0);
