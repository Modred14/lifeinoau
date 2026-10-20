// lib3d/tripflow.js
// One journey, as a state machine with no drawing in it (pure JS: runs in the browser and in the tests). lib3d/travel.js draws what this says.
//
//   keke / bus / car with a driver:  intro -> approach (you walk to the vehicle while it drives up) -> board (step in through the right-hand door)
//                                    -> ride (it drives the road route) -> paying -> alight (step out at the kerb) -> walk (to the door) -> door -> enter
//   your own car:                    the same, but the car is already parked and "ride" is "drive": you steer
//   trek:                            intro -> trek (you walk) -> paying -> walk -> door -> enter
//
// Everything that moves does so by elapsed time (dt), through the shared collision world, so frame rate changes nothing and nobody passes through anything.
// The person is a Walker (one controller for the stick, the keys and the automatic route, so they never fight). Vehicles are sim vehicles on the road graph.
// The journey time is whatever the motion adds up to; `eta` is the planner's arithmetic (tripplan.js) applied to where things are right now.
import { Walker, WALK_R } from "./walker.js";
import { KINDS, doorPoint, toWorld } from "./trafficsim.js";
import { remainingSecs } from "./tripplan.js";
import { INTRO_SECONDS, BOARD_SECONDS, ALIGHT_SECONDS, OWN_CAR_MAX } from "../lib/travel.js";
import { boxesOverlap } from "./collide.js";

const OWN = { accel: 3.4, brake: 7.5, vmax: OWN_CAR_MAX, wheelbase: 2.7, steerMax: 0.5 };
const ARRIVE_RADIUS = 14, DOOR_OPEN = 0.9, ENTER_SECONDS = 1.4;

/**
 * env: { svc, sim }. o: { plan (from planTrip), onArrive(): Promise<boolean>|boolean, onEnter(), onEnd(reason), onNotice(text), rnd }.
 * The caller feeds update(dt, input): input = { dx, dz, mag, run } (a walking direction in the world) and { gas, brake, steer } for your own car.
 */
export function createTripFlow(env, o) {
  const { svc, sim } = env, { world, nav, graph } = svc, plan = o.plan, mode = plan.mode, B = plan.B, dims = o.dims ?? null;   // dims: { len, wid } of the model, when it is not the standard size (a purchased car)
  const driven = !!plan.driven, ownCar = mode === "car" && !plan.driven, vehicleTrip = mode !== "trek", kind = plan.kind;
  const walker = new Walker(world, nav, { x: plan.start.x, z: plan.start.z, hx: 0, hz: 1 });
  const S = { phase: "intro", t: 0, time: 0, eta: plan.secs, notice: null, ended: false, entered: false, doorK: 0, boardK: 0, alightK: 0, speed: 0 };
  let hero = null, own = null, spawnAt = 0, spawnTries = 0, waitedForVehicle = 0, boardFrom = null, alightTo = null, lastEta = -1, retargeted = false, approachDoor = null, departed = false, enterFrom = null, alightFrom = null;
  const person = { visible: true, seated: false, seat: null, x: plan.start.x, z: plan.start.z, hx: 0, hz: 1 };

  const go = (p) => { S.phase = p; S.t = 0; };
  const notice = (m) => { S.notice = m; o.onNotice?.(m); };
  const end = (why) => { if (S.ended) return; S.ended = true; o.onEnd?.(why); };
  const heroPose = () => (own ? { x: own.x, z: own.z, hx: own.hx, hz: own.hz, wid: own.wid } : hero ? { x: hero.x, z: hero.z, hx: hero.hx, hz: hero.hz, wid: hero.wid } : null);
  const vehicleId = () => (own ? "own" : hero ? "veh" + hero.id : null);

  // ---- vehicles ----
  function spawnVehicle() {
    const def = KINDS[kind];
    if (ownCar) { // your car is already waiting at the kerb
      const lane = plan.pick.lane, s0 = Math.max(0, plan.pick.s - 4), r = graph.makeRoute([{ kind: "lane", id: lane.id, s0, s1: Math.min(lane.len, plan.pick.s + 4) }], plan.opts); if (!r) return false;
      hero = sim.addHero(kind, r, { s: plan.pick.s - s0, v: 0, hold: true, len: dims?.len, wid: dims?.wid, cruise: plan.profile.cruise, aMax: plan.profile.accel, brake: plan.profile.brake }); hero.color = "#1c1d21"; hero.ignoreExt = new Set(["player"]); return true;
    }
    const r = plan.inbound ?? graph.makeRoute([{ kind: "lane", id: plan.pick.lane.id, s0: Math.max(0, plan.pick.s - 3), s1: plan.pick.s }], plan.opts); if (!r) return false;
    const p0 = r.path.at(0, {}); if (!sim.spotFree(p0.x, p0.z, (dims?.len ?? def.len) + 4) && spawnTries++ < 600) return false;   // wait for a clear spot to appear
    hero = sim.addHero(kind, r, { v: 0, len: dims?.len, wid: dims?.wid, cruise: plan.profile.cruise, aMax: plan.profile.accel, brake: plan.profile.brake }); hero.ignoreExt = new Set(["player"]); return true;
  }
  const stoppedAtPickup = () => hero && hero.v < 0.2 && (ownCar || hero.s >= hero.route.len - 0.9);   // your own car is already parked there

  // ---- own car controller ----
  function makeOwn() { const h = hero; own = { x: h.x, z: h.z, hx: h.hx, hz: h.hz, ang: Math.atan2(h.hx, h.hz), v: 0, steer: 0, len: h.len, wid: h.wid, kind }; sim.remove(h); hero = null; world.setBody("own", { x: own.x, z: own.z, hx: own.hx, hz: own.hz, hl: own.len / 2, hw: own.wid / 2 }); sim.setExternal("own", { x: own.x, z: own.z, hx: own.hx, hz: own.hz, len: own.len, wid: own.wid, v: 0 }); }
  const onRoad = (x, z) => graph.surfaceAt(x, z, onRoad.s ??= {}).cls === 1;
  /** Why a pose is not allowed for your own car: "road" (a part of it would be off the carriageway), "building", "vehicle" (another vehicle is there), or null if it is fine. */
  function ownBlock(x, z, hx, hz) {
    const hl = own.len / 2, hw = own.wid / 2, rx = -hz, rz = hx;
    for (const u of [-hl, 0, hl]) for (const w of [-hw, 0, hw]) if (!onRoad(x + hx * u + rx * w, z + hz * u + rz * w)) return "road";
    if (world.boxBlocked(x, z, hx, hz, hl, hw, 0.05)) return "building";
    const me = { x, z, hx, hz, hl, hw }, now = { x: own.x, z: own.z, hx: own.hx, hz: own.hz, hl, hw };
    for (const b of sim.vehicles) {
      if (Math.abs(b.x - x) > 8 || Math.abs(b.z - z) > 8) continue; const B = { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 };
      if (!boxesOverlap(me, B, 0.05)) continue;
      // already touching it (it pulled across in front of you)? Then moving AWAY from it is allowed, so neither of you can be stuck for ever; moving further in is not
      if (boxesOverlap(now, B, 0.05) && Math.hypot(x - b.x, z - b.z) > Math.hypot(own.x - b.x, own.z - b.z) + 1e-4) continue;
      return "vehicle";
    }
    return null;
  }
  function driveOwn(dt, inp) {
    const n = Math.max(1, Math.ceil(dt / (1 / 60))), h = dt / n;
    for (let i = 0; i < n; i++) {
      const sp = Math.abs(own.v), want = (inp.steer ?? 0) * OWN.steerMax * (1 - Math.min(0.7, sp / 40)); own.steer += (want - own.steer) * (1 - Math.exp(-7 * h));
      const near = Math.hypot(own.x - plan.drop.x, own.z - plan.drop.z) < ARRIVE_RADIUS;
      let acc;
      if (near) acc = own.v > 0 ? -Math.max(1.5, Math.min(OWN.brake, own.v * 2, 5)) : own.v < 0 ? 2 : 0;                  // near the kerb the car brakes itself to a stop
      else { const gas = inp.gas ?? 0, br = inp.brake ?? 0; acc = gas * OWN.accel; if (!gas && !br) acc = own.v > 0 ? -1.6 : own.v < 0 ? 1.6 : 0; if (br) acc = own.v > 0.3 ? -OWN.brake : -OWN.accel; }
      own.v = Math.max(-4, Math.min(OWN.vmax, own.v + acc * h)); if (!inp.gas && !inp.brake && Math.abs(own.v) < 0.25) own.v = 0; if (near && Math.abs(own.v) < 0.05) own.v = 0;
      const ang = own.ang + (own.v / OWN.wheelbase) * Math.tan(own.steer) * h, hx = Math.sin(ang), hz = Math.cos(ang), nx = own.x + hx * own.v * h, nz = own.z + hz * own.v * h;
      const why = ownBlock(nx, nz, hx, hz); own.blockedBy = why;
      if (!why) { own.x = nx; own.z = nz; own.ang = ang; own.hx = hx; own.hz = hz; } else own.v = own.v > 0 ? Math.max(0, own.v - 9 * h) : Math.min(0, own.v + 9 * h);   // a kerb, a wall or another car: the car does not go through it, it scrubs off its speed (hard braking) and stops
    }
    world.setBody("own", { x: own.x, z: own.z, hx: own.hx, hz: own.hz, hl: own.len / 2, hw: own.wid / 2 }); sim.setExternal("own", { x: own.x, z: own.z, hx: own.hx, hz: own.hz, len: own.len, wid: own.wid, v: own.v });
  }

  // ---- phases ----
  function startApproach() {
    go("approach"); approachDoor = plan.doorIn; walker.follow(plan.walkIn, { goal: plan.doorIn, tolerance: 0.4, onDone: (why) => { if (why === "blocked") { notice("You cannot get to the " + kindName() + " from here."); end("unreachable"); } } });
    if (ownCar) spawnVehicle();
    spawnAt = driven ? Math.max(0, plan.parts.walkIn - plan.tVeh - 0.3) : 0;
  }
  const seatLocal = () => (ownCar ? KINDS[kind].driver ?? KINDS[kind].seat : KINDS[kind].seat);   // you drive your own car; in everything else you are a passenger
  const kindName = () => (mode === "car" ? "car" : mode);
  function retarget() { // the vehicle stopped somewhere a little different from the plan: walk to its real door
    const d = doorPoint({ ...heroPose(), kind }); if (Math.hypot(d.x - approachDoor.x, d.z - approachDoor.z) < 1.0) return; approachDoor = d;
    const r = nav.plan(walker.x, walker.z, d.x, d.z); if (r.ok) walker.follow(r, { goal: d, tolerance: 0.4 });
  }
  function startBoard() { const hp = heroPose(); boardFrom = { x: walker.x, z: walker.z }; walker.cancelRoute(); walker.ignore = new Set([vehicleId()]); go("board"); person.seated = false; S.hx = hp.hx; }
  function startRide() {
    if (ownCar) { makeOwn(); go("drive"); return; }
    sim.setRoute(hero, plan.route, {}); hero.hold = false; hero.stopAt = null; go("ride");
  }
  function arrive() {
    go("paying"); const after = (ok) => { if (S.ended) return; if (ok === false) end("failed"); else startAlight(); };
    try { const r = o.onArrive?.() ?? true; if (r && typeof r.then === "function") r.then(after, () => end("failed")); else after(r); } catch { end("failed"); }
  }
  function startAlight() {
    if (mode === "trek") { startWalk(); return; }
    const hp = heroPose(), d = doorPoint({ ...hp, kind }), st = nav.stand(d.x, d.z); alightTo = world.blockedAt(d.x, d.z, WALK_R + 0.02) ? st : d; alightFrom = { x: walker.x, z: walker.z }; go("alight");
  }
  function startWalk() {
    walker.ignore = null; const r = nav.plan(walker.x, walker.z, plan.goal.x, plan.goal.z);
    if (!r.ok) { notice("The way to the door is blocked."); end("unreachable"); return; }
    go("walk"); walker.follow(r, { goal: plan.goal, tolerance: 0.45 });
    if (hero && driven) { hero.role = "npc"; hero.hold = false; hero.stopAt = null; hero.cruise = Math.min(hero.cruise, 9); sim.setRoute(hero, sim.wander(hero.laneId, hero.laneS, 600)); departed = true; }
  }

  function update(dt, inp = {}) {
    if (S.ended) return S; dt = Math.min(dt, 0.25); S.time += dt; S.t += dt;
    const walkIn = { dx: inp.dx ?? 0, dz: inp.dz ?? 0, mag: inp.mag ?? 0, run: !!inp.run };
    switch (S.phase) {
      case "intro": walker.step(dt, null); if (S.t >= INTRO_SECONDS) { if (mode === "trek") go("trek"); else startApproach(); } break;
      case "trek": walker.step(dt, walkIn); if (Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z) < 3.2) { walker.step(0.0001, null); arrive(); } break;
      case "approach": {
        if (driven && !hero && S.t >= spawnAt) spawnVehicle(); walker.step(dt, walkIn);
        if (walker.off > 8 && walker.mode !== "manual" && walker.following) { const r = nav.plan(walker.x, walker.z, approachDoor.x, approachDoor.z); if (r.ok) walker.follow(r, { goal: approachDoor, tolerance: 0.4 }); }
        if (hero) {
          if (stoppedAtPickup()) { if (!retargeted) { retargeted = true; retarget(); } const d = doorPoint({ ...heroPose(), kind }); if (Math.hypot(walker.x - d.x, walker.z - d.z) < 0.75) { startBoard(); break; } }
          if (hero.stillFor > 20 && !stoppedAtPickup()) sim.clearAhead(hero);
        }
        waitedForVehicle += dt; if (waitedForVehicle > plan.tVeh + plan.parts.walkIn + 90) { notice("The " + kindName() + " could not get to you. Try again."); end("unavailable"); }
        break; }
      case "board": { // turn to the door, step through it and sit down
        const hp = heroPose(), def = KINDS[kind], k = Math.min(1, S.t / BOARD_SECONDS); S.boardK = k; const door = doorPoint({ ...hp, kind }), seat = toWorld(hp, seatLocal()), m = Math.max(0, Math.min(1, (S.t - 0.55) / 1.2));
        const x = boardFrom.x + (door.x - boardFrom.x) * Math.min(1, S.t / 0.55), z = boardFrom.z + (door.z - boardFrom.z) * Math.min(1, S.t / 0.55), px = x + (seat.x - x) * m, pz = z + (seat.z - z) * m;
        walker.x = px; walker.z = pz; walker.vx = walker.vz = 0; walker.speed = 0; const fx = m > 0 ? seat.x - door.x : door.x - boardFrom.x, fz = m > 0 ? seat.z - door.z : door.z - boardFrom.z, fl = Math.hypot(fx, fz) || 1; walker.hx = fx / fl; walker.hz = fz / fl;
        if (m >= 1) { person.seated = true; person.seat = seatLocal(); }
        if (S.t >= BOARD_SECONDS) { walker.ignore = null; startRide(); } break; }
      case "ride": {
        if (!hero || hero.done) { notice("The ride ended unexpectedly."); end("failed"); break; }
        { const sp = toWorld(hero, seatLocal()); walker.x = sp.x; walker.z = sp.z; } if (hero.stillFor > 20) sim.clearAhead(hero);
        if (hero.s >= hero.route.len - 0.9 && hero.v < 0.25) { hero.hold = true; arrive(); } break; }
      case "drive": driveOwn(dt, inp); { const sp = toWorld(own, seatLocal()); walker.x = sp.x; walker.z = sp.z; }
        if (Math.hypot(own.x - plan.drop.x, own.z - plan.drop.z) < ARRIVE_RADIUS && Math.abs(own.v) < 0.3) arrive(); break;
      case "paying": break;
      case "alight": {
        const k = Math.min(1, S.t / ALIGHT_SECONDS), seat = alightFrom, m = Math.min(1, S.t / (ALIGHT_SECONDS * 0.7)); S.alightK = k; person.seated = m < 1;
        walker.x = seat.x + (alightTo.x - seat.x) * m; walker.z = seat.z + (alightTo.z - seat.z) * m; const fx = alightTo.x - seat.x, fz = alightTo.z - seat.z, fl = Math.hypot(fx, fz) || 1; walker.hx = fx / fl; walker.hz = fz / fl;
        if (S.t >= ALIGHT_SECONDS) { person.seated = false; walker.place(alightTo.x, alightTo.z); startWalk(); } break; }
      case "walk": walker.step(dt, walkIn); if (!walker.following && Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z) < 1.2) { walker.vx = walker.vz = 0; go("door"); }
        else if (!walker.following && walker.failed) { notice("The way to the door is blocked."); end("unreachable"); } break;
      case "door": { const hx = -B.door.nx, hz = -B.door.nz; walker.step(dt, null); walker.hx = hx; walker.hz = hz; S.doorK = Math.min(1, S.t / DOOR_OPEN); if (!B.building) { if (S.t > 0.6) finishEnter(); } else if (S.t > DOOR_OPEN) go("enter"); break; }
      case "enter": { const k = Math.min(1, S.t / ENTER_SECONDS), d = -B.door.nx, e = -B.door.nz; enterFrom ??= { x: walker.x, z: walker.z }; const ix = B.front.x + d * 3.2, iz = B.front.z + e * 3.2; walker.x = enterFrom.x + (ix - enterFrom.x) * k; walker.z = enterFrom.z + (iz - enterFrom.z) * k; walker.hx = d; walker.hz = e; walker.speed = 2.4; person.visible = k < 0.55; if (k >= 1) finishEnter(); break; }
      default: break;
    }
    // the person
    person.x = walker.x; person.z = walker.z; person.hx = walker.hx; person.hz = walker.hz; S.speed = S.phase === "drive" ? own.v : S.phase === "ride" && hero ? hero.v : walker.speed;
    if (!person.seated && S.phase !== "board") sim.setExternal("player", { x: walker.x, z: walker.z, hx: walker.hx, hz: walker.hz, len: 0.6, wid: 0.6, v: walker.speed }); else sim.removeExternal("player");
    if (S.time - lastEta > 0.2) { lastEta = S.time; S.eta = etaNow(); }
    return S;
  }
  function finishEnter() { if (S.entered) return; S.entered = true; go("inside"); o.onEnter?.(); }

  /** Seconds to go, by the planner's own arithmetic from where everything is now. */
  function etaNow() {
    const ph = S.phase, walkLeft = walker.path ? Math.max(0, walker.path.len - walker.ps) : Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z);
    switch (ph) {
      case "intro": return Math.max(0, plan.secs - S.t);
      case "trek": return remainingSecs(plan, "trek", { walkLeft: Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z) * 1.1 });
      case "approach": { const vehLeft = hero ? (hero.s >= hero.route.len - 0.9 ? 0 : Math.max(0, plan.tVeh - (S.time - spawnAt))) : Math.max(0, spawnAt - S.t) + plan.tVeh; return remainingSecs(plan, "approach", { walkLeft, vehLeft }); }
      case "board": return remainingSecs(plan, "board", { boardLeft: Math.max(0, BOARD_SECONDS - S.t) });
      case "ride": return hero ? remainingSecs(plan, "ride", { rideS: hero.s, rideV: hero.v }) : 0;
      case "drive": return remainingSecs({ ...plan, route: plan.route }, "ride", { rideS: Math.min(plan.route.len, plan.route.path.nearest(own.x, own.z, 0, plan.route.len + 1)), rideV: Math.max(0, own.v) });
      case "paying": case "alight": return remainingSecs(plan, "alight", { alightLeft: Math.max(0, ALIGHT_SECONDS - (ph === "alight" ? S.t : 0)) });
      case "walk": return remainingSecs(plan, "walk", { walkLeft });
      case "door": case "enter": return Math.max(0, plan.parts.door - S.t);
      default: return 0;
    }
  }
  /** Metres still to go on the road (rides) or on foot (the trek and the last walk). */
  function remainMetres() { const ph = S.phase; if (ph === "ride" && hero) return Math.max(0, hero.route.len - hero.s); if (ph === "drive") return Math.max(0, Math.hypot(own.x - plan.drop.x, own.z - plan.drop.z)); if (ph === "approach") return walker.path ? Math.max(0, walker.path.len - walker.ps) : 0; return Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z); }

  function dispose() {
    S.ended = true; sim.removeExternal("player"); sim.removeExternal("own"); world.removeBody("own");
    if (hero) { if (departed) hero.role = "npc"; else sim.remove(hero); }
  }
  return { update, dispose, state: S, walker, person, plan, kind, get hero() { return hero; }, get own() { return own; }, get vehicle() { return own ?? hero; }, eta: () => S.eta, remainMetres, cancel: () => end("cancelled"), get driving() { return S.phase === "drive"; } };
}