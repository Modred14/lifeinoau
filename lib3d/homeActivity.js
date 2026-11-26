// lib3d/homeActivity.js
// The person doing something at home: walk to the piece, line up with it, settle onto it, do it, get up, hand control back. A small state machine with no three.js in it (the trip
// draws the pose it reports), so it can be run headlessly by the tests.
//
//   walk    the walker follows the indoor route (lib3d/homeRoute.js) to the spot's `stand` point; the player may steer away to cancel
//   enter   (about a second) the body eases from the standing point onto the piece: turns to face it, sits / lies down / steps up to the cooker. The activity's clip is already playing
//   active  the activity runs for its time (a sleep runs until the player wakes; the server says when it is over)
//   exit    the body eases back to the standing point and straightens; then control is the player's again
//
// pose() reports where to draw the body: { x, z, yaw, lift (m above the floor), th (radians tipped back: 0 upright, PI/2 lying), clip, stage, k }.
import { chooseSpot, ACTIVITIES } from "../lib/homeActivities.js";
import { WALK_R } from "./walker.js";

const ease = (k) => k * k * (3 - 2 * k), clamp01 = (x) => Math.min(1, Math.max(0, x));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const ENTER_S = { lie: 1.5, seat: 1.0, dine: 1.0, toilet: 1.0, floor: 1.1, cook: 0.6, basin: 0.6, shower: 0.7 }, EXIT_S = { lie: 1.4, seat: 0.9, dine: 0.9, toilet: 0.9, floor: 1.0, cook: 0.5, basin: 0.5, shower: 0.6 };

/**
 * o: { walker, router, env: { toWorld, dirOf }, getItems(), room, height (the avatar's, m), free(x, z), taken(): keys other people use, hooks: { onStart(spot), onActive(spot), onEnd(spot, why), onWalkFailed } }
 */
export function createHomeActivity(o) {
  const WK = o.walker, hipH = () => 0.53 * (o.height?.() ?? 1.76);
  let cur = null; // { id, spot, stage, t, from: {x,z,yaw}, left, why }
  const noop = () => {};
  const hook = (n, ...a) => { try { (o.hooks?.[n] ?? noop)(...a); } catch (e) { console.warn("home activity hook", n, e); } };

  /** Where the body is, as the fraction k (0 = at the standing point, 1 = on the piece). */
  function bodyAt(k) {
    const s = cur.spot, kind = s.kind, e = ease(k), th = kind === "lie" ? (Math.PI / 2) * e : 0;
    // lying: the hips go to the spot and the feet trail out in front (the tipped body's origin is its feet)
    const off = kind === "lie" ? hipH() * Math.sin(th) : 0, ax = s.at.x + s.face.hx * off, az = s.at.z + s.face.hz * off;
    const lift = kind === "lie" ? (s.y + 0.12 - hipH() * Math.cos(th)) * e + 0 : 0;
    const x = cur.from.x + (ax - cur.from.x) * e, z = cur.from.z + (az - cur.from.z) * e, yaw = cur.from.yaw + angDiff(cur.from.yaw, s.yaw) * clamp01(e * 1.6);
    return { x, z, yaw, lift: Math.max(0, lift), th };
  }

  function begin(spot) {
    const def = spot.def;
    cur = { id: spot.id, spot, stage: "walk", t: 0, from: null, left: def.secs, why: "" };
    const route = o.router.route({ x: WK.x, z: WK.z }, spot.stand);
    if (!route) { cur = null; return { ok: false, why: "There is no way to get there." }; }
    hook("onStart", spot);
    WK.follow({ pts: route }, { goal: spot.stand, tolerance: 0.22, yieldToPlayer: false, onDone: () => { if (cur && cur.stage === "walk") arrive(); } });
    if (route.length < 2 || Math.hypot(WK.x - spot.stand.x, WK.z - spot.stand.z) < 0.22) arrive();
    return { ok: true };
  }
  function arrive() {
    if (!cur) return; WK.cancelRoute(); WK.speed = 0;
    cur.stage = "enter"; cur.t = 0; cur.from = { x: WK.x, z: WK.z, yaw: Math.atan2(WK.hx, WK.hz) };
  }
  function finish(why = "done") {
    if (!cur) return; const s = cur.spot; WK.cancelRoute(); WK.speed = 0;
    if (cur.from) { WK.place(cur.from.x, cur.from.z); WK.hx = Math.sin(cur.yawOut ?? cur.from.yaw); WK.hz = Math.cos(cur.yawOut ?? cur.from.yaw); }
    const c = cur; cur = null; hook("onEnd", c.spot, why);
  }

  return {
    /** Start `id` (optionally on the tapped `item`). { ok } or { ok: false, why }. Nothing else may be going on. */
    start(id, { item = null } = {}) {
      if (cur) return { ok: false, why: "You are already doing something." };
      const spot = chooseSpot(id, { items: o.getItems(), room: o.room, from: { x: WK.x, z: WK.z }, env: o.env, item, free: o.free, taken: o.taken?.() ?? [] });
      if (!spot || spot.why) return { ok: false, why: spot?.why ?? "Nothing here can be used for that." };
      return begin(spot);
    },
    /** Stop: before arriving it just stops walking; while doing it, the person gets up. */
    stop(why = "cancel") {
      if (!cur) return false;
      if (cur.stage === "walk") { WK.cancelRoute(); cur = null; hook("onEnd", null, "cancelled"); return true; }
      if (cur.stage === "enter" || cur.stage === "active") { cur.k0 = cur.k ?? 1; cur.stage = "exit"; cur.t = 0; cur.yawOut = cur.spot.yaw; hook("onExitStart", cur.spot, why); return true; }
      return false;
    },
    /** Called every frame, before the walker steps. Returns true while the body is not the player's to steer (settling, doing it, getting up). */
    update(dt) {
      if (!cur) return false;
      const s = cur.spot, kind = s.kind;
      if (cur.stage === "walk") { if (!WK.following && cur.stage === "walk") { if (Math.hypot(WK.x - s.stand.x, WK.z - s.stand.z) < 0.6) arrive(); else { cur = null; hook("onEnd", null, "blocked"); } } return false; }
      cur.t += dt;
      if (cur.stage === "enter") { cur.k = clamp01(cur.t / (ENTER_S[kind] ?? 1)); if (cur.k >= 1) { cur.stage = "active"; cur.t = 0; cur.k = 1; hook("onActive", s); } }
      else if (cur.stage === "active") { cur.k = 1; cur.left = Math.max(0, cur.left - dt); if (s.def.server !== "sleep" && cur.left <= 0 && !s.def.untilStopped) this.stop("complete"); }
      else if (cur.stage === "exit") { cur.k = clamp01((cur.k0 ?? 1) * (1 - cur.t / ((EXIT_S[kind] ?? 1) * (cur.k0 ?? 1)))); if (cur.k <= 0) finish("done"); }
      return true;
    },
    /** What to draw, or null while the person is just walking (or doing nothing). */
    pose() {
      if (!cur || !cur.from) return null; const b = bodyAt(cur.k ?? 0);
      return { ...b, clip: cur.stage === "exit" && cur.k < 0.35 ? null : cur.spot.def.clip, stage: cur.stage, k: cur.k ?? 0, kind: cur.spot.kind, id: cur.id, private: !!cur.spot.def.private };
    },
    get state() { return cur ? { id: cur.id, stage: cur.stage, left: cur.left, def: cur.spot.def, key: cur.spot.key, private: !!cur.spot.def.private } : null; },
    get busy() { return !!cur; },
    /** Already asleep when the page opened: lie in the bed at once, no walk. */
    resume(id, spot) { cur = { id, spot, stage: "active", t: 0, k: 1, from: { x: spot.stand.x, z: spot.stand.z, yaw: spot.yaw }, left: spot.def.secs }; WK.place(spot.stand.x, spot.stand.z); return true; }, // no onActive here: it began earlier, the server already knows,
    abort() { if (cur) { WK.cancelRoute(); cur = null; } },
    WALK_R,
  };
}
export { ACTIVITIES };
