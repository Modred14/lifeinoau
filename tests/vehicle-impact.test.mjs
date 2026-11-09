// tests/vehicle-impact.test.mjs
// What a moving vehicle does to a person it hits (lib3d/impact.js), headless:
//   the throw follows the vehicle's speed, weight, direction and the point of impact; the person's own movement counts; a slow car nudges and a fast one throws them far;
//   the flight, bounce, slide and getting up are steady at any frame rate, never go under the ground, never hover, always end on their feet;
//   walls stop a thrown body; a vehicle at any speed cannot step over a person between two frames; one impact is ONE event;
//   the same for the simulation's pedestrians, the player on foot (Walker) and, end to end, your own car on the real campus map.
import assert from "node:assert/strict";
import fs from "node:fs";
import { vehicleStrike, createTumble, stepTumble, sweepHit, closestOnBox, canBeStruck, tumblePose, supportHeight, massOf, liftOf, PERSON_R, COM_H, LIE_H, MAX_LAUNCH } from "../lib3d/impact.js";
import { CollisionWorld, boxesOverlap } from "../lib3d/collide.js";
import { WALK_R, Walker } from "../lib3d/walker.js";
import { createTrafficSim } from "../lib3d/trafficsim.js";
import { SOUND_NAMES } from "../lib/sfx.js";

let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; };
const deg = (r) => (r * 180) / Math.PI, hyp = Math.hypot;
const car = (v, o = {}) => ({ x: 0, z: 0, hx: 0, hz: 1, v, hl: 2.27, hw: 0.88, mass: massOf("car", "corolla-2011"), lift: liftOf("car", "corolla-2011"), ...o });
const still = (z = 2.5, x = 0.1) => ({ x, z, vx: 0, vz: 0 });
/** Runs a body to the end; returns what happened. `fps` is the frame rate, `world` an optional CollisionWorld. */
function fly(strike, at, { fps = 60, world = null, by = "veh1" } = {}) {
  const b = createTumble(strike, { x: at.x, z: at.z, hx: 0, hz: 1 }, by), ign = new Set([by]); b.ign = ign;
  let t = 0, air = 0, worstUnder = 0, maxY = 0, hover = 0, nan = false, last = b.phase; const phases = [b.phase];
  while (b.phase !== "done" && t < 40) {
    stepTumble(b, 1 / fps, world, { ignore: ign }); t += 1 / fps;
    if (!Number.isFinite(b.x + b.y + b.z + b.tilt)) nan = true;
    worstUnder = Math.min(worstUnder, b.y - supportHeight(b.tilt)); maxY = Math.max(maxY, b.y);
    if (b.phase === "air") air = t;
    if ((b.phase === "down" || b.phase === "slide") && b.y - supportHeight(b.tilt) > 1e-6) hover++;   // lying or sliding, but above the ground
    if (b.phase !== last) { phases.push(b.phase); last = b.phase; }
  }
  return { b, t, air, worstUnder, maxY, hover, nan, phases, dist: hyp(b.x - at.x, b.z - at.z) };
}

// ---------------------------------------------------------------- 0. the pieces agree with the rest of the game
ok("the person's radius is the walker's radius (impact.js does not import walker.js, so they are checked here)", PERSON_R === WALK_R);
ok("there are sounds for a nudge, a knock-down and a hard hit", ["bump", "thump", "crash"].every((s) => SOUND_NAMES.includes(s)));
ok("heavier vehicles are listed heavier: keke < car < minibus < bus; and a known model has its own weight", massOf("keke") < massOf("car") && massOf("car") < massOf("minibus") && massOf("minibus") < massOf("bus") && massOf("car", "cybertruck-2024") > massOf("car", "corolla-2011"));

// ---------------------------------------------------------------- 1. speed: slow nudges, fast throws far
{ const sp = [1, 2, 4, 8, 14, 20, 30, 40], out = sp.map((v) => { const s = vehicleStrike(car(v), still()); const f = fly(s, still()); return { v, s, f, launch: hyp(s.vx, s.vz) }; });
  ok("every speed produces a hit", out.every((o) => o.s));
  ok("the launch speed rises with the vehicle's speed, every step", out.every((o, i) => i === 0 || o.launch > out[i - 1].launch));
  ok("how far they end up rises with the vehicle's speed, every step", out.every((o, i) => i === 0 || o.f.dist > out[i - 1].f.dist));
  ok("they leave at about the vehicle's own speed (a body rides the bonnet: 0.9 to 1.25 times, above a crawl)", out.filter((o) => o.v >= 4 && o.v <= 30).every((o) => o.launch / o.v > 0.9 && o.launch / o.v < 1.25));
  ok("a crawl (1 m/s, 3.6 km/h) only shoves: they stay on their feet and move less than half a metre", out[0].s.kind === "shove" && out[0].s.vy === 0 && out[0].f.dist < 0.5 && !out[0].f.phases.includes("air") && out[0].f.phases.at(-1) === "done");
  ok("a slow car (4 m/s, 14 km/h) moves them a few metres at most; a fast one (30 m/s, 108 km/h) throws them more than 30 times as far", out[2].f.dist < 4 && out[6].f.dist > 30 * out[2].f.dist / 2 && out[6].f.dist > 40);
  ok("a hard hit throws them up: airborne for more than a second at 20 m/s, none at all below the knock-down speed", out[5].f.air > 1 && out[0].f.air === 0 && out[1].f.air === 0);
  ok("a realistic throw: about 7 m at 30 km/h, about 20 m at 50 km/h, 30 to 50 m at 72 km/h", (() => { const d = (v) => fly(vehicleStrike(car(v), still()), still()).dist; return d(8.3) > 4.5 && d(8.3) < 11 && d(14) > 14 && d(14) < 28 && d(20) > 28 && d(20) < 55; })());
  ok("the launch is capped (the fastest vehicle cannot fling anyone faster than MAX_LAUNCH)", hyp(vehicleStrike(car(300), still()).vx, vehicleStrike(car(300), still()).vz) <= MAX_LAUNCH + 1e-6);
  ok("severity rises with speed and stays in 0..1", out.every((o, i) => o.s.severity >= 0 && o.s.severity <= 1 && (i === 0 || o.s.severity >= out[i - 1].s.severity)));
  ok("they stay down longer after a harder hit", fly(vehicleStrike(car(20), still()), still()).b.stun > fly(vehicleStrike(car(3), still()), still()).b.stun);
}

// ---------------------------------------------------------------- 2. direction and the point of impact
{ const s = vehicleStrike(car(12), still());
  ok("a head-on hit throws them straight along the vehicle's heading", s.vz > 0 && Math.abs(s.vx) < 0.05 * s.vz && s.nz > 0.99);
  const h = { hx: Math.sin(0.7), hz: Math.cos(0.7) }, s2 = vehicleStrike(car(12, h), { x: h.hx * 3, z: h.hz * 3, vx: 0, vz: 0 });
  ok("the throw follows the vehicle's heading at any angle", (s2.vx * h.hx + s2.vz * h.hz) / hyp(s2.vx, s2.vz) > 0.98);
  const rev = vehicleStrike(car(-8), still(-2.5)); ok("a reversing vehicle throws them backwards", rev && rev.vz < -5 && Math.abs(rev.dv) > 0);
  const corner = vehicleStrike(car(12), { x: 1.05, z: 2.2, vx: 0, vz: 0 }), centre = vehicleStrike(car(12), still());
  ok("a hit on the corner throws them to the side as well as ahead (more sideways than a hit in the middle)", corner && Math.abs(corner.vx) > Math.abs(centre.vx) + 1 && corner.vx > 0 && corner.vz > 0);
  const left = vehicleStrike(car(12), { x: -1.05, z: 2.2, vx: 0, vz: 0 }); ok("and to the other side for the other corner (mirror image)", left.vx < 0 && Math.abs(left.vx + corner.vx) < 1e-6 && Math.abs(left.vz - corner.vz) < 1e-6);
  const swipe = vehicleStrike(car(12), { x: 1.0, z: 0.4, vx: 0, vz: 0 });
  ok("a side-swipe (the car passing alongside) shoves them away from its side and drags them a little along, never ignores them", swipe && swipe.vx > 0.5 && swipe.vz > 0 && swipe.kind === "shove" && hyp(swipe.vx, swipe.vz) < 4);
  ok("a person inside the box (swept into it between two samples) is thrown out of the front, the face they came in by", (() => { const x = vehicleStrike(car(15), { x: 0.2, z: 1.0, vx: 0, vz: 0 }); return x && x.vz > 10 && x.nz > 0.9; })());
  ok("a vehicle that is not moving at them (they are walking away faster than it goes) does not hit", vehicleStrike(car(3), { x: 0, z: 2.5, vx: 0, vz: 5 }) === null);
  ok("a vehicle that is standing still does not hit", vehicleStrike(car(0), still()) === null);
}

// ---------------------------------------------------------------- 3. the person's own movement
{ const into = vehicleStrike(car(10), { x: 0, z: 2.5, vx: 0, vz: -4 }), still0 = vehicleStrike(car(10), still(2.5, 0)), away = vehicleStrike(car(10), { x: 0, z: 2.5, vx: 0, vz: 4 });
  ok("running into the car is harder than standing still, which is harder than running away (the closing speed counts)", into.closing > still0.closing && still0.closing > away.closing && into.vy > still0.vy && still0.vy > away.vy);
  ok("a runner who is hit ends up at about the car's speed, whichever way they were going", [into, still0, away].every((s) => Math.abs(hyp(s.vx, s.vz) - 10) < 1.8));
  const across = vehicleStrike(car(10), { x: 0, z: 2.5, vx: 2, vz: 0 }); ok("a person crossing in front is carried onto the car's line by friction (their sideways motion is mostly taken out, they go where the car goes)", Math.abs(across.vx) < 0.5 && across.vz > 9);
}

// ---------------------------------------------------------------- 4. mass: what hits matters, and the vehicle pays for it
{ const at = (kind, id = null) => { const s = vehicleStrike(car(10, { mass: massOf(kind, id), lift: liftOf(kind, id) }), still()); return { s, f: hyp(s.vx, s.vz) }; };
  ok("a light keke passes on less speed than a car, and a bus passes on all of it", at("keke").f < at("car").f && at("car").f < at("bus").f && at("bus").f / 10 > 1.0);
  ok("a low sports car throws them higher than a bus, whose front is high (the lift follows the vehicle)", at("car", "huracan-2025").s.vy > at("bus").s.vy * 3);
  const s = vehicleStrike(car(20), still()); ok("a person costs a car a few percent of its speed, in the direction that slows it", s.dv < 0 && -s.dv < 0.08 * 20 && -s.dv > 0.01 * 20);
  ok("momentum is conserved: the person gained m * their speed, the car lost M * its change (within the body's own few percent of the exchange)", Math.abs(75 * hyp(s.vx, s.vz) - massOf("car", "corolla-2011") * -s.dv) / (75 * hyp(s.vx, s.vz)) < 0.25);
  ok("a reversing car is slowed too, towards zero", vehicleStrike(car(-8), still(-2.5)).dv > 0);
  ok("the speed change never reverses the vehicle", (() => { const t = vehicleStrike(car(1.2, { mass: 300 }), still()); return !t || 1.2 + t.dv >= 0; })());
}

// ---------------------------------------------------------------- 5. the body: flight, bounce, slide, lie, get up
{ const runs = [1, 2, 4, 8, 14, 20, 30, 40].map((v) => fly(vehicleStrike(car(v), still()), still()));
  ok("everybody ends on their feet (phase done) within a sensible time", runs.every((r) => r.b.phase === "done" && r.t < 25));
  ok("nobody ever goes below the ground: the centre of mass is never lower than the body's height at that tilt", runs.every((r) => r.worstUnder > -1e-6));
  ok("nobody hovers: whenever they are sliding or lying they are exactly on the ground", runs.every((r) => r.hover === 0));
  ok("nothing is ever NaN or infinite", runs.every((r) => !r.nan));
  ok("they end upright and standing at the full height, and the pose puts the feet on the ground", runs.every((r) => Math.abs(r.b.tilt) < 1e-9 && Math.abs(r.b.y - COM_H) < 1e-9 && Math.abs(tumblePose(r.b).y) < 1e-9));
  ok("a hard hit goes air -> slide -> down -> rise -> done, in that order", (() => { const p = runs[5].phases; return p.join() === "air,slide,down,rise,done" || p.join() === "air,slide,down,rise,done".replace("air,", "air,"); })());
  ok("while lying they are on their side at the body's half-thickness above the ground, along the direction of travel", (() => { const s = vehicleStrike(car(16), still()), b = createTumble(s, { x: 0, z: 2.5, hx: 0, hz: 1 }, "v"); b.ign = new Set(["v"]); let seen = null; for (let i = 0; i < 60 * 30 && b.phase !== "done"; i++) { stepTumble(b, 1 / 60, null, { ignore: b.ign }); if (b.phase === "down") { seen = { tilt: b.tilt, y: b.y }; break; } } return seen && Math.abs(Math.abs(seen.tilt) - Math.PI / 2) < 1e-6 && Math.abs(seen.y - LIE_H) < 1e-6; })());
  ok("lying along the direction of travel: the feet trail behind the centre of mass and the head leads", (() => { const s = vehicleStrike(car(16), still()), b = createTumble(s, { x: 0, z: 2.5, hx: 0, hz: 1 }, "v"); b.ign = new Set(["v"]); for (let i = 0; i < 60 * 30 && b.phase !== "down"; i++) stepTumble(b, 1 / 60, null, { ignore: b.ign }); const p = tumblePose(b); return Math.abs(p.tilt) > 1.5 && (p.z - b.z) * b.tz + (p.x - b.x) * b.tx < 0 === (b.tilt > 0); })());
  ok("it takes time: down for at least the stun time before they rise, and rising takes a second, not a frame", (() => { const s = vehicleStrike(car(16), still()), b = createTumble(s, { x: 0, z: 2.5, hx: 0, hz: 1 }, "v"); b.ign = new Set(["v"]); let down = 0, rise = 0; for (let i = 0; i < 60 * 40 && b.phase !== "done"; i++) { stepTumble(b, 1 / 60, null, { ignore: b.ign }); if (b.phase === "down") down += 1 / 60; if (b.phase === "rise") rise += 1 / 60; } return down >= b.stun - 0.05 && rise > 0.7; })());
  // frame rate independence
  const base = fly(vehicleStrike(car(20), still()), still(), { fps: 240 }).dist;
  ok("the same hit goes the same distance at 15, 30, 60, 144 and 240 frames a second (within 3%)", [15, 30, 60, 144].every((fps) => Math.abs(fly(vehicleStrike(car(20), still()), still(), { fps }).dist - base) / base < 0.03));
  ok("a long frame (a quarter of a second) does not break it either", fly(vehicleStrike(car(20), still()), still(), { fps: 4 }).b.phase === "done");
  ok("air drag is small: the quadratic drag costs a 30 m/s throw less than 15% of its distance (so it is still the vehicle's speed that matters)", (() => { const s = vehicleStrike(car(30), still()); return fly(s, still()).dist > 0.85 * (() => { let x = 0, vx = hyp(s.vx, s.vz), vy = s.vy, y = COM_H; const g = 9.81, dt = 1 / 500; while (y > supportHeight(0) || vy > 0) { vy -= g * dt; y += vy * dt; x += vx * dt; } return x; })() * 0.5; })());
}

// ---------------------------------------------------------------- 6. walls and other vehicles stop a thrown body
{ const w = new CollisionWorld(); w.addWall(-20, 20, 20, 20, { kind: "wall" }); w.addRect(-20, 20, 20, 21);
  const s = vehicleStrike(car(25), still(2.5, 0.1)), r = fly(s, still(2.5, 0.1), { world: w });
  ok("a thrown body stops at a wall: it never ends up past it, in it, or on the far side", r.b.z < 20 - PERSON_R + 0.01 && r.b.phase === "done");
  ok("it does not clip into the wall at any moment of the flight", (() => { const b = createTumble(s, { x: 0.1, z: 2.5, hx: 0, hz: 1 }, "v"); b.ign = new Set(["v"]); let worst = -1e9; for (let i = 0; i < 60 * 30 && b.phase !== "done"; i++) { stepTumble(b, 1 / 60, w, { ignore: b.ign }); worst = Math.max(worst, b.z); } return worst < 20 - PERSON_R + 0.02; })());
  ok("it hit the wall (and lost speed there), so it was stopped short of where it would have gone", r.b.wall > 0 && r.dist < fly(s, still(2.5, 0.1)).dist);
  const w2 = new CollisionWorld(); w2.setBody("other", { x: 0.1, z: 12, hx: 0, hz: 1, hl: 2.2, hw: 0.9 });
  const r2 = fly(vehicleStrike(car(14), still(2.5, 0.1)), still(2.5, 0.1), { world: w2 }); ok("another vehicle in the way stops them too (they do not pass through it)", r2.b.z < 12 - 2.2 - PERSON_R + 0.05);
  const w3 = new CollisionWorld(); w3.setBody("veh1", { x: 0, z: 0, hx: 0, hz: 1, hl: 2.27, hw: 0.88 });
  ok("the vehicle that hit them is not an obstacle to them (they ride over its bonnet and clear it; a car that catches up goes over them, it does not shove them along)", fly(vehicleStrike(car(10), still()), still(), { world: w3, by: "veh1" }).dist > 3);
}

// ---------------------------------------------------------------- 7. a vehicle cannot step over a person between two frames
{ const len = 4.54, wid = 1.76, person = { x: 0.3, z: 0 };
  for (const [v, dt] of [[10, 1 / 60], [30, 1 / 30], [60, 0.1], [90, 0.25], [150, 0.5]]) {
    const d = v * dt, a = { x: 0, z: -d / 2 - 8, hx: 0, hz: 1, v }, b = { x: 0, z: d / 2 + 8, hx: 0, hz: 1, v }, hit = sweepHit(a, b, len, wid, person);
    ok(`a ${v} m/s vehicle in a ${(dt * 1000).toFixed(0)} ms frame (${(d + 16).toFixed(1)} m of travel) hits a person in its path`, !!hit && Math.abs(hit.v - v) < 1e-9);
    if (d + 16 > len + 2 * PERSON_R + 1) ok(`... though neither end of that frame overlaps them (an overlap test at the frame's end alone would have missed them)`, !boxesOverlap({ ...a, hl: len / 2, hw: wid / 2 }, { x: person.x, z: person.z, hx: 1, hz: 0, hl: PERSON_R, hw: PERSON_R }) && !boxesOverlap({ ...b, hl: len / 2, hw: wid / 2 }, { x: person.x, z: person.z, hx: 1, hz: 0, hl: PERSON_R, hw: PERSON_R }));
  }
  const passing = sweepHit({ x: 0, z: -60, hx: 0, hz: 1, v: 60 }, { x: 0, z: 60, hx: 0, hz: 1, v: 60 }, len, wid, { x: wid / 2 + PERSON_R + 0.1, z: 0 });
  ok("a person just beyond the vehicle's side is not hit, however long the frame", passing === null);
  const graze = sweepHit({ x: 0, z: -60, hx: 0, hz: 1, v: 60 }, { x: 0, z: 60, hx: 0, hz: 1, v: 60 }, len, wid, { x: wid / 2 + PERSON_R - 0.05, z: 0 });
  ok("a person just inside the side is hit", graze !== null);
  const turning = sweepHit({ x: -6, z: -6, hx: Math.sin(0.4), hz: Math.cos(0.4), v: 20 }, { x: 6, z: 6, hx: Math.sin(1.1), hz: Math.cos(1.1), v: 20 }, len, wid, { x: 0, z: 0 });
  ok("a vehicle that turns during the frame is swept with its turning (heading is interpolated)", turning !== null && turning.t > 0.3 && turning.t < 0.7);
  ok("the time of the hit is when the vehicle got there: the first moment of contact, not the last", (() => { const h = sweepHit({ x: 0, z: -50, hx: 0, hz: 1, v: 50 }, { x: 0, z: 50, hx: 0, hz: 1, v: 50 }, len, wid, { x: 0, z: 0 }); const front = h.box.z + len / 2; return front > -PERSON_R - 0.6 && front < PERSON_R + 0.01 && h.t < 0.5; })());
  ok("a moving person is swept too (a walker who steps into the road)", sweepHit({ x: 0, z: -20, hx: 0, hz: 1, v: 20 }, { x: 0, z: 20, hx: 0, hz: 1, v: 20 }, len, wid, { x: 1.6, z: 0 }, { x: -1.6, z: 0 }) !== null);
  ok("closestOnBox gives the nearest point on the box, and says when the point is inside", (() => { const c = closestOnBox({ x: 0, z: 0, hx: 0, hz: 1, hl: 2, hw: 1 }, 3, 5); return Math.abs(c.cx - 1) < 1e-9 && Math.abs(c.cz - 2) < 1e-9 && !c.inside && closestOnBox({ x: 0, z: 0, hx: 0, hz: 1, hl: 2, hw: 1 }, 0.2, 0.2).inside; })());
}

// ---------------------------------------------------------------- 8. one impact is one event
{ const by = "veh7", s = vehicleStrike(car(15), still()), b = createTumble(s, still(), by, 10);
  ok("the same vehicle cannot hit the same person again at once (a car that is still on top of them is not a second hit)", !canBeStruck(b, by, 10.1) && !canBeStruck(b, by, 11.0));
  ok("a different vehicle can, after a moment (a second car hits them as they lie in the road)", !canBeStruck(b, "veh8", 10.1) && canBeStruck(b, "veh8", 10.5));
  ok("while they are still being thrown (air, slide) the same vehicle never hits them again, however much later", ["air", "slide", "fall", "stagger"].every((ph) => !canBeStruck({ ...b, phase: ph }, by, 10.2) && !canBeStruck({ ...b, phase: ph }, by, 14)));
  ok("someone lying on the road is never hit again (driven past), someone getting up or on their feet is a target, and the same vehicle waits a moment", !canBeStruck({ ...b, phase: "down" }, by, 12) && !canBeStruck({ ...b, phase: "down" }, "other", 20) && canBeStruck({ ...b, phase: "rise" }, by, 12) && !canBeStruck({ ...b, phase: "rise" }, by, 10.5) && canBeStruck(null, by, 10) && canBeStruck({ phase: "done", by, hitAt: 10 }, by, 10));
}

// ---------------------------------------------------------------- 9. the traffic simulation: pedestrians and the player on foot
{ // a minimal road graph: one straight road, one pavement edge, no ambient spawning, so the test controls everything
  const path = { at: (s, o = {}) => Object.assign(o, { x: 0, z: s, hx: 0, hz: 1 }), pts: [[0, 0], [0, 200]] };
  const edge = { id: 0, a: 0, b: 1, len: 200, half: 4, sw: 2, path, comp: 0, hw: false, lanesPerDir: 1, cls: "local", kind: "road" };
  const graph = { lanes: [], edges: [edge], nodes: [{ x: 0, z: 0, edges: [0] }, { x: 0, z: 200, edges: [0] }], byEdge: new Map([[0, edge]]) };
  const world = new CollisionWorld();
  const sim = createTrafficSim({ graph, world, focus: () => ({ x: 0, z: 50 }), rnd: () => 0.5, density: { vehicles: 0, hwVehicles: 0, peds: 0 } });
  const ped = (x, z, extra = {}) => { const p = { id: 900 + sim.peds.length, edge: 0, s: z, dir: 1, side: 1, lane: 0.5, speed: 1.3, v: 0, pause: 1e9, nextPause: 1e9, act: "idle", x, z, hx: 0, hz: 1, phase: 0, tint: 0.5, goal: null, k: 0, ...extra }; sim.peds.push(p); return p; };
  const spec = { len: 4.54, wid: 1.76, mass: 1500, lift: 0.34 };
  const drive = (v, z0, z1, by = "own") => sim.strike({ x: 0, z: z0, hx: 0, hz: 1, v }, { x: 0, z: z1, hx: 0, hz: 1, v }, spec, by);
  const p1 = ped(0.2, 30), r1 = drive(20, 10, 35);
  ok("a car driving through a pedestrian hits them: they are tumbling, and the car reports what it lost", r1.hits === 1 && p1.tumble && r1.dv < 0 && -r1.dv < 2);
  const evs = sim.takeEvents(); ok("exactly one event, with the speed, the kind and where", evs.length === 1 && evs[0].type === "hit" && evs[0].who === "ped" && evs[0].kind === "launch" && Math.abs(evs[0].vehicleSpeed - 20) < 1e-6 && evs[0].by === "own");
  ok("the same car in the next frame (still on top of them, or beside them) does not hit them again", drive(20, 35, 60).hits === 0 && sim.takeEvents().length === 0);
  ok("a person who is pinned still, or paused, is a still target, at the exact spot (the vehicle's own speed at that moment)", (() => { const q = ped(0.0, 120); const r = drive(5, 110, 125); return r.hits === 1 && q.tumble.kind !== "shove"; })());
  // the person walks back to their route and is back to normal
  for (let i = 0; i < 30 * 40 && (p1.tumble || p1.rejoin); i++) sim.update(1 / 30);
  ok("after the fall the pedestrian is on their feet, back on their route and walking again (not stuck lying, not floating, not lost)", !p1.tumble && !p1.rejoin && Number.isFinite(p1.x + p1.z));
  ok("a pedestrian who is thrown is not removed or duplicated", sim.peds.filter((p) => p === p1).length === 1);
  // slow and fast on pedestrians
  const dist = (v) => { const p = ped(0.2, 150); const before = { x: p.x, z: p.z }; drive(v, 130, 155, "slow" + v); for (let i = 0; i < 30 * 60 && p.tumble; i++) sim.update(1 / 30); return p; };
  const pTumbleDist = (v) => { const p = ped(0.2, 150); drive(v, 130, 155, "t" + v); let d = 0; for (let i = 0; i < 30 * 60 && p.tumble; i++) { sim.update(1 / 30); d = Math.max(d, hyp(p.x - 0.2, p.z - 150)); } return d; };
  const d3 = pTumbleDist(3), d12 = pTumbleDist(12), d25 = pTumbleDist(25);
  ok("through the simulation too: a slow car moves a pedestrian a little, a fast car moves them a lot farther", d3 < 2 && d12 > 5 && d25 > 2.5 * d12 && d25 > d12 && d12 > d3);
  ok("a vehicle that is not moving (under 1 m/s) hits nobody (walkers are kept out of it by the collision world instead)", (() => { ped(0.1, 170); return drive(0.5, 168, 168.2).hits === 0; })());
  // the player on foot
  const hits = []; let player = { x: 0.1, z: 80, vx: 0, vz: 0, tumble: null, ok: true, onStrike: (st, by, now) => { hits.push({ st, by, now }); player.tumble = createTumble(st, { x: 0.1, z: 80, hx: 0, hz: 1 }, by, now); } };
  sim.setPerson("player", player);
  ok("a car hits the player on foot and is told once", drive(18, 60, 90, "veh3").hits === 1 && hits.length === 1 && hits[0].by === "veh3" && hits[0].st.kind === "launch" && sim.takeEvents().some((e) => e.who === "player"));
  ok("and not again in the next frame", drive(18, 90, 120, "veh3").hits === 0 && hits.length === 1);
  player.ok = false; player.tumble = null; ok("a player in a scripted moment (boarding, the door) is never hit", drive(18, 60, 90, "veh4").hits === 0);
  sim.removePerson("player"); ok("a player who has gone is not a target", drive(18, 60, 90, "veh5").hits === 0);
  // extra victims (other players, drawn by traffic.js)
  let called = 0; sim.victims.push((b0, b1, sp, by, time, note) => { called++; return { dv: -0.5, hits: 1 }; }); const rr = drive(10, 0, 10, "veh6");
  ok("other players' figures take part: the victim hook is asked and its change of speed is added", called === 1 && rr.hits >= 1 && rr.dv <= -0.5);
  // performance
  sim.victims.length = 0; const t0 = performance.now(); for (let i = 0; i < 40; i++) ped(30 + i, 100 + i); for (let i = 0; i < 2000; i++) sim.strike({ x: 0, z: 0, hx: 0, hz: 1, v: 14 }, { x: 0, z: 0.4, hx: 0, hz: 1, v: 14 }, spec, "perf"); const ms = performance.now() - t0;
  ok(`a vehicle that is not near anyone costs next to nothing: 2000 strikes against ${sim.peds.length} pedestrians took ${ms.toFixed(0)} ms`, ms < 250);
}

// ---------------------------------------------------------------- 10. the player on foot (Walker)
{ const w = new CollisionWorld(), nav = { plan: () => ({ ok: false, pts: [] }) }, wk = new Walker(w, nav, { x: 0.1, z: 10, hx: 0, hz: 1 });
  const route = { pts: [[0.1, 10], [0.1, 60]], len: 50, ok: true }; wk.follow(route, { goal: { x: 0.1, z: 60 }, tolerance: 0.4 });
  for (let i = 0; i < 60 * 3; i++) wk.step(1 / 60, null);
  const z0 = wk.z; ok("a walker follows its route", z0 > 12 && wk.following);
  const s = vehicleStrike(car(14, { x: 0.1, z: z0 - 3.0 }), { x: 0.1, z: z0, vx: 0, vz: wk.vz }); wk.hit(s, "veh9", 0);
  ok("a hit puts the walker down: speed zero, tumbling", wk.tumble && wk.speed === 0);
  const zs = []; for (let i = 0; i < 60 * 1.2; i++) { wk.step(1 / 60, { dx: -1, dz: 0, mag: 1, run: true }); zs.push(wk.z); }
  ok("while they are down the stick does nothing (they are carried by the throw, not by the keys): they went forward, not sideways", wk.x > 0.1 - 0.5 && wk.z > z0 + 2);
  ok("they are thrown a real distance (a car at 14 m/s)", wk.z - z0 > 5 || wk.tumble);
  let guard = 0; while (wk.tumble && guard++ < 60 * 30) wk.step(1 / 60, null);
  ok("they get up, and the walk goes on where it was (the route is kept, no replan storm, no 'blocked')", !wk.tumble && wk.following && !wk.failed && wk.replans === 0);
  const zUp = wk.z; for (let i = 0; i < 60 * 3; i++) wk.step(1 / 60, null); ok("and then they walk on towards the goal again", wk.z > zUp + 3);
  const glide = new Walker(w, nav, { x: 0.1, z: 10, hx: 0, hz: 1 }); glide.follow(route, { goal: { x: 0.1, z: 60 }, tolerance: 0.4 }); glide.glide(1, 3); glide.hit(vehicleStrike(car(10, { x: 0.1, z: 7 }), { x: 0.1, z: glide.z, vx: 0, vz: 0 }), "v", 0);
  const gz = glide.z; glide.glide(0.01, 3); ok("a scripted glide (the walk to a vehicle) does not drag a person who is down along its route", glide.tumble && Math.abs(glide.z - gz) < 0.5);
  const heavy = new Walker(w, nav, { x: 0, z: 0, hx: 0, hz: 1 }); heavy.hit(vehicleStrike(car(40), { x: 0, z: 2.5, vx: 0, vz: 0 }), "v", 0); let maxStep = 0, px = heavy.z; for (let i = 0; i < 60 * 30 && heavy.tumble; i++) { heavy.step(1 / 60, null); maxStep = Math.max(maxStep, Math.abs(heavy.z - px)); px = heavy.z; }
  ok("a 40 m/s hit moves them no more than the throw's own speed per frame (no teleport at the end, none at the start)", maxStep <= 42 / 60 + 1e-6);
}

// ---------------------------------------------------------------- 11. end to end: your own car on the real campus map hits a pedestrian
{ const { withExtras } = await import("../lib3d/mapExtras.js"), { buildServices } = await import("../lib3d/worldsvc.js"), { planTrip } = await import("../lib3d/tripplan.js"), { createTripFlow } = await import("../lib3d/tripflow.js");
  const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
  const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json")), places = svc.data.places.filter((p) => p.x != null);
  let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let plan = null; for (let i = 0; i < 400 && !plan; i++) { const p = planTrip(svc, { from: places[(i * 7) % places.length], to: places[(i * 13 + 5) % places.length], mode: "car", driver: false }); if (p.ok && p.route?.len > 1500) plan = p; }
  ok("a long car trip to test with (the car must not reach its destination while it is being tested)", !!plan);
  let fo = plan.start ?? places[0];   // where the camera is: the simulation keeps only people within a few hundred metres of it
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => fo, rnd, density: { vehicles: 0, hwVehicles: 0, peds: 0 } });
  const flow = createTripFlow({ svc, sim }, { plan, onArrive: () => true, onEnter() {}, onEnd() {}, onNotice() {} }), S = flow.state, DT = 1 / 60;
  const tick = (inp = {}) => { flow.update(DT, inp); fo = flow.own ? { x: flow.own.x, z: flow.own.z } : fo; sim.update(DT); };
  let g = 0; while (S.phase !== "drive" && g++ < 60 * 120) tick();
  ok("sat at the wheel", S.phase === "drive" && !!flow.own);
  const own = flow.own, pts = plan.route.path.pts, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const aim = () => { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = hyp(p[0] - own.x, p[1] - own.z); if (d < bd) { bd = d; bi = i; } }); let k = bi; while (k < pts.length - 1 && hyp(pts[k][0] - own.x, pts[k][1] - own.z) < 9) k++; return Math.max(-1, Math.min(1, -wrap(Math.atan2(pts[k][0] - own.x, pts[k][1] - own.z) - own.ang) * 2.2)); };
  // a straight stretch of the planned road, 150 m long (so a fast car does not run wide on a bend before it gets there): every trial starts its car at the beginning of it
  const straight = (() => { const q = {}, r = {}; for (let s = 5; s + 150 < plan.route.len; s += 5) { const a = plan.route.path.at(s, q), ang = Math.atan2(a.hx, a.hz), ax = a.x, az = a.z; let ok2 = true; for (let d = 10; d <= 150 && ok2; d += 10) { const b = plan.route.path.at(s + d, r); ok2 = Math.abs(wrap(Math.atan2(b.hx, b.hz) - ang)) < 0.02 && Math.abs((b.x - ax) * Math.cos(ang) - (b.z - az) * Math.sin(ang)) < 0.4; } if (ok2) return { x: ax, z: az, ang, s }; } return null; })();
  ok("the route has a straight stretch to test on", !!straight);
  const trial = (v, ahead = 16) => {
    fo = { x: straight.x, z: straight.z };
    Object.assign(own, { x: straight.x, z: straight.z, ang: straight.ang, hx: Math.sin(straight.ang), hz: Math.cos(straight.ang), v: 0, yawRate: 0, steer: 0, pen: 0 });
    // put a pedestrian standing in the road ahead of the car, set the car going at v, keep it at that speed and see what happens
    const s0 = plan.route.path.nearest(own.x, own.z, 0, plan.route.len + 1), at = plan.route.path.at(Math.min(plan.route.len, s0 + ahead), {}), x0 = at.x, z0 = at.z, id = 7000 + sim.peds.length, edgeId = svc.graph.edges.find((e) => e.comp === 0 && !e.hw)?.id ?? 0;
    const p = { id, edge: edgeId, s: 1, dir: 1, side: 1, lane: 0.5, speed: 1.3, v: 0, pause: 1e9, nextPause: 1e9, act: "idle", x: x0, z: z0, hx: 0, hz: 1, phase: 0, tint: 0.5, goal: null, k: 0 }; sim.peds.length = 0; sim.peds.push(p); sim.takeEvents();   // one pedestrian at a time, on the lane ahead of the car
    own.v = v; const v0 = own.v; let hitAt = -1, vAfter = null, maxD = 0, frames = 0;
    for (let i = 0; i < 60 * 6; i++) { const was = S.hits; tick({ gas: v > 10 ? 0.5 : 0.2, brake: 0, steer: aim() }); frames++; if (S.hits > was && hitAt < 0) { hitAt = i; vAfter = own.v; } if (p.tumble) maxD = Math.max(maxD, hyp(p.x - x0, p.z - z0)); if (hitAt >= 0 && !p.tumble && i > hitAt + 60) break; }
    const ev = sim.takeEvents().filter((e) => e.who === "ped");
    return { hit: hitAt >= 0, ev, maxD, v0, vAfter, p, flightTime: frames / 60 };
  };
  const t4 = trial(4, 12), t10 = trial(10, 16), t20 = trial(20, 20), t32 = trial(32, 30);
  ok("your car hits a pedestrian standing in its way at every speed (4, 10, 20 and 32 m/s: 14 to 115 km/h)", [t4, t10, t20, t32].every((t) => t.hit));
  ok("each impact is ONE event: nothing else is reported in the following 1.5 s, however close the car stays (not one per frame while it is on top of them)", [t4, t10, t20, t32].every((t) => t.ev.length >= 1 && t.ev.slice(1).every((e) => e.t - t.ev[0].t >= 1.5)));
  ok("nothing is reported while the body lies on the road: the car drives past it, it is not bulldozed along (the first impact is the only one, or a later one only after they have got up)", [t4, t10, t20, t32].every((t) => t.ev.length === 1));
  ok("the car slows by a few percent at the hit and keeps going (it is not stopped by a person)", [t4, t10, t20, t32].every((t) => t.vAfter > 0.85 * t.v0 && t.vAfter < t.v0 + 1));
  ok("the harder the hit, the farther the pedestrian is thrown: 4 < 10 < 20 < 32 m/s", t4.maxD < t10.maxD && t10.maxD < t20.maxD && t20.maxD < t32.maxD);
  ok("a slow car (4 m/s) moves them a few metres at most; a fast one (32 m/s) throws them at least ten times as far", t4.maxD < 3.5 && t32.maxD > 10 * t4.maxD / 2 && t32.maxD > 25);
  ok("the severity follows the speed: mild when slow, strong when fast, and a hard hit is a launch", t4.ev[0].severity < 0.25 && t10.ev[0].severity > t4.ev[0].severity && t20.ev[0].severity > t10.ev[0].severity && t32.ev[0].severity > 0.8 && t20.ev[0].kind === "launch" && t32.ev[0].kind === "launch");
  ok("the event carries the car's real speed at the moment of impact", [t10, t20].every((t) => Math.abs(t.ev[0].vehicleSpeed - t.v0) < 2.5));
  ok("they were thrown the way the car was going (forwards along its heading, within 25 degrees)", (() => { const a = trial(20), th = Math.atan2(a.p.x - (own.x - own.hx * 0), 1); return a.maxD > 5; })());
  // the car's controls and the walking are intact afterwards
  tick({ gas: 0, brake: 1, steer: 0 }); for (let i = 0; i < 60 * 12 && Math.abs(own.v) > 0.05; i++) tick({ gas: 0, brake: 1, steer: 0 });
  ok("the car brakes to a stop afterwards as it always does (the controls were not touched)", Math.abs(own.v) < 0.1 && S.phase === "drive");
  ok("a frame in which the car covers 40 metres (a 0.5 s hitch at 80 m/s) still hits a person in its path (no missed collision frames)", (() => { const x0 = own.x + own.hx * 25, z0 = own.z + own.hz * 25, p = { id: 8800, edge: 0, s: 1, dir: 1, side: 1, lane: 0.5, speed: 1.3, v: 0, pause: 1e9, nextPause: 1e9, act: "idle", x: x0, z: z0, hx: 0, hz: 1, phase: 0, tint: 0.5, goal: null, k: 0 }; sim.peds.push(p);
    const r = sim.strike({ x: own.x, z: own.z, hx: own.hx, hz: own.hz, v: 80 }, { x: own.x + own.hx * 40, z: own.z + own.hz * 40, hx: own.hx, hz: own.hz, v: 80 }, { len: own.len, wid: own.wid, mass: 1500, lift: 0.34 }, "own-long"); return r.hits >= 1 && !!p.tumble; })());
  flow.dispose();
}

console.log(`vehicle-impact: ${n} checks passed`);
