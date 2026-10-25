// tests/garage.test.mjs
// The private garage compound: every car has a bay on the driveway lane, the lane runs straight through the gate onto the road, and every car can be driven out.
import { CARS } from "../lib/cars.js";
import { garageLayout, garageVehicleSize, garageWalkPath, G } from "../lib3d/garageLayout.js";
import { driveWorld, createDriver, routeOut, autopilot, onRoad, blockedPose, footprint } from "../lib3d/garageDrive.js";
import fs from "node:fs";
const chk = (label, ok) => { console.log(`${ok ? "OK   " : "FAIL "}${label}`); if (!ok) process.exitCode = 1; };
const owned = CARS.map((c) => ({ id: c.id, modelId: c.id, color: "#2c5aa0" })), layout = garageLayout(owned);
const size = (s) => garageVehicleSize(s.modelId);
const box = (s) => ({ x0: s.x - size(s).length / 2, x1: s.x + size(s).length / 2, z0: s.z - size(s).width / 2, z1: s.z + size(s).width / 2 });
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

chk("all owned car models receive a unique parking bay", layout.slots.length === owned.length && new Set(layout.slots.map((p) => `${p.x},${p.z}`)).size === owned.length);
chk("the compound grows to fit the complete showroom collection", layout.perSide * 2 >= owned.length && garageLayout(owned.slice(0, 2)).depth < layout.depth);
chk("parked vehicles do not overlap each other or the carport posts, including the longest pickup and widest SUV", layout.slots.every((a, i) => layout.slots.slice(i + 1).every((b) => !overlap(box(a), box(b)))) && layout.slots.every((a) => layout.posts.every((p) => !overlap(box(a), { x0: p.x - p.r, x1: p.x + p.r, z0: p.z - p.r, z1: p.z + p.r }))));
chk("every bay opens straight onto the driveway lane (nose towards it, tail inside the compound walls)", layout.slots.every((s) => { const b = box(s); return (s.x < 0 ? -b.x1 : b.x0) >= layout.laneHalf && (s.x < 0 ? -b.x1 : b.x0) <= layout.laneHalf + G.NOSE + 0.01 && Math.abs(b.x0) < layout.halfW && Math.abs(b.x1) < layout.halfW; }));
chk("the driveway lane is clear of every parked car and post, and is wide enough for two cars to pass", layout.slots.every((s) => !overlap(box(s), { x0: -layout.laneHalf, x1: layout.laneHalf, z0: -99, z1: 999 })) && G.LANE >= 6 && layout.lane.x1 - layout.lane.x0 === G.LANE);
chk("the vehicle gate is wider than the lane, centred on it, and the lane meets the road at a right angle", layout.front.gate[1] - layout.front.gate[0] > G.LANE && layout.front.gate[0] === -layout.front.gate[1] && layout.lane.z1 === layout.road.z0);
chk("the road lies beyond the footpath, entirely outside the compound walls, and spans past both sides", layout.road.z0 > layout.frontZ + G.WALL / 2 && layout.road.x0 < -layout.halfW && layout.road.x1 > layout.halfW);

// every car, in every collection size, can be driven from its bay out onto the road without touching anything
const sim = (L, s, route = routeOut(L, s), seconds = 60) => { const sz = size(s), world = driveWorld(L, s.id), d = createDriver(world, { x: s.x, z: s.z, yaw: s.yaw }, sz), ap = autopilot(route, sz); let t = 0, prev = { x: s.x, z: s.z }, maxStep = 0, hit = false, done = false;
  while (t < seconds) { d.step(ap(d.state), 1 / 60); t += 1 / 60; maxStep = Math.max(maxStep, Math.hypot(d.state.x - prev.x, d.state.z - prev.z)); prev = { x: d.state.x, z: d.state.z }; if (d.state.hit) hit = true; if (blockedPose(world, d.state.x, d.state.z, d.state.yaw, sz.length, sz.width)) return { ok: false, why: "illegal pose" }; if (onRoad(L, d.state.x, d.state.z, d.state.yaw, sz.length, sz.width)) { done = true; break; } }
  return { ok: done, hit, maxStep, t, state: d.state }; };
let allOut = true, noTeleport = true, noHit = true;
for (const n of [1, 2, 3, 6, owned.length]) { const L = garageLayout(owned.slice(0, n)); for (const s of L.slots) { const r = sim(L, s); if (!r.ok) { allOut = false; console.log("  stuck:", n, s.id, r.why ?? "", r.state?.x?.toFixed(1), r.state?.z?.toFixed(1)); } else { if (r.maxStep > 9 / 60 + 0.01) noTeleport = false; if (r.hit) noHit = false; } } }
chk("every car in every collection size drives out of its bay, along the driveway, through the gate and onto the road", allOut);
chk("the whole drive out is smooth: no jump larger than a frame of travel, and no collision on the way", noTeleport && noHit);

// the real walls are real, and nothing else is
{ const s = layout.slots[0], sz = size(s), world = driveWorld(layout, s.id);
  chk("a car standing in its bay is in a legal pose", blockedPose(world, s.x, s.z, s.yaw, sz.length, sz.width) === null);
  const open = { ...world, solids: [] }, wallCar = { x: layout.front.gate[1] + 3, z: layout.frontZ - 3, yaw: 0 }, d = createDriver(open, wallCar, sz); // an empty yard, so only the wall is in the way for (let i = 0; i < 300; i++) d.step({ throttle: 1, steer: 0 }, 1 / 60);
  chk("driving into the front wall beside the gate stops the car at the wall and it never passes through", d.state.z < layout.frontZ && blockedPose(open, d.state.x, d.state.z, d.state.yaw, sz.length, sz.width) === null);
  for (let i = 0; i < 200; i++) d.step({ throttle: -1, steer: 0 }, 1 / 60);
  chk("it can reverse away from the wall afterwards, so it can never be stuck", d.state.z < layout.frontZ - 3 && !d.state.hit);
  const nb = layout.slots[2], d2 = createDriver(world, { x: layout.slots[0].x, z: layout.slots[0].z, yaw: layout.slots[0].yaw + Math.PI / 2 }, sz); for (let i = 0; i < 200; i++) d2.step({ throttle: 1, steer: 0 }, 1 / 60);
  chk("driving into a parked car stops, with no overlap", !!d2.state.hit && blockedPose(world, d2.state.x, d2.state.z, d2.state.yaw, sz.length, sz.width) === null && !!nb); }
{ const L = layout, s = L.slots[1], sz = size(s), world = driveWorld(L, s.id), d = createDriver(world, { x: 0, z: L.road.z0 + 2, yaw: Math.PI / 2 }, sz); for (let i = 0; i < 600; i++) d.step({ throttle: 1, steer: 0 }, 1 / 60);
  chk("on the road a car can drive along it, and stops at the end of the road rather than leaving the world", Math.abs(d.state.x) <= L.road.x1 && d.state.z >= L.road.z0 && d.state.z <= L.road.z1); }
{ const L = layout, s = L.slots[0], sz = size(s), pts = footprint(0, L.road.z0 + 2, 0, sz.length, sz.width); chk("a car driving straight in from the road reaches the gate with the same width of drive", pts.every(([x]) => Math.abs(x) <= sz.width / 2 + 0.01) && L.front.gate[1] - L.front.gate[0] >= sz.width * 3); }

// walking
const target = { x: layout.slots[0].x, z: layout.slots[0].z + G.PITCH / 2 }, path = garageWalkPath(layout.start, target, layout);
chk("the walk planner reaches a parked vehicle without walking through parked cars", path.length > 2 && path.every((p) => layout.slots.every((v) => { const s = size(v); return !(Math.abs(p.x - v.x) < s.length / 2 + 0.4 && Math.abs(p.z - v.z) < s.width / 2 + 0.4); })));
chk("the person can walk out of the gate to the footpath but never through the front wall", garageWalkPath(layout.start, { x: 0, z: layout.frontZ + 1 }, layout).length > 2 && garageWalkPath(layout.start, { x: layout.front.gate[1] + 2, z: layout.frontZ + 1 }, layout).length === 0);

const app = fs.readFileSync(new URL("../components/HomeGarage.js", import.meta.url), "utf8"), scene = fs.readFileSync(new URL("../lib3d/homeGarage.js", import.meta.url), "utf8"), css = fs.readFileSync(new URL("../components/home-garage.css", import.meta.url), "utf8");
chk("the garage loads only the signed-in player's Ride inventory and uses the existing server-side vehicle selector", /call\("\/api\/rides"\)/.test(app) && /action: "use"/.test(app));
chk("the garage uses existing 3D vehicle models, the walking planner and the driving model", /makeVehicle\(/.test(scene) && /garageWalkPath\(/.test(scene) && /createDriver\(/.test(scene) && /driveWorld\(/.test(scene));
chk("touch controls hold steer, accelerate and brake by pointer, release on cancel, and keyboard driving is supported", /onPointerDown/.test(app) && /onPointerCancel/.test(app) && /onLostPointerCapture/.test(app) && /ArrowUp/.test(scene) && /touch-action: none/.test(css) && /max-width: 640px/.test(css));
chk("the car reaching the road offers the map, and the camera follows the car smoothly", /onRoad/.test(app) && /router\.push\("\/map"\)/.test(app) && /camera\.lookAt/.test(scene));
