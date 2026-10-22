// lib3d/tripguide.js
// The route shown to the player during a trip (the ribbon on the ground, the mini map, the full map). Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//
// The rule: the route ALWAYS starts at where the traveller is right now (the person, or the vehicle they are in) and ends at the place they are heading for.
// It is never the plan made when the trip began. So it is worked out again, from the live position, whenever
//   - the leg changes (walking to the vehicle -> riding -> walking to the door; this is what "switching transport" means inside one trip),
//   - the destination of the leg changes (the vehicle stopped a little way from where it was planned),
//   - the traveller leaves the route (they steer off it, or walk round something), or
//   - a new trip starts (a new guide is made for every trip, so nothing is ever carried over from a previous journey).
// While the traveller follows the route, only the part still ahead is shown: the point behind them is dropped, so the line never starts at an old position.
import { Path } from "./roadnet.js";

const OFF_WALK = 3.5, OFF_DRIVE = 7, REPLAN_GAP = 0.6, DRIVE_GAP = 1.0;
const WALK_PHASES = new Set(["intro", "approach", "trek", "walk"]);
const SHORT_PHASES = new Set(["alight", "paying", "door", "enter", "inside"]);

/** The part of `path` from distance `s` onwards, as points, starting at the live position (x, z). */
export function remainingPts(path, s, x, z) {
  const out = [[x, z]], P = path.pts, C = path.cum;
  for (let i = 0; i < P.length; i++) if (C[i] > s + 0.05) out.push(P[i]);
  if (out.length === 1) out.push(P.at(-1));
  return out;
}
const lenOf = (pts) => { let t = 0; for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return t; };

/**
 * nav: the walking planner, graph: the road graph, plan: from planTrip. Returns { update(dt, c), reset(), get current }.
 * update(dt, c) with c = { phase, x, z, goal?: {x, z} (the door being walked to), ride?: { s, path } (the vehicle's route and metres along it) } returns
 * { pts, len, kind: "walk" | "drive", show, rev, s, path, goal, ok }: `pts[0]` is exactly (c.x, c.z); `rev` changes whenever the underlying route changed (so a
 * drawing can rebuild its geometry only then); `s` is how far along `path` the traveller is (it keeps a pattern drawn on the route from sliding).
 */
export function createGuide({ nav, graph, plan }) {
  let cur = null, time = 0, lastPlan = -99, rev = 0, out = { pts: [[0, 0], [0, 0]], len: 0, kind: "walk", show: false, rev: 0, s: 0, path: null, goal: null, ok: true };
  const B = plan.B, endGoal = plan.goal;

  const walkRoute = (x, z, g) => { const r = nav.plan(x, z, g.x, g.z); return r.ok && r.pts.length > 1 ? { path: new Path(r.pts), ok: true } : { path: new Path([[x, z], [g.x, g.z]]), ok: false }; };
  function driveRoute(x, z) { // your own car has left the planned road: the way from the road beside it to the drop-off
    const sp = graph.stopSpotFor(x, z, { len: plan.def?.len ?? 4.5 }); if (!sp || !plan.drop) return null;
    const r = graph.route(sp.lane.id, sp.s, plan.drop.lane.id, plan.drop.s, plan.opts); return r?.path ? { path: r.path, ok: true } : null;
  }

  /** What leg this is: its key (a change means plan again), kind, where it goes, and whether the route may be re-planned when the traveller leaves it. */
  function leg(c) {
    const ph = c.phase;
    const rp = c.ride?.path ?? plan.route?.path; // the road the vehicle is actually running (it may differ a little from the plan)
    if (ph === "board") return { key: "ride", kind: "drive", fixed: rp, show: false };
    if (ph === "ride") return { key: "ride", kind: "drive", fixed: rp, show: true };
    if (ph === "drive") return { key: "drive", kind: "drive", dynamic: true, show: true };
    if (SHORT_PHASES.has(ph)) { const g = ph === "door" || ph === "enter" || ph === "inside" ? { x: B.front.x, z: B.front.z } : endGoal; return { key: "short:" + ph, kind: "walk", goal: g, show: false, straight: true }; }
    if (WALK_PHASES.has(ph)) { const g = ph === "approach" ? (c.goal ?? plan.doorIn ?? endGoal) : ph === "intro" && plan.mode !== "trek" ? (plan.doorIn ?? endGoal) : endGoal; return { key: "walk:" + Math.round(g.x * 2) + "," + Math.round(g.z * 2), kind: "walk", goal: g, show: true }; }
    return { key: "walk:end", kind: "walk", goal: endGoal, show: false };
  }

  function update(dt, c) {
    time += dt; const L = leg(c), x = c.x, z = c.z;
    let replan = !cur || cur.key !== L.key;
    if (!replan && cur.s != null) { cur.s = cur.path.nearest(x, z, cur.s, 80); const p = cur.path.at(cur.s, {}), off = Math.hypot(p.x - x, p.z - z);
      if (!L.fixed && !L.straight && off > (L.dynamic ? OFF_DRIVE : OFF_WALK) && time - lastPlan > (L.dynamic ? DRIVE_GAP : REPLAN_GAP)) replan = true; }
    if (!replan && L.fixed && cur.path !== L.fixed) replan = true; // the vehicle was given another road: follow that one
    if (!replan && L.straight) replan = time - lastPlan > 0.25; // a few metres: straight from the person to the door, kept up to date
    if (replan) {
      lastPlan = time; let r = null;
      if (L.fixed) r = { path: L.fixed, ok: true };
      else if (L.straight) r = { path: new Path([[x, z], [L.goal.x, L.goal.z]]), ok: true };
      else if (L.dynamic) r = (cur?.key === "drive" ? driveRoute(x, z) : null) ?? (cur?.key === "drive" ? { path: cur.path, ok: cur.ok } : { path: plan.route.path, ok: true });
      else r = walkRoute(x, z, L.goal);
      const changedPath = !cur || cur.path !== r.path; cur = { key: L.key, path: r.path, ok: r.ok, s: 0, kind: L.kind };
      cur.s = L.fixed ? (c.ride?.s ?? 0) : cur.path.nearest(x, z, 0, cur.path.len + 1); if (changedPath || cur.key !== out.key) rev++;
    }
    if (L.fixed) cur.s = Math.max(cur.s ?? 0, c.ride?.s ?? cur.path.nearest(x, z, cur.s ?? 0, 80));
    const pts = remainingPts(cur.path, cur.s ?? 0, x, z);
    out = { pts, len: lenOf(pts), kind: cur.kind, show: L.show, rev, s: cur.s ?? 0, path: cur.path, goal: L.goal ?? null, ok: cur.ok, key: L.key };
    return out;
  }
  return { update, reset() { cur = null; }, get current() { return out; } };
}
