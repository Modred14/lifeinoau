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
import { sweepHit, vehicleStrike, createTumble, stepTumble, canBeStruck, massOf, liftOf, PERSON_R } from "./impact.js";
import { heightOn } from "./roadgraph.js";

export const KINDS = {
  // doorZ: where the passenger door is along the vehicle (metres from the middle, nose is +); seat: where a passenger sits, in the vehicle's own space
  // (x is +left, -right: traffic keeps right, so the kerb and the door are on the right). driver: the driver's seat (null: the keke model has its own).
  car: { len: 4.5, wid: 1.85, cruise: [8.5, 13], aMax: 2.2, brake: 3.2, weight: 0.72, doorZ: -0.5, doorZL: 0.3, seat: { x: -0.45, y: 0.5, z: -0.5 }, driver: { x: 0.45, y: 0.5, z: 0.35 } },
  keke: { noHw: true, len: 2.78, wid: 1.3, cruise: [6.5, 9.5], aMax: 1.7, brake: 3.0, weight: 0.18, doorZ: -0.45, seat: { x: 0, y: 0.62, z: -0.72 }, driver: null },
  // a commercial minibus (the yellow danfo-style hire bus): shares the bus body, drawn shorter (see traffic.js); `noHw: false` below, kekes are kept off the expressway
  minibus: { len: 4.7, wid: 1.88, cruise: [7.5, 11.5], aMax: 1.6, brake: 2.9, weight: 0.12, doorZ: -0.5, doorZL: 0.8, seat: { x: -0.5, y: 0.71, z: -0.4 }, driver: { x: 0.45, y: 0.8, z: 1.0 } },
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
// vehicles: ambient cars on the campus roads; hwVehicles: on the expressway (kept busier than any small road); peds: walkers. farAt: beyond this many metres from the camera an entity is stepped less often.
// view: inside this many metres of the camera nothing is ever created or removed in the open (an NPC may only come into being, or be taken out, beyond it or where a building hides the spot).
// pedView: the same for people (they are drawn to pedView - PED_FADE, see traffic.js). Spawning happens in the ring spawnMin..spawnMax, removal beyond `despawn`: both outside `view`.
export const DENSITY = { vehicles: 30, hwVehicles: 16, peds: 24, view: 250, pedView: 200, hideBelow: 60, pedHideBelow: 45, spawnMin: 60, spawnMax: 340, despawn: 410, farAt: 200, farPedAt: 130 };
/** Metres inside pedView at which a person stops being drawn (they are far too small to notice by then). */
export const PED_FADE = 20;
/** How busy each class of road is, per metre of lane: the main roads carry the most, the small roads a lower but still noticeable flow. */
export const CLASS_WEIGHT = { local: 0.8, collector: 1.3, arterial: 2.6 };
/** Where people gather, by kind of place (weights): hostels, shops, the library, the social centre and the town gate are busiest. */
export const HOT_KINDS = { hostel: 3, shop: 3, social: 3, town: 3, library: 2.5, bank: 2, hall: 2, lecture: 1.5, faculty: 1.5, admin: 1.5, sports: 1.5, hospital: 1, worship: 1 };
const LANE_W = 3.5;
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
  // ---------- being hit (lib3d/impact.js) ----------
  // A moving vehicle that touches a person throws them by its own speed and weight. The people who can be hit are the simulation's pedestrians, the player on foot (`persons`: the trip
  // registers them each frame and is told when they are struck) and anyone else a caller adds (`victims`: the real players drawn by lib3d/traffic.js). One function, strike(), does it for
  // every vehicle: the player's own car (called by the trip), the traffic (called below, every step) and other players' cars (called by the drawing).
  const persons = new Map(), victims = [], events = []; const MIN_STRIKE_V = 1.0;   // slower than this a vehicle only touches: walkers and pedestrians are simply kept out of it
  const note = (e) => { if (events.length < 40) events.push(e); };
  const edgeOf = (laneId) => graph.byEdge.get(graph.lanes[laneId].edge);
  const nLanesOf = (laneId) => Math.max(1, edgeOf(laneId).lanesPerDir);
  const laneWOf = (laneId) => { const e = edgeOf(laneId), n = e.lanesPerDir; return n > 1 ? Math.max(0, (graph.lanes[laneId].off - e.med - e.lw / 2) / (n - 1)) : e.lw ?? LANE_W; };   // lanes in this lane's direction that vehicles may share
  // Spawn pools, weighted by length x how busy that class of road is (the ramps are never used by ambient traffic: they belong to the player's journeys).
  const makePool = (pred, wf) => { const arr = [], cum = []; let t = 0; for (const l of graph.lanes) { const e = graph.byEdge.get(l.edge); if (e && pred(l, e)) { t += l.len * wf(e); arr.push(l); cum.push(t); } } return { arr, cum, total: t }; };
  const pickFrom = (pool) => { let lo = 0, hi = pool.arr.length - 1; const r = rnd() * pool.total; while (lo < hi) { const m = (lo + hi) >> 1; if (pool.cum[m] < r) lo = m + 1; else hi = m; } return pool.arr[lo]; };
  const groundPool = makePool((l, e) => l.comp === 0 && l.len > 18 && !l.hw, (e) => CLASS_WEIGHT[e.cls] ?? 1);   // ambient traffic keeps to the campus roads here
  const hwPool = makePool((l, e) => l.comp === 0 && l.hw && String(e.kind).startsWith("express") && l.len > 60, () => 1);   // the expressway's own lanes
  const isHwLane = (id) => { const l = graph.lanes[id]; return l.hw && String(edgeOf(id).kind).startsWith("express"); };
  const stats = { spawned: 0, despawned: 0, stuckRemoved: 0, maxOverlapFixed: 0, laneChanges: 0, extended: 0, removedInView: 0, deadlocksBroken: 0 };
  let tick = 0;

  // ---------- where people gather ----------
  const hot = [];
  for (const h of D.hotspots ?? []) hot.push({ x: h.x, z: h.z, w: h.w ?? 1, edges: null });
  const hotEdges = (h) => h.edges ??= graph.edges.filter((e) => e.comp === 0 && e.sw > 0 && e.len > 8 && !e.hw && (e.path.pts ?? []).some((q) => Math.hypot(q[0] - h.x, q[1] - h.z) < 45));

  // ---------- routes ----------
  // Lanes a vehicle that may not use the expressway (a keke) could never drive out of: every exit is a ramp or the deck, or leads only to such a lane. Routing and spawning keep it off them,
  // so no drive ever strands it (the cause of vehicles that "ran out of road" and had to be removed).
  const trapNoHw = new Set();
  { const exits = (id) => graph.lanes[id].out.map((c) => graph.conns[c]).filter((c) => graph.lanes[c.to].comp === 0 && !graph.lanes[c.to].hw);
    for (const l of graph.lanes) if (l.comp === 0 && !l.hw && !exits(l.id).length) trapNoHw.add(l.id);
    for (let changed = true; changed;) { changed = false; for (const l of graph.lanes) if (l.comp === 0 && !l.hw && !trapNoHw.has(l.id) && exits(l.id).every((c) => trapNoHw.has(c.to))) { trapNoHw.add(l.id); changed = true; } } }
  /**
   * Extends a drive with random choices until it is at least `minLen` metres: at each junction mostly straight on, sometimes a turn, never a U-turn unless the road ends (a dead end is a turning place,
   * not the end of the drive). Ramps and the deck are ordinary roads for everything but a keke (`noHw`): the traffic of the campus and of the expressway is one flow, so a vehicle that takes a ramp stays in the world.
   */
  function grow(segs, cur, total, minLen, noHw) {
    let guard = 0;
    while (total < minLen && guard++ < 80) {
      const all = graph.lanes[cur].out.map((c) => graph.conns[c]).filter((c) => graph.lanes[c.to].comp === 0 && !((noHw) && (graph.lanes[c.to].hw || trapNoHw.has(c.to)))), plain = all.filter((c) => c.kind !== "uturn"), outs = plain.length ? plain : all; if (!outs.length) break;
      const w = outs.map((c) => (c.kind === "straight" ? 0.58 : c.kind === "uturn" ? 1 : 0.21)), sum = w.reduce((a, b) => a + b, 0); let r = rnd() * sum, pick = outs[0]; for (let i = 0; i < outs.length; i++) { r -= w[i]; if (r <= 0) { pick = outs[i]; break; } }
      segs.push({ kind: "conn", id: pick.id }); const nl = graph.lanes[pick.to]; segs.push({ kind: "lane", id: nl.id, s0: 0, s1: nl.len }); total += pick.len + nl.len; cur = nl.id;
    }
    return segs;
  }
  /** A random drive of at least `minLen` metres starting on `lane` at `s`. */
  function wander(lane, s, minLen = 2200, noHw = false) {
    return graph.makeRoute(grow([{ kind: "lane", id: lane, s0: s, s1: graph.lanes[lane].len }], lane, graph.lanes[lane].len - s, minLen, noHw));
  }
  /**
   * Keeps an ambient vehicle's drive going: when little of its route is left, the rest of the route it already has is kept exactly as it is (same lane, same turns, same position) and more is added
   * at the far end. So a vehicle never reaches "the end" in front of anyone: it simply carries on, over the junctions, the ramps and the deck, like a driver with somewhere to go.
   */
  function extendRoute(a) {
    const segs = a.route.segs, sg = segs[a.si], last = segs[segs.length - 1]; if (!sg || sg.kind !== "lane" || last.kind !== "lane" || a.res != null) return false;
    const keep = segs.slice(a.si).map((q, i) => (q.kind === "lane" ? { kind: "lane", id: q.id, s0: q.s0, s1: q.s1 } : { kind: "conn", id: q.id })), off = a.s - sg.start;
    const total = a.route.len - sg.start, noHw = KINDS[a.kind].noHw, n0 = keep.length, grown = grow(keep, last.id, total, Math.max(2200, total + 1500), noHw); if (grown.length === n0) return false;   // (grow adds to `keep` itself)
    const route = graph.makeRoute(grown); if (!route) return false;
    a.route = route; a.s = off; a.si = 0; a.nextConn = null; a.stopLine = null; pose(a); stats.extended++; return true;
  }
  const pickKind = (hw = false) => {
    const have = {}; for (const v of vehicles) if (v.role === "npc" && !v.custom && !v.done) have[v.kind] = (have[v.kind] ?? 0) + 1;
    const open = Object.entries(KINDS).filter(([k, d]) => !(hw && d.noHw) && (D.limits?.[k] == null || (have[k] ?? 0) < D.limits[k])); if (!open.length) return null;
    let r = rnd() * open.reduce((s, [, d]) => s + d.weight, 0), k = open[0][0]; for (const [name, def] of open) { r -= def.weight; if (r <= 0) { k = name; break; } } return k;
  };

  function make(kind, route, opts = {}) {
    const def = KINDS[kind], a = { id: nextId++, kind, len: opts.len ?? def.len, wid: opts.wid ?? def.wid, aMax: opts.aMax ?? def.aMax, brake: opts.brake ?? def.brake, route, s: opts.s ?? 0, v: opts.v ?? 0, si: 0, role: opts.role ?? "npc",
      cruise: opts.cruise ?? def.cruise[0] + rnd() * (def.cruise[1] - def.cruise[0]), stopAt: opts.stopAt ?? null, hold: !!opts.hold, res: null, waitSince: null, stillFor: 0, acc: 0, x: 0, z: 0, hx: 0, hz: 1, yaw: 0, laneId: -1, laneS: 0, color: opts.color ?? null, tint: rnd(), done: false, born: time, hw: !!opts.hw, lvl: 0, y: 0, sub: opts.sub ?? 0, lat: opts.lat ?? 0, lead: null, lcAt: -9 };
    pose(a); vehicles.push(a); stats.spawned++; return a;
  }
  /** Where the vehicle is and which way its body points (from a point behind its centre to one in front, so it swings through a curve like a real one). */
  /** How far (m) to the LEFT of its lane's own line a vehicle is at route distance sc: it slides to a free lane only along the open stretch, and is back on the lane's line near either end (junctions and ramps are built for the lane's line). */
  function latAt(a, sc) {
    if (!a.lat) return 0;
    const segs = a.route.segs; let sg = segs[a.si]; if (!sg || sc < sg.start || sc > sg.end) { sg = null; for (const q of segs) if (sc <= q.end) { sg = q; break; } sg ??= segs[segs.length - 1]; }
    if (sg.kind !== "lane") return 0;
    const L = graph.lanes[sg.id], ls = sg.s0 + (sc - sg.start), k = Math.max(0, Math.min(1, Math.min(ls, L.len - ls) / 30));
    return Math.min(a.lat, (nLanesOf(sg.id) - 1) * laneWOf(sg.id)) * k * k * (3 - 2 * k);
  }
  const shifted = (a, pt, sc) => { const l = latAt(a, sc); if (l) { pt.x += pt.hz * l; pt.z -= pt.hx * l; } return pt; };
  /** Where the vehicle is and which way its body points (from a point behind its centre to one in front, so it swings through a curve like a real one). */
  function pose(a) {
    while (a.si < a.route.segs.length - 1 && a.s >= a.route.segs[a.si].end) a.si++;
    const P = a.route.path, sf = Math.min(P.len, a.s + a.len * 0.3), sr = Math.max(0, a.s - a.len * 0.3), p = shifted(a, P.at(a.s, {}), a.s), f = shifted(a, P.at(sf, {}), sf), r = shifted(a, P.at(sr, {}), sr);
    a.x = p.x; a.z = p.z; let hx = f.x - r.x, hz = f.z - r.z; const l = Math.hypot(hx, hz); if (l > 1e-3) { a.hx = hx / l; a.hz = hz / l; } else { a.hx = p.hx; a.hz = p.hz; } a.yaw = Math.atan2(a.hx, a.hz);
    const sg = a.route.segs[a.si]; if (sg.kind === "lane") { a.laneId = sg.id; a.laneS = sg.s0 + (a.s - sg.start); } else { a.laneId = graph.conns[sg.id].to; a.laneS = 0; }
    a.hw = !!graph.lanes[a.laneId].hw;   // on the deck or a ramp right now (counts and spawning follow where a vehicle IS, so one that drives up a ramp is still the same inhabitant)
    const e = edgeOf(a.laneId); a.y = e.h0 === e.h1 ? e.h0 : heightOn(e, graph.lanes[a.laneId].dir ? e.len - a.laneS : a.laneS); a.lvl = a.y > 2 ? 1 : 0;
    // the pitch of a vehicle on a slope: its axles (about 0.29 of its length either side of the middle) both on the road, so its tyres touch it instead of floating at one end and sinking at the other
    if (e.h0 === e.h1) a.pitch = 0; else { const dir = graph.lanes[a.laneId].dir, hAt = (s) => heightOn(e, dir ? e.len - Math.max(0, Math.min(e.len, s)) : Math.max(0, Math.min(e.len, s))), L = a.len * 0.29; a.pitch = Math.atan2(hAt(a.laneS + L) - hAt(a.laneS - L), 2 * L); a.y = (hAt(a.laneS + L) + hAt(a.laneS - L)) / 2; }   // the deck is a different level: nothing on it can touch anything below
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
      if (a.pass?.has(b.id)) return;   // see stepVehicle: a vehicle this one has been let through
      if ((b.lvl ?? (b.y > 2 ? 1 : 0)) !== a.lvl) return;   // the deck and the ground never meet
      const dx = b.x - a.x, dz = b.z - a.z; if (dx * dx + dz * dz > (H + a.len + bLen) ** 2) return;
      const behind = dx * a.hx + dz * a.hz < -0.2, B = { x: b.x, z: b.z, hx: bhx, hz: bhz, hl: bLen / 2, hw: bWid / 2 };
      for (let k = 0; k <= H; k += 1.2) {
        const sc = a.s + k; if (sc > P.len) break; P.at(sc, at); { const l = latAt(a, sc); probe.x = at.x + at.hz * l; probe.z = at.z - at.hx * l; } probe.hx = at.hx; probe.hz = at.hz;
        // something behind me that I already touch has to give way to me; but something behind me that my body WOULD sweep into (I am turning) counts
        if (boxesOverlap(probe, B, 0.02)) { if (k === 0 && behind) return; const gap = k - 0.6; if (!best || gap < best.gap) best = { gap, v: Math.max(0, bv * (bhx * at.hx + bhz * at.hz)), who: b }; return; }
      }
    };
    for (const b of vehicles) if (b !== a && !b.done) consider(b, b.len, b.wid, b.v, b.hx, b.hz);
    for (const [id, b] of external) { if (a.ignoreExt?.has(id)) continue; consider(b, b.len ?? 1, b.wid ?? 1, b.v ?? 0, b.hx ?? 0, b.hz ?? 1); }
    if (a.lvl === 0) for (const p of peds) consider(p, PED_W, PED_W, p.v, p.hx, p.hz);
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
  // The cause of the junction gridlock: a vehicle that had to wait stopped on the end of its lane, right in the path of a turn that another vehicle had already started (the end of one arm lies within
  // a car's width of the turn from the next). The turning car then could not finish the turn because the waiting one was in the way, and the waiting one would not move until the turning car had cleared:
  // for ever. So a vehicle that has to wait stops short of any such turn that is already under way.
  // Nobody takes a turn ahead of the vehicle in front of them in the same lane: a car stuck in the queue must not hold the junction's reservation while the one at the head of the queue, which is the one that
  // has to go first, waits for it (it would wait for a car that is behind it).
  const queuedBehind = (a) => { const l = a.lead?.who; return !!l && l.laneId === a.laneId && l.res == null && !l.done && l.s > a.s && vehicles.includes(l) && a.lead.gap < 14; };
  const HOLD_BACK = 7.5;
  const heldBack = (a) => { for (const b of vehicles) { if (b === a || b.res == null || b.done) continue; if (graph.conns[b.res].lanesNear.includes(a.laneId)) return true; } return false; };
  // a vehicle still waiting at the end of a neighbouring lane that this connector sweeps past: let whoever has waited longer go first (a strict order, so nobody waits in a circle)
  const blockedByWaiting = (conn, a) => { const mine = a.waitSince ?? Infinity; for (const b of vehicles) { if (b === a || b.done || b.res != null) continue; const sg = b.route.segs[b.si]; if (sg.kind !== "lane" || !conn.lanesNear.includes(sg.id)) continue; if (b.laneS < graph.lanes[sg.id].len - 7) continue; const theirs = b.waitSince ?? Infinity; if (theirs < mine || (theirs === mine && b.id < a.id)) return true; } return false; };
  // would my body, driven through this turn, touch any vehicle that is already there? (a long bus waiting in a turn reaches back across the next arm)
  const sweepBox = { x: 0, z: 0, hx: 0, hz: 1, hl: 0, hw: 0 }, sweepAt = {};
  const sweepBlocked = (a, nxt) => {
    const P = a.route.path; sweepBox.hl = a.len / 2; sweepBox.hw = a.wid / 2;
    for (let sc = Math.max(a.s, nxt.start - 1); sc <= nxt.end + a.len / 2; sc += 1.2) {
      if (sc > P.len) break; P.at(sc, sweepAt); sweepBox.x = sweepAt.x; sweepBox.z = sweepAt.z; sweepBox.hx = sweepAt.hx; sweepBox.hz = sweepAt.hz;
      for (const b of vehicles) { if (b === a || b.done || b.lvl !== a.lvl) continue; if (Math.abs(b.x - sweepBox.x) > 8 || Math.abs(b.z - sweepBox.z) > 8) continue; if (boxesOverlap(sweepBox, { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 }, -0.2)) return true; }
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
      for (const b of vehicles) { if (b === a || b.done || b.lvl !== a.lvl) continue; if (Math.abs(b.x - exitBox.x) > 9 || Math.abs(b.z - exitBox.z) > 9) continue; if (boxesOverlap(exitBox, { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 }, 0.1)) return true; }
    }
    return false;
  };
  function arbitrate() {
    const asking = [];
    for (const a of vehicles) {
      if (a.done) continue; const sg = a.route.segs[a.si];
      // release a reservation once the rear of the vehicle has left the connector (or if the route no longer contains it)
      if (a.res != null) { const k = a.route.segs.findIndex((q) => q.kind === "conn" && q.id === a.res); if (k < 0 || (a.si > k && a.s - a.len / 2 > a.route.segs[k].end + 0.2)) a.res = null; }
      // a car that took the turn's reservation but is still in its lane, stopped behind a vehicle that has not (the one at the head of the queue must go first): give it back
      if (a.res != null && sg.kind === "lane" && a.stillFor > 2 && a.lead?.who && a.lead.who.laneId === a.laneId && a.lead.who.res == null && vehicles.includes(a.lead.who)) a.res = null;
      const nxt = a.route.segs[a.si + 1]; a.nextConn = null; a.stopLine = null;
      if (sg.kind === "lane" && nxt?.kind === "conn" && a.res == null) { const dist = nxt.start - (a.s + a.len / 2); if (dist < 36) { a.nextConn = nxt; a.stopLine = nxt.start; asking.push(a); } }
    }
    asking.sort((p, q) => (p.waitSince ?? 1e9) - (q.waitSince ?? 1e9) || p.id - q.id);
    for (const a of asking) {
      const conn = graph.conns[a.nextConn.id], dist = a.nextConn.start - (a.s + a.len / 2), waited = a.waitSince == null ? 0 : time - a.waitSince;
      const ok = !conflictsWithReserved(conn, a) && !blockedByWaiting(conn, a) && !queuedBehind(a) && (waited > 30 || (!exitBlocked(a, a.nextConn) && !sweepBlocked(a, a.nextConn)));
      if (ok) { a.res = conn.id; a.waitSince = null; a.stopLine = null; }
      else { if (a.waitSince == null && dist < 14) a.waitSince = time; if (heldBack(a)) a.stopLine = a.nextConn.start - HOLD_BACK; if (dist < (a.v * a.v) / (2 * 7) + 0.4 && a.v > 2) { a.res = conn.id; a.waitSince = null; a.stopLine = null; /* it could not stop even braking as hard as it can: it is committed, so carry on through */ } }
    }
  }

  // ---------- lanes: sharing a multi-lane road, overtaking ----------
  // Is the lane `sub` beside/around `a` free from 14 m behind to 28 m ahead (more behind when the one behind is faster)?
  function laneFree(a, sub) {
    for (const b of vehicles) {
      if (b === a || b.done || b.laneId !== a.laneId || b.lvl !== a.lvl) continue;
      const lw = laneWOf(a.laneId), lat = Math.max(b.lat, b.sub * lw); if (Math.abs(lat - sub * lw) > 2.4 && Math.abs(b.lat - sub * lw) > 2.4) continue;
      const d = b.laneS - a.laneS; if (d > -(a.len + 8 + Math.max(0, b.v - a.v) * 2.5) && d < b.len + 24 + Math.max(0, a.v - b.v) * 1.5) return false;
    }
    return true;
  }
  /** Every so often: stuck behind something slower and a lane to the left is free: pull out and pass; once the road ahead is clear, move back to the right-hand lane. */
  function considerLaneChange(a) {
    const sg = a.route.segs[a.si]; if (sg.kind !== "lane" || a.role !== "npc") return;
    const n = nLanesOf(sg.id); if (n < 2) { a.sub = 0; return; }
    a.sub = Math.min(a.sub, n - 1); const L = graph.lanes[sg.id]; if (a.laneS < 45 || L.len - a.laneS < 80 || time - a.lcAt < 5) return;
    const lead = a.lead, slow = lead && lead.gap < 26 && lead.v < a.cruise - 1.5;
    if (slow && a.sub < n - 1 && laneFree(a, a.sub + 1)) { a.sub++; a.lcAt = time; stats.laneChanges++; }
    else if (!slow && a.sub > 0 && (!lead || lead.gap > 40) && laneFree(a, a.sub - 1)) { a.sub--; a.lcAt = time; stats.laneChanges++; }
  }

  // ---------- the step ----------
  function stepVehicle(a, dt) {
    if (a.kinematic) { a.stillFor = 0; return; }   // the player's ride is played from a recorded motion (placeAlong): the traffic model does not move it
    const route = a.route, front = a.s + a.len / 2;
    let v0 = Math.min(a.cruise, route.vAt(Math.min(route.len, a.s + 3 + a.v * 0.8)));
    if (a.hold) v0 = 0;
    // the nearest obstacle: a vehicle or person ahead, a junction I am not allowed into, or the end of my route / my stopping place
    let gap = Infinity, vl = 0, s0 = S0;
    let lead = leaderOf(a);
    // Safety net behind the prevention above. Two kinds of lock can still form between vehicles that are already in each other's way, and in both nobody can ever move, so one of the two is let through the other:
    //  - a vehicle part-way through its turn, stopped by one that is only WAITING at its stop line for this very turn to clear;
    //  - two vehicles that each take the other for "the one in front" (side by side after a lane change, or meeting on a narrow lane): the one with the higher id gives way by ignoring the other.
    // They brush past for a moment instead of both standing still for ever. Nothing is ever deleted to clear a jam.
    if (a.pass) { for (const id of a.pass) { const ib = vehicles.find((q) => q.id === id); if (!ib || ib.done || Math.hypot(ib.x - a.x, ib.z - a.z) > 14) a.pass.delete(id); } if (!a.pass.size) a.pass = null; }
    if (lead?.who && a.stillFor > 3 && vehicles.includes(lead.who) && !a.pass?.has(lead.who.id)) {
      const b = lead.who, turnLock = a.res != null && a.stillFor > 4 && b.res == null && b.stopLine != null, mutual = b.lead?.who === a && b.stillFor > 3 && a.id > b.id;
      // a chain that has stood for 8 s because of a vehicle in ANOTHER lane (arms of a junction, or lanes of a wide road, whose boxes overlap): that is geometry, not a queue, so let it pass
      const crossLane = b.laneId !== a.laneId && a.stillFor > 8 && b.stillFor > 8;
      if (turnLock || mutual || crossLane) { (a.pass ??= new Set()).add(b.id); stats.deadlocksBroken++; lead = leaderOf(a); }
    }
    a.lead = lead; if (lead) { gap = lead.gap; vl = lead.v; }
    // slide across to the lane it has chosen (only on the open stretch of a lane; see latAt), and think about overtaking a few times a second
    { const sg = route.segs[a.si]; if (sg.kind === "lane") { const tgt = Math.min(a.sub, nLanesOf(sg.id) - 1) * laneWOf(sg.id), d = tgt - a.lat, st = 1.4 * dt; a.lat += Math.max(-st, Math.min(st, d)); } if ((tick + a.id) % 12 === 0) considerLaneChange(a); }
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
    if (a.role === "npc" && a.s >= route.len - a.len) {
      // Reaching the end of a drive is not the end of the vehicle: ambient traffic carries on (the drive is normally extended long before this, see extendRoute). Only a vehicle nobody can see, or one that was
      // sent somewhere on purpose (a pickup), is finished here; one that cannot be extended in view just stops where it is until it can.
      if (a.custom) a.done = true; else if (!extendRoute(a)) { if (!seen(a.x, a.z, focus(), D.view, D.hideBelow, a.lvl)) a.done = true; else { a.s = Math.min(a.s, route.len - a.len); a.v = 0; } }
    }
  }
  function setBodies() { if (!world) return; for (const a of vehicles) if (a.lvl === 0) world.setBody("veh" + a.id, { x: a.x, z: a.z, hx: a.hx, hz: a.hz, hl: a.len / 2, hw: a.wid / 2, kind: a.kind, vehicle: a }); else world.removeBody("veh" + a.id); }   // on the deck: no body on the ground for walkers to bump into
  function guardOverlaps() { // a safety net, not the mechanism: if two boxes ever overlap, the one behind stops dead
    for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i], b = vehicles[j]; if (a.done || b.done || a.lvl !== b.lvl || a.pass?.has(b.id) || b.pass?.has(a.id)) continue; if (Math.abs(a.x - b.x) > 8 || Math.abs(a.z - b.z) > 8) continue;
      const A = { x: a.x, z: a.z, hx: a.hx, hz: a.hz, hl: a.len / 2, hw: a.wid / 2 }, B = { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 };
      if (boxesOverlap(A, B, 0.05)) { stats.maxOverlapFixed++; const behind = ((b.x - a.x) * a.hx + (b.z - a.z) * a.hz) > 0 ? a : b; behind.v = 0; }
    }
  }

  // ---------- what the player can see ----------
  // The one rule that stops NPCs popping in and out: inside D.view metres of the camera nothing is created and nothing is removed in the open. Beyond it (or, past `hideBelow` metres,
  // where a building stands between the camera and the spot) an NPC can come into being or be taken out and nobody can see it happen. `occluded` is a straight look from the camera's ground point.
  // Hidden only if a building stands in the way of the line to the spot AND of the lines to a point 2.5 m either side of it (a car is wider than its centre line, and a ray can graze a wall's corner).
  const occ = (x, z, f) => { if (!world?.raycast) return false; const dx = x - f.x, dz = z - f.z, l = Math.hypot(dx, dz) || 1, px = (-dz / l) * 2.5, pz = (dx / l) * 2.5; return world.raycast(f.x, f.z, x, z) != null && world.raycast(f.x, f.z, x + px, z + pz) != null && world.raycast(f.x, f.z, x - px, z - pz) != null; };
  /** Could someone at the camera see (x, z)? `view` is the radius they can see to; `hideBelow` the distance from which a building in the way hides it. */
  // The deck (lvl 1) stands above the roofs: nothing on the ground hides it, so there only the distance counts.
  function seen(x, z, f, view = D.view, hideBelow = D.hideBelow, lvl = 0) { const d = Math.hypot(x - f.x, z - f.z); if (d > view) return false; if (lvl === 1 || d < hideBelow) return true; return !occ(x, z, f); }

  // ---------- spawning ----------
  const freeSpot = (x, z, r, lvl = 0) => { for (const b of vehicles) if (!b.done && b.lvl === lvl && Math.hypot(b.x - x, b.z - z) < r) return false; if (lvl === 0) { for (const b of external.values()) if (Math.hypot(b.x - x, b.z - z) < r + 6) return false; } return true; };
  const pedNear = (x, z, r) => { for (const q of peds) if (Math.hypot(q.x - x, q.z - z) < r) return true; return false; };   // ambient spawning only: a pickup vehicle clears its own spot
  /** `prime`: the world is being filled for the first time (a trip has just begun, or the camera jumped across the map): anywhere not right on top of the player will do, as the road is just being laid out. */
  function trySpawn(hw = false, prime = false) {
    const f = focus(), pool = hw ? hwPool : groundPool; if (!pool.arr.length) return false;
    for (let k = 0; k < (hw ? 60 : 30); k++) {
      const l = pickFrom(pool), s = rnd() * l.len, p = l.path.at(s, {}), d = Math.hypot(p.x - f.x, p.z - f.z), lvl = hw ? 1 : 0;
      if (d < (prime ? 45 : D.spawnMin) || d > D.spawnMax || !freeSpot(p.x, p.z, hw ? 38 : 28, lvl) || (!hw && pedNear(p.x, p.z, 5))) continue;   // never on top of a person
      if (!prime && d <= D.view && seen(p.x, p.z, f, D.view, D.hideBelow, lvl)) continue;   // never where the player can watch it appear
      const kind = pickKind(hw); if (!kind) return false; if (KINDS[kind].noHw && trapNoHw.has(l.id)) continue; const route = wander(l.id, s, hw ? 3000 : 2200, !!KINDS[kind].noHw); if (!route) continue;
      const n = nLanesOf(l.id), sub = Math.floor(rnd() * n), a = make(kind, route, { v: 0, hw, sub, lat: sub * laneWOf(l.id) });
      if (!prime && Math.hypot(a.x - f.x, a.z - f.z) <= D.view && seen(a.x, a.z, f, D.view, D.hideBelow, lvl)) { vehicles.pop(); stats.spawned--; continue; }   // its lane offset put it where it can be seen: not here
      a.v = hw ? a.cruise * 0.85 : Math.min(KINDS[kind].cruise[0], 6); return true;   // on the expressway they are already up to speed
    }
    return false;
  }
  const pickHot = (list) => { let r = rnd() * list.reduce((t, h) => t + h.w, 0); for (const h of list) { r -= h.w; if (r <= 0) return h; } return list[0]; };
  function spawnPed(prime = false) {
    const f = focus(), near = hot.filter((h) => { const d = Math.hypot(h.x - f.x, h.z - f.z); return d > 20 && d < D.spawnMax + 60; });
    for (let k = 0; k < 16; k++) {
      let e, goal = null;
      if (near.length && rnd() < 0.7) { goal = pickHot(near); const es = hotEdges(goal); if (!es.length) continue; e = es[Math.floor(rnd() * es.length)]; }
      else { const w = graph.edges; e = w[Math.floor(rnd() * w.length)]; if (e.comp !== 0 || !(e.sw > 0) || e.len <= 20 || e.hw) continue; }
      const s = rnd() * e.len, p = e.path.at(s, {}), d = Math.hypot(p.x - f.x, p.z - f.z); if (d < 25 || d > D.spawnMax) continue;
      if (!prime && d <= D.pedView && seen(p.x, p.z, f, D.pedView, D.pedHideBelow)) continue;   // a person never appears where the player is looking
      if (!freeSpot(p.x, p.z, 1.2, 0)) continue;
      peds.push({ id: nextId++, edge: e.id, s, dir: rnd() < 0.5 ? 1 : -1, side: rnd() < 0.5 ? 1 : -1, lane: 0.2 + rnd() * 0.6, speed: 1.0 + rnd() * 0.6, v: 1, pause: 0, nextPause: 3 + rnd() * 14, act: "idle", x: p.x, z: p.z, hx: 1, hz: 0, phase: rnd() * 6, tint: rnd(), goal: goal ?? (near.length ? pickHot(near) : null), k: 0 }); return true;
    }
    return false;
  }
  /** A struck pedestrian: flight, slide and lying are lib3d/impact.js; when they are back on their feet they walk back to their pavement route (and are put back on it if that takes too long). */
  function fallPed(p, dt) {
    const tb = p.tumble; stepTumble(tb, dt, world, { ignore: tb.ign }); p.x = tb.x; p.z = tb.z; p.v = 0;
    if (tb.phase === "done") { p.tumble = null; p.rejoin = 0.001; p.act = "idle"; }
  }
  function rejoinPed(p, dt) {
    const ee = graph.byEdge.get(p.edge), q = ee.path.at(Math.max(0, Math.min(ee.len, p.s)), {}), off = p.side * (ee.half + ee.sw * (p.lane ?? 0.5)), tx = q.x - q.hz * off, tz = q.z + q.hx * off;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz); p.rejoin += dt;
    if (d < 0.3 || p.rejoin > 8) { p.rejoin = 0; return; }   // close enough, or it is taking too long: the normal walk takes over and puts them on the route
    const st = Math.min(d, p.speed * dt), r = world ? world.moveCircle(p.x, p.z, (dx / d) * st, (dz / d) * st, PERSON_R, {}) : { x: p.x + (dx / d) * st, z: p.z + (dz / d) * st };
    p.x = r.x; p.z = r.z; p.hx = dx / d; p.hz = dz / d; p.v = p.speed; p.phase += p.speed * dt * 2.4;
  }
  function stepPed(p, dt) {
    if (p.tumble) { fallPed(p, dt); return; }
    if (p.rejoin) { rejoinPed(p, dt); return; }
    if (p.pause > 0) { p.pause -= dt; p.v = 0; if (p.pause <= 0) { p.nextPause = 15 + rnd() * 30; if (p.arrived) { p.arrived = false; const f = focus(), near = hot.filter((h) => Math.hypot(h.x - f.x, h.z - f.z) < D.spawnMax + 60); p.goal = near.length ? pickHot(near) : null; } } return; }
    p.nextPause -= dt; if (p.nextPause <= 0) { p.pause = 4 + rnd() * 9; p.act = PED_ACTS[Math.floor(rnd() * PED_ACTS.length)]; p.v = 0; return; }
    if (p.goal && Math.hypot(p.x - p.goal.x, p.z - p.goal.z) < 22) { p.pause = 6 + rnd() * 12; p.act = PED_ACTS[Math.floor(rnd() * PED_ACTS.length)]; p.v = 0; p.arrived = true; return; }   // got where they were going: stop and chat, then choose somewhere else
    const e = graph.byEdge.get(p.edge); p.s += p.dir * p.speed * dt;
    if (p.s < 0 || p.s > e.len) { // reached a junction: carry on along one of the other roads there, mostly towards where they are headed
      const nodeId = p.s < 0 ? e.a : e.b, node = graph.nodes[nodeId], opts = node.edges.filter((id) => id !== e.id && graph.byEdge.get(id).sw > 0 && !graph.byEdge.get(id).hw);
      if (!opts.length) { p.dir = -p.dir; p.s = Math.max(0, Math.min(e.len, p.s)); }
      else {
        let pickId = opts[Math.floor(rnd() * opts.length)];
        if (p.goal && rnd() < 0.6) { let best = Infinity; for (const id of opts) { const o = graph.byEdge.get(id), far = o.a === nodeId ? o.b : o.a, q = graph.nodes[far], d = Math.hypot(q.x - p.goal.x, q.z - p.goal.z); if (d < best) { best = d; pickId = id; } } }
        const n = graph.byEdge.get(pickId); p.edge = n.id; p.dir = n.a === nodeId ? 1 : -1; p.s = p.dir === 1 ? 0.01 : n.len - 0.01; p.side = rnd() < 0.5 ? 1 : -1; p.lane = 0.2 + rnd() * 0.6;
      }
    }
    const ee = graph.byEdge.get(p.edge), q = ee.path.at(p.s, {}), off = p.side * (ee.half + ee.sw * (p.lane ?? 0.5)); p.x = q.x - q.hz * off; p.z = q.z + q.hx * off; p.hx = q.hx * p.dir; p.hz = q.hz * p.dir; p.phase += p.speed * dt * 2.4; p.v = p.speed;
  }

  /**
   * A vehicle has moved from pose b0 to pose b1 ({ x, z, hx, hz, v } with v the signed speed along its heading) during a step: does it hit anyone on the way? Everyone it touches is
   * thrown (see lib3d/impact.js) and the total change of its speed is returned ({ dv, hits }) for the caller to apply: a person costs a vehicle a few percent of its speed, never a stop.
   * spec: { len, wid, mass, lift }. by: the vehicle's id (it is ignored by the people it threw for a moment, and cannot hit them again at once). opts.peds = false: only the people the
   * simulation does not own (the player, other players). The path is swept in small steps, so a vehicle at any speed cannot step over a person between two frames.
   */
  function strike(b0, b1, spec, by, opts = {}) {
    const out = { dv: 0, hits: 0 };
    if (Math.max(Math.abs(b0.v ?? 0), Math.abs(b1.v ?? 0)) < MIN_STRIKE_V) return out;
    const hl = spec.len / 2, hw = spec.wid / 2, mx = (b0.x + b1.x) / 2, mz = (b0.z + b1.z) / 2, reach = Math.hypot(b1.x - b0.x, b1.z - b0.z) / 2 + hl + hw + 3;
    const one = (who, p, vx, vz, can, apply) => {
      if (Math.abs(p.x - mx) > reach || Math.abs(p.z - mz) > reach || !can) return;
      const hit = sweepHit(b0, b1, spec.len, spec.wid, { x: p.x, z: p.z }); if (!hit) return;
      const st = vehicleStrike({ ...hit.box, v: hit.v, mass: spec.mass, lift: spec.lift }, { x: hit.px, z: hit.pz, vx, vz }); if (!st) return;
      apply(st); out.dv += st.dv; out.hits++;
      note({ type: "hit", t: time, who, by, x: hit.px, z: hit.pz, closing: st.closing, speed: Math.hypot(st.vx, st.vz), kind: st.kind, severity: st.severity, vehicleSpeed: hit.v });
    };
    if (opts.peds !== false) for (const p of peds) {
      const tb = p.tumble; if (tb && tb.y > 1.6) continue;   // flying over the bonnet
      one("ped", p, tb ? tb.vx : p.pause > 0 || p.rejoin ? 0 : p.hx * p.v, tb ? tb.vz : p.pause > 0 || p.rejoin ? 0 : p.hz * p.v, canBeStruck(tb, by, time), (st) => {
        p.tumble = createTumble(st, { x: p.x, z: p.z, hx: p.hx, hz: p.hz }, by, time); p.tumble.ign = new Set([by]); p.pause = 0; p.v = 0; p.rejoin = 0; });
    }
    for (const q of persons.values()) one("player", q, q.vx ?? 0, q.vz ?? 0, q.ok !== false && canBeStruck(q.tumble, by, time), (st) => q.onStrike?.(st, by, time));
    for (const f of victims) { const r = f(b0, b1, spec, by, time, note); if (r) { out.dv += r.dv; out.hits += r.hits; } }
    return out;
  }
  const specOf = (a) => ({ len: a.len, wid: a.wid, mass: massOf(a.kind), lift: liftOf(a.kind) });

  /** Advances everything by dt seconds (in steps of at most 1/30 s so the maths stays steady at any frame rate). */
  // The first fill of the world (a trip has just begun) or a jump of the camera across the map: the traffic is laid out around the player straight away, anywhere not on top of them, instead of trickling in
  // where it can be watched. It is done a few vehicles per frame (`priming`) so that no single frame pays for all of it.
  let primed = false, priming = 0; const lastF = { x: 0, z: 0 };
  function fillStep() {
    let g = 0, w = 0; for (const v of vehicles) if (v.role === "npc" && !v.custom && !v.done) { if (v.hw) w++; else g++; }
    let k = 0; while (k++ < 3 && (g < D.vehicles || w < D.hwVehicles)) { if (w < D.hwVehicles && trySpawn(true, true)) w++; else if (g < D.vehicles && trySpawn(false, true)) g++; }
    for (let q = 0; q < 3 && peds.length < D.peds; q++) spawnPed(true);
    return g < D.vehicles || w < D.hwVehicles || peds.length < D.peds;
  }
  function update(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 30))), h = dt / n, f0 = focus(), farV = D.farAt ** 2, farP = D.farPedAt ** 2;
    for (let i = 0; i < n; i++) {
      time += h; tick++; arbitrate();
      // distant vehicles and people are stepped every other / every fourth tick with the matching longer step: the same motion, a fraction of the work
      for (const a of vehicles) if (!a.done) {
        const near = (a.x - f0.x) ** 2 + (a.z - f0.z) ** 2 <= farV, p0 = (a.pv ??= { x: 0, z: 0, hx: 0, hz: 1, v: 0 }); p0.x = a.x; p0.z = a.z; p0.hx = a.hx; p0.hz = a.hz; p0.v = a.v;
        if (a.role === "npc" && !a.kinematic && !near) { if ((tick + a.id) % 2 === 0) stepVehicle(a, 2 * h); } else stepVehicle(a, h);
        a.sw = near && a.role === "npc" && a.lvl === 0 && (p0.v >= MIN_STRIKE_V || a.v >= MIN_STRIKE_V);   // only vehicles near the camera, on the ground and moving can hit anyone
      }
      guardOverlaps();
      for (const a of vehicles) if (a.sw && !a.done) { const r = strike(a.pv, (a.cv ??= { x: 0, z: 0, hx: 0, hz: 1, v: 0 }, a.cv.x = a.x, a.cv.z = a.z, a.cv.hx = a.hx, a.cv.hz = a.hz, a.cv.v = a.v, a.cv), specOf(a), "veh" + a.id); if (r.dv) a.v = Math.max(0, a.v + r.dv); }
      if ((tick & 15) === 0) for (const a of vehicles) if (!a.done && a.role === "npc" && !a.custom && !a.kinematic && a.route.len - a.s < 600) extendRoute(a);
      for (const p of peds) { if ((p.x - f0.x) ** 2 + (p.z - f0.z) ** 2 > farP) { if ((tick + p.id) % 4 === 0) stepPed(p, 4 * h); } else stepPed(p, h); }
    }
    const f = focus();
    for (const a of vehicles) {
      if (a.done || a.role !== "npc") continue; const far = Math.hypot(a.x - f.x, a.z - f.z);
      if (far > D.despawn) a.done = true;   // beyond the view, well outside it: nobody can see this
      else if (a.stillFor > 50 && far > D.hideBelow && !seen(a.x, a.z, f, D.view, D.hideBelow, a.lvl)) { a.done = true; stats.stuckRemoved++; }   // a jam that somehow outlived the fixes, cleared where it cannot be watched
    }
    for (let i = vehicles.length - 1; i >= 0; i--) if (vehicles[i].done) { world?.removeBody("veh" + vehicles[i].id); stats.despawned++; vehicles.splice(i, 1); }
    for (let i = peds.length - 1; i >= 0; i--) if (Math.hypot(peds[i].x - f.x, peds[i].z - f.z) > D.despawn) peds.splice(i, 1);
    setBodies();
    if (!primed || Math.hypot(f.x - lastF.x, f.z - lastF.z) > D.view) { primed = true; priming = 240; }
    lastF.x = f.x; lastF.z = f.z;
    if (priming > 0) { priming--; if (!fillStep()) priming = 0; }
    spawnCool -= dt;
    if (spawnCool <= 0) {
      let g = 0, w = 0; for (const v of vehicles) if (v.role === "npc" && !v.custom && !v.done) { if (v.hw) w++; else g++; }
      // fill quickly when the road is empty (the start of a trip), then top up gently; the expressway is topped up first and held at its own, higher, count
      let tries = Math.min(4, 1 + ((D.vehicles - g) >> 3) + ((D.hwVehicles - w) >> 3));
      while (tries-- > 0) { if (w < D.hwVehicles && trySpawn(true)) w++; else if (g < D.vehicles && trySpawn(false)) g++; }
      spawnCool = 0.12 + rnd() * 0.3;
    }
    pedCool -= dt; if (pedCool <= 0 && peds.length < D.peds) { let k = Math.min(3, D.peds - peds.length); while (k-- > 0) spawnPed(false); pedCool = 0.25; }
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
    /** Being hit: see strike() above. `persons` are people the simulation does not own (the player on foot): { x, z, vx, vz, tumble, ok, onStrike(strike, by, time) }, refreshed by their owner every frame. */
    strike, setPerson(id, q) { persons.set(id, q); }, removePerson(id) { persons.delete(id); }, victims, events,
    /** The hits since the last call (for the sound and the screen), oldest first. */
    takeEvents() { return events.splice(0); },
    /** Nearest NPC-free check, used to decide where a pickup vehicle may appear. */
    spotFree: freeSpot,
    /** If a vehicle has been stuck behind another driven by the simulation, remove that one (the road ahead of the player's ride must never stay blocked). */
    clearAhead(a) { const l = leaderOf(a); if (l?.who && vehicles.includes(l.who) && l.who.role === "npc") { l.who.done = true; return true; } return false; },
    density: D,
  };
}