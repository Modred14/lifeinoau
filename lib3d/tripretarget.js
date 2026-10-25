// lib3d/tripretarget.js
// Picking another destination while a trip is under way. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//
// A trip is planned once (lib3d/tripplan.js). When the person taps another place's name tag on foot (trek) or at the wheel of their own car, the SAME trip carries on with a new
// destination: the plan is made again from where they are NOW, by the same planner and the same arithmetic, so the guide, the estimate, the door and the beam all follow.
// Nothing is changed unless the whole new plan works: a place nobody can walk to, or no road to it, answers { ok: false, reason } and the trip goes on as before.
import { destinationOf } from "./roadnet.js";
import { KINDS, rideTime, doorPoint } from "./trafficsim.js";
import { WALK_SPEED } from "../lib/travel.js";

const fail = (reason) => ({ ok: false, reason });
const total = (parts) => Object.values(parts).reduce((a, b) => a + b, 0);
/** Words for the player for each reason a new destination cannot be set. */
export const RETARGET_WHY = {
  nopos: "That place has no position on the map yet.",
  unreachable: "There is no clear way on foot to that place from here.",
  noroad: "No road reaches that place from here.",
  noroute: "No road route leads there from here.",
  phase: "You cannot change where you are going right now.",
  paid: "You have already paid for this trip, so it cannot go anywhere else.",
  busy: "Wait until the door has finished moving.",
  same: "You are already going there.",
};

/**
 * svc: the world services. plan: the plan of the trip under way (trek, or your own car). at: { x, z } where the traveller (or the car) is now. to: a resolved place ({ id, x, z, bid? }).
 * Returns { ok: true, plan } with the new plan, or { ok: false, reason }.
 */
export function planRetarget(svc, plan, { at, to }) {
  if (!to || to.x == null) return fail("nopos");
  if (plan.mode !== "trek" && !(plan.mode === "car" && !plan.driven)) return fail("phase");
  const { nav, graph, net } = svc, B = destinationOf(net, to), goal = nav.stand(B.front.x, B.front.z);
  if (plan.mode === "trek") {
    const walk = nav.plan(at.x, at.z, goal.x, goal.z); if (!walk.ok) return fail("unreachable");
    const parts = { intro: 0, walk: walk.len / WALK_SPEED.walk, door: plan.parts.door };
    return { ok: true, plan: { ...plan, B, goal, walk, parts, secs: total(parts), len: walk.len } };
  }
  // your own car: the new drop-off, the road from where the car is now to it, and the walk from the kerb to the door
  const def = KINDS[plan.kind], drop = graph.stopSpotFor(goal.x, goal.z, { len: def.len }), pick = graph.stopSpotFor(at.x, at.z, { len: def.len });
  if (!drop || !pick) return fail("noroad");
  const route = graph.route(pick.lane.id, pick.s, drop.lane.id, drop.s, plan.opts); if (!route) return fail("noroute");
  const doorOut = doorPoint({ x: drop.x, z: drop.z, hx: drop.hx, hz: drop.hz }, plan.kind), walkOut = nav.plan(doorOut.x, doorOut.z, goal.x, goal.z); if (!walkOut.ok) return fail("unreachable");
  const ride = rideTime(route, plan.params); if (!Number.isFinite(ride)) return fail("noroute");
  const parts = { ...plan.parts, ride, walkOut: walkOut.len / WALK_SPEED.walk };
  return { ok: true, plan: { ...plan, B, goal, drop, doorOut, walkOut, route, parts, secs: total(parts), len: route.len } };
}
