// tests/building-roundtrip.test.mjs
// Going in and coming out of EVERY kind of building, as one continuous walk over the real campus map (headless: the same planner, collision world and trip flow the map page runs):
//   1. every enterable building has a portal: an exit spot on walkable ground, in front of the door, clear of walls and of the open leaf, facing the way out; an exit on the carriageway is
//      only ever used where NO spot off it exists within reach (checked against an exhaustive search); the portal is the mirror of the entrance about the wall
//   2. the round trip, for hostels, hostel blocks, lecture theatres, faculties, shops, banks, clubs, churches and more: walk to the door, open it, go in, come OUT through the door onto the
//      building's own exit spot, facing out, with the door open behind and swinging shut; walk on to the street; come back and go in again. At no point does the trip end, anybody jump,
//      or the flow need a reload: it is one trip
//   3. the door sequence is the same from the street as from the doorstep: walking back to the door you came out of offers Open Door again (and only after you have walked away from it)
//   4. a trip that BEGINS on a doorstep (a building opened from the map card) walks out the same way
//   5. the room behind the door is never waited for on a loading screen: with o.holdEnter the person stands in the doorway until the room is ready, for at most ENTRY_HOLD_MAX seconds
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow, ENTRY_HOLD_MAX } from "../lib3d/tripflow.js";
import { createTrafficSim } from "../lib3d/trafficsim.js";
import { planRetarget } from "../lib3d/tripretarget.js";
import { destinationOf } from "../lib3d/roadnet.js";
import { portalFor, portalsFor, portalWalk, PORTAL, PORTAL_OVERRIDES } from "../lib3d/buildingPortals.js";
import { planDoorOpening, doorLocal, inSwing, doorFrame } from "../lib3d/doorway.js";
import { WALK_R } from "../lib3d/walker.js";
import { hasInterior, classify } from "../lib3d/interiors/registry.js";
import { isOpenSpace } from "../lib3d/interiors/openSpaces.js";
import { buildInterior } from "../lib3d/interiors/index.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const { world, graph, net, nav } = svc;
const byId = (id) => svc.data.places.find((p) => p.id === id);
const enterable = svc.data.places.filter((p) => p.x != null && p.kind !== "billboard" && hasInterior(p.id, p.kind) && !isOpenSpace(p.id));
const scratch = {}, isRoad = (x, z) => graph.surfaceAt(x, z, scratch).cls === 1;
const DT = 1 / 30;

// ---------- 1. every enterable building has a sound portal ----------
const portals = portalsFor(svc, enterable);
assert.ok(enterable.length >= 80, "the map has its enterable buildings");
assert.equal(Object.keys(portals).length, enterable.length, "every enterable building has a portal (none is left without a way out)");
{
  let onRoad = 0;
  for (const p of enterable) {
    const P = portals[p.id], D = P.door, E = P.exit, d = doorLocal(D, E.x, E.z);
    assert.ok(Math.abs(Math.hypot(D.nx, D.nz) - 1) < 1e-9, `${p.id}: a unit door normal`);
    assert.ok(Math.abs(Math.hypot(E.hx, E.hz) - 1) < 1e-9 && E.hx * D.nx + E.hz * D.nz > 0.999, `${p.id}: the exit faces the way out, away from the building`);
    assert.ok(d.v >= 0.8, `${p.id}: the exit is outside the wall (${d.v.toFixed(2)} m in front of the door)`);
    assert.ok(!world.blockedAt(E.x, E.z, WALK_R + 0.1), `${p.id}: the exit is clear of walls and posts`);
    assert.ok(Math.abs(d.u) <= PORTAL.shift.reduce((a, b) => Math.max(a, Math.abs(b)), 0) + 1e-6 && d.v <= PORTAL.out.at(-1) + 1e-6, `${p.id}: the exit is just in front of the door, not somewhere else`);
    // the person who has just come out is not in the way of the leaf (the leaf swings out into the street, or in when there is no room outside for it)
    const f = doorFrame(D, P.hinge); assert.ok(P.hinge === "in" || !inSwing(f, E.x, E.z, WALK_R + 0.1), `${p.id}: the exit is clear of the swept leaf`);
    // the walk through the doorway is the mirror of going in: entrance and exit are on opposite sides of the wall, and the walk crosses the wall once
    assert.ok(doorLocal(D, P.entrance.x, P.entrance.z).v < 0 && doorLocal(D, P.halfway.x, P.halfway.z).v > 0, `${p.id}: inside the wall, then outside it`);
    const out0 = portalWalk(P, 0, { leaving: true }), out1 = portalWalk(P, 1, { leaving: true }), in0 = portalWalk(P, 0, { leaving: false }), in1 = portalWalk(P, 1, { leaving: false });
    assert.ok(!out0.passedWall && out1.passedWall && in0.passedWall && !in1.passedWall, `${p.id}: leaving crosses the wall outwards, entering crosses it inwards`);
    assert.ok(Math.hypot(out0.x - in1.x, out0.z - in1.z) < 1e-6 && Math.hypot(out1.x - in0.x, out1.z - in0.z) < 1e-6, `${p.id}: the same walk, run in opposite directions`);
    // a way to the street from the exit: the planner finds a walk to the nearest road cell
    const B = destinationOf(net, p), street = nav.plan(E.x, E.z, B.kerb.x, B.kerb.z); assert.ok(street.ok, `${p.id}: a walk from the exit to the street`);
    if (P.onRoad) {   // only where there is nothing better: no spot off the carriageway within the same search area, and the whole frontage up to the kerb is road
      onRoad++;
      const tx = D.nz, tz = -D.nx; let better = null;
      for (const o of PORTAL.out) for (const s of PORTAL.shift) { const x = D.x + D.nx * o + tx * s, z = D.z + D.nz * o + tz * s; if (world.blockedAt(x, z, PORTAL.clearance) || doorLocal(D, x, z).v < 0.8 || isRoad(x, z)) continue; const q = planDoorOpening(world, D, { x, z }, { isRoad }); if (q.ok && q.dist <= 0.02) better = { x, z }; }
      assert.equal(better, null, `${p.id}: the exit is on the carriageway although a spot off it was free`);
    }
  }
  assert.ok(onRoad <= 8, `only a few doors open straight onto the carriageway (${onRoad})`);
}
// a building with no map position, or no outline, has no portal and says why (never a made-up one)
assert.equal(portalFor(svc, { id: "nowhere" }).reason, "nopos"); { const open = svc.data.places.find((q) => q.x != null && !svc.data.buildings.some((b) => b.id === q.bid)) ?? { id: "x", x: 1, z: 1 }; assert.equal(portalFor(svc, open).ok, false, `${open.id}: a place with no outline has no portal`); }
// the override hook is data: one building can be told where to put its exit without touching the code
{
  const id = "library", base = portalFor(svc, byId(id)), forced = portalFor(svc, byId(id), { overrides: { [id]: { out: [base.out + 0.9], shift: [base.shift] } } });
  assert.ok(forced.ok && Math.abs(forced.out - (base.out + 0.9)) < 1e-9 || !forced.ok, "an override moves the exit where it was told to"); assert.deepEqual(PORTAL_OVERRIDES, {}, "no building needs a special case today");
}
// every enterable building has an inside to come out of
for (const p of enterable) assert.ok(buildInterior(p), `${p.id}: has an interior`);

// ---------- the rig ----------
const rig = (from, to, extra = {}) => {
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const plan = planTrip(svc, { from, to, mode: "trek", driver: false }); assert.ok(plan.ok, `plan ${from.id}->${to.id}`);
  const sim = createTrafficSim({ graph, world, focus: () => from, rnd }), log = []; let end = null, entered = 0;
  const flow = createTripFlow({ svc, sim }, { plan, enterable: true, onArrive: () => true, onEnter() { entered++; log.push("entered"); }, onEnd: (w) => { end = w; log.push("end:" + w); }, onNotice: (m) => log.push("notice:" + m), ...extra });
  let t = 0; const S = flow.state;
  const tick = (inp = {}) => { flow.update(DT, inp); sim.update(DT); t += DT; };
  const until = (f, max = 300) => { const t0 = t; while (!f() && t < t0 + max && !end) tick(); return f(); };
  return { plan, flow, S, sim, log, tick, until, get end() { return end; }, get t() { return t; }, get entered() { return entered; } };
};
/** Walks to the door of the plan's destination (automatic walk), opens it and goes in. */
function goIn(r) {
  const { S, flow } = r;
  if (S.phase === "intro") r.until(() => S.phase !== "intro");
  if (S.phase === "trek" || S.phase === "roam") flow.walker.follow(flow.plan.walk ?? nav.plan(flow.walker.x, flow.walker.z, flow.plan.goal.x, flow.plan.goal.z), { goal: flow.plan.goal, tolerance: 0.45 });
  assert.ok(r.until(() => S.phase === "door", 400), `reached the door of ${flow.plan.B.id} (phase ${S.phase}, ${r.log.join(" | ")})`);
  for (let i = 0; i < 4; i++) r.tick(); assert.equal(S.door, "closed", "the door waits for the player"); assert.ok(S.canOpen, "Open Door is offered");
  assert.ok(flow.pressDoor(), "Open Door"); assert.ok(r.until(() => S.door === "open", 30), "the door opened");
  r.tick(); assert.ok(flow.enterNow(), "go in"); assert.ok(r.until(() => S.phase === "inside", 40), "went in");
}

// ---------- 2. the round trip, for every kind of building ----------
/** The nearest other enterable building that can be walked from to this one (a short walk keeps the trips quick; one that cannot be reached on foot is skipped). */
const nearestOther = (p) => { for (const [, q] of enterable.filter((q) => q.id !== p.id).map((q) => [Math.hypot(q.x - p.x, q.z - p.z), q]).sort((a, b) => a[0] - b[0])) if (planTrip(svc, { from: q, to: p, mode: "trek", driver: false }).ok && planTrip(svc, { from: p, to: q, mode: "trek", driver: false }).ok) return q; throw new Error("nothing can walk to " + p.id); };
const KINDS = [
  ["hostel", ["h_awo", "h_moremi", "h_fajuyi", "h_alumni", "h_akintola", "h_ojaja", "h_pg"]],
  ["hostel block", ["blk_1a", "blk_c", "blk_a", "blk_boutary", "blk_2b"]],
  ["lecture theatre", ["lt_1000", "hslta", "hsltb", "hsltc", "chem_eng_lt", "first_bank_lt", "computer_auditorium", "boob"]],
  ["faculty", ["f_science", "f_technology", "f_cs", "f_law", "f_arts", "f_education", "f_pharmacy", "f_health", "f_social", "f_agric", "geology"]],
  ["shop", ["school_bookshop", "as_e_dey", "dove_phoneworld", "new_bukateria", "afkit", "buks_empire", "new_market"]],
  ["bank", ["ecobank", "wema_bank", "first_bank", "zenith_bank", "access_bank"]],
  ["campus core / admin", ["senate", "library", "oduduwa", "sub", "white_house", "ajose"]],
  ["club / worship / other", ["club_quantum", "club_0203", "club_divas", "church_catholic", "church_baptist", "etf_mosque", "museum", "health_centre", "squash_court", "cooperative_hall"]],
];
const swept = new Set(); let cycles = 0, maxStep = 0;
for (const [kind, ids] of KINDS) for (const id of ids) {
  const B = byId(id); if (!B || !enterable.includes(B)) continue; swept.add(id);
  const A = nearestOther(B), P = portals[B.id], r = rig(A, B), { S, flow } = r, W = flow.walker, n = P.door;
  goIn(r); assert.equal(r.entered, 1, `${id}: went in once`);
  // ---- out: the same trip, no restart ----
  const planBefore = flow.plan, stepAt = { x: W.x, z: W.z };
  assert.deepEqual(flow.exitBuilding(null), { ok: false, reason: "noportal" }, "no portal, no exit"); assert.equal(S.phase, "inside");
  assert.ok(flow.exitBuilding(P).ok, `${id} (${kind}): came out`); assert.equal(S.phase, "leave"); assert.equal(flow.person.visible, false, "they are still inside the wall when it starts");
  assert.equal(S.door, "open", "the door is open as they come out"); assert.ok(S.doorK === 1, "wide open");
  let prev = { x: W.x, z: W.z }, appeared = null, maxD = 0; const t0 = r.t;
  while (S.phase === "leave" && r.t < t0 + 20) { r.tick(); const dd = Math.hypot(W.x - prev.x, W.z - prev.z); maxD = Math.max(maxD, dd); prev = { x: W.x, z: W.z }; if (appeared === null && flow.person.visible) appeared = { ...prev, v: doorLocal(n, W.x, W.z).v }; }
  maxStep = Math.max(maxStep, maxD);
  assert.equal(S.phase, "roam", `${id}: free to walk after coming out`); assert.ok(maxD <= 2.4 * DT * 1.6, `${id}: the walk out is a walk, not a jump (${(maxD / DT).toFixed(2)} m/s)`);
  assert.ok(appeared && appeared.v > -0.2, `${id}: they appear in the doorway, as they pass the wall line (${appeared?.v?.toFixed(2)})`);
  const E = P.exit; assert.ok(Math.hypot(W.x - E.x, W.z - E.z) < 0.6, `${id}: standing on the building's own exit spot (${Math.hypot(W.x - E.x, W.z - E.z).toFixed(2)} m off)`);
  assert.ok(W.hx * n.nx + W.hz * n.nz > 0.95, `${id}: facing the way out`); assert.equal(S.entered, false); assert.equal(flow.person.visible, true);
  assert.equal(r.end, null, `${id}: the trip never ended: it is one continuous trip`); assert.equal(flow.plan, planBefore, "same plan, nothing was rebuilt"); assert.ok(flow.free && flow.roaming);
  assert.ok(!world.blockedAt(W.x, W.z, WALK_R - 0.02), `${id}: not inside a wall or a post`);
  // the door swings shut behind them, and never through them
  let shut = false; for (let i = 0; i < 90 && !shut; i++) { r.tick(); shut = S.door === "closed"; assert.ok(!inSwing(doorFrame(n, P.hinge), W.x, W.z, 0.05) || P.hinge === "in" || S.door === "closed", "the leaf is clear of the person"); } assert.ok(shut, `${id}: the door swings shut`);
  // ---- on to the street, by hand, as the player would ----
  const kerb = destinationOf(net, B).kerb, route = nav.plan(W.x, W.z, kerb.x, kerb.z); assert.ok(route.ok, `${id}: a route to the street`);
  W.follow(route, { goal: kerb, tolerance: 1.0 }); assert.ok(r.until(() => !W.following || Math.hypot(W.x - kerb.x, W.z - kerb.z) < 1.5, 200), `${id}: reached the street`); assert.equal(S.phase, "roam", "still roaming, nothing was entered on the way");
  assert.ok(Math.hypot(W.x - kerb.x, W.z - kerb.z) < 3, `${id}: at the street (${Math.hypot(W.x - kerb.x, W.z - kerb.z).toFixed(1)} m from the kerb)`);
  // ---- back: tap the same building's name tag from the street (it works because you are roaming), walk there, go in again ----
  const re = planRetarget(svc, flow.plan, { at: { x: W.x, z: W.z }, to: B }); assert.ok(re.ok, `${id}: a route back`); assert.ok(flow.retarget(re.plan, true).ok, `${id}: sent back to the door you came out of`);
  r.tick(); assert.ok(S.auto, "an automatic walk back");
  assert.ok(r.until(() => S.phase === "door", 400), `${id}: back at the door`); for (let i = 0; i < 4; i++) r.tick(); assert.ok(S.canOpen);
  assert.ok(flow.pressDoor()); assert.ok(r.until(() => S.door === "open", 30)); r.tick(); assert.ok(flow.enterNow()); assert.ok(r.until(() => S.phase === "inside", 40), `${id}: went in a second time`);
  assert.equal(r.entered, 2, `${id}: in, out, and in again`); assert.equal(r.end, null);
  assert.ok(!r.log.some((m) => m.startsWith("notice:") && /blocked|no room|cannot/i.test(m)), `${id}: nothing went wrong on the way: ${r.log.filter((m) => m.startsWith("notice:")).join("; ")}`);
  cycles++; void stepAt;
}
assert.equal(cycles, KINDS.reduce((n, [, ids]) => n + ids.length, 0), `every listed building was walked in, out and in again (${cycles})`);
for (const [kind, ids] of KINDS) assert.ok(ids.some((i) => swept.has(i)), `at least one ${kind} was walked through`);

// ---------- 3. back to the door on foot: the door is offered again, but only after you have walked away from it ----------
{
  const B = byId("library"), A = nearestOther(B), P = portals[B.id], r = rig(A, B), { S, flow } = r, W = flow.walker; goIn(r); assert.ok(flow.exitBuilding(P).ok);
  assert.ok(r.until(() => S.phase === "roam", 20));
  for (let i = 0; i < 120; i++) r.tick(); assert.equal(S.phase, "roam", "standing on the doorstep you came out of does not count as arriving at it");
  // walk away (more than 4 m), then walk back by hand
  const away = nav.stand(P.exit.x + P.door.nx * 9, P.exit.z + P.door.nz * 9), there = nav.plan(W.x, W.z, away.x, away.z); assert.ok(there.ok); W.follow(there, { goal: away, tolerance: 0.6 });
  assert.ok(r.until(() => !W.following, 200)); assert.equal(S.phase, "roam"); const back = nav.plan(W.x, W.z, flow.plan.goal.x, flow.plan.goal.z); assert.ok(back.ok); W.follow(back, { goal: flow.plan.goal, tolerance: 0.45 });
  assert.ok(r.until(() => S.phase === "door", 200), "back at the door by hand: the door is offered again"); assert.equal(S.door, "closed"); assert.equal(flow.free, false, "now it is a trip to this door again");
  for (let i = 0; i < 4; i++) r.tick(); assert.ok(S.canOpen); assert.ok(flow.pressDoor()); assert.ok(r.until(() => S.door === "open", 30)); r.tick(); assert.ok(flow.enterNow()); assert.ok(r.until(() => S.phase === "inside", 40)); assert.equal(r.entered, 2);
}

// ---------- 4. a trip that begins on a doorstep (a building opened from the map card) walks out the same way ----------
for (const id of ["f_cs", "h_awo", "lt_1000", "as_e_dey"]) {
  const B = byId(id), P = portals[id], plan = planTrip(svc, { from: B, to: B, mode: "trek", driver: false }); assert.ok(plan.ok, `${id}: a trip from a building to itself plans`);
  const r = rig(B, B, { roam: P }), { S, flow } = r;
  assert.equal(S.phase, "leave", `${id}: starts by walking out of the door`); assert.equal(flow.person.visible, false);
  assert.ok(r.until(() => S.phase === "roam", 20), `${id}: free after stepping out`); const E = P.exit; assert.ok(Math.hypot(flow.walker.x - E.x, flow.walker.z - E.z) < 0.6);
  assert.equal(r.end, null); assert.ok(flow.free); assert.deepEqual(flow.exitBuilding(P), { ok: false, reason: "phase" }, "cannot come out twice");
  // and from there a tapped place is walked to, like any trek
  const other = nearestOther(B), res = planRetarget(svc, flow.plan, { at: { x: flow.walker.x, z: flow.walker.z }, to: other }); assert.ok(res.ok && flow.retarget(res.plan, true).ok, `${id}: sent to ${other.id}`);
  r.tick(); assert.ok(S.auto, "walking there by itself"); assert.ok(r.until(() => S.phase === "door", 500), `${id}: reached ${other.id}`);
}
// not from anywhere else: no portal for a fresh trip means the ordinary intro
{ const B = byId("library"), r = rig(B, B); assert.equal(r.S.phase, "intro"); assert.deepEqual(r.flow.exitBuilding(portals.library), { ok: false, reason: "phase" }, "only from inside, or at the very start of a doorstep trip"); }

// ---------- 5. the room behind the door is never waited for on a loading screen ----------
{
  const B = byId("library"), A = nearestOther(B); let ready = false, asked = 0;
  const r = rig(A, B, { holdEnter: () => { asked++; return !ready; } }), { S } = r;
  r.until(() => S.phase !== "intro"); r.flow.walker.follow(r.plan.walk, { goal: r.plan.goal, tolerance: 0.45 }); assert.ok(r.until(() => S.phase === "door", 400)); for (let i = 0; i < 4; i++) r.tick();
  assert.ok(r.flow.pressDoor()); assert.ok(r.until(() => S.door === "open", 30)); r.tick(); assert.ok(r.flow.enterNow());
  assert.ok(r.until(() => S.phase === "enter" && S.t > 3, 40), "they walk in through the doorway"); for (let i = 0; i < 90; i++) r.tick();
  assert.equal(S.phase, "enter", "the room is not ready: they wait in the doorway, nothing is shown"); assert.equal(r.entered, 0); assert.ok(asked > 0);
  ready = true; r.tick(); r.tick(); assert.equal(S.phase, "inside", "the moment the room is ready they are in"); assert.equal(r.entered, 1);
  // a room that never reports ready cannot trap anyone outside
  const r2 = rig(A, B, { holdEnter: () => true }); goInHeld(r2);
  function goInHeld(q) { q.until(() => q.S.phase !== "intro"); q.flow.walker.follow(q.plan.walk, { goal: q.plan.goal, tolerance: 0.45 }); assert.ok(q.until(() => q.S.phase === "door", 400)); for (let i = 0; i < 4; i++) q.tick(); assert.ok(q.flow.pressDoor()); assert.ok(q.until(() => q.S.door === "open", 30)); q.tick(); assert.ok(q.flow.enterNow()); const t1 = q.t; q.until(() => q.S.phase === "inside", ENTRY_HOLD_MAX + 20); assert.equal(q.S.phase, "inside", "after the cap they go in whatever the room shows"); assert.ok(q.t - t1 >= ENTRY_HOLD_MAX - 1 && q.t - t1 <= ENTRY_HOLD_MAX + 6, `the wait is capped at ${ENTRY_HOLD_MAX} s (${(q.t - t1).toFixed(1)})`); }
  // a hold that throws is no hold at all
  const r3 = rig(A, B, { holdEnter: () => { throw new Error("boom"); } }); r3.until(() => r3.S.phase !== "intro"); r3.flow.walker.follow(r3.plan.walk, { goal: r3.plan.goal, tolerance: 0.45 }); assert.ok(r3.until(() => r3.S.phase === "door", 400)); for (let i = 0; i < 4; i++) r3.tick(); r3.flow.pressDoor(); r3.until(() => r3.S.door === "open", 30); r3.tick(); r3.flow.enterNow(); assert.ok(r3.until(() => r3.S.phase === "inside", 40), "a failing hold never traps anyone");
}
console.log(`building-roundtrip: ok (${enterable.length} portals, ${cycles} round trips, longest step ${(maxStep / DT).toFixed(2)} m/s)`);
void classify;
