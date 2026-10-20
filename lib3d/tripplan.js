// lib3d/tripplan.js
// Plans a whole journey and says how long it will take. Pure JS (no three.js, no DOM): the travel sheet uses it to show an estimate before you go,
// and the trip itself (lib3d/tripflow.js) runs the very plan it returns, so the estimate and the journey cannot disagree about the route.
//
// A trip is: walk to where the vehicle will stop for you (kerbside, the lane whose right-hand side faces you) -> step in -> the vehicle drives the road route ->
// step out at the kerb nearest your destination -> walk to the door. There is no fixed duration anywhere: every part is a distance divided by a speed.
//   walking:    metres / WALK_SPEED               (lib/travel.js)
//   the ride:   rideTime() integrates the vehicle's real motion along its route: it speeds up at its own rate, slows for bends and junctions, brakes to stop
//               at the end. That is the same motion model the live vehicle runs (trafficsim.js idmAccel), so a ride on an empty road takes what is promised.
//   waiting:    the vehicle is sent so that it arrives when you do (or you wait for it, if it is slower than your walk).
// The only fixed times left are the animations at each end (INTRO_SECONDS, BOARD_SECONDS, ALIGHT_SECONDS, DOOR_SECONDS).
import { destinationOf } from "./roadnet.js";
import { KINDS, rideTime, doorPoint } from "./trafficsim.js";
import { WALK_SPEED, VEHICLE, OWN_CAR, BOARD_SECONDS, ALIGHT_SECONDS, INTRO_SECONDS, DOOR_SECONDS, rideKind } from "../lib/travel.js";

const KIND_OF = { keke: "keke", bus: "bus", car: "car" };
/** How far up the road the vehicle starts, so it can be seen coming and arrives at a natural pace. */
export const INBOUND_METRES = { car: 90, keke: 70, bus: 80 };
const WALK = WALK_SPEED.walk;

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
/** The motion profile a mode uses: the vehicle's own, or the nominal pace of your own car (which you steer). */
export const profileFor = (mode, driver) => VEHICLE[rideKind(mode, driver)] ?? (mode === "car" ? OWN_CAR : null);

/**
 * svc: from worldsvc (graph, nav, net). from/to: resolved places ({ id, x, z, bid?, ... }). mode: "trek"|"keke"|"bus"|"car". driver: a driver is hired (cars).
 * Returns { ok, secs, parts, ... } or { ok: false, reason: "noroad" | "noroute" | "unreachable" }.
 * `parts` is what the estimate is made of, in seconds, so the screen can say where the time goes.
 */
export function planTrip(svc, { from, to, mode, driver = false }) {
  const { graph, nav, net } = svc, A = destinationOf(net, from), B = destinationOf(net, to);
  const start = nav.stand(A.front.x, A.front.z), goal = nav.stand(B.front.x, B.front.z);
  const base = { mode, driver: !!driver, A, B, start, goal };
  if (mode === "trek") {
    const walk = nav.plan(start.x, start.z, goal.x, goal.z); if (!walk.ok) return fail("unreachable", base);
    const w = walk.len / WALK, parts = { intro: INTRO_SECONDS, walk: w, door: DOOR_SECONDS };
    return { ...base, ok: true, walk, parts, secs: INTRO_SECONDS + w + DOOR_SECONDS, len: walk.len, approx: true };
  }
  const kind = KIND_OF[mode], def = KINDS[kind], profile = profileFor(mode, driver), driven = rideKind(mode, driver) != null;
  const pick = graph.stopSpotFor(start.x, start.z, { len: def.len }), drop = graph.stopSpotFor(goal.x, goal.z, { len: def.len });
  if (!pick || !drop) return fail("noroad", base);
  const opts = { cruise: profile.cruise, aLat: profile.lat, brake: profile.brake, junctionSpeed: profile.cruise * 0.5 };
  const doorIn = doorPoint({ x: pick.x, z: pick.z, hx: pick.hx, hz: pick.hz }, kind), doorOut = doorPoint({ x: drop.x, z: drop.z, hx: drop.hx, hz: drop.hz }, kind);
  const walkIn = nav.plan(start.x, start.z, doorIn.x, doorIn.z), walkOut = nav.plan(doorOut.x, doorOut.z, goal.x, goal.z);
  if (!walkIn.ok || !walkOut.ok) return fail("unreachable", { ...base, pick, drop });
  const route = graph.route(pick.lane.id, pick.s, drop.lane.id, drop.s, opts); if (!route) return fail("noroute", { ...base, pick, drop });
  // a driven vehicle is sent from up the road; your own car is already waiting
  const inbound = driven ? graph.upstreamRoute(pick.lane.id, pick.s, INBOUND_METRES[kind], () => 0.5, opts) : null;
  const tVeh = inbound ? rideTime(inbound, { cruise: profile.cruise, aMax: profile.accel, brake: profile.brake }) : 0;
  const tWalkIn = walkIn.len / WALK, ready = Math.max(tVeh, tWalkIn), ride = rideTime(route, { cruise: profile.cruise, aMax: profile.accel, brake: profile.brake }), tOut = walkOut.len / WALK;
  if (!Number.isFinite(ride)) return fail("noroute", { ...base, pick, drop });
  const parts = { intro: INTRO_SECONDS, walkIn: tWalkIn, wait: Math.max(0, ready - tWalkIn), board: BOARD_SECONDS, ride, alight: ALIGHT_SECONDS, walkOut: tOut, door: DOOR_SECONDS };
  const secs = Object.values(parts).reduce((a, b) => a + b, 0);
  return { ...base, ok: true, kind, def, profile, driven, opts, pick, drop, doorIn, doorOut, walkIn, walkOut, route, inbound, tVeh, parts, secs, len: route.len, approx: !driven };
}

/**
 * Time left on a trip that is under way, by the same arithmetic: what is still to be walked or driven, from where things are now.
 * phase: "approach" | "board" | "ride" | "drive" | "alight" | "walk" | "trek" | "door". State: { walkLeft (m), rideS (m along the route), rideV (m/s) }.
 */
export function remainingSecs(plan, phase, st = {}) {
  const p = plan.parts, prof = plan.profile ? { cruise: plan.profile.cruise, aMax: plan.profile.accel, brake: plan.profile.brake } : null;
  const ride = () => (plan.route ? rideTime(plan.route, prof, st.rideS ?? 0, st.rideV ?? 0) : 0);
  switch (phase) {
    case "intro": return plan.secs;
    case "trek": return (st.walkLeft ?? plan.walk.len) / WALK + p.door;
    case "approach": return Math.max(st.vehLeft ?? 0, (st.walkLeft ?? 0) / WALK) + p.board + p.ride + p.alight + p.walkOut + p.door;
    case "board": return (st.boardLeft ?? p.board) + p.ride + p.alight + p.walkOut + p.door;
    case "ride": case "drive": return ride() + p.alight + p.walkOut + p.door;
    case "paying": case "alight": return (st.alightLeft ?? p.alight) + p.walkOut + p.door;
    case "walk": return (st.walkLeft ?? 0) / WALK + p.door;
    case "door": case "enter": return st.doorLeft ?? p.door;
    default: return 0;
  }
}

/**
 * Estimates for the travel sheet: one entry per mode, { secs, len, ok, approx } (len = road distance for rides, walking distance for a trek).
 * `modes` limits which are worked out (each takes a moment); `onEach(mode, result)` is called as each finishes so the sheet can fill in as it goes.
 */
export function estimateModes(svc, { from, to, modes = ["trek", "keke", "bus", "car"], driver = false }, onEach) {
  const out = {};
  for (const mode of modes) { const p = planTrip(svc, { from, to, mode, driver: mode === "car" && driver }); out[mode] = p.ok ? { ok: true, secs: p.secs, len: p.len, approx: p.approx, parts: p.parts } : { ok: false, reason: p.reason }; onEach?.(mode, out[mode]); }
  return out;
}