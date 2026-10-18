// tests/vehicles.test.mjs
// The 3D cars of YK Autos (lib3d/vehicles.js makeVehicle), built headless: each of the ten builds, stands on the ground, is about the size it says,
// and the ones that look different in the showroom ARE different shapes (a Cybertruck must not turn into a sedan when it is driven).
import * as THREE from "three";
import { makeVehicle, makeCar } from "../lib3d/vehicles.js";
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
process.exit(bad ? 1 : 0);
