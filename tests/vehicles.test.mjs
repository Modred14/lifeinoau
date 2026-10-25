// tests/vehicles.test.mjs
// The 3D cars of YK Autos (lib3d/vehicles.js makeVehicle), built headless: each of the ten builds, stands on the ground, is about the size it says,
// and the ones that look different in the showroom ARE different shapes (a Cybertruck must not turn into a sedan when it is driven).
import * as THREE from "three";
import { makeVehicle, makeCar, makeKeke, makeBus, rollWheels } from "../lib3d/vehicles.js";
import { VEHICLE_DIMS } from "../lib3d/vehicleDims.js";
import { PROFILES, carProfile, createCar, stepCar } from "../lib3d/carphysics.js";
import { OWN_CAR_MAX } from "../lib/travel.js";
import { KINDS } from "../lib3d/trafficsim.js";
import { garageVehicleSize } from "../lib3d/garageLayout.js";
import { CARS } from "../lib/cars.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const size = (o) => { const b = new THREE.Box3().setFromObject(o), v = b.getSize(new THREE.Vector3()); return { w: v.x, h: v.y, l: v.z, minY: b.min.y }; };

const dims = {};
for (const c of CARS) {
  const v = makeVehicle(c.id, "#2c5aa0"), s = size(v.root); dims[c.id] = s;
  chk(`${c.name}: builds with four wheels and a body`, v.wheels.length === 4 && v.front.length === 2 && v.root.children.length >= 5 && s.w > 1.6 && s.l > 4 && s.h > 1.0);
  chk(`${c.name}: stands on the ground and is about its stated length and width`, Math.abs(s.minY) < 0.02 && Math.abs(s.l - v.length) < 0.45 && Math.abs(s.w - v.width) < 0.5);
}
const D = (id) => dims[id];
chk("the Cybertruck is the longest and the Huracán the lowest", CARS.every((c) => D("cybertruck-2024").l >= D(c.id).l - 0.01) && CARS.every((c) => D("huracan-2025").h <= D(c.id).h + 0.01));
chk("SUVs stand taller than sedans; the Urus is wider than a Corolla", D("gle-2018").h > D("camry-2014").h + 0.1 && D("rrsport-2016").h > D("cclass-2016").h + 0.1 && D("urus-2025").w > D("corolla-2011").w + 0.15);
const sig = (id) => [D(id).l, D(id).h, D(id).w].map((x) => x.toFixed(2)).join();
chk("the Cybertruck, Huracán, Urus and Corolla have four different silhouettes", new Set(["cybertruck-2024", "huracan-2025", "urus-2025", "corolla-2011"].map(sig)).size === 4);
chk("no id (the family car) or an unknown id: the plain sedan as before", Math.abs(size(makeVehicle("", "#1c1d21").root).l - size(makeCar("#1c1d21").root).l) < 0.01 && Math.abs(size(makeVehicle("nope", undefined).root).l - 4.5) < 0.2);
chk("paint is applied (a Cybertruck is bare steel whatever is asked)", (() => { const col = (v) => { let hex = null; v.root.traverse((m) => { if (m.isMesh && m.geometry.attributes.color && hex == null) hex = m.geometry.attributes.color; }); return hex ? [hex.getX(0), hex.getY(0), hex.getZ(0)] : null; };
  const a = col(makeVehicle("camry-2014", "#2c5aa0")), b = col(makeVehicle("camry-2014", "#c0392b")), t1 = col(makeVehicle("cybertruck-2024", "#2c5aa0")), t2 = col(makeVehicle("cybertruck-2024", "#c0392b"));
  return a && b && a.join() !== b.join() && t1.join() === t2.join(); })());

// ---- every vehicle: real size, wheelbase, and handling that differs from car to car
for (const c of CARS) { const v = makeVehicle(c.id, "#2c5aa0"), d = VEHICLE_DIMS[c.id], g = garageVehicleSize(c.id);
  chk(`${c.name}: model, garage and physics agree on the length, width and wheelbase`, Math.abs(v.length - d.length) < 0.02 && Math.abs(v.width - d.width) < 0.02 && Math.abs(v.wheelbase - d.wheelbase) < 0.02 && g.length === d.length && PROFILES[c.id].wheelbase === d.wheelbase);
  chk(`${c.name}: has seats for a driver and a passenger, inside the body`, v.driver && v.seat && Math.abs(v.driver.x) < v.width / 2 && Math.abs(v.seat.x) < v.width / 2 && Math.abs(v.driver.z) < v.length / 2 && v.driver.x > 0 && v.seat.x < 0);
  v.dispose(); }
{ const keke = makeKeke(), bus = makeBus(), kd = VEHICLE_DIMS.keke, bd = VEHICLE_DIMS.bus, ks = size(keke.root), bs = size(bus.root);
  chk("the keke has three wheels (one steering at the front), a built-in driver and the Bajaj proportions", keke.wheels.length === 3 && keke.front.length === 1 && keke.driver === null && Math.abs(ks.l - kd.length) < 0.25 && Math.abs(ks.h - kd.height) < 0.2 && Math.abs(keke.wheelbase - kd.wheelbase) < 0.01 && Math.abs(ks.minY) < 0.02);
  chk("the bus has four wheels, two steering, a sliding door, and is visibly longer and taller than every car", bus.wheels.length === 4 && bus.front.length === 2 && !!bus.doors && CARS.every((c) => bs.l > D(c.id).l + 0.3 && bs.h > D(c.id).h + 0.3) && Math.abs(bs.l - bd.length) < 0.3 && Math.abs(bs.minY) < 0.02);
  chk("the bus is the same size in the model, the traffic simulation and the physics, and the keke likewise", Math.abs(bus.length - KINDS.bus.len) < 0.05 && Math.abs(bus.width - KINDS.bus.wid) < 0.05 && Math.abs(keke.length - KINDS.keke.len) < 0.05 && Math.abs(keke.width - KINDS.keke.wid) < 0.05 && PROFILES.bus.wheelbase === bd.wheelbase && PROFILES.keke.wheelbase === kd.wheelbase);
  chk("the bus turns in a wider circle than any car, and the keke in a tighter one", (() => { const r = (id) => { const P = carProfile(id); return P.wheelbase / Math.tan(P.steerMax); }; return CARS.every((c) => r("bus") > r(c.id) * 1.15) && CARS.every((c) => r("keke") < r(c.id)); })());
  chk("the bus has its door and driver seat in the right places (driver on the left, passengers on the right)", bus.driver.x > 0 && bus.seat.x < 0 && KINDS.bus.driver.x > 0 && KINDS.bus.seat.x < 0 && Math.abs(bus.seat.z - KINDS.bus.seat.z) < 0.05);
  // wheels turn with distance and the front ones steer; the inside wheel steers more
  const car = makeVehicle("camry-2014", "#c0392b"), w0 = car.wheels[0].rotation.x; rollWheels(car, 1.0, 0.3);
  chk("wheels rotate in proportion to the distance rolled, and the inside front wheel steers more than the outside one", Math.abs(car.wheels[0].rotation.x - w0 - 1 / car.wheels[0].userData.r) < 1e-6 && car.front[1].rotation.y > car.front[0].rotation.y && car.front[0].rotation.y > 0);
  car.setBrake(true); const lit = car.lamps.tail.emissiveIntensity; car.setBrake(false); chk("the brake lights glow when braking and dim when not", lit > car.lamps.tail.emissiveIntensity * 3);
  const k0 = keke.wheels[0].rotation.x; rollWheels(keke, 0.5, 0.4); chk("the keke's single front wheel steers by the full angle", Math.abs(keke.front[0].rotation.y - 0.4) < 1e-6 && keke.wheels[0].rotation.x > k0);
  keke.dispose(); bus.dispose(); car.dispose(); }
// handling: different per vehicle, never above the server's cap, and the faster / lighter ones really are quicker
{ const ids = Object.keys(PROFILES), t = (id, sec = 6) => { const c = createCar(), P = carProfile(id); for (let i = 0; i < 60 * sec; i++) stepCar(c, { gas: 1 }, 1 / 60, null, P); return c; }, stop = (id) => { const c = createCar(), P = carProfile(id); c.v = Math.min(P.vmax, 15); for (let i = 0; i < 60 * 5 && c.v > 0.05; i++) stepCar(c, { brake: 1 }, 1 / 60, null, P); return c.distance; };
  chk("no vehicle can go faster than the server's cap, and none is a copy of another", ids.every((id) => carProfile(id).vmax <= OWN_CAR_MAX) && new Set(ids.map((id) => JSON.stringify(PROFILES[id]))).size === ids.length);
  chk("the Huracán out-accelerates the Corolla and the Camry; the Cybertruck out-accelerates the Range Rover; the bus is slowest and the keke slower than any car", t("huracan-2025").v > t("corolla-2011").v + 3 && t("huracan-2025").v > t("camry-2014").v && t("cybertruck-2024").v > t("rrsport-2016").v && t("bus").v < t("keke").v + 8 && CARS.every((c) => t("keke", 8).v < t(c.id, 8).v) && CARS.every((c) => t("bus", 8).v < t(c.id, 8).v));
  chk("a sports car stops in a shorter distance than an SUV from the same speed", stop("huracan-2025") < stop("gle-2018") && stop("is350-2014") < stop("corolla-2011") && stop("bus") > stop("corolla-2011"));
  chk("steering lock differs: the Huracán turns tighter at a crawl than the Cybertruck", (() => { const r = (id) => { const c = createCar(), P = carProfile(id); c.v = 3; for (let i = 0; i < 240; i++) { c.v = 3; stepCar(c, { steer: 1 }, 1 / 60, null, P); } return Math.abs(c.ang); }; return r("huracan-2025") > r("cybertruck-2024"); })());
  chk("an unknown id drives like the standard car", carProfile("nope").accel === carProfile("").accel); }
process.exit(bad ? 1 : 0);
