// lib3d/trafficsim.js
// Everything that drives on the campus roads, as a simulation with no drawing in it (pure JS: runs in the browser and in the tests).
// Vehicles follow ROUTES over the lane graph (roadgraph.js), so they can only ever be on a road, in the lane for their direction, taking the
// curves the junctions give them. On top of that:
//   - car-following (IDM): each vehicle looks ahead along its own route for the nearest thing in the way (another vehicle, a person, the player's car,
//     the end of its route) and brakes smoothly for it, so nothing overlaps and nothing stops dead,
//   - junctions: before a vehicle enters a junction it asks for the connector it needs; it is only given it if no crossing connector is reserved and
//     there is room to leave on the other side, otherwise it waits at the stop line (first come, first served),
//   - spawning around a focus point (the camera): at a clear spot on a lane, away from the player, and despawning far away or when stuck for long,
//   - pedestrians who walk the pavements,
//   - "hero" vehicles for the player's journey: the same vehicles, with a route, a stopping point and a hold.
// Metres, x east, z south. A vehicle's position is its centre; `s` is how far along its route that centre is.
import { boxesOverlap } from "./collide.js";

export const KINDS = {
  // doorZ: where the passenger door is along the vehicle (metres from the middle, nose is +); seat: where a passenger sits, in the vehicle's own space
  // (x is +left, -right: traffic keeps right, so the kerb and the door are on the right). driver: the driver's seat (null: the keke model has its own).
  car: { len: 4.5, wid: 1.85, cruise: [8.5, 13], aMax: 2.2, brake: 3.2, weight: 0.72, doorZ: -0.5, doorZL: 0.3, seat: { x: -0.45, y: 0.5, z: -0.5 }, driver: { x: 0.45, y: 0.5, z: 0.35 } },
  keke: { len: 2.78, wid: 1.3, cruise: [6.5, 9.5], aMax: 1.7, brake: 3.0, weight: 0.18, doorZ: -0.45, seat: { x: 0, y: 0.62, z: -0.72 }, driver: null },
  bus: { len: 6.08, wid: 1.88, cruise: [7.5, 10.5], aMax: 1.3, brake: 2.8, weight: 0.10, doorZ: -0.6, doorZL: 0.97, seat: { x: -0.5, y: 0.71, z: -0.54 }, driver: { x: 0.45, y: 0.8, z: 1.35 } },
};
/** Where a person sits in a vehicle kind (its own space); a kind that has no seat (a trek is on foot: no kind at all) falls back to the car's, so asking never throws. */
export const seatOf = (kind) => KINDS[kind]?.seat ?? KINDS.car.seat;
/** Where, in the world, a passenger stands to use a vehicle's door: just outside its right-hand side (side -1, the default) or its left, the driver's (side +1). `v` is { x, z, hx, hz, kind } (centre and heading). */
export function doorPoint(v, kind = v.kind, side = -1) {
  const d = KINDS[kind], z = side > 0 ? (d.doorZL ?? d.doorZ) : d.doorZ, rx = -v.hz * -side, rz = v.hx * -side, k = (v.wid ?? d.wid) / 2 + 0.55;
  return { x: v.x + v.hx * z + rx * k, z: v.z + v.hz * z + rz * k };
}
/** A point given in a vehicle's own space ({ x: left+, z: forward+ }) as a point in the world. */
export function toWorld(v, local) { return { x: v.x + v.hx * local.z + v.hz * local.x, z: v.z + v.hz * local.z - v.hx * local.x }; }
export const DENSITY = { vehicles: 12, peds: 10, spawnMin: 80, spawnMax: 230, despawn: 320 };
const T_HEAD = 1.3, S0 = 2.0, PED_W = 0.6, PED_ACTS = ["phone", "talk", "lookAround"];

/**
 * The one rule for how a vehicle speeds up and slows down (the Intelligent Driver Model): it accelerates towards its wanted speed `v0`, and brakes
 * smoothly for whatever is `gap` metres ahead (moving at `vl`), never harder than it must. `gap` = Infinity means a clear road.
 * The simulation, and the journey-time estimate in tripplan.js, both call this, so what is promised on screen is what the vehicle does.
 */
export function idmAccel(v, v0, aMax, brake, gap = Infinity, vl = 0, s0 = S0) {
  let acc = aMax * (1 - Math.pow(v / Math.max(0.5, v0), 4));
  if (gap < Infinity) { const sStar = s0 + Math.max(0, v * T_HEAD + (v * (v - vl)) / (2 * Math.sqrt(aMax * brake))); acc -= aMax * (sStar / Math.max(0.05, gap)) ** 2; }
  return Math.max(-8, Math.min(aMax, acc));
}
/** How long (seconds) a vehicle takes to drive `route` from distance `s0` at speed `v0` to a stop at its end, on an empty road. Same motion as the simulation. */
export function rideTime(route, { cruise, aMax, brake }, s0 = 0, v0 = 0) {
  let s = s0, v = v0, t = 0; const dt = 0.1;
  while (t < 3600) {
    const lim = Math.min(cruise, route.vAt(Math.min(route.len, s + 3 + v * 0.8))), acc = idmAccel(v, lim, aMax, brake, route.len - s, 0, 0.25);
    v = Math.max(0, v + acc * dt); s = Math.min(route.len, s + v * dt); t += dt;
    if (route.len - s < 0.8 && v < 0.3) break;
    if (v < 0.01 && t > 5 && route.len - s > 5 && acc <= 0) return Infinity;
  }
  return t;
}

/**
 * The same motion as rideTime(), recorded, then played back over exactly `duration` seconds (or at its natural pace when `duration` is omitted).
 * The shape of the ride is kept (it pulls away, slows for bends and junctions, brakes to a stop at the end); only its pace changes. at(t) -> { s, v }:
 * how far along the route the vehicle is after t seconds of the ride, and how fast it is going. Returns null when the vehicle can never finish the route.
 */
export function rideProfile(route, { cruise, aMax, brake }, duration = null) {
  let s = 0, v = 0, t = 0; const dt = 0.1, S = [0], V = [0];
  while (t < 3600) {
    const lim = Math.min(cruise, route.vAt(Math.min(route.len, s + 3 + v * 0.8))), acc = idmAccel(v, lim, aMax, brake, route.len - s, 0, 0.25);
    v = Math.max(0, v + acc * dt); s = Math.min(route.len, s + v * dt); t += dt; S.push(s); V.push(v);
    if (route.len - s < 0.8 && v < 0.3) break;
    if (v < 0.01 && t > 5 && route.len - s > 5 && acc <= 0) return null;
  }
  S.push(route.len); V.push(0); t += dt;   // the last little bit: it comes to rest exactly at the end of the route
  const raw = t, dur = duration ?? raw, k = raw / dur, n = S.length - 1;
  return {
    dur, raw,
    at(u) {
      if (u >= dur) return { s: route.len, v: 0 };   // exactly at rest at the end, with no rounding left over
      const x = Math.max(0, Math.min(dur, u)) * k / dt, i = Math.min(n - 1, Math.floor(x)), f = Math.max(0, Math.min(1, x - i));
      return { s: S[i] + (S[i + 1] - S[i]) * f, v: (V[i] + (V[i + 1] - V[i]) * f) * k };
    },
  };
}

const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/** Closest point of path to (x, z) searching only arclength [s0, s1]: [s, distance]. Walks just that stretch, so it is cheap on a long route. */
function nearestOnPath(path, x, z, s0, s1) {
  const P = path.pts, C = path.cum; let lo = 0, hi = P.length - 1; s0 = Math.max(0, s0);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= s0) lo = m; else hi = m; }
  let best = Infinity, bs = s0;
  for (let i = lo; i < P.length - 1 && C[i] <= s1; i++) {
    const ax = P[i][0], az = P[i][1], dx = P[i + 1][0] - ax, dz = P[i + 1][1] - az, l2 = dx * dx + dz * dz || 1; let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d2 = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2; if (d2 < best) { best = d2; bs = C[i] + t * Math.sqrt(l2); }
  }
  return [bs, Math.sqrt(best)];
}

/**
 * graph: from buildRoadGraph. world: a CollisionWorld (vehicles are registered in it as boxes so walkers cannot pass through them), or null.
 * focus(): { x, z } where the action is (the camera). rnd(): 0..1. density: see DENSITY.
 */
export function createTrafficSim({ graph, world = null, focus = () => ({ x: 0, z: 0 }), rnd = Math.random, density = {} }) {
  const D = { ...DENSITY, ...density }, vehicles = [], peds = [], external = new Map(), reserved = new Map(); let nextId = 1, time = 0, spawnCool = 0, pedCool = 0;
  const mainLanes = graph.lanes.filter((l) => l.comp === 0 && l.len > 18 && !l.hw);   // ambient traffic keeps to the campus roads: never the expressway or its ramps
  const stats = { spawned: 0, despawned: 0, stuckRemoved: 0, maxOverlapFixed: 0 };

  // ---------- routes ----------
  /** A random drive of at least `minLen` metres starting on `lane` at `s`: at each junction mostly straight on, sometimes a turn, never a U-turn. */
  function wander(lane, s, minLen = 2200) {
    const segs = [{ kind: "lane", id: lane, s0: s, s1: graph.lanes[lane].len }]; let total = graph.lanes[lane].len - s, cur = lane, guard = 0;
    while (total < minLen && guard++ < 80) {
      const outs = graph.lanes[cur].out.map((c) => graph.conns[c]).filter((c) => c.kind !== "uturn" && graph.lanes[c.to].comp === 0 && !graph.lanes[c.to].hw); if (!outs.length) break;
      const w = outs.map((c) => (c.kind === "straight" ? 0.58 : 0.21)), sum = w.reduce((a, b) => a + b, 0); let r = rnd() * sum, pick = outs[0]; for (let i = 0; i < outs.length; i++) { r -= w[i]; if (r <= 0) { pick = outs[i]; break; } }
      segs.push({ kind: "conn", id: pick.id }); const nl = graph.lanes[pick.to]; segs.push({ kind: "lane", id: nl.id, s0: 0, s1: nl.len }); total += pick.len + nl.len; cur = nl.id;
    }
    return graph.makeRoute(segs);
  }
  const pickKind = () => {
    const have = {}; for (const v of vehicles) if (v.role === "npc" && !v.custom && !v.done) have[v.kind] = (have[v.kind] ?? 0) + 1;
    const open = Object.entries(KINDS).filter(([k]) => D.limits?.[k] == null || (have[k] ?? 0) < D.limits[k]); if (!open.length) return null;
    let r = rnd() * open.reduce((s, [, d]) => s + d.weight, 0), k = open[0][0]; for (const [name, def] of open) { r -= def.weight; if (r <= 0) { k = name; break; } } return k;
  };

  function make(kind, route, opts = {}) {
    const def = KINDS[kind], a = { id: nextId++, kind, len: opts.len ?? def.len, wid: opts.wid ?? def.wid, aMax: opts.aMax ?? def.aMax, brake: opts.brake ?? def.brake, route, s: opts.s ?? 0, v: opts.v ?? 0, si: 0, role: opts.role ?? "npc",
      cruise: opts.cruise ?? def.cruise[0] + rnd() * (def.cruise[1] - def.cruise[0]), stopAt: opts.stopAt ?? null, hold: !!opts.hold, res: null, waitSince: null, stillFor: 0, acc: 0, x: 0, z: 0, hx: 0, hz: 1, yaw: 0, laneId: -1, laneS: 0, color: opts.color ?? null, tint: rnd(), done: false, born: time };
    pose(a); vehicles.push(a); stats.spawned++; return a;
  }
  /** Where the vehicle is and which way its body points (from a point behind its centre to one in front, so it swings through a curve like a real one). */
  function pose(a) {
    const P = a.route.path, p = P.at(a.s, {}), f = P.at(Math.min(P.len, a.s + a.len * 0.3), {}), r = P.at(Math.max(0, a.s - a.len * 0.3), {});
    a.x = p.x; a.z = p.z; let hx = f.x - r.x, hz = f.z - r.z; const l = Math.hypot(hx, hz); if (l > 1e-3) { a.hx = hx / l; a.hz = hz / l; } else { a.hx = p.hx; a.hz = p.hz; } a.yaw = Math.atan2(a.hx, a.hz);
    while (a.si < a.route.segs.length - 1 && a.s >= a.route.segs[a.si].end) a.si++;
    const sg = a.route.segs[a.si]; if (sg.kind === "lane") { a.laneId = sg.id; a.laneS = sg.s0 + (a.s - sg.start); } else { a.laneId = graph.conns[sg.id].to; a.laneS = 0; }
  }

  // ---------- obstacles ----------
  /**
   * The nearest thing in the way along a's route, as { gap (from the front of a to where it would touch), v (the other's speed along my route) }.
   * My own box is swept along my route and tested against each other box, so a vehicle angled into my path counts even when its centre is not on my line.
   */
  const probe = { x: 0, z: 0, hx: 0, hz: 1, hl: 0, hw: 0 }, at = {};
  function leaderOf(a) {
    const H = Math.min(60, 10 + a.v * 3.4), P = a.route.path; let best = null; probe.hl = a.len / 2; probe.hw = a.wid / 2 + 0.1;
    const consider = (b, bLen, bWid, bv, bhx, bhz) => {
      const dx = b.x - a.x, dz = b.z - a.z; if (dx * dx + dz * dz > (H + a.len + bLen) ** 2) return;
      const behind = dx * a.hx + dz * a.hz < -0.2, B = { x: b.x, z: b.z, hx: bhx, hz: bhz, hl: bLen / 2, hw: bWid / 2 };
      for (let k = 0; k <= H; k += 1.2) {
        const sc = a.s + k; if (sc > P.len) break; P.at(sc, at); probe.x = at.x; probe.z = at.z; probe.hx = at.hx; probe.hz = at.hz;
        // something behind me that I already touch has to give way to me; but something behind me that my body WOULD sweep into (I am turning) counts
        if (boxesOverlap(probe, B, 0.02)) { if (k === 0 && behind) return; const gap = k - 0.6; if (!best || gap < best.gap) best = { gap, v: Math.max(0, bv * (bhx * at.hx + bhz * at.hz)), who: b }; return; }
      }
    };
    for (const b of vehicles) if (b !== a && !b.done) consider(b, b.len, b.wid, b.v, b.hx, b.hz);
    for (const [id, b] of external) { if (a.ignoreExt?.has(id)) continue; consider(b, b.len ?? 1, b.wid ?? 1, b.v ?? 0, b.hx ?? 0, b.hz ?? 1); }
    for (const p of peds) consider(p, PED_W, PED_W, p.v, p.hx, p.hz);
    return best;
  }

  // ---------- junctions ----------
  // do two vehicles, driving two different turns of one junction, ever have their BODIES in the same place? (cached per pair of turns and sizes; the paths alone
  // can be metres apart while a long bus and a car still clip each other)
  const bodyConf = new Map(), cbA = { x: 0, z: 0, hx: 0, hz: 1, hl: 0, hw: 0 }, cbB = { x: 0, z: 0, hx: 0, hz: 1, hl: 0, hw: 0 }, pa = {}, pb = {};
  const bodiesConflict = (ka, ca, kb, cb) => {
    const key = ka + ca + "|" + kb + cb; let v = bodyConf.get(key); if (v !== undefined) return v; v = false;
    const A = KINDS[ka], B = KINDS[kb], PA = graph.conns[ca].path, PB = graph.conns[cb].path; cbA.hl = A.len / 2; cbA.hw = A.wid / 2; cbB.hl = B.len / 2; cbB.hw = B.wid / 2;
    outer: for (let s = 0; s <= PA.len; s += 1.0) { PA.at(s, pa); cbA.x = pa.x; cbA.z = pa.z; cbA.hx = pa.hx; cbA.hz = pa.hz;
      for (let u = 0; u <= PB.len; u += 1.0) { PB.at(u, pb); if (Math.abs(pb.x - pa.x) > 9 || Math.abs(pb.z - pa.z) > 9) continue; cbB.x = pb.x; cbB.z = pb.z; cbB.hx = pb.hx; cbB.hz = pb.hz; if (boxesOverlap(cbA, cbB, -0.15)) { v = true; break outer; } } }
    bodyConf.set(key, v); return v;
  };
  const conflictsWithReserved = (conn, a) => { for (const b of vehicles) { if (b === a || b.res == null || b.done) continue; if (b.res === conn.id) continue; if (conn.conflicts.includes(b.res) || (graph.conns[b.res].node === conn.node && bodiesConflict(a.kind, conn.id, b.kind, b.res))) return true; } return false; };
  // a vehicle still waiting at the end of a neighbouring lane that this connector sweeps past: let whoever has waited longer go first (a strict order, so nobody waits in a circle)
  const blockedByWaiting = (conn, a) => { const mine = a.waitSince ?? Infinity; for (const b of vehicles) { if (b === a || b.done || b.res != null) continue; const sg = b.route.segs[b.si]; if (sg.kind !== "lane" || !conn.lanesNear.includes(sg.id)) continue; if (b.laneS < graph.lanes[sg.id].len - 7) continue; const theirs = b.waitSince ?? Infinity; if (theirs < mine || (theirs === mine && b.id < a.id)) return true; } return false; };
  // would my body, driven through this turn, touch any vehicle that is already there? (a long bus waiting in a turn reaches back across the next arm)
  const sweepBox = { x: 0, z: 0, hx: 0, hz: 1, hl: 0, hw: 0 }, sweepAt = {};
  const sweepBlocked = (a, nxt) => {
    const P = a.route.path; sweepBox.hl = a.len / 2; sweepBox.hw = a.wid / 2;
    for (let sc = Math.max(a.s, nxt.start - 1); sc <= nxt.end + a.len / 2; sc += 1.2) {
      if (sc > P.len) break; P.at(sc, sweepAt); sweepBox.x = sweepAt.x; sweepBox.z = sweepAt.z; sweepBox.hx = sweepAt.hx; sweepBox.hz = sweepAt.hz;
      for (const b of vehicles) { if (b === a || b.done) continue; if (Math.abs(b.x - sweepBox.x) > 8 || Math.abs(b.z - sweepBox.z) > 8) continue; if (boxesOverlap(sweepBox, { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 }, -0.2)) return true; }
      // the player's own car is not under the junction rules, so give way to it: where it is now, and where it will be in a moment at its present speed
      for (const [id, b] of external) { if ((b.len ?? 0) < 2 || a.ignoreExt?.has(id)) continue; const reach = Math.min(40, Math.max(0, b.v ?? 0) * 3.5) + (b.len ?? 4) / 2;
        if (Math.abs(b.x - sweepBox.x) > 9 + reach || Math.abs(b.z - sweepBox.z) > 9 + reach) continue; if (boxesOverlap(sweepBox, { x: b.x + (b.hx ?? 0) * reach / 2, z: b.z + (b.hz ?? 1) * reach / 2, hx: b.hx ?? 0, hz: b.hz ?? 1, hl: reach, hw: (b.wid ?? 1.8) / 2 }, -0.3)) return true; }
    }
    return false;
  };
  // is there room for the whole vehicle beyond the junction? Looks along MY route past the end of the connector, so a short exit lane that is already full counts.
  const exitBox = { x: 0, z: 0, hx: 0, hz: 1, hl: 0, hw: 0 }, exitAt = {};
  const exitBlocked = (a, nxt) => {
    const P = a.route.path; exitBox.hl = a.len / 2 + 0.3; exitBox.hw = a.wid / 2;
    for (let k = a.len / 2 + 0.5; k <= a.len + 6; k += 1.5) {
      const sc = nxt.end + k; if (sc > P.len) break; P.at(sc, exitAt); exitBox.x = exitAt.x; exitBox.z = exitAt.z; exitBox.hx = exitAt.hx; exitBox.hz = exitAt.hz;
      for (const b of vehicles) { if (b === a || b.done) continue; if (Math.abs(b.x - exitBox.x) > 9 || Math.abs(b.z - exitBox.z) > 9) continue; if (boxesOverlap(exitBox, { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 }, 0.1)) return true; }
    }
    return false;
  };
  function arbitrate() {
    const asking = [];
    for (const a of vehicles) {
      if (a.done) continue; const sg = a.route.segs[a.si];
      // release a reservation once the rear of the vehicle has left the connector (or if the route no longer contains it)
      if (a.res != null) { const k = a.route.segs.findIndex((q) => q.kind === "conn" && q.id === a.res); if (k < 0 || (a.si > k && a.s - a.len / 2 > a.route.segs[k].end + 0.2)) a.res = null; }
      const nxt = a.route.segs[a.si + 1]; a.nextConn = null; a.stopLine = null;
      if (sg.kind === "lane" && nxt?.kind === "conn" && a.res == null) { const dist = nxt.start - (a.s + a.len / 2); if (dist < 36) { a.nextConn = nxt; a.stopLine = nxt.start; asking.push(a); } }
    }
    asking.sort((p, q) => (p.waitSince ?? 1e9) - (q.waitSince ?? 1e9) || p.id - q.id);
    for (const a of asking) {
      const conn = graph.conns[a.nextConn.id], dist = a.nextConn.start - (a.s + a.len / 2), waited = a.waitSince == null ? 0 : time - a.waitSince;
      const ok = !conflictsWithReserved(conn, a) && !blockedByWaiting(conn, a) && (waited > 30 || (!exitBlocked(a, a.nextConn) && !sweepBlocked(a, a.nextConn)));
      if (ok) { a.res = conn.id; a.waitSince = null; a.stopLine = null; }
      else { if (a.waitSince == null && dist < 14) a.waitSince = time; if (dist < (a.v * a.v) / (2 * 7) + 0.4 && a.v > 2) { a.res = conn.id; a.waitSince = null; a.stopLine = null; /* it could not stop even braking as hard as it can: it is committed, so carry on through */ } }
    }
  }

  // ---------- the step ----------
  function stepVehicle(a, dt) {
    if (a.kinematic) { a.stillFor = 0; return; }   // the player's ride is played from a recorded motion (placeAlong): the traffic model does not move it
    const route = a.route, front = a.s + a.len / 2;
    let v0 = Math.min(a.cruise, route.vAt(Math.min(route.len, a.s + 3 + a.v * 0.8)));
    if (a.hold) v0 = 0;
    // the nearest obstacle: a vehicle or person ahead, a junction I am not allowed into, or the end of my route / my stopping place
    let gap = Infinity, vl = 0, s0 = S0;
    const lead = leaderOf(a); if (lead) { gap = lead.gap; vl = lead.v; }
    if (a.stopLine != null) { const g = a.stopLine - front - 0.4; if (g < gap) { gap = g; vl = 0; s0 = 0.6; } }
    const endFront = (a.stopAt ?? (a.role === "hero" ? route.len : null)); if (endFront != null) { const g = endFront + a.len / 2 - front; if (g < gap) { gap = g; vl = 0; s0 = 0.25; } }
    let acc = idmAccel(a.v, v0, a.aMax, a.brake, gap, vl, s0);
    if (a.hold && a.v < 0.05) { a.v = 0; acc = 0; }
    a.acc = acc;
    a.v = Math.max(0, a.v + acc * dt); let ds = a.v * dt;
    if (gap < Infinity && ds > gap + 0.05 && gap > -0.5) ds = Math.max(0, gap + 0.05), a.v = ds / dt;   // never step through the thing in front
    if (endFront != null) ds = Math.min(ds, Math.max(0, endFront - a.s)); a.s += ds;
    if (a.v < 0.08) a.stillFor += dt; else a.stillFor = 0;
    pose(a);
    if (a.role === "npc" && a.s >= route.len - a.len) a.done = true;
  }
  function setBodies() { if (!world) return; for (const a of vehicles) world.setBody("veh" + a.id, { x: a.x, z: a.z, hx: a.hx, hz: a.hz, hl: a.len / 2, hw: a.wid / 2, kind: a.kind, vehicle: a }); }
  function guardOverlaps() { // a safety net, not the mechanism: if two boxes ever overlap, the one behind stops dead
    for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i], b = vehicles[j]; if (a.done || b.done) continue; if (Math.abs(a.x - b.x) > 8 || Math.abs(a.z - b.z) > 8) continue;
      const A = { x: a.x, z: a.z, hx: a.hx, hz: a.hz, hl: a.len / 2, hw: a.wid / 2 }, B = { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 };
      if (boxesOverlap(A, B, 0.05)) { stats.maxOverlapFixed++; const behind = ((b.x - a.x) * a.hx + (b.z - a.z) * a.hz) > 0 ? a : b; behind.v = 0; }
    }
  }

  // ---------- spawning ----------
  const freeSpot = (x, z, r) => { for (const b of vehicles) if (!b.done && Math.hypot(b.x - x, b.z - z) < r) return false; for (const b of external.values()) if (Math.hypot(b.x - x, b.z - z) < r + 6) return false; return true; };
  function trySpawn() {
    const f = focus(); if (!mainLanes.length) return false;
    for (let k = 0; k < 14; k++) {
      const l = mainLanes[Math.floor(rnd() * mainLanes.length)], s = rnd() * l.len, p = l.path.at(s, {}), d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < D.spawnMin || d > D.spawnMax || !freeSpot(p.x, p.z, 28)) continue;
      const kind = pickKind(); if (!kind) return false; const route = wander(l.id, s); if (!route) continue; make(kind, route, { v: 0 }).v = Math.min(KINDS[kind].cruise[0], 6); return true;
    }
    return false;
  }
  function spawnPed() {
    const f = focus(), E = graph.edges.filter((e) => e.comp === 0 && e.sw > 0 && e.len > 20); if (!E.length) return false;
    for (let k = 0; k < 14; k++) {
      const e = E[Math.floor(rnd() * E.length)], s = rnd() * e.len, p = e.path.at(s, {}), d = Math.hypot(p.x - f.x, p.z - f.z); if (d < 50 || d > D.spawnMax) continue;
      peds.push({ id: nextId++, edge: e.id, s, dir: rnd() < 0.5 ? 1 : -1, side: rnd() < 0.5 ? 1 : -1, speed: 1.0 + rnd() * 0.6, v: 1, pause: 0, nextPause: 3 + rnd() * 14, act: "idle", x: p.x, z: p.z, hx: 1, hz: 0, phase: rnd() * 6, tint: rnd() }); return true;
    }
    return false;
  }
  function stepPed(p, dt) {
    if (p.pause > 0) { p.pause -= dt; p.v = 0; if (p.pause <= 0) p.nextPause = 15 + rnd() * 30; return; }
    p.nextPause -= dt; if (p.nextPause <= 0) { p.pause = 4 + rnd() * 9; p.act = PED_ACTS[Math.floor(rnd() * PED_ACTS.length)]; p.v = 0; return; }
    const e = graph.byEdge.get(p.edge); p.s += p.dir * p.speed * dt;
    if (p.s < 0 || p.s > e.len) { // reached a junction: carry on along one of the other roads there
      const nodeId = p.s < 0 ? e.a : e.b, node = graph.nodes[nodeId], opts = node.edges.filter((id) => id !== e.id && graph.byEdge.get(id).sw > 0);
      if (!opts.length) { p.dir = -p.dir; p.s = Math.max(0, Math.min(e.len, p.s)); }
      else { const n = graph.byEdge.get(opts[Math.floor(rnd() * opts.length)]); p.edge = n.id; p.dir = n.a === nodeId ? 1 : -1; p.s = p.dir === 1 ? 0.01 : n.len - 0.01; p.side = rnd() < 0.5 ? 1 : -1; }
    }
    const ee = graph.byEdge.get(p.edge), q = ee.path.at(p.s, {}), off = p.side * (ee.half + ee.sw * 0.5); p.x = q.x - q.hz * off; p.z = q.z + q.hx * off; p.hx = q.hx * p.dir; p.hz = q.hz * p.dir; p.phase += p.speed * dt * 2.4; p.v = p.speed;
  }

  /** Advances everything by dt seconds (in steps of at most 1/30 s so the maths stays steady at any frame rate). */
  function update(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 30))), h = dt / n;
    for (let i = 0; i < n; i++) {
      time += h; arbitrate(); for (const a of vehicles) if (!a.done) stepVehicle(a, h); guardOverlaps(); for (const p of peds) stepPed(p, h);
    }
    const f = focus();
    for (const a of vehicles) {
      if (a.done || a.role !== "npc") continue; const far = Math.hypot(a.x - f.x, a.z - f.z);
      if (far > D.despawn) a.done = true; else if (a.stillFor > 50 && far > 40) { a.done = true; stats.stuckRemoved++; }
    }
    for (let i = vehicles.length - 1; i >= 0; i--) if (vehicles[i].done) { world?.removeBody("veh" + vehicles[i].id); stats.despawned++; vehicles.splice(i, 1); }
    for (let i = peds.length - 1; i >= 0; i--) if (Math.hypot(peds[i].x - f.x, peds[i].z - f.z) > D.despawn) peds.splice(i, 1);
    setBodies();
    spawnCool -= dt; if (spawnCool <= 0 && vehicles.filter((v) => v.role === "npc").length < D.vehicles) { trySpawn(); spawnCool = 0.4 + rnd() * 0.8; }
    pedCool -= dt; if (pedCool <= 0 && peds.length < D.peds) { spawnPed(); pedCool = 0.5; }
  }

  return {
    vehicles, peds, stats, update, wander,
    get time() { return time; },
    /** A vehicle for the player's journey: follows `route`, stops with its centre at `stopAt` (default: the end of the route), waits while `hold`. */
    addHero(kind, route, opts = {}) { const a = make(kind, route, { ...opts, role: "hero" }); a.custom = true; return a; },
    /** Gives a vehicle a new route that starts exactly where it is now (the first lane of `route` must be the lane it is on). */
    setRoute(a, route, opts = {}) { a.route = route; a.s = 0; a.si = 0; a.stopAt = opts.stopAt ?? null; a.res = null; a.waitSince = null; a.nextConn = null; a.stopLine = null; pose(a); },
    /** Removes the traffic (not the player's vehicle) within r metres of a point, so a pickup vehicle can appear there straight away. */
    clearSpot(x, z, r) { for (const b of vehicles) if (!b.done && b.role === "npc" && Math.hypot(b.x - x, b.z - z) < r) b.done = true; },
    /** Puts a kinematic vehicle (a.kinematic = true) at `s` metres along its route, moving at `v`. The player's ride uses this so its duration is exact. */
    placeAlong(a, s, v = 0) { a.s = Math.max(0, Math.min(a.route.len, s)); a.v = v; a.stillFor = 0; pose(a); },
    remove(a) { a.done = true; world?.removeBody("veh" + a.id); const i = vehicles.indexOf(a); if (i >= 0) vehicles.splice(i, 1); },
    /** The player's own car, the player on foot, or anything else vehicles must give way to. */
    setExternal(id, b) { external.set(id, b); }, removeExternal(id) { external.delete(id); },
    /** Nearest NPC-free check, used to decide where a pickup vehicle may appear. */
    spotFree: freeSpot,
    /** If a vehicle has been stuck behind another driven by the simulation, remove that one (the road ahead of the player's ride must never stay blocked). */
    clearAhead(a) { const l = leaderOf(a); if (l?.who && vehicles.includes(l.who) && l.who.role === "npc") { l.who.done = true; return true; } return false; },
    density: D,
  };
}