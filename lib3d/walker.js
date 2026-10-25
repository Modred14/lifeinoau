// lib3d/walker.js
// A person on foot, and how they find their way. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//   createNav()   plans a walking route that goes round buildings and parked vehicles, keeps to pavements where it can, and crosses roads at the marked crossings
//   Walker        ONE controller for a person: it takes either the player's own stick/keys or a planned route, never both fighting. It has speed and turning
//                 that depend on elapsed time (not frames), and it moves through lib3d/collide.js, so it cannot enter a building or a vehicle.
// Metres, x east, z south.
import { Heap } from "./roadgraph.js";
import { WALK_SPEED } from "../lib/travel.js";

export const WALK_R = 0.32;               // the person's radius
export const NAV_CLEAR = 1.15;            // the planner keeps this far from a wall (the walker itself only needs WALK_R)
const CELL = 1.5, HEUR = 1.8 /* weighted A*: greedier than exact, so a detour round a big obstacle costs a few thousand cells, not hundreds of thousands; routes stay within a few percent of the best */, COST = { ground: 1.25, pavement: 1.0, road: 3.6, crossing: 1.1 };
const SQ2 = Math.SQRT2;

/**
 * world: a CollisionWorld. graph: a road graph (for pavement / carriageway / crossing costs), or null. The grid is filled in lazily, only where a search looks.
 */
export function createNav({ world, graph = null }) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of world.polys) { x0 = Math.min(x0, p.bb[0]); x1 = Math.max(x1, p.bb[2]); z0 = Math.min(z0, p.bb[1]); z1 = Math.max(z1, p.bb[3]); }
  for (const n of graph?.nodes ?? []) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
  x0 = Math.floor(x0 - 120); z0 = Math.floor(z0 - 120); x1 = Math.ceil(x1 + 120); z1 = Math.ceil(z1 + 120);
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL), clear = new Uint8Array(nx * nz), cls = new Uint8Array(nx * nz), surf = {};
  const cx = (i) => x0 + (i + 0.5) * CELL, cz = (j) => z0 + (j + 0.5) * CELL, ix = (x) => Math.floor((x - x0) / CELL), iz = (z) => Math.floor((z - z0) / CELL), inb = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz;
  /** 1 = blocked, 2.. = clearance in tenths of a metre (+2), for the cell centre. */
  function clearOf(i, j) { const k = j * nx + i; let c = clear[k]; if (!c) { const sd = world.sdf(cx(i), cz(j), 6); c = sd < 0 ? 1 : 2 + Math.min(250, Math.round(sd * 10)); clear[k] = c; } return c; }
  function kindOf(i, j) { const k = j * nx + i; let c = cls[k]; if (!c) { if (!graph) c = 1; else { const sf = graph.surfaceAt(cx(i), cz(j), surf); c = sf.cls === 1 ? (graph.onCrossing(cx(i), cz(j)) ? 4 : 3) : sf.cls === 2 ? 2 : 1; } cls[k] = c; } return c; }
  const costOf = (c) => (c === 2 ? COST.pavement : c === 3 ? COST.road : c === 4 ? COST.crossing : COST.ground);
  /** Walking cost per metre at a point (pavement 1, open ground 1.25, a crossing 1.1, the road 3.6). */
  const costAt = (x, z) => { const i = ix(x), j = iz(z); return inb(i, j) ? costOf(kindOf(i, j)) : 5; };

  /** The closest free grid cell to (x, z) that can be reached from it in a straight line (so the first and last leg of a route never clip a corner). */
  function nearestFree(x, z, r = 5) {
    let best = null; const i0 = ix(x), j0 = iz(z);
    for (let d = 0; d <= r; d++) for (let j = j0 - d; j <= j0 + d; j++) for (let i = i0 - d; i <= i0 + d; i++) {
      if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== d || !inb(i, j) || clearOf(i, j) < 2 + NAV_CLEAR * 10) continue;
      const dd = Math.hypot(cx(i) - x, cz(j) - z); if (best && dd >= best.d) continue;
      if (dd > 0.4 && !world.segmentClear(x, z, cx(i), cz(j), WALK_R + 0.05, { bodies: false })) continue;
      best = { i, j, d: dd };
    }
    return best;
  }

  /**
   * A walking route from (ax, az) to (bx, bz): { pts: [[x, z]...], len, ok }. `ignore` is a Set of vehicle body ids that are not obstacles (the one being
   * boarded). Vehicles still standing are walked around. Falls back to a straight line when it is clear, and ok = false when there is no way.
   */
  function plan(ax, az, bx, bz, { ignore = null, maxNodes = 400000 } = {}) {
    const blockedByBody = (x, z) => { for (const b of world.bodies.values()) { if (ignore?.has(b.id)) continue; const dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz > (b.hl + b.hw + 1.4) ** 2) continue; const u = dx * b.hx + dz * b.hz, w = dx * -b.hz + dz * b.hx; if (Math.abs(u) < b.hl + 0.75 && Math.abs(w) < b.hw + 0.75) return true; } return false; };
    if (Math.hypot(bx - ax, bz - az) < 0.5) return { pts: [[ax, az], [bx, bz]], len: Math.hypot(bx - ax, bz - az), ok: true };
    const s = nearestFree(ax, az), g = nearestFree(bx, bz, 8); if (!s || !g) return fallback();
    const si = s.j * nx + s.i, gi = g.j * nx + g.i, G = new Map([[si, 0]]), from = new Map(), heap = new Heap(), done = new Set(); heap.push(0, si);
    const h = (i, j) => { const dx = Math.abs(i - g.i), dz = Math.abs(j - g.j); return (Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz)) * CELL * HEUR; };
    const pass = (i, j, k) => inb(i, j) && (k === gi || (clearOf(i, j) >= 2 + NAV_CLEAR * 10 && !blockedByBody(cx(i), cz(j))));
    let n = 0, found = false; plan.nodes = 0;
    while (heap.size && n++ < maxNodes) {
      const [, cur] = heap.pop(); if (done.has(cur)) continue; done.add(cur); if (cur === gi) { found = true; break; }
      const ci = cur % nx, cj = (cur / nx) | 0, base = G.get(cur);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = ci + di, nj = cj + dj, k = nj * nx + ni; if (done.has(k) || !pass(ni, nj, k)) continue;
        if (di && dj && !(pass(ci + di, cj, -2) && pass(ci, cj + dj, -2))) continue;           // no cutting a corner
        const step = (di && dj ? SQ2 : 1) * CELL * (costOf(kindOf(ni, nj)) + costOf(kindOf(ci, cj))) * 0.5, gg = base + step;
        if (gg < (G.get(k) ?? Infinity)) { G.set(k, gg); from.set(k, cur); heap.push(gg + h(ni, nj), k); }
      }
    }
    plan.nodes = n; if (!found) return fallback();
    const cells = []; for (let k = gi; k !== undefined; k = from.get(k)) { cells.push([cx(k % nx), cz((k / nx) | 0)]); if (k === si) break; }
    cells.reverse(); const pts = [[ax, az], ...cells, [bx, bz]];   // the first and last cell are kept: they are the cells with a clear line to the start and the goal
    return finish(pull(pts, ignore));
    function fallback() { if (world.segmentClear(ax, az, bx, bz, WALK_R + 0.1, { ignore })) return finish([[ax, az], [bx, bz]]); return { pts: [[ax, az]], len: 0, ok: false }; }
  }
  const finish = (pts) => { let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return { pts, len, ok: true }; };
  /** Straightens a route wherever a straight line is clear AND no more expensive (so it does not cut across a road just because it can). */
  function pull(pts, ignore) {
    if (pts.length < 3) return pts; const out = [pts[0]]; let i = 0;
    const lineCost = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(l / CELL)); let c = 0; for (let k = 0; k < m; k++) c += costAt(a[0] + ((b[0] - a[0]) * (k + 0.5)) / m, a[1] + ((b[1] - a[1]) * (k + 0.5)) / m) * (l / m); return c; };
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) { if (!world.segmentClear(pts[i][0], pts[i][1], pts[j][0], pts[j][1], WALK_R + 0.35, { ignore })) continue; let orig = 0; for (let k = i; k < j; k++) orig += lineCost(pts[k], pts[k + 1]); if (lineCost(pts[i], pts[j]) <= orig * 1.04 + 0.5) break; }
      out.push(pts[j]); i = j;
    }
    return out;
  }
  /** A spot to stand near (x, z) that is clear of walls by the planner's margin: the point itself when it already is, else the nearest free spot in sight. */
  function stand(x, z) { if (world.sdf(x, z, 3) >= 1.0 && !world.blockedAt(x, z, WALK_R + 0.6)) return { x, z }; const f = nearestFree(x, z, 8); return f ? { x: cx(f.i), z: cz(f.j) } : { x, z }; }
  return { plan, stand, costAt, clearAt: (x, z) => { const i = ix(x), j = iz(z); return inb(i, j) ? (clearOf(i, j) - 2) / 10 : 0; } };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Polyline helper for following a route: arclength table and a point at a distance. */
function pathOf(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, len: cum[cum.length - 1] }; }
function pointAt(p, s, out) { s = clamp(s, 0, p.len); let i = 1; while (i < p.pts.length - 1 && p.cum[i] < s) i++; const a = p.pts[i - 1], b = p.pts[i], l = p.cum[i] - p.cum[i - 1] || 1, t = (s - p.cum[i - 1]) / l; out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t; return out; }

/**
 * The person. Either the player steers (`step(dt, { dx, dz, mag, run })`, dx/dz a direction in the world) or a route is being followed (`follow(pts)`);
 * the player's own input always wins and a route resumes `resumeAfter` seconds after they let go. The walker does not know about animation: it reports
 * `speed` (m/s) and a facing, and the caller plays the matching clip.
 */
export class Walker {
  constructor(world, nav, { x = 0, z = 0, hx = 0, hz = 1, resumeAfter = 1.2 } = {}) {
    Object.assign(this, { world, nav, x, z, hx, hz, vx: 0, vz: 0, speed: 0, blocked: false, ignore: null, resumeAfter, manualAt: -99, time: 0, off: 0, path: null, ps: 0, goal: null, onDone: null, replans: 0, lastProg: 0, lastProgAt: 0, mode: "idle", failed: null, yieldToPlayer: false });
  }
  /** Starts following a route (see createNav().plan). `goal` {x, z} is where it ends; if the route is blocked the walker plans again from where it stands. */
  follow(route, { goal = null, tolerance = 0.35, ignore = null, onDone = null, yieldToPlayer = false } = {}) {
    this.path = route?.pts?.length > 1 ? pathOf(route.pts) : null; this.ps = 0; this.goal = goal ?? (route?.pts ? { x: route.pts.at(-1)[0], z: route.pts.at(-1)[1] } : null); this.tol = tolerance; this.ignore = ignore; this.onDone = onDone; this.yieldToPlayer = yieldToPlayer; this.replans = 0; this.lastProg = 0; this.lastProgAt = this.time; this.failed = null; this.mode = this.path ? "auto" : "idle";
    if (!this.path) { const cb = this.onDone; this.onDone = null; cb?.("arrived"); }
  }
  cancelRoute() { this.path = null; this.onDone = null; this.mode = "idle"; this.yieldToPlayer = false; }
  get following() { return !!this.path; }
  /** Puts the person somewhere (never into a wall), and stops them. */
  place(x, z) { const p = this.world.pushOut(x, z, WALK_R, { ignore: this.ignore }); this.x = p.x; this.z = p.z; this.vx = this.vz = 0; this.speed = 0; }

  /**
   * Moves the person along the route they are following by `speed` m/s for dt seconds, at exactly that pace (no easing, no stick or keys): used when the walk to
   * a vehicle has to fit in a few seconds however far the kerb is. The route was planned around everything solid, so nothing is walked through.
   * Finishes the route like a normal walk does when the end is reached. Returns true while there is still route left.
   */
  glide(dt, speed) {
    const P = this.path; if (!P) return false;
    this.time += dt; const ox = this.x, oz = this.z, ds = Math.max(0, speed) * dt;
    this.ps = Math.min(P.len, this.ps + ds); const q = pointAt(P, this.ps, {});
    this.x = q.x; this.z = q.z; this.off = 0; this.mode = "auto"; this.lastProg = this.ps; this.lastProgAt = this.time;
    const mx = this.x - ox, mz = this.z - oz, ml = Math.hypot(mx, mz);
    if (ml > 1e-6) { this.hx = mx / ml; this.hz = mz / ml; this.vx = this.hx * speed; this.vz = this.hz * speed; this.speed = speed; }
    this.blocked = false;
    const end = P.pts.at(-1);
    if (this.ps >= P.len - 1e-6 || Math.hypot(end[0] - this.x, end[1] - this.z) <= (this.tol ?? 0.35)) { this.vx = this.vz = 0; this.speed = 0; this._finish("arrived"); return false; }
    return true;
  }

  /** Advances by dt seconds, in steps of at most 1/60 s so the result barely depends on frame rate. input: { dx, dz, mag (0..1), run }. Returns this. */
  step(dt, input = null) {
    const n = Math.max(1, Math.ceil(dt / (1 / 60))), h = dt / n; for (let i = 0; i < n; i++) this._sub(h, input); return this;
  }
  _sub(dt, input) {
    this.time += dt; const manual = input && input.mag > 0.06; let dx = 0, dz = 0, mag = 0, run = !!input?.run;
    // a walk the player asked for (they tapped a place) belongs to them: touching the stick or the keys ends it, and it does not start again by itself
    if (manual && this.path && this.yieldToPlayer) { const cb = this.onDone; this.cancelRoute(); cb?.("cancelled"); }
    if (manual) { const l = Math.hypot(input.dx, input.dz) || 1; dx = input.dx / l; dz = input.dz / l; mag = Math.min(1, input.mag); this.manualAt = this.time; this.mode = "manual"; }
    else if (this.path && this.time - this.manualAt > this.resumeAfter) { const t = this._carrot(); if (t) { dx = t.dx; dz = t.dz; mag = t.mag; this.mode = "auto"; run = false; } }
    else if (!this.path) this.mode = "idle";
    const vmax = (run ? WALK_SPEED.run : WALK_SPEED.walk) * mag, tx = dx * vmax, tz = dz * vmax;
    // speed up and slow down at a steady rate (so a tap does not teleport and a release does not snap to a stop)
    const ax = tx - this.vx, az = tz - this.vz, am = Math.hypot(ax, az), maxA = (mag > 0 ? 26 : 34) * dt; if (am > maxA) { this.vx += (ax / am) * maxA; this.vz += (az / am) * maxA; } else { this.vx = tx; this.vz = tz; }
    const r = this.world.moveCircle(this.x, this.z, this.vx * dt, this.vz * dt, WALK_R, { ignore: this.ignore }); this.x = r.x; this.z = r.z; this.blocked = r.hit;
    if (r.hit) { const d = this.vx * r.nx + this.vz * r.nz; if (d < 0) { this.vx -= d * r.nx; this.vz -= d * r.nz; } }
    this.speed = Math.hypot(this.vx, this.vz);
    // face where the person is trying to go (not where the wall pushed them), turning at a steady rate whatever the frame rate
    const fx = mag > 0 ? dx : this.speed > 0.4 ? this.vx / this.speed : 0, fz = mag > 0 ? dz : this.speed > 0.4 ? this.vz / this.speed : 0;
    if (fx || fz) { const want = Math.atan2(fx, fz), cur = Math.atan2(this.hx, this.hz); let d = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI; const a = cur + d * (1 - Math.exp(-14 * dt)); this.hx = Math.sin(a); this.hz = Math.cos(a); }
    if (this.path && this.mode === "auto") this._check();
  }
  /** The point to walk at, 1.4 m ahead along the route, and how hard to walk (easing off over the last metre or so). */
  _carrot() {
    const P = this.path, here = { x: this.x, z: this.z }; // progress: nearest point of the route, never going backwards by much
    let best = Infinity, bs = this.ps; for (let i = 1; i < P.pts.length; i++) { if (P.cum[i] < this.ps - 3) continue; if (P.cum[i - 1] > this.ps + 12) break; const a = P.pts[i - 1], b = P.pts[i], ddx = b[0] - a[0], ddz = b[1] - a[1], l2 = ddx * ddx + ddz * ddz || 1; let t = ((here.x - a[0]) * ddx + (here.z - a[1]) * ddz) / l2; t = clamp(t, 0, 1); const d = Math.hypot(here.x - (a[0] + ddx * t), here.z - (a[1] + ddz * t)); if (d < best) { best = d; bs = P.cum[i - 1] + t * Math.sqrt(l2); } }
    this.ps = Math.max(this.ps, bs); this.off = best; const end = P.pts.at(-1), dEnd = Math.hypot(end[0] - this.x, end[1] - this.z);
    if (dEnd <= (this.tol ?? 0.35)) { this._finish("arrived"); return null; }
    const tgt = pointAt(P, Math.min(P.len, this.ps + 1.4), {}), ddx = tgt.x - this.x, ddz = tgt.z - this.z, dl = Math.hypot(ddx, ddz) || 1;
    return { dx: ddx / dl, dz: ddz / dl, mag: P.len - this.ps < 1.4 ? clamp(dEnd / 1.4, 0.3, 1) : 1 };
  }
  /** If the person has not got anywhere for a while, plan again from here; give up after a few tries instead of pushing at a wall for ever. */
  _check() {
    if (this.ps > this.lastProg + 0.3) { this.lastProg = this.ps; this.lastProgAt = this.time; return; }
    if (this.time - this.lastProgAt < 1.6 || !this.goal) return;
    if (this.replans >= 3) { this._finish("blocked"); return; }
    this.replans++; const r = this.nav.plan(this.x, this.z, this.goal.x, this.goal.z, { ignore: this.ignore });
    if (!r.ok || r.pts.length < 2) { this._finish("blocked"); return; }
    this.path = pathOf(r.pts); this.ps = 0; this.lastProg = 0; this.lastProgAt = this.time;
  }
  _finish(why) { const cb = this.onDone; this.path = null; this.onDone = null; this.mode = "idle"; this.failed = why === "arrived" ? null : why; cb?.(why); }
}