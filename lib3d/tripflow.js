// lib3d/tripflow.js
// One journey, as a state machine with no drawing in it (pure JS: runs in the browser and in the tests). lib3d/travel.js draws what this says.
//
//   keke / bus / car with a driver:  intro -> approach (you walk to the vehicle while it drives up) -> board (step in through the right-hand door)
//                                    -> ride (it drives the road route) -> paying -> alight (step out at the kerb) -> walk (to the door) -> door -> enter
//   your own car:                    the same, but the car is already parked and "ride" is "drive": you steer. Getting in is a sequence (walk to the driver's door, it opens,
//                                    you step in and sit, it closes; only then do the controls work), and so is getting out (Exit Car: the car stops, the door opens, you climb out onto a
//                                    clear spot beside it) -> "afoot" (you walk; close the door, or get back in) -> the same walk to the building
//   trek:                            intro -> trek (you walk) -> paying -> walk -> door -> enter
//   the door:                        in "door" you stand in front of a CLOSED door and are offered Open Door. Nothing opens by itself: when you press it you step back just far enough to
//                                    clear the leaf (and no further than there is room for), the leaf swings out, and you go in (walk into the doorway, or press Go in).
//   a new destination:               while on foot (trek, or out of your own car) or at the wheel of your own car, retarget() sends the same trip to another place: the plan is made again from
//                                    where you are, and on foot you are walked there until you take the stick or keys yourself.
//
// Everything that moves does so by elapsed time (dt), through the shared collision world, so frame rate changes nothing and nobody passes through anything.
// The person is a Walker (one controller for the stick, the keys and the automatic route, so they never fight). Vehicles are sim vehicles on the road graph.
// The journey time is whatever the motion adds up to; `eta` is the planner's arithmetic (tripplan.js) applied to where things are right now.
import { Walker, WALK_R } from "./walker.js";
import { KINDS, doorPoint, toWorld, rideProfile } from "./trafficsim.js";
import { remainingSecs } from "./tripplan.js";
import { INTRO_SECONDS, BOARD_SECONDS, ALIGHT_SECONDS, CAR_BOARD_SECONDS, CAR_ALIGHT_SECONDS, EXIT_STOP_SPEED, EXIT_REFUSE_SPEED } from "../lib/travel.js";
import { boxesOverlap } from "./collide.js";
import { createCar, stepCar, gentleStop, carProfile } from "./carphysics.js";
import { exitSpots, pickDoorSide } from "./carexit.js";
import { SWING, BACK_SPEED, LEAF_ID, canOpenAt, atThreshold, doorLocal, planDoorOpening, inSwing, swingBlocked, leafBody } from "./doorway.js";
import { RETARGET_WHY } from "./tripretarget.js";

const ARRIVE_RADIUS = 14, DOOR_OPEN = 0.9, ENTER_SECONDS = 1.4, BACK_TIMEOUT = 2.6, OPEN_HOLD_MAX = 1.6, MANUAL_EXIT_SECONDS = 2.6, PARK_ASSIST_BELOW = 7, CLOSE_AUTO_M = 4.5, ENTER_REACH_M = 3.2;
const clamp01 = (x) => Math.max(0, Math.min(1, x)), smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); }, lerp = (a, b, k) => a + (b - a) * k;

/**
 * env: { svc, sim }. o: { plan (from planTrip), onArrive(): Promise<boolean>|boolean, onEnter(), onEnd(reason), onNotice(text), rnd }.
 * The caller feeds update(dt, input): input = { dx, dz, mag, run } (a walking direction in the world) and { gas, brake, steer } for your own car (steer +1 = right),
 * plus the one-shot buttons { exit } (Exit Car), { enter } (get back in) and { close } (close the door).
 */
export function createTripFlow(env, o) {
  const { svc, sim } = env, { world, nav, graph } = svc, mode = o.plan.mode, dims = o.dims ?? null;
  let plan = o.plan, B = plan.B, enterable = o.enterable !== false;   // enterable: the place has a door to open (an open-air place, a statue or a gate has none: you simply stop there)   // dims: { len, wid, id (the car model, for its handling), seat, driver } of the model, when it is not the standard size (a purchased car)
  const driven = !!plan.driven, ownCar = mode === "car" && !plan.driven, vehicleTrip = mode !== "trek", kind = plan.kind;
  const walker = new Walker(world, nav, { x: plan.start.x, z: plan.start.z, hx: 0, hz: 1 });
  const S = { phase: "intro", t: 0, time: 0, eta: plan.secs, notice: null, ended: false, entered: false, pay: "none", doorK: 0, boardK: 0, alightK: 0, speed: 0, vehDoorK: 0, vehDoorSide: -1, seatK: 0, exiting: false, canExit: false, canEnter: false, canClose: false,
    door: "closed", hinge: "left", canOpen: false, canGoIn: false, auto: false, target: 0 };   // door: "closed" | "back" | "opening" | "open" | "closing"
  let hero = null, own = null, inProf = null, heroT = 0, spawnAt = 0, spawnTries = 0, waitedForVehicle = 0, boardFrom = null, alightTo = null, lastEta = -1, retargeted = false, approachDoor = null, departed = false, alightFrom = null;
  let dframe = null, dBack = null, dHeld = 0, dStall = 0, dT = 0, arrivals = 0, enterSecs = ENTER_SECONDS, enterPts = null;
  let doorSide = -1, doorStart = 0, doorTarget = 0, closeAsk = false, exitAsk = false, exitTo = null, exitArrival = false, exitSeat = null, reTo = null;
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
    const p0 = r.path.at(0, {}); const need = (dims?.len ?? def.len) + 4; if (!sim.spotFree(p0.x, p0.z, need)) { sim.clearSpot(p0.x, p0.z, need); if (!sim.spotFree(p0.x, p0.z, need) && spawnTries++ < 30) return false; }   // other traffic parked on the spot moves on at once, so the approach is never held up
    hero = sim.addHero(kind, r, { v: 0, len: dims?.len, wid: dims?.wid, cruise: plan.profile.cruise, aMax: plan.profile.accel, brake: plan.profile.brake }); hero.ignoreExt = new Set(["player"]);
    // the vehicle comes up the road in the time the approach lasts, whatever the distance (the walk to it is never longer than that)
    inProf = rideProfile(r, plan.params, Math.max(0.5, plan.tVeh)); hero.kinematic = true; heroT = 0; return true;
  }
  const stoppedAtPickup = () => hero && hero.v < 0.2 && (ownCar || hero.s >= hero.route.len - 0.9);   // your own car is already parked there

  // ---- own car controller ----
  function publishOwn() { world.setBody("own", { x: own.x, z: own.z, hx: own.hx, hz: own.hz, hl: own.len / 2, hw: own.wid / 2 }); sim.setExternal("own", { x: own.x, z: own.z, hx: own.hx, hz: own.hz, len: own.len, wid: own.wid, v: own.v }); }
  function makeOwn() { const h = hero; own = Object.assign(createCar({ x: h.x, z: h.z, ang: Math.atan2(h.hx, h.hz) }), { len: h.len, wid: h.wid, kind, P: carProfile(dims?.id) }); sim.remove(h); hero = null; own.pen = ownProbe(own.x, own.z, own.hx, own.hz)?.pen ?? 0; publishOwn(); }
  const onRoad = (x, z) => graph.surfaceAt(x, z, onRoad.s ??= {}).cls === 1;
  /**
   * Why a pose is not allowed for your own car: null when it is fine, otherwise { pen, why } with why = "road" (a part of it would be off the carriageway), "building" or "vehicle".
   * `pen` says how bad the place is, so the physics can let a car that is already touching something move AWAY from it (it is never pinned) but never further in.
   */
  function ownProbe(x, z, hx, hz) {
    const hl = own.len / 2, hw = own.wid / 2, rx = -hz, rz = hx; let pen = 0, why = null;
    for (const u of [-hl, 0, hl]) for (const w of [-hw, 0, hw]) if (!onRoad(x + hx * u + rx * w, z + hz * u + rz * w)) { pen++; why = "road"; }
    if (world.boxBlocked(x, z, hx, hz, hl, hw, 0.05)) { pen += 100; why = "building"; }
    const me = { x, z, hx, hz, hl, hw };
    for (const b of sim.vehicles) {
      if (Math.abs(b.x - x) > 8 || Math.abs(b.z - z) > 8) continue;
      if (!boxesOverlap(me, { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 }, 0.05)) continue;
      pen += 50 + Math.round(20 * Math.max(0, 1 - Math.hypot(x - b.x, z - b.z) / (hl + b.len / 2))); why = "vehicle";
    }
    return pen ? { pen, why } : null;
  }
  /** Asking to get out: the car brakes itself to a stop (not at once, and not at all if it is going far too fast), then the door opens. */
  function requestExit() {
    if (exitAsk || S.phase !== "drive") return;
    if (own.v > EXIT_REFUSE_SPEED) { notice("Slow down before you get out."); return; }
    if (!pickExit()) { notice("There is no room to get out here. Move the car and try again."); return; }
    exitAsk = true; S.exiting = true;
  }
  function driveOwn(dt, inp) {
    if (inp.exit) requestExit();
    let drv = { gas: inp.gas ?? 0, brake: inp.brake ?? 0, steer: inp.steer ?? 0 };
    const dist = Math.hypot(own.x - plan.drop.x, own.z - plan.drop.z), near = dist < ARRIVE_RADIUS;
    if (exitAsk && drv.gas > 0.3) { exitAsk = false; S.exiting = false; }     // you changed your mind: you pressed the gas
    if (exitAsk) drv = gentleStop(own, Math.min(4.5, own.P.brake * 0.6), own.P);
    else if (near && own.v > 0.3 && own.v < PARK_ASSIST_BELOW && !drv.gas) drv.brake = Math.max(drv.brake, 0.4);   // by the drop-off the car helps you park: it eases to a stop if you let go of the gas
    stepCar(own, drv, dt, ownProbe, own.P); publishOwn();
    return { near, drv };
  }
  /** Where a stopped car's door and the way out are, with the cars and the world as they are now. */
  const carBox = () => { const p = heroPose(); return { x: p.x, z: p.z, hx: p.hx, hz: p.hz, len: p.len ?? (own ?? hero)?.len ?? KINDS[kind].len, wid: p.wid ?? (own ?? hero)?.wid ?? KINDS[kind].wid }; };
  const exitCtx = () => ({ world, onRoad, vehicles: sim.vehicles.filter((b) => b !== hero).map((b) => ({ x: b.x, z: b.z, hx: b.hx, hz: b.hz, len: b.len, wid: b.wid })) });
  const pickExit = () => exitSpots(carBox(), KINDS[kind], exitCtx(), { preferSide: ownCar ? 1 : -1 })[0] ?? null;
  /** Which door to get in by (the driver's, unless something is in the way there). */
  function chooseDoorSide() {
    if (!ownCar) return -1; const hp = heroPose(), box = { ...hp, kind };
    return pickDoorSide((side) => doorPoint(box, kind, side), world, sim.vehicles.filter((b) => b !== hero).map((b) => ({ x: b.x, z: b.z, hx: b.hx, hz: b.hz, len: b.len, wid: b.wid })), hp);
  }
  const doorStand = (hp = heroPose()) => doorPoint({ ...hp, kind }, kind, doorSide);
  /** The line of the door itself (where a person passes through the side of the car) and the seat, in the world. */
  const threshold = (hp, side) => toWorld(hp, { x: side * ((hp.wid ?? KINDS[kind].wid) / 2 - 0.12), z: side > 0 ? KINDS[kind].doorZL ?? KINDS[kind].doorZ : KINDS[kind].doorZ });

  // ---- phases ----
  function startApproach() {
    go("approach"); approachDoor = plan.doorIn; walker.follow(plan.walkIn, { goal: plan.doorIn, tolerance: 0.4, onDone: (why) => { if (why === "blocked") { notice("You cannot get to the " + kindName() + " from here."); end("unreachable"); } } });
    if (ownCar && spawnVehicle()) { doorSide = chooseDoorSide(); S.vehDoorSide = doorSide; }
    spawnAt = 0;   // the vehicle sets off as you do, and both get there together
  }
  const seatLocal = () => (ownCar ? dims?.driver ?? KINDS[kind].driver ?? dims?.seat ?? KINDS[kind].seat : dims?.seat ?? KINDS[kind].seat);   // you drive your own car; in everything else you are a passenger
  const kindName = () => (mode === "car" ? "car" : mode);
  function retarget() { // the vehicle stopped somewhere a little different from the plan: walk to its real door
    const d = doorStand(); if (Math.hypot(d.x - approachDoor.x, d.z - approachDoor.z) < 1.0) return; approachDoor = d;
    const r = nav.plan(walker.x, walker.z, d.x, d.z); if (r.ok) walker.follow(r, { goal: d, tolerance: 0.4 });
  }
  const hasDoors = () => mode === "car";     // a car has doors that open; a keke and a bus are open or have their own door
  const boardSecs = () => (hasDoors() ? CAR_BOARD_SECONDS : BOARD_SECONDS), alightSecs = () => (hasDoors() ? CAR_ALIGHT_SECONDS : ALIGHT_SECONDS);
  function startBoard() {
    const hp = heroPose(); boardFrom = { x: walker.x, z: walker.z }; walker.cancelRoute(); walker.ignore = new Set([vehicleId()]); closeAsk = false;
    if (hasDoors()) { S.vehDoorSide = doorSide = ownCar ? doorSide : -1; doorStart = S.vehDoorK; }
    go("board"); person.seated = false; S.hx = hp.hx;
  }
  function startRide() {
    if (ownCar) { if (!own) makeOwn(); else { own.v = 0; own.thr = own.brk = 0; } exitAsk = false; S.exiting = false; S.seatK = 1; S.vehDoorK = 0; go("drive"); return; }
    sim.setRoute(hero, plan.route, {}); hero.hold = false; hero.stopAt = null; hero.kinematic = true; heroT = 0; go("ride");   // played over exactly the ride time the plan promised (plan.rideProf)
  }
  // Arriving: the fare is settled with the server IN THE BACKGROUND. The traveller does not stand still waiting for the answer: they step out and walk to the door at once
  // (movement is local). The server stays the authority: if it refuses (or the request finally fails) the trip ends as "failed" and the page rolls the player back to where
  // the server says they are; and the one thing that does wait for the answer is going INTO the building, because what a place lets you do depends on the server's record.
  function payFare() {
    S.pay = "pending"; const ticket = ++arrivals;   // an answer about an EARLIER arrival (you changed your mind and went elsewhere) must not decide this one
    const settle = (ok) => { if (S.ended || ticket !== arrivals) return; if (ok === false) { S.pay = "failed"; end("failed"); } else S.pay = "paid"; };
    let r; try { r = o.onArrive?.() ?? true; } catch { r = false; }
    if (r && typeof r.then === "function") { r.then(settle, () => settle(false)); return true; }
    settle(r); return false;
  }
  function arrive() { go("paying"); const pending = payFare(); if (pending || !S.ended) startAlight(); }
  function startAlight() {
    if (mode === "trek") { startWalk(); return; }
    if (hasDoors()) { beginExit(true); return; }
    const hp = heroPose(), d = doorPoint({ ...hp, kind }), st = nav.stand(d.x, d.z); alightTo = world.blockedAt(d.x, d.z, WALK_R + 0.02) ? st : d; alightFrom = { x: walker.x, z: walker.z }; go("alight");
  }
  /**
   * Getting out of a car (arrival: the trip's own step out at the kerb; otherwise you asked: Exit Car). The car is stopped. A safe spot beside it is chosen first
   * (clear of walls, other vehicles and the car), then the door opens, the person climbs out through it onto that spot, and only then do they walk.
   */
  function beginExit(arrival) {
    const hp = heroPose(), box = carBox(), sp = pickExit(); exitArrival = arrival; exitAsk = false; S.exiting = false; closeAsk = false;
    if (!sp && !arrival) { notice("There is no room to get out here. Move the car and try again."); return false; }
    const side = sp?.side ?? (ownCar ? 1 : -1), d = sp ?? (() => { const st = doorPoint({ ...hp, kind }, kind, side), q = nav.stand(st.x, st.z); return { x: q.x, z: q.z, side, door: threshold(box, side) }; })();
    exitTo = d; doorSide = d.side; S.vehDoorSide = doorSide; exitSeat = toWorld(hp, seatLocal()); doorStart = S.vehDoorK;
    alightFrom = { x: walker.x, z: walker.z }; walker.cancelRoute(); walker.ignore = new Set([vehicleId()]); go("exit"); return true;
  }
  function startWalk() {
    walker.ignore = null; const r = nav.plan(walker.x, walker.z, plan.goal.x, plan.goal.z);
    if (!r.ok) { notice("The way to the door is blocked."); end("unreachable"); return; }
    go("walk"); walker.follow(r, { goal: plan.goal, tolerance: 0.45 });
    if (hero && driven) { hero.kinematic = false; hero.role = "npc"; hero.hold = false; hero.stopAt = null; hero.cruise = Math.min(hero.cruise, 9); sim.setRoute(hero, sim.wander(hero.laneId, hero.laneS, 600)); departed = true; }
  }

  // ---- moving the person by hand through the door sequences (the walker is placed, not steered: the car is in the way of any real walking) ----
  function moveWalkerTo(x, z, dt, fx, fz) {
    const dx = x - walker.x, dz = z - walker.z; walker.speed = Math.min(1.6, Math.hypot(dx, dz) / Math.max(dt, 1e-3)); walker.x = x; walker.z = z; walker.vx = walker.vz = 0;
    const moving = Math.hypot(dx, dz) > 0.0015, tx = moving ? dx : fx, tz = moving ? dz : fz, tl = Math.hypot(tx, tz);
    if (tl > 1e-6) { const k = 1 - Math.exp(-dt * 11); let hx = walker.hx + (tx / tl - walker.hx) * k, hz = walker.hz + (tz / tl - walker.hz) * k; const l = Math.hypot(hx, hz) || 1; walker.hx = hx / l; walker.hz = hz / l; }
  }
  const stepDoor = (dt, target) => { S.vehDoorK += Math.max(-dt / 0.5, Math.min(dt / 0.5, target - S.vehDoorK)); };
  function distToCar(x, z) { const b = carBox(), dx = x - b.x, dz = z - b.z, u = dx * b.hx + dz * b.hz, w = -dx * b.hz + dz * b.hx; return Math.hypot(u - Math.max(-b.len / 2, Math.min(b.len / 2, u)), w - Math.max(-b.wid / 2, Math.min(b.wid / 2, w))); }
  /** Walk up, open the door, step in and sit, close the door: the controls only work when this is over. */
  function boardCar(hp, dt) {
    const t = S.t, T = boardSecs(), th = threshold(hp, doorSide), seat = toWorld(hp, seatLocal()), a = smooth((t - 1.1) / 0.9), b = smooth((t - 1.9) / 1.0);
    S.vehDoorK = Math.max(smooth((t - 0.4) / 0.7), doorStart) * (1 - smooth((t - (T - 1.1)) / 0.8));
    S.seatK = smooth((t - 1.8) / 1.2); person.seated = S.seatK >= 0.5; if (b >= 1) person.seat = seatLocal();
    moveWalkerTo(lerp(lerp(boardFrom.x, th.x, a), seat.x, b), lerp(lerp(boardFrom.z, th.z, a), seat.z, b), dt, t < 1.1 ? th.x - boardFrom.x : hp.hx, t < 1.1 ? th.z - boardFrom.z : hp.hz);
    if (t >= T) { S.vehDoorK = 0; S.seatK = 1; walker.speed = 0; walker.hx = hp.hx; walker.hz = hp.hz; walker.ignore = null; startRide(); }
  }
  /** Open the door, climb out through it and step clear onto the chosen spot. For an arrival the door is then closed and the walk to the building starts; for Exit Car you are on foot at once, door open. */
  function exitCar(hp, dt) {
    const t = S.t, T = exitArrival ? CAR_ALIGHT_SECONDS : MANUAL_EXIT_SECONDS, a = smooth((t - 0.7) / 0.9), b = smooth((t - 1.5) / 0.9), open = Math.max(smooth(t / 0.7), doorStart);
    S.vehDoorK = exitArrival ? open * (1 - smooth((t - (T - 0.8)) / 0.6)) : open; S.seatK = 1 - smooth((t - 0.7) / 1.0); person.seated = S.seatK >= 0.5;
    const x = lerp(lerp(exitSeat.x, exitTo.door.x, a), exitTo.x, b), z = lerp(lerp(exitSeat.z, exitTo.door.z, a), exitTo.z, b);
    moveWalkerTo(x, z, dt, exitTo.door.x - exitSeat.x, exitTo.door.z - exitSeat.z); S.alightK = Math.min(1, t / T);
    if (t < T) return;
    person.seated = false; S.seatK = 0; walker.ignore = null; walker.place(exitTo.x, exitTo.z);
    if (exitArrival) { S.vehDoorK = 0; startWalk(); } else { S.vehDoorK = 1; doorTarget = 1; closeAsk = false; go("afoot"); }
  }
  function startReenter() {
    const hp = heroPose(); doorSide = chooseDoorSide(); S.vehDoorSide = doorSide; reTo = doorStand(hp);
    const r = nav.plan(walker.x, walker.z, reTo.x, reTo.z, { ignore: new Set(["own"]) }); if (!r.ok) { notice("You cannot get to the car door from here."); return; }
    walker.ignore = new Set(["own"]); walker.follow(r, { goal: reTo, tolerance: 0.4 }); closeAsk = false; go("reenter");
  }

  // ---- the door: it stays shut until the player asks, and never swings into them ----
  const turnToward = (dt, hx, hz, rate = 6) => { const k = 1 - Math.exp(-dt * rate); let x = walker.hx + (hx - walker.hx) * k, z = walker.hz + (hz - walker.hz) * k; const l = Math.hypot(x, z) || 1; walker.hx = x / l; walker.hz = z / l; };
  const hasDoor = () => !!B.building && enterable;
  const setLeaf = () => { const b = dframe ? leafBody(dframe, S.doorK * SWING) : null; if (b) world.setBody(LEAF_ID, b); else world.removeBody(LEAF_ID); };
  const shutDoor = () => { S.door = "closed"; S.doorK = 0; S.canOpen = S.canGoIn = false; dframe = null; world.removeBody(LEAF_ID); };
  /** Open Door was pressed. One press at a time: a second press while the door is moving, or open, does nothing. */
  function pressDoor() {
    if (S.ended || S.phase !== "door" || !hasDoor() || S.door !== "closed" || S.pay === "failed") return false;
    if (!canOpenAt(B.door, walker.x, walker.z).ok) { notice("Step up to the door first."); return false; }
    const pl = planDoorOpening(world, B.door, { x: walker.x, z: walker.z }, { isRoad: onRoad });
    if (!pl.ok) { notice(pl.text); return false; }
    dframe = pl.frame; S.hinge = pl.hinge; dBack = pl.back; walker.cancelRoute(); walker.vx = walker.vz = 0; dT = dHeld = dStall = 0; S.canOpen = false;
    S.door = pl.dist > 0.02 ? "back" : "opening"; return true;
  }
  /** Go in through the open door (the button; walking into the doorway does the same). You must be lined up with the opening, so the walk in never crosses the leaf. */
  function enterNow() {
    if (S.ended || S.phase !== "door" || S.door !== "open") return false;
    const l = doorLocal(B.door, walker.x, walker.z); if (l.v > 4 || Math.abs(l.u) > B.door.width / 2 - 0.15) { notice("Walk up to the open doorway to go in."); return false; }
    beginEnter(); return true;
  }
  function beginEnter() {
    const D = B.door, p1 = { x: D.x + D.nx * 0.5, z: D.z + D.nz * 0.5 }, p2 = { x: D.x - D.nx * 1.6, z: D.z - D.nz * 1.6 }, l1 = Math.hypot(p1.x - walker.x, p1.z - walker.z), l2 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    S.canOpen = S.canGoIn = false; enterPts = { p0: { x: walker.x, z: walker.z }, p1, p2, l1, l2 }; enterSecs = Math.max(ENTER_SECONDS, (l1 + l2) / 2.4); go("enter");
  }
  function stepBack(dt) {
    const D = B.door, dx = dBack.x - walker.x, dz = dBack.z - walker.z, dl = Math.hypot(dx, dz); dT += dt; walker.vx = walker.vz = 0; turnToward(dt, -D.nx, -D.nz, 9);   // the person keeps looking at the door
    const giveUp = (m) => { walker.speed = 0; shutDoor(); notice(m); };
    if (dl > 0.04 && dT < BACK_TIMEOUT) {
      const sp = Math.min(dl, BACK_SPEED * dt), r = world.moveCircle(walker.x, walker.z, (dx / dl) * sp, (dz / dl) * sp, WALK_R); dStall = r.moved < sp * 0.25 ? dStall + dt : 0;
      walker.x = r.x; walker.z = r.z; walker.speed = BACK_SPEED * 0.9; if (dStall > 0.6) giveUp("There is no room to step back. Move to a clearer spot and try again.");
    } else if (inSwing(dframe, walker.x, walker.z, WALK_R + 0.08)) giveUp("There is no room to open the door from here. Move to a clearer spot and try again.");
    else { walker.speed = 0; S.door = "opening"; dHeld = 0; }
  }
  function swingDoor(dt, dir) {
    walker.step(dt, null);   // the person stands still while the leaf moves
    if (dir > 0) {
      const k = Math.min(1, S.doorK + dt / DOOR_OPEN);
      // never through the person, and never through something that has moved into the way (a vehicle pulling up): the leaf waits, and gives up after a moment
      if (inSwing(dframe, walker.x, walker.z, WALK_R + 0.06, k * SWING) || swingBlocked(world, dframe, k * SWING)) { dHeld += dt; if (dHeld > OPEN_HOLD_MAX) { notice("Something is in the way of the door."); dHeld = 0; S.door = "closing"; } return; }
      dHeld = 0; S.doorK = k; setLeaf(); if (k >= 1) S.door = "open";
    } else { S.doorK = Math.max(0, S.doorK - (dt / DOOR_OPEN) * 1.4); setLeaf(); if (S.doorK <= 0) shutDoor(); }
  }
  function doorPhase(dt, walkIn) {
    S.canOpen = S.canGoIn = false;
    if (!hasDoor()) { walker.step(dt, null); if (S.t > 0.6 && S.pay !== "pending") finishEnter(); return; }   // an open-air place, a statue or a gate: you stop there, and that is that
    const D = B.door;
    if (S.door === "closed" || S.door === "open") {
      walker.step(dt, walkIn);
      if (S.door === "closed") { const n = canOpenAt(D, walker.x, walker.z); S.canOpen = n.ok && S.pay !== "failed"; if (n.ok && walker.speed < 0.2 && !(walkIn.mag > 0.06)) turnToward(dt, -D.nx, -D.nz); }   // standing at the door, you face it
      else { const l = doorLocal(D, walker.x, walker.z); S.canGoIn = l.v <= 4 && Math.abs(l.u) <= D.width / 2 - 0.15; if (atThreshold(D, walker.x, walker.z) && S.pay !== "pending") beginEnter(); }
    } else if (S.door === "back") stepBack(dt);
    else swingDoor(dt, S.door === "opening" ? 1 : -1);
  }

  // ---- a new destination, in the middle of the trip ----
  const stopAuto = () => { if (walker.path && ["trek", "afoot", "walk"].includes(S.phase)) { walker.cancelRoute(); return true; } return false; };
  function startAuto(route) {
    walker.follow(route, { goal: plan.goal, tolerance: 0.45, yieldToPlayer: true, onDone: (why) => { if (why === "blocked") notice("The way is blocked. Walk round it yourself."); } });   // the stick or the keys end it
  }
  /**
   * Sends the trip somewhere else. np: the new plan (lib3d/tripretarget.js), made from where the traveller is now; enter: whether the new place has a door to open.
   * Returns { ok: true } or { ok: false, reason, text }. Nothing about the trip changes unless it returns ok.
   */
  function retargetTrip(np, en = true) {
    const bad = (reason) => ({ ok: false, reason, text: RETARGET_WHY[reason] }), ph = S.phase;
    if (S.ended || S.entered) return bad("phase");
    const okPhase = mode === "trek" ? ["trek", "walk", "door"].includes(ph) : ownCar ? ["drive", "afoot"].includes(ph) : false; if (!okPhase) return bad("phase");
    if (mode !== "trek" && S.pay !== "none") return bad("paid");       // a fare has been paid for the place you are at: it cannot be taken somewhere else for free
    if (S.door === "back" || S.door === "opening" || S.door === "closing" || exitAsk) return bad("busy");
    let route = null;
    if (mode === "trek" || ph === "afoot") { route = mode === "trek" ? np.walk : nav.plan(walker.x, walker.z, np.goal.x, np.goal.z); if (!route?.ok || route.pts.length < 2) return bad("unreachable"); }
    plan = np; B = np.B; enterable = en; shutDoor(); enterPts = null; S.target++;
    if (mode === "trek") { arrivals++; S.pay = "none"; go("trek"); }       // an answer about the place you were going to no longer counts
    if (route) startAuto(route);
    return { ok: true };
  }

  function update(dt, inp = {}) {
    if (S.ended) return S; dt = Math.min(dt, 0.25); S.time += dt; S.t += dt;
    const walkIn = { dx: inp.dx ?? 0, dz: inp.dz ?? 0, mag: inp.mag ?? 0, run: !!inp.run };
    switch (S.phase) {
      case "intro": walker.step(dt, null); if (S.t >= INTRO_SECONDS) { if (mode === "trek") go("trek"); else startApproach(); } break;
      case "trek": walker.step(dt, walkIn); if (Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z) < 3.2) { walker.step(0.0001, null); arrive(); } break;
      case "approach": {
        if (driven && !hero && S.t >= spawnAt) spawnVehicle();
        if (hero?.kinematic && inProf) { heroT += dt; const q = inProf.at(heroT); sim.placeAlong(hero, q.s, q.v); }
        const gs = retargeted ? Math.max(plan.glide, 8) : plan.glide;   // once the vehicle has stopped, the last few metres to its real door are covered briskly too
        if (gs > 0 && walker.following) walker.glide(dt, gs); else walker.step(dt, walkIn);   // a long way to the kerb is walked at the pace that fits the approach time
        if (walker.off > 8 && walker.mode !== "manual" && walker.following) { const r = nav.plan(walker.x, walker.z, approachDoor.x, approachDoor.z); if (r.ok) walker.follow(r, { goal: approachDoor, tolerance: 0.4 }); }
        if (hero) {
          if (stoppedAtPickup() && (!hero.kinematic || heroT >= plan.tVeh - 0.05)) { if (!retargeted) { retargeted = true; retarget(); } const d = doorStand(); if (Math.hypot(walker.x - d.x, walker.z - d.z) < 0.75) { startBoard(); break; } }
          if (hero.stillFor > 20 && !stoppedAtPickup()) sim.clearAhead(hero);
        }
        waitedForVehicle += dt; if (waitedForVehicle > plan.tVeh + plan.parts.walkIn + 60) { notice("The " + kindName() + " could not get to you. Try again."); end("unavailable"); }
        break; }
      case "board": { // turn to the door, open it, step through it and sit down (in a car: close it too)
        if (hasDoors()) { boardCar(heroPose(), dt); break; }
        const hp = heroPose(), def = KINDS[kind], k = Math.min(1, S.t / BOARD_SECONDS); S.boardK = k; const door = doorPoint({ ...hp, kind }), seat = toWorld(hp, seatLocal()), m = Math.max(0, Math.min(1, (S.t - 0.55) / 1.2));
        const x = boardFrom.x + (door.x - boardFrom.x) * Math.min(1, S.t / 0.55), z = boardFrom.z + (door.z - boardFrom.z) * Math.min(1, S.t / 0.55), px = x + (seat.x - x) * m, pz = z + (seat.z - z) * m;
        walker.x = px; walker.z = pz; walker.vx = walker.vz = 0; walker.speed = 0; const fx = m > 0 ? seat.x - door.x : door.x - boardFrom.x, fz = m > 0 ? seat.z - door.z : door.z - boardFrom.z, fl = Math.hypot(fx, fz) || 1; walker.hx = fx / fl; walker.hz = fz / fl;
        if (m >= 1) { person.seated = true; person.seat = seatLocal(); }
        if (S.t >= BOARD_SECONDS) { walker.ignore = null; startRide(); } break; }
      case "ride": {
        if (!hero || hero.done) { notice("The ride ended unexpectedly."); end("failed"); break; }
        heroT += dt; { const q = plan.rideProf.at(heroT); sim.placeAlong(hero, q.s, q.v); }   // the ride is the recorded motion played over its set time
        { const sp = toWorld(hero, seatLocal()); walker.x = sp.x; walker.z = sp.z; }
        if (heroT >= plan.rideProf.dur) { sim.placeAlong(hero, hero.route.len, 0); hero.hold = true; arrive(); } break; }
      case "drive": {
        const { near } = driveOwn(dt, inp), sp = toWorld(own, seatLocal());
        walker.x = sp.x; walker.z = sp.z; walker.vx = walker.vz = 0; walker.speed = 0; walker.hx = own.hx; walker.hz = own.hz; S.seatK = 1; S.vehDoorK = 0; person.seated = true;
        if (exitAsk && Math.abs(own.v) < 0.25) { own.v = 0; own.thr = own.brk = 0; own.yawRate = 0; own.steer = 0; publishOwn(); beginExit(false); break; }
        if (!exitAsk && near && Math.abs(own.v) < EXIT_STOP_SPEED && !(inp.gas > 0.05)) arrive();
        break; }
      case "paying": break;
      case "alight": {
        const k = Math.min(1, S.t / ALIGHT_SECONDS), seat = alightFrom, m = Math.min(1, S.t / (ALIGHT_SECONDS * 0.7)); S.alightK = k; person.seated = m < 1;
        walker.x = seat.x + (alightTo.x - seat.x) * m; walker.z = seat.z + (alightTo.z - seat.z) * m; const fx = alightTo.x - seat.x, fz = alightTo.z - seat.z, fl = Math.hypot(fx, fz) || 1; walker.hx = fx / fl; walker.hz = fz / fl;
        if (S.t >= ALIGHT_SECONDS) { person.seated = false; walker.place(alightTo.x, alightTo.z); startWalk(); } break; }
      case "exit": exitCar(heroPose(), dt); break;
      case "afoot": { // out of the car, on foot: walk where you like, close the door, or get back in
        walker.step(dt, walkIn); const d = distToCar(walker.x, walker.z);
        if (inp.close || d > CLOSE_AUTO_M) closeAsk = true; if (closeAsk) doorTarget = 0; stepDoor(dt, doorTarget);
        if (inp.enter && d < ENTER_REACH_M) { startReenter(); break; }
        if (Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z) < 1.2) { walker.vx = walker.vz = 0; doorTarget = 0; payFare(); go("door"); }
        break; }
      case "reenter": {
        walker.step(dt, null); stepDoor(dt, S.vehDoorK);
        if (Math.hypot(walker.x - reTo.x, walker.z - reTo.z) < 0.75) { startBoard(); break; }
        if (!walker.following) { notice("You cannot get to the car door from here."); walker.ignore = null; doorTarget = S.vehDoorK > 0.5 ? 1 : 0; go("afoot"); }
        break; }
      case "walk": walker.step(dt, walkIn); if (!walker.following && Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z) < 1.2) { walker.vx = walker.vz = 0; go("door"); }
        else if (!walker.following && walker.failed) { notice("The way to the door is blocked."); end("unreachable"); } break;
      case "door": doorPhase(dt, walkIn); break;
      case "enter": { // from where they stand, through the doorway, and in (the leaf stays open behind them)
        const k = Math.min(1, S.t / enterSecs), E = enterPts ?? (beginEnter(), enterPts), tot = E.l1 + E.l2 || 1, s = k * tot, d = -B.door.nx, e = -B.door.nz;
        if (s <= E.l1) { const q = E.l1 ? s / E.l1 : 1; walker.x = E.p0.x + (E.p1.x - E.p0.x) * q; walker.z = E.p0.z + (E.p1.z - E.p0.z) * q; } else { const q = E.l2 ? (s - E.l1) / E.l2 : 1; walker.x = E.p1.x + (E.p2.x - E.p1.x) * q; walker.z = E.p1.z + (E.p2.z - E.p1.z) * q; }
        walker.vx = walker.vz = 0; turnToward(dt, d, e, 10); walker.speed = 2.4; person.visible = s < E.l1 + E.l2 * 0.55; if (k >= 1 && S.pay !== "pending") finishEnter(); break; }
      default: break;
    }
    if (S.phase === "door" || S.phase === "enter") { doorTarget = 0; stepDoor(dt, 0); }
    S.auto = !!walker.path && walker.mode === "auto" && ["trek", "afoot", "walk"].includes(S.phase);
    S.canExit = S.phase === "drive" && !exitAsk; S.canEnter = S.phase === "afoot" && distToCar(walker.x, walker.z) < ENTER_REACH_M; S.canClose = S.phase === "afoot" && S.vehDoorK > 0.02 && doorTarget === 1;
    // the person
    person.x = walker.x; person.z = walker.z; person.hx = walker.hx; person.hz = walker.hz; S.speed = S.phase === "drive" ? own.v : S.phase === "ride" && hero ? hero.v : walker.speed;
    if (!person.seated && S.phase !== "board") sim.setExternal("player", { x: walker.x, z: walker.z, hx: walker.hx, hz: walker.hz, len: 0.6, wid: 0.6, v: walker.speed }); else sim.removeExternal("player");
    if (S.time - lastEta > 0.2) { lastEta = S.time; S.eta = etaNow(); }
    return S;
  }
  function finishEnter() { if (S.entered) return; S.entered = true; world.removeBody(LEAF_ID); go("inside"); o.onEnter?.(); }

  /** Seconds to go, by the planner's own arithmetic from where everything is now. */
  function etaNow() {
    const ph = S.phase, walkLeft = walker.path ? Math.max(0, walker.path.len - walker.ps) : Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z);
    switch (ph) {
      case "intro": return Math.max(0, plan.secs - S.t);
      case "trek": return remainingSecs(plan, "trek", { walkLeft: Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z) * 1.1 });
      case "approach": { const vehLeft = hero ? (hero.kinematic ? Math.max(0, plan.tVeh - heroT) : hero.s >= hero.route.len - 0.9 ? 0 : Math.max(0, plan.tVeh - (S.time - spawnAt))) : Math.max(0, spawnAt - S.t) + plan.tVeh, walkSecsLeft = plan.glide > 0 ? walkLeft / plan.glide : undefined; return remainingSecs(plan, "approach", { walkLeft, vehLeft, walkSecsLeft }); }
      case "board": return remainingSecs(plan, "board", { boardLeft: Math.max(0, boardSecs() - S.t) });
      case "exit": return remainingSecs(plan, "alight", { alightLeft: Math.max(0, alightSecs() - S.t) });
      case "afoot": case "reenter": return remainingSecs(plan, "walk", { walkLeft });
      case "ride": return hero ? remainingSecs(plan, "ride", { rideS: hero.s, rideV: hero.v, rideT: heroT }) : 0;
      case "drive": return remainingSecs({ ...plan, route: plan.route }, "ride", { rideS: Math.min(plan.route.len, plan.route.path.nearest(own.x, own.z, 0, plan.route.len + 1)), rideV: Math.max(0, own.v) });
      case "paying": case "alight": return remainingSecs(plan, "alight", { alightLeft: Math.max(0, alightSecs() - (ph === "alight" ? S.t : 0)) });
      case "walk": return remainingSecs(plan, "walk", { walkLeft });
      case "door": case "enter": return Math.max(0, plan.parts.door - S.t);
      default: return 0;
    }
  }
  /** Metres still to go on the road (rides) or on foot (the trek and the last walk). */
  function remainMetres() { const ph = S.phase; if (ph === "ride" && hero) return Math.max(0, hero.route.len - hero.s); if (ph === "drive") return Math.max(0, Math.hypot(own.x - plan.drop.x, own.z - plan.drop.z)); if (ph === "approach") return walker.path ? Math.max(0, walker.path.len - walker.ps) : 0; return Math.hypot(walker.x - plan.goal.x, walker.z - plan.goal.z); }

  function dispose() {
    S.ended = true; sim.removeExternal("player"); sim.removeExternal("own"); world.removeBody("own"); world.removeBody(LEAF_ID);
    if (hero) { if (departed) hero.role = "npc"; else sim.remove(hero); }
  }
  return { update, dispose, state: S, walker, person, get plan() { return plan; }, kind, pressDoor, enterNow, retarget: retargetTrip, stopAuto, get doorFrame() { return dframe; }, get hero() { return hero; }, get approachDoor() { return approachDoor ?? plan.doorIn; }, get own() { return own; }, get vehicle() { return own ?? hero; }, eta: () => S.eta, remainMetres, cancel: () => end("cancelled"), get driving() { return S.phase === "drive"; } };
}