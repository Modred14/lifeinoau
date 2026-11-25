// tests/car-parking.test.mjs
// Saved parking: where each owned car was left in the home compound. (1) the planner keeps a valid saved pose and ignores an invalid one (a changed room, a wall, another car, off the plot,
// no way out) by parking automatically; (2) the server rule (parkCarInTx) accepts only places a car can really stand, per car, never overlaps, and can forget a place; (3) the migration
// and the schema agree; (4) the screens read it (home fleet and map site) and write it when a car is parked.
import fs from "node:fs";
import { makeDb } from "./fakedb.mjs";
import { roomFor } from "../lib/room.js";
import { CARS } from "../lib/cars.js";
import { planParking, validParkedPose, cleanParkPose, lotSignature, compoundWorld, poseBox, vehicleCells, exitRoute } from "../lib3d/compoundParking.js";
import { parkCarInTx, savedOf } from "../lib/carService.js";
import { plotFor } from "../lib/plot.js";
let bad = 0; const chk = (l, c, x = "") => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && x ? `: ${x}` : "")); };
const ids = ["corolla-2011", "accord-2014", "camry-2014", "civic-2012"].filter((id) => CARS.some((c) => c.id === id));
const cars = (n, saved = {}) => ids.slice(0, n).map((id) => ({ id, modelId: id, color: "#2c5aa0", saved: saved[id] ?? null }));
const same = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-6 && Math.abs(a.yaw - b.yaw) < 1e-6;

for (const hostel of ["Awo", "Ojaja", "Off-campus", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"]) {
  const room = roomFor(hostel, "p"), tag = hostel.padEnd(16), lot = lotSignature(room), cw = compoundWorld(room, []), P = plotFor(room);
  const auto = planParking(room, cars(3), []);
  // a spot on the lawn that is free: find one the same way the rules do, by asking them
  const v = cars(3)[0], pick = (slots) => { for (let z = cw.lawn.z0 + 2; z < cw.lawn.z1 - 2; z += 0.5) for (let x = cw.lawn.x0 + 2; x < cw.lawn.x1 - 2; x += 0.5) for (const yaw of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) if (validParkedPose(cw, room, slots, v, { x, z, yaw })) return { x, z, yaw }; return null; };
  const spot = pick(auto.slots.filter((s) => s.id !== v.id).map((s) => ({ ...s })));
  if (!spot) { chk(`${tag} (the lawn is full: nothing to save, automatic parking stays)`, true); continue; }
  const withSaved = planParking(room, cars(3, { [v.id]: { ...spot, lot } }), []), s0 = withSaved.slots.find((s) => s.id === v.id);
  chk(`${tag} a valid saved pose is kept exactly, flagged fixed, and every car is still placed`, !!s0?.fixed && same(s0, cleanParkPose(spot)) && withSaved.unplaced.length === 0 && withSaved.slots.length === 3, JSON.stringify(s0));
  chk(`${tag} nobody overlaps the saved car and every car still has a way out`, (() => { const b = withSaved.slots.map((s) => poseBox(s.x, s.z, s.yaw, s.len, s.wid)); return b.every((x, i) => b.every((y, j) => i === j || !(x.x0 < y.x1 - 1e-6 && x.x1 > y.x0 + 1e-6 && x.z0 < y.z1 - 1e-6 && x.z1 > y.z0 + 1e-6))) && withSaved.slots.every((s) => exitRoute(withSaved.cw, withSaved.slots, s)); })());
  chk(`${tag} planning is deterministic with a saved pose`, JSON.stringify(withSaved.slots.map((s) => [s.id, s.x, s.z, s.yaw])) === JSON.stringify(planParking(room, cars(3, { [v.id]: { ...spot, lot } }), []).slots.map((s) => [s.id, s.x, s.z, s.yaw])));
  // invalid: a pose made for another room, inside the house, off the plot, on another saved car, not numbers
  const bads = { "for another room": { ...spot, lot: lot + "x" }, "inside the house": { x: room.w / 2, z: room.d / 2, yaw: 0, lot }, "off the plot": { x: P.plot.x0 - 6, z: P.plot.z0 - 6, yaw: 0, lot }, "not numbers": { x: "a", z: NaN, yaw: 0, lot } };
  for (const [why, sv] of Object.entries(bads)) { const r = planParking(room, cars(3, { [v.id]: sv }), []), s = r.slots.find((x) => x.id === v.id); chk(`${tag} a saved pose ${why} is ignored: parked automatically, not fixed, same as no saved pose`, !!s && !s.fixed && r.slots.length === 3 && same(s, auto.slots.find((x) => x.id === v.id)), JSON.stringify(s)); }
  const two = planParking(room, cars(2, { [ids[0]]: { ...spot, lot }, [ids[1]]: { ...spot, lot } }), []);
  chk(`${tag} two cars saved at the same place: the first keeps it, the second is parked elsewhere`, two.slots.filter((s) => s.fixed).length === 1 && two.slots.length === 2);

  // the server rule, over the in-memory database
  const db = makeDb(["ownedCar"], { unique: { ownedCar: ["characterId", "modelId"] } });
  await db.$transaction(async (tx) => { for (const id of ids.slice(0, 3)) await tx.ownedCar.create({ data: { characterId: "c1", modelId: id, color: "#2c5aa0", pricePaid: 1n, parked: false } }); });
  const park = (modelId, pose) => db.$transaction((tx) => parkCarInTx(tx, { id: "c1" }, { modelId, pose }, { room, items: [] })).then((r) => r, (e) => ({ err: e.message, status: e.status }));
  const ok = await park(v.id, { x: spot.x, z: spot.z, yaw: spot.yaw });
  chk(`${tag} the server saves a valid place (rounded), flags the car parked and keeps the lot signature`, ok.ok && ok.park.lot === lot && same(ok.park, cleanParkPose(spot)), JSON.stringify(ok));
  const row = await db.ownedCar.findFirst({ where: { characterId: "c1", modelId: v.id } });
  chk(`${tag} the row holds exactly the pose and the all-or-nothing columns`, row.parked === true && row.parkLot === lot && savedOf(row) && same(savedOf(row), cleanParkPose(spot)));
  chk(`${tag} a place inside the house is refused (422) and the saved one is untouched`, (await park(ids[1], { x: room.w / 2, z: room.d / 2, yaw: 0 })).status === 422 && same(savedOf(await db.ownedCar.findFirst({ where: { characterId: "c1", modelId: v.id } })), cleanParkPose(spot)));
  chk(`${tag} a second car cannot be left on top of the first`, (await park(ids[1], { x: spot.x, z: spot.z, yaw: spot.yaw })).status === 422);
  chk(`${tag} a place off the plot, junk and a car you do not own are refused`, (await park(ids[1], { x: 9999, z: 0, yaw: 0 })).status === 422 || (await park(ids[1], { x: 9999, z: 0, yaw: 0 })).status === 400);
  chk(`${tag} (junk numbers 400, a car you do not own 403, no model 400)`, (await park(ids[1], { x: "1", z: 2, yaw: 3 })).status === 400 && (await park("huracan-2025", spot)).status === 403 && (await park("", spot)).status === 400);
  const gone = await park(v.id, null), r2 = await db.ownedCar.findFirst({ where: { characterId: "c1", modelId: v.id } });
  chk(`${tag} pose null forgets the place (all columns cleared, parked false): automatic parking again`, gone.ok && gone.park === null && r2.parked === false && r2.parkX == null && r2.parkLot == null && savedOf(r2) === null);
}

// the migration and the schema agree
const sql = fs.readFileSync(new URL("../prisma/migrations/20261124120000_owned_car_parking/migration.sql", import.meta.url), "utf8"), schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const model = schema.slice(schema.indexOf("model OwnedCar"), schema.indexOf("}", schema.indexOf("model OwnedCar")));
for (const [col, type] of [["parked", "BOOLEAN NOT NULL DEFAULT false"], ["parkX", "DOUBLE PRECISION"], ["parkZ", "DOUBLE PRECISION"], ["parkYaw", "DOUBLE PRECISION"], ["parkLot", "TEXT"], ["parkedAt", "TIMESTAMP(3)"]]) chk(`the migration adds "${col}" ${type}, and the schema has it`, sql.includes(`ADD COLUMN "${col}"`) && new RegExp(`ADD COLUMN "${col}"\\s+${type.replace(/[()]/g, "\\$&")}`).test(sql) && new RegExp(`\\b${col}\\b`).test(model));
chk("the migration only adds nullable or defaulted columns (nothing existing breaks) and drops nothing", !/DROP |NOT NULL(?! DEFAULT)/.test(sql.replace(/CHECK[\s\S]*$/, "")) && !/ALTER COLUMN/.test(sql));
const dirs = fs.readdirSync(new URL("../prisma/migrations", import.meta.url)).filter((d) => /^\d{14}_/.test(d)).sort();
chk("the migration applies after the migration before it and is not the first (later migrations may follow)", dirs.includes("20261124120000_owned_car_parking") && dirs.indexOf("20261124120000_owned_car_parking") === dirs.indexOf("20261121120000_club_dance") + 1);

// the screens read and write it
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
chk("GET /api/rides returns each car's saved place and POST /api/rides has the park action", /park: o\.parked/.test(read("lib/carService.js")) && /action === "park"/.test(read("src/app/api/rides/route.js")));
chk("the home screen's vehicle list and the map's home option both carry the saved place", /saved: o\.park/.test(read("components/CompoundDrive.js")) && /saved: o\.park/.test(read("lib/homeOption.js")));
chk("parking on the home screen writes it (api/rides park) and the fleet parks where the car was left", /action: "park"/.test(read("components/CompoundDrive.js")) && /parkCandidate/.test(read("lib3d/compoundFleet.js")));
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
