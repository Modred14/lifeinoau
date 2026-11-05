// lib3d/roadgraph.js
// The campus roads as something a vehicle can actually follow. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
// Input is public/data/oau-roadgraph.json (centrelines found in the real road polygons by tools/oau/roadgraph.py). From it this builds:
//   - a standard cross-section for every road: a two-way carriageway with a pavement each side, as wide as the free space beside the road allows,
//   - two directed LANES per road (traffic keeps right, as in Nigeria), trimmed back from junctions,
//   - CONNECTORS: the smooth curves a vehicle drives through a junction from one lane into the next, and which of them cross each other,
//   - routing over lanes, upstream walking (where does a vehicle that must arrive here come from), and kerbside stopping places,
//   - surface queries: is this point carriageway, pavement or neither (one spatial hash shared by cars, pedestrians and the renderer),
//   - LEVELS: a road may run above the ground (the expressway and its ramps, lib3d/highway.js). Every edge has a level mask (1 ground, 2 deck, 3 ramp: both) and a surface query only
//     sees the levels it asks for (the default is the ground), so people, ambient traffic and pick-ups never meet the deck, while a car on it asks for the deck. heightAt() gives the height.
// Metres, x east, z south, like the rest of lib3d. Heading (hx, hz); the right-hand side of a heading is (-hz, hx).
import { Path } from "./roadnet.js";
import { dataUrl } from "./dataUrl.js";
import { buildJunctions, inside } from "./roadjunction.js";
import { DECK } from "./roadsurface.js";

/** Cross-section rules. A road is `half` metres from its centreline to the kerb on each side, then `sw` metres of pavement. */
export const XS = { minDrivableClearance: 2.7, lane: 3.5, minHalf: 3.5, maxHalf: 7.0, pavement: 2.0, minPavement: 0.7, setback: 0.7, junctionExtra: 1.6, frontage: 1.0, uTurnTrim: 3,
  /** a vehicle waits this far (m) beyond the mouth of a junction; the zebra crossing (3.4 m deep) sits between the mouth and the stop line */
  stopGap: 6.2, crossingGap: 1.6 };
/** The standard half-widths (m) a collector road comes in: it takes the widest that fits, so the network has a few widths, not a different one on every road. */
const STD_HALF = { collector: [5.0, 4.4, 3.8, 3.5] };
/**
 * What each class of road is made of, centreline outwards: a median strip (`med`, half its width), `lanes` traffic lanes of XS.lane each way, then a paved `shoulder`; the rest of the free space is pavement.
 * arterial = the campus' express roads (two lanes each way and a median); collector = a wide campus road (one lane each way and a shoulder for stopping); local = a lane each way.
 */
export const CLASSES = {
  arterial: { lanes: 2, med: 1.0, shoulder: 1.5, cap: 9.5 },
  collector: { lanes: 1, med: 0, shoulder: 1.5, cap: 5.5 },
  local: { lanes: 1, med: 0, shoulder: 0.5, cap: 4.0 },
};
/**
 * The cross-section of a class when `avail` metres are free beside the centreline: gives up the shoulder first, then lanes. Returns { half, med, lanes (per direction), shoulder }.
 * An arterial is as many lanes each way as the road on the map was wide: a 35-45 m dual carriageway (the main road in from the south, the Senate roundabout) gets three, the others two.
 */
export function crossSection(cls, avail, rawHalf = 0) {
  const C = CLASSES[cls] ?? CLASSES.local;
  if (cls === "arterial") for (let lanes = rawHalf >= 16 ? 3 : 2; lanes >= 2; lanes--) for (const sh of [C.shoulder, 0.8, 0.3, 0]) { const h = C.med + lanes * XS.lane + sh; if (h <= avail + 1e-6) return { half: h, med: C.med, lanes, shoulder: sh }; }
  // not an express road (or no room for one): as wide as the polygon was, between one lane and the class' cap, and no wider than the free space
  const want = Math.min(C.cap, Math.max(XS.lane, rawHalf)); let half = Math.max(XS.minHalf, Math.min(want, avail));
  const std = STD_HALF[cls]; if (std) half = std.find((h) => h <= half + 0.05) ?? Math.max(XS.minHalf, half);
  return { half, med: 0, lanes: 1, shoulder: Math.max(0, half - XS.lane) };
}
/** Two surfaces that are more than this many metres apart in height are not the same place (a ramp over a road). */
const LEVEL_GAP = 3.0;
/** Height of the surface at fraction t of a spatial-hash segment (sg.s0 is where the segment starts along its edge). */
const segH = (e, sg, t) => (e.h0 === e.h1 ? e.h0 : heightOn(e, sg.s0 + t * Math.hypot(sg.bx - sg.ax, sg.bz - sg.az)));
/** Level masks: an edge is on the ground (1), on the deck (2) or a ramp (4). A vehicle on level 0 sees ground + ramps (5), on level 1 deck + ramps (6); people see only the ground (1). */
export const LV_GROUND = 1, LV_DECK = 2, LV_RAMP = 4;
const maskOfLv = (lv) => (lv === 1 ? LV_DECK : lv === 2 ? LV_RAMP : LV_GROUND);
/** The surface mask for a vehicle on level `lv` (0 ground, 1 deck): its own level plus the ramps between them. */
export const carMask = (lv) => (lv ? LV_DECK : LV_GROUND) | LV_RAMP;
/**
 * The same, for a vehicle at height h: it also sees the deck when it is high enough to be on it (a car on a ramp, or crossing from a ramp on to the deck, has its nose over the deck before its middle is), and the
 * ground when it is low. Surfaces more than LEVEL_GAP from the vehicle's height are never seen anyway (surfaceAt's hRef), so this only stops the level, which is decided at the middle of the car, from hiding a surface
 * that a corner of it is already over.
 */
export const carMaskAt = (lv, h) => carMask(lv) | (h > LEVEL_GAP ? LV_DECK : 0) | (h < LEVEL_GAP ? LV_GROUND : 0);
const ease5 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * t * (t * (t * 6 - 15) + 10); };   // smootherstep: a ramp starts and ends level, so a car never meets a kink
/**
 * The fraction (0..1) of its climb a ramp has made at distance s along its climbing stretch [a, b]: a steady grade with eased ends (the slope builds up over `te` metres, holds, and eases off), so a car never meets a kink and
 * the grade is as gentle as the stretch allows. Below a it is 0, above b it is 1.
 */
export const RAMP_EASE = 40;
export function climbFrac(s, a, b) {
  if (s <= a) return 0; if (s >= b) return 1;
  const L = b - a, te = Math.min(RAMP_EASE, L * 0.25), k = 1 / (L - te), x = s - a;
  return x < te ? (k * x * x) / (2 * te) : x > L - te ? 1 - (k * (L - x) * (L - x)) / (2 * te) : k * (te / 2 + (x - te));
}
/** Height of a road at distance s along it. A ramp climbs over [ha, hb] (see shapeRamps); an edge without them (a flat one, or a plain ramp description) eases over its whole length. */
export const heightOn = (e, s) => (e.h0 === e.h1 ? e.h0 : e.h0 + (e.h1 - e.h0) * (e.ha === undefined ? ease5(s / (e.len || 1)) : climbFrac(s, e.ha, e.hb)));
const CELL = 24;
/** Is (x, z) inside the polygon, or within `r` metres of its outline? */
const nearPoly = (P, x, z, r) => { if (inside(P, x, z)) return true; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const ax = P[j][0], az = P[j][1], dx = P[i][0] - ax, dz = P[i][1] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r) return true; } return false; };
const TAU = Math.PI * 2;
const angDiff = (a, b) => ((b - a + Math.PI * 3) % TAU) - Math.PI;
const bez = (p0, p1, p2, p3, t) => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]; };

/** A min-heap of [priority, value] pairs. */
export class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, v) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i > 0) { const u = (i - 1) >> 1; if (a[u][0] <= a[i][0]) break; [a[u], a[i]] = [a[i], a[u]]; i = u; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= a.length) break; if (c + 1 < a.length && a[c + 1][0] < a[c][0]) c++; if (a[c][0] >= a[i][0]) break; [a[c], a[i]] = [a[i], a[c]]; i = c; } } return top; }
}

/** Samples a Path every `step` metres between s0 and s1, with a tangent taken over a short span so corners do not jump. Returns [{x, z, hx, hz}]. */
function sampleSmooth(path, s0, s1, step) {
  const out = [], n = Math.max(1, Math.ceil((s1 - s0) / step)), a = {}, b = {};
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n; path.at(s, a); path.at(Math.max(0, s - 1.5), b); const px = b.x, pz = b.z; path.at(Math.min(path.len, s + 1.5), b);
    let hx = b.x - px, hz = b.z - pz; const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l; out.push({ x: a.x, z: a.z, hx, hz });
  }
  return out;
}


/**
 * Pushes the middle of a road away from buildings that crowd it. Samples the line every 2 m, and where a sample is closer than `need` to something solid
 * moves it away along the direction of steepest clearance, then smooths the moves so the road bends gently. The ends (junctions) stay put.
 */
function relaxCentreline(pts, need, sdf) {
  const path = new Path(pts), n = Math.max(2, Math.ceil(path.len / 2)); let P = []; const at = {};
  for (let i = 0; i <= n; i++) { path.at((path.len * i) / n, at); P.push([at.x, at.z]); }
  if (n < 4) return P;
  const taper = (i) => Math.max(0, Math.min(1, Math.min(i, n - i) / Math.min(6, n / 2)));
  for (let it = 0; it < 8; it++) {
    const mv = P.map(() => [0, 0]); let any = false;
    for (let i = 1; i < n; i++) {
      const c = sdf(P[i][0], P[i][1]); if (c >= need) continue;
      const h = 0.7, gx = sdf(P[i][0] + h, P[i][1]) - sdf(P[i][0] - h, P[i][1]), gz = sdf(P[i][0], P[i][1] + h) - sdf(P[i][0], P[i][1] - h), gl = Math.hypot(gx, gz); if (gl < 1e-6) continue;
      const k = Math.min(1.2, (need - c) * 0.7); mv[i] = [(gx / gl) * k, (gz / gl) * k]; any = true;
    }
    if (!any) break;
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i < n; i++) { const a = mv[i - 1], b = mv[i], c = mv[Math.min(n, i + 1)]; mv[i] = [a[0] * 0.25 + b[0] * 0.5 + c[0] * 0.25, a[1] * 0.25 + b[1] * 0.5 + c[1] * 0.25]; }
    P = P.map((p, i) => [p[0] + mv[i][0] * taper(i), p[1] + mv[i][1] * taper(i)]);
  }
  return P;
}

/**
 * Makes each ramp meet the deck FLUSH. A ramp is laid out to leave (or join) the deck tangentially, at the deck's own centreline, so for its last stretch it runs under the deck's footprint. The old
 * profile climbed to the deck height only at that centreline, so over that stretch the ramp was 0.5 to 2.8 m below the deck surface, inside its girder: a car on the ramp drove into the side of the bridge.
 * Here the climb is finished where the ramp's inner edge reaches the deck's outer edge (the road layout is unchanged), and from there the ramp runs at deck height, level with the deck it merges into.
 * Sets ha / hb (the climbing stretch, metres along the edge from its first point) on each ramp edge, and on the matching entries of the expressway description that the meshes are built from;
 * the heights of the ramp piers follow the new profile.
 */
export function shapeRamps(ex, edges) {
  if (!ex?.deck) return;
  const D = ex.deck, seg = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
  const lat = (x, z) => { let d = Infinity; for (let i = 0; i < D.length - 1; i++) d = Math.min(d, seg(x, z, D[i][0], D[i][1], D[i + 1][0], D[i + 1][1])); return d; };
  // where a ramp leaves or joins, the deck's parapet has a gap (the mesh leaves it open): the drivable width is open there too
  for (const e of edges) if (e.hw && e.rail > 0 && e.kind !== "ramp" && e.ds1 > e.ds0) { const g = (ex.ramps ?? []).filter((r) => r.gap && r.gap[1] >= e.ds0 && r.gap[0] <= e.ds1).map((r) => ({ s0: r.gap[0], s1: r.gap[1], side: r.gap[2] })); if (g.length) e.gaps = g; }
  for (const e of edges) {
    if (e.kind !== "ramp" || e.h0 === e.h1) continue;
    const r = ex.ramps?.find((q) => q.id === e.id), lim = ex.half + (r?.half ?? e.half) + 1.0, up = e.h1 > e.h0, at = {};
    // the first point along the edge, from the deck end, that is clear of the deck's footprint: the climb must be done there (rising ramp: its last such point is where it ends)
    let u0 = up ? 0 : e.len; if (up) { for (let u = 0; u <= e.len; u += 0.5) { e.path.at(u, at); if (lat(at.x, at.z) <= lim) { u0 = u; break; } u0 = e.len; } } else { for (let u = e.len; u >= 0; u -= 0.5) { e.path.at(u, at); if (lat(at.x, at.z) <= lim) { u0 = u; break; } u0 = 0; } }
    e.ha = up ? 0 : u0; e.hb = up ? u0 : e.len;
    if (r) { r.ha = e.ha; r.hb = e.hb; r.grade = Math.abs(e.h1 - e.h0) / Math.max(1, e.hb - e.ha); }
    for (const p of ex.rampPiers ?? []) if (p.ramp === e.id) p.h = Math.round(heightOn(e, p.u) * 100) / 100;
  }
}

/**
 * Builds everything from the generated JSON. `raw` is { nodes: [{id,x,z,rim,comp}], edges: [{id,a,b,pts,w,clr,comp}] }.
 * `sdf` (optional) is (x, z) => signed distance to the nearest building or water (CollisionWorld.sdf). With it the centrelines are nudged away from
 * buildings that crowd them, and each road is sized from the clearance that is really left, so lanes never clip a wall.
 */
export function buildRoadGraph(raw, { sdf = null } = {}) {
  const nodes = raw.nodes.map((n) => ({ ...n, edges: [], radius: XS.minHalf, mask: 0, h: 0, fixedOnly: true })), edges = [], foots = [];
  // ---- the cross-section of each edge ----
  for (const e of raw.edges) {
    let pts = e.pts, clr = e.clr ?? 10; const rawHalf = (e.w ?? 4) / 2, cls = e.cls ?? "collector";
    // an edge with `fixed` is designed, not found (the expressway and its ramps): its geometry and cross-section are exactly as given and are never nudged or measured against buildings
    if (e.fixed) {
      const path = new Path(pts), F = e.fixed, lv = e.lv ?? 0;
      edges.push({ id: e.id, a: e.a, b: e.b, path, len: path.len, half: F.half, sw: F.sw ?? 0, med: F.med ?? 0, lanesPerDir: F.lanes ?? 1, shoulder: F.shoulder ?? 0, laneOff: F.laneOff ?? null, oneWay: !!e.oneWay, cls: e.kind ?? "express", kind: e.kind ?? "express", hw: !!e.hw, lv, mask: maskOfLv(lv), h0: e.h0 ?? 0, h1: e.h1 ?? e.h0 ?? 0, comp: e.comp ?? 0, lanes: [null, null], rawHalf: F.half, clr: Infinity, foot: false, struct: e.struct ?? null,
        ds0: e.s0 ?? 0, ds1: e.s1 ?? 0, rail: F.rail ?? (e.kind === "ramp" ? DECK.rampParapet : e.hw ? DECK.parapet : 0), endInset: F.endInset ?? (e.kind === "express-end" ? DECK.endStop : 0) });   // rail: the parapet (not drivable); endInset: where the drivable surface stops short of a dead end (the end barrier)
      continue;
    }
    if (sdf) {
      const want = Math.min(cls === "arterial" ? 13 : CLASSES[cls]?.cap ?? XS.maxHalf, Math.max(XS.lane, rawHalf)) + XS.setback;
      pts = relaxCentreline(pts, Math.min(want, XS.lane + 1.2), sdf);
      const probe = new Path(pts), edge = Math.min(10, probe.len * 0.25), at = {}; let lo = Infinity;   // clearance along the road, leaving out the junction ends
      for (let s = edge; s <= probe.len - edge; s += 1.5) { probe.at(s, at); lo = Math.min(lo, sdf(at.x, at.z)); }
      clr = Number.isFinite(lo) ? lo : clr;
    }
    const path = new Path(pts); if (path.len < 1) continue;
    if (e.a === e.b && path.len < 30) continue;   // a tiny loop where the centreline circled a wide junction: not a road
    const avail = Math.max(0, clr - XS.setback);
    // an alley squeezed between buildings (less than a car and some margin) is a footpath: walkable pavement, but no lanes and no vehicles
    const foot = clr < XS.minDrivableClearance;
    const X = foot ? { half: 0, med: 0, lanes: 1, shoulder: 0 } : crossSection(cls, Math.max(avail - XS.frontage, Math.min(avail, XS.minHalf)), rawHalf), half = X.half;   // keep a strip of pavement against the buildings: people step out of a car onto it, and doors open onto it
    let sw = foot ? Math.max(1.0, Math.min(XS.pavement, clr - 0.3)) : Math.min(XS.pavement, Math.max(0, avail - half)); if (!foot && sw < XS.minPavement) sw = 0;
    (foot ? foots : edges).push({ id: e.id, a: e.a, b: e.b, path, len: path.len, half, sw, med: X.med, lanesPerDir: X.lanes, shoulder: X.shoulder, laneOff: null, oneWay: false, cls, kind: cls, hw: false, lv: 0, mask: LV_GROUND, h0: 0, h1: 0, comp: e.comp ?? 0, lanes: [null, null], rawHalf, clr, foot });
  }
  const byId = new Map([...edges, ...foots].map((e) => [e.id, e]));
  for (const e of edges) {
    nodes[e.a].edges.push(e.id); if (e.b !== e.a) nodes[e.b].edges.push(e.id); nodes[e.a].radius = Math.max(nodes[e.a].radius, e.half); nodes[e.b].radius = Math.max(nodes[e.b].radius, e.half);
    if (!e.hw) nodes[e.a].fixedOnly = nodes[e.b].fixedOnly = false;
    nodes[e.a].mask |= e.mask; nodes[e.b].mask |= e.mask; nodes[e.a].h = Math.max(nodes[e.a].h, e.h0); nodes[e.b].h = Math.max(nodes[e.b].h, e.h1);
  }
  for (const n of nodes) n.deg = n.edges.length;
  // ---- junction polygons (lib3d/roadjunction.js): where the roads meet, one polygon per layer; the road ribbons start where it ends ----
  const jstat = buildJunctions(nodes, byId);
  shapeRamps(raw.expressway, edges);
  // The END of a designed road that leads nowhere (the deck's two ends) is a flat cut across the road, `endInset` metres short of the last point, where the end barrier stands: not a half-circle
  // (every segment of a road is measured as a capsule, which would carry the road on past the barrier for a whole carriageway's width). Stored as planes: a point on the outer side of one is not road.
  for (const e of edges) {
    if (!(e.hw && e.endInset > 0)) continue; const P = e.path.pts, n = P.length, cuts = [];
    const plane = (end, step) => { let q = end + step; while (q + step >= 0 && q + step < n && Math.hypot(P[q][0] - P[end][0], P[q][1] - P[end][1]) < 5) q += step; const l = Math.hypot(P[end][0] - P[q][0], P[end][1] - P[q][1]) || 1; return { x: P[end][0], z: P[end][1], ox: (P[end][0] - P[q][0]) / l, oz: (P[end][1] - P[q][1]) / l }; };   // the outward direction at the end, taken over about 5 m
    if (nodes[e.a].deg === 1) cuts.push(plane(0, 1)); if (nodes[e.b].deg === 1) cuts.push(plane(n - 1, -1));
    if (cuts.length) e.cuts = cuts;
  }

  // ---- lanes: forward (a -> b) is dir 0, backward is dir 1. Lane centre is half/2 to the right of travel. ----
  const lanes = [];
  // two arms that meet at a sharp angle need their stop lines further from the middle, or a car waiting on one would sit inside the car waiting on the next
  const armTrim = new Map();
  for (const n of nodes) {
    if (n.deg < 3) continue; const arms = [];
    for (const eid of n.edges) { const e = byId.get(eid); for (const end of [e.a === n.id ? 0 : -1, e.b === n.id ? 1 : -1]) { if (end < 0) continue; const p = e.path.at(end ? Math.max(0, e.len - Math.min(8, e.len * 0.4)) : Math.min(8, e.len * 0.4), {}); arms.push({ e, end, ang: Math.atan2(p.z - n.z, p.x - n.x) }); } }
    arms.sort((p, q) => p.ang - q.ang); const k = arms.length;
    arms.forEach((a, i) => { const gp = (arms[(i + 1) % k].ang - a.ang + TAU) % TAU, gm = (a.ang - arms[(i + k - 1) % k].ang + TAU) % TAU, th = Math.max(0.25, Math.min(gp, gm)); armTrim.set(a.e.id * 2 + a.end, Math.min(24, (2.6 + a.e.half * Math.cos(th / 2)) / (2 * Math.sin(th / 2)))); });
  }
  // a vehicle stops beyond the junction's mouth (and the zebra crossing in front of it), not in the middle of the junction
  const mouth = (e, node) => (node.deg >= 3 && !e.hw ? node.J?.asph.cut.get(e.id * 2 + (node.id === e.a ? 0 : 1)) ?? 0 : 0);
  const trimAt = (e, node) => (node.deg <= 1 ? XS.uTurnTrim : Math.min(0.42 * e.len, Math.max(node.radius + XS.junctionExtra, armTrim.get(e.id * 2 + (node.id === e.a ? 0 : 1)) ?? 0, mouth(e, node) ? mouth(e, node) + XS.stopGap : 0)));
  // where a lane runs, measured from the centreline: the middle of the road's own lane (the right-hand one on an express road, so traffic keeps to the outer lane), or the centreline of a one-way carriageway
  const laneOffset = (e) => (e.oneWay ? 0 : e.laneOff ?? (e.med > 0 ? Math.min(e.half - 1.0, e.med + XS.lane * (e.lanesPerDir - 0.5)) : e.half / 2));
  for (const e of edges) {
    for (const dir of e.oneWay ? [0] : [0, 1]) {
      const from = dir ? e.b : e.a, to = dir ? e.a : e.b, off = laneOffset(e);
      const ta = trimAt(e, nodes[from]), tb = trimAt(e, nodes[to]), s0 = dir ? e.len - ta : ta, s1 = dir ? tb : e.len - tb;
      const centre = sampleSmooth(e.path, Math.min(s0, s1), Math.max(s0, s1), 1.0), line = dir ? centre.reverse().map((p) => ({ x: p.x, z: p.z, hx: -p.hx, hz: -p.hz })) : centre;
      const pts = line.map((p) => [p.x - p.hz * off, p.z + p.hx * off]);
      if (pts.length < 2) pts.push([pts[0][0] + line[0].hx * 0.5, pts[0][1] + line[0].hz * 0.5]);
      const lane = { id: lanes.length, edge: e.id, dir, from, to, path: new Path(pts), off, half: e.half, sw: e.sw, comp: e.comp, hw: e.hw, mask: e.mask, out: [], in: [], trimA: ta, trimB: tb };
      lane.len = lane.path.len; lanes.push(lane); e.lanes[dir] = lane;
    }
  }
  const endState = (l, atEnd) => { const a = {}, b = {}; if (atEnd) { l.path.at(l.len, a); l.path.at(Math.max(0, l.len - 1), b); let hx = a.x - b.x, hz = a.z - b.z; const m = Math.hypot(hx, hz) || 1; return { x: a.x, z: a.z, hx: hx / m, hz: hz / m }; } l.path.at(0, a); l.path.at(Math.min(l.len, 1), b); let hx = b.x - a.x, hz = b.z - a.z; const m = Math.hypot(hx, hz) || 1; return { x: a.x, z: a.z, hx: hx / m, hz: hz / m }; };

  // ---- connectors ----
  const conns = [];
  for (const n of nodes) {
    const ins = lanes.filter((l) => l.to === n.id), outs = lanes.filter((l) => l.from === n.id);
    for (const li of ins) {
      const s = endState(li, true), cand = [];
      for (const lo of outs) {
        const uturn = lo.edge === li.edge && lo.dir !== li.dir;
        if ((uturn && n.deg > 1) || lo === li) continue;
        const t = endState(lo, false); cand.push({ lo, uturn, t, turn: angDiff(Math.atan2(s.hx, s.hz), Math.atan2(t.hx, t.hz)) });
      }
      // a turn of more than ~135 degrees (two roads meeting at a sharp Y) is not a turn a vehicle can make: only keep one when nothing gentler exists
      const gentle = cand.filter((c) => c.uturn || Math.abs(c.turn) <= 2.35), use = gentle.some((c) => !c.uturn) || n.deg <= 1 ? gentle : cand;
      for (const { lo, uturn, t, turn } of use) {
        const d = Math.hypot(t.x - s.x, t.z - s.z), k = uturn ? Math.max(2.4, d * 0.9) : Math.max(1.2, d * 0.42, Math.abs(turn) > 2 ? 3 : 0), p1 = [s.x + s.hx * k, s.z + s.hz * k], p2 = [t.x - t.hx * k, t.z - t.hz * k];
        const pts = [], len0 = Math.max(2, d + Math.abs(turn) * 3), m = Math.max(4, Math.ceil(len0 / 0.8));
        for (let i = 0; i <= m; i++) pts.push(bez([s.x, s.z], p1, p2, [t.x, t.z], i / m));
        const path = new Path(pts), kind = uturn ? "uturn" : Math.abs(turn) < 0.4 ? "straight" : (turn > 0 ? "right" : "left");
        const c = { id: conns.length, node: n.id, from: li.id, to: lo.id, path, len: path.len, turn, kind, conflicts: [] };
        conns.push(c); li.out.push(c.id); lo.in.push(c.id);
      }
    }
  }
  // which connectors in one junction cross or merge (a vehicle waits for the other)
  const nodeConns = new Map(); for (const c of conns) { if (!nodeConns.has(c.node)) nodeConns.set(c.node, []); nodeConns.get(c.node).push(c); }
  const bb = (c) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of c.path.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return [x0, z0, x1, z1]; };
  for (const list of nodeConns.values()) {
    list.forEach((c) => { c.bb = bb(c); });
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; if (a.from === b.from) continue;               // same entry lane: they do not cross, they follow each other
      let hit = a.to === b.to;
      if (!hit) { const m = 2.7; if (a.bb[0] - m > b.bb[2] || b.bb[0] - m > a.bb[2] || a.bb[1] - m > b.bb[3] || b.bb[1] - m > a.bb[3]) continue;
        search: for (let s = 0; s <= a.len; s += 0.8) { const p = a.path.at(s, {}); for (let u = 0; u <= b.len; u += 0.8) { const q = b.path.at(u, {}); if (Math.hypot(p.x - q.x, p.z - q.z) < m) { hit = true; break search; } } } }
      if (hit) { a.conflicts.push(b.id); b.conflicts.push(a.id); }
    }
  }
  for (const c of conns) delete c.bb;
  // which OTHER entry lanes end so close to a connector's path that a vehicle waiting at the end of one would be clipped by a vehicle driving it
  for (const c of conns) {
    c.lanesNear = [];
    for (const L of lanes) {
      if (L.to !== c.node || L.id === c.from) continue; let hit = false;
      for (let s = Math.max(0, L.len - 7); s <= L.len && !hit; s += 1) { const p = L.path.at(s, {}); for (let u = 0; u <= c.len; u += 0.8) { const q = c.path.at(u, {}); if (Math.hypot(p.x - q.x, p.z - q.z) < 2.7) { hit = true; break; } } }
      if (hit) c.lanesNear.push(L.id);
    }
  }


  // ---- spatial hash of centreline segments, for surface and nearest-road queries ----
  const hash = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  const segs = [];
  for (const e of [...edges, ...foots]) {
    const P = e.path.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const sg = { e: e.id, ax: P[i][0], az: P[i][1], bx: P[i + 1][0], bz: P[i + 1][1], s0: e.path.cum[i], reach: e.half + e.sw, len: Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) || 1 };
      segs.push(sg);
      const i0 = Math.floor((Math.min(sg.ax, sg.bx) - sg.reach) / CELL), i1 = Math.floor((Math.max(sg.ax, sg.bx) + sg.reach) / CELL), j0 = Math.floor((Math.min(sg.az, sg.bz) - sg.reach) / CELL), j1 = Math.floor((Math.max(sg.az, sg.bz) + sg.reach) / CELL);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const k = key(a, b); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(sg); }
    }
  }
  // junction patches: the corner a vehicle sweeps through while it turns is road too (otherwise the inside of every turn would be "off the road")
  const patches = [];
  for (const c of conns) {
    if (nodes[c.node].fixedOnly && nodes[c.node].deg === 1) continue;   // the dead end of the deck: the deck covers the turning area, and the U-turn's patch would reach past the end barrier
    const ef = byId.get(lanes[c.from].edge), et = byId.get(lanes[c.to].edge), half = (ef.hw || et.hw ? Math.min(ef.half, et.half) : Math.max(ef.half, et.half)) + 0.4, P = c.path.pts, mk = lanes[c.from].mask | lanes[c.to].mask, pe = { id: -(c.id + 1), half, sw: 0, med: 0, mask: mk, h0: nodes[c.node].h, h1: nodes[c.node].h, comp: lanes[c.from].comp, conn: c.id, path: c.path }; byId.set(pe.id, pe); patches.push(pe);
    // the whole turn is swept, from the stop line to the next lane: a driver cuts corners, and must never meet an invisible edge
    for (let i = 0; i < P.length - 1; i += 2) {
      const j = Math.min(P.length - 1, i + 2); 
      const sg = { e: pe.id, ax: P[i][0], az: P[i][1], bx: P[j][0], bz: P[j][1], s0: 0, reach: half };
      const i0 = Math.floor((Math.min(sg.ax, sg.bx) - half) / CELL), i1 = Math.floor((Math.max(sg.ax, sg.bx) + half) / CELL), j0 = Math.floor((Math.min(sg.az, sg.bz) - half) / CELL), j1 = Math.floor((Math.max(sg.az, sg.bz) + half) / CELL);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const k = key(a, b); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(sg); }
    }
  }
  const nhash = new Map(); for (const n of nodes) { if (!n.deg || n.fixedOnly) continue;   /* a junction on the expressway has no disc: the carriageways meet end to end, and a disc would cover the median */ const r = (n.J ? n.J.pave.rmax : n.radius + XS.pavement) + 1; for (let a = Math.floor((n.x - r) / CELL); a <= Math.floor((n.x + r) / CELL); a++) for (let b = Math.floor((n.z - r) / CELL); b <= Math.floor((n.z + r) / CELL); b++) { const k = key(a, b); if (!nhash.has(k)) nhash.set(k, []); nhash.get(k).push(n); } }

  const segDist = (sg, x, z) => { const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, l2 = dx * dx + dz * dz || 1; let t = ((x - sg.ax) * dx + (z - sg.az) * dz) / l2; t = Math.max(0, Math.min(1, t)); const px = sg.ax + dx * t, pz = sg.az + dz * t; return { d: Math.hypot(x - px, z - pz), t, px, pz }; };

  /** How far from the centreline (m) a vehicle may drive on edge e at (x, z), whose nearest segment is sg (fraction t, distance d): up to the parapet, or to the edge of the deck where the parapet has a gap. */
  const driveHalf = (e, sg, t, x, z, d) => {
    const base = e.half - (e.rail ?? 0); if (!e.gaps || d <= base || d > e.half) return base;
    const sd = e.ds0 + (sg.s0 + t * sg.len) * ((e.ds1 - e.ds0) / (e.len || 1)), side = (sg.bx - sg.ax) * (z - sg.az) - (sg.bz - sg.az) * (x - sg.ax) >= 0 ? 1 : -1;
    for (const q of e.gaps) if (q.side === side && sd >= q.s0 && sd <= q.s1) return e.half; return base;
  };
  /** Is (x, z) beyond the flat end of a designed dead-end road (past its end barrier)? A plane, so it holds however far past the end the point is, and at any speed a car might skip it. */
  const beyondEnd = (e, x, z) => { for (const c of e.cuts) if ((x - c.x) * c.ox + (z - c.z) * c.oz > -e.endInset) return true; return false; };
  /** Scratch for surfaceAt: the nearest segment of each road around the point (reused, so a query allocates nothing). */
  const CAND = Array.from({ length: 256 }, () => ({ e: null, sg: null, t: 0, d: 0 }));   // a busy junction cell holds a road or two and a patch for every turn through it: tens of them

  const G = {
    sdf, nodes, edges, foots, lanes, conns, patches, junctions: jstat, byEdge: byId, segs, expressway: raw.expressway ?? null, comps: Math.max(0, ...edges.map((e) => e.comp)) + 1, bounds: raw.bounds ?? null,
    laneOf: (edge, dir) => byId.get(edge)?.lanes[dir] ?? null,

    /**
     * What is at (x, z)? { cls: 0 ground, 1 carriageway, 2 pavement, edge, d (to the centreline), half, sw, h (height of the surface there, m) }. Carriageway wins over pavement.
     * `mask` says which levels are seen (LV_GROUND = 1 by default: the deck and its ramps do not exist for people, traffic and pick-ups; a vehicle asks for carMask(its level)).
     * A median (the strip down the middle of an express road) is neither carriageway nor pavement: nobody drives over it, and it is no place to wait.
     */
    surfaceAt(x, z, out = {}, mask = LV_GROUND, hRef = NaN) {
      out.cls = 0; out.edge = -1; out.d = Infinity; out.half = 0; out.sw = 0; out.h = 0; let bestPav = null, nc = 0;
      const list = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      // 1. for each road under the point, the NEAREST of its segments (a road is one surface: its height at a point is the height of the part of it that is nearest, never of a farther part that
      //    merely happens to be at the height the car was at a moment ago: that made the height cling to its old value on a slope and then jump)
      if (list) for (const sg of list) {
        const e = byId.get(sg.e); if (!(e.mask & mask)) continue; const { d, t } = segDist(sg, x, z); if (hRef === hRef && Math.abs(segH(e, sg, t) - hRef) > LEVEL_GAP) continue;
        if (e.cuts && beyondEnd(e, x, z)) continue;
        let k = 0; while (k < nc && CAND[k].e !== e) k++;
        if (k < nc) { const c = CAND[k]; if (d < c.d) { c.sg = sg; c.t = t; c.d = d; } continue; }
        if (nc < CAND.length) { const c = CAND[nc++]; c.e = e; c.sg = sg; c.t = t; c.d = d; }
      }
      // 2. between DIFFERENT roads at the same place (a ramp where it runs on to the deck, a ramp over a road): the one at the height the car is at, otherwise the nearer
      //    Two roads whose surfaces are within 10 cm of each other are drawn on top of one another (a ramp's last metres lie just under the deck): what is seen, and what a tyre must sit on, is the higher.
      let best = null, bestDh = 0, bestH = 0;
      for (let k = 0; k < nc; k++) {
        const c = CAND[k], e = c.e;
        if (c.d <= driveHalf(e, c.sg, c.t, x, z, c.d)) {   // the carriageway (the parapet along the edge of a deck is not drivable, except in its gaps)
          if (c.d < (e.med ?? 0)) continue;           // the median
          const ch = segH(e, c.sg, c.t), dh = hRef === hRef ? Math.abs(ch - hRef) : 0, gap = best ? Math.abs(ch - bestH) : 0;
          if (!best || (gap > 0.002 && gap <= 0.1 ? ch > bestH : Math.abs(dh - bestDh) > 0.02 ? dh < bestDh : c.d < best.d)) { best = c; bestDh = dh; bestH = ch; }
        } else if (c.d > e.half && c.d <= e.half + e.sw && (!bestPav || c.d < bestPav.d)) bestPav = { d: c.d, e };
      }
      if (best) {
        const e = best.e; out.cls = 1; out.edge = e.id; out.d = best.d; out.half = e.half; out.sw = e.sw;
        if (e.h0 || e.h1) out.h = heightOn(e, best.sg.s0 + best.t * best.sg.len);
      }
      const nl = nhash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (nl) for (const n of nl) { if (!(n.mask & mask) || (hRef === hRef && Math.abs(n.h - hRef) > LEVEL_GAP)) continue; const d = Math.hypot(x - n.x, z - n.z), J = n.J;
        // the junction's own polygon (the same one that is drawn): carriageway inside the asphalt, pavement inside the pavement polygon
        if (d <= n.radius || (J && inside(J.asph.poly, x, z))) { out.cls = 1; if (out.edge < 0) out.edge = n.edges[0]; out.d = Math.min(out.d, d); if (!best) out.h = n.h; } else if (out.cls !== 1 && !bestPav && (J ? inside(J.pave.poly, x, z) : d <= n.radius + XS.pavement)) bestPav = { d, e: byId.get(n.edges[0]) }; }
      if (out.cls === 0 && bestPav) { out.cls = 2; out.edge = bestPav.e.id; out.d = bestPav.d; out.half = bestPav.e.half; out.sw = bestPav.e.sw; }
      return out;
    },
    onCarriageway(x, z, mask = LV_GROUND, hRef = NaN) { return G.surfaceAt(x, z, G._s ??= {}, mask, hRef).cls === 1; },
    /** The height (m) of the road surface a vehicle on level `mask` stands on at (x, z): 0 on the ground, the deck's or ramp's height above it. */
    heightAt(x, z, mask = LV_DECK | LV_GROUND | LV_RAMP, hRef = NaN) { const s = G.surfaceAt(x, z, G._h ??= {}, mask, hRef); return s.cls === 1 ? s.h : 0; },
    /**
     * The height of the road under (x, z) for a point that may not be exactly on it (a tyre a hair over the kerb, a corner just past the end of the deck). On the carriageway it is the road's height; off it,
     * the profile of the nearest road of the right height, carried on. It never drops to 0 (heightAt does, which is right for "is there a road" but makes a body jump 10 m when a wheel crosses an edge);
     * with nothing near it gives `hRef`, i.e. stays where it is.
     */
    heightNear(x, z, mask = LV_DECK | LV_GROUND | LV_RAMP, hRef = NaN, max = 8) {
      const s = G.surfaceAt(x, z, G._n ??= {}, mask, hRef); if (s.cls === 1) return s.h;
      let best = max, h = hRef === hRef ? hRef : 0; const list = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (list) for (const sg of list) { const e = byId.get(sg.e); if (!(e.mask & mask)) continue; const { d, t } = segDist(sg, x, z); if (d >= best) continue; const hh = segH(e, sg, t); if (hRef === hRef && Math.abs(hh - hRef) > LEVEL_GAP) continue; best = d; h = hh; }
      return h;
    },
    /**
     * Which level is a vehicle at (x, z) on? 1 = the deck (or a ramp's upper part), 0 = the ground. `prev` is where it was a moment ago: it only changes when the point is on one level and not the other
     * (under the deck, or where a ramp meets it, both are there, so the vehicle stays where it was). Also says whether it is on a ramp (`ramp`).
     */
    levelAt(x, z, prev = 0, hRef = NaN) {
      let ground = false, deck = false, ramp = false;
      const see = (m) => { if (m & LV_GROUND) ground = true; if (m & LV_DECK) deck = true; if (m & LV_RAMP) ramp = true; };
      const list = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (list) for (const sg of list) { const e = byId.get(sg.e), { d, t } = segDist(sg, x, z); if (d <= driveHalf(e, sg, t, x, z, d) && d >= (e.med ?? 0) && !(hRef === hRef && Math.abs(segH(e, sg, t) - hRef) > LEVEL_GAP) && !(e.cuts && beyondEnd(e, x, z))) see(e.mask); }
      const nl = nhash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (nl) for (const n of nl) if ((Math.hypot(x - n.x, z - n.z) <= n.radius || (n.J && inside(n.J.asph.poly, x, z))) && !(hRef === hRef && Math.abs(n.h - hRef) > LEVEL_GAP)) see(n.mask);
      const lv = deck && !ground ? 1 : ground && !deck ? 0 : prev;
      return { lv, ramp, deck, ground };
    },

    /** Nearest point on any road centreline within `max` metres: { edge, s (along the edge), x, z, d, side (+1 = on the right of a->b) }. `main` limits it to the big connected network. */
    nearestOnRoad(x, z, max = 80, main = false, mask = LV_GROUND) {
      let best = null; const r = Math.ceil(max / CELL);
      for (let a = Math.floor(x / CELL) - r; a <= Math.floor(x / CELL) + r; a++) for (let b = Math.floor(z / CELL) - r; b <= Math.floor(z / CELL) + r; b++) {
        const list = hash.get(key(a, b)); if (!list) continue;
        for (const sg of list) { if (sg.e < 0) continue; const e = byId.get(sg.e); if (!(e.mask & mask) || (main && e.comp !== 0)) continue; const q = segDist(sg, x, z); if (q.d > max || (best && q.d >= best.d)) continue;
          const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, l = Math.hypot(dx, dz) || 1, cr = (dx / l) * (z - q.pz) - (dz / l) * (x - q.px);   // >0: the point is on the right of a->b
          best = { edge: e.id, s: sg.s0 + q.t * l, x: q.px, z: q.pz, d: q.d, side: cr >= 0 ? 1 : -1 }; }
      }
      return best;
    },
    /** Where along lane `l` (its own arclength) is the point nearest (x, z)? */
    laneS(l, x, z) { return l.path.nearest(x, z, l.len / 2, l.len + 1); },

    /**
     * A kerbside stopping place for something that must pick up or set down at (x, z): the lane whose right-hand side faces that point, and a spot on it
     * clear of junctions. Returns { lane, s, x, z, hx, hz, edge, d } or null when no usable road is within `max` metres.
     */
    stopSpotFor(x, z, { max = 600, len = 6, main = true } = {}) {
      let best = null;
      for (const rad of [60, 140, 300, max]) {
        if (rad > max) break;
        for (const e of edges) {
          if (e.mask !== LV_GROUND || (main && e.comp !== 0)) continue; const n = G.nearestOnEdge(e, x, z); if (n.d > rad) continue;
          const side = n.side; const lane = e.lanes[side === 1 ? 0 : 1]; if (!lane || lane.len < len + 6) continue;
          const sl = G.laneS(lane, n.x, n.z); const s = Math.max(len / 2 + 2, Math.min(lane.len - len / 2 - 3, sl)); const p = lane.path.at(s, {});
          const score = n.d + (Math.abs(s - sl) * 0.8) + (lane.len < 30 ? 12 : 0); if (!best || score < best.score) best = { score, lane, s, x: p.x, z: p.z, hx: p.hx, hz: p.hz, edge: e.id, d: n.d };
        }
        if (best) break;
      }
      return best;
    },
    nearestOnEdge(e, x, z) { const P = e.path.pts; let best = null; for (let i = 0; i < P.length - 1; i++) { const sg = { ax: P[i][0], az: P[i][1], bx: P[i + 1][0], bz: P[i + 1][1] }, q = segDist(sg, x, z); if (!best || q.d < best.d) { const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, l = Math.hypot(dx, dz) || 1; best = { d: q.d, x: q.px, z: q.pz, s: e.path.cum[i] + q.t * l, side: (dx / l) * (z - q.pz) - (dz / l) * (x - q.px) >= 0 ? 1 : -1 }; } } return best; },

    /**
     * The best way from `fromLane` at distance `fromS` to `toLane` at `toS`. Returns a Route (see makeRoute) or null.
     * Cost is distance plus a small charge per turn, so a vehicle prefers the straight road to a zig-zag, and a U-turn only when nothing else will do.
     * Works when the target is behind the start on the same lane (the vehicle goes round).
     */
    route(fromLane, fromS, toLane, toS, opts = {}) {
      const L = lanes[fromLane], T = lanes[toLane]; if (!L || !T) return null;
      if (fromLane === toLane && toS >= fromS) return G.makeRoute([{ kind: "lane", id: fromLane, s0: fromS, s1: toS }], opts);
      const START = -1, dist = new Map(), prev = new Map(), heap = new Heap(), done = new Set(), tx = T.path.pts[0][0], tz = T.path.pts[0][1];
      const cost = (c, base) => base + c.len + Math.abs(c.turn) * 2 + (c.kind === "uturn" ? 80 : 0) + (c.to === toLane ? 0 : lanes[c.to].len);
      const useHw = L.hw || T.hw, relax = (from, c, base) => { if (opts.avoid?.has(c.to) || (lanes[c.to].hw && !useHw)) return; const g = cost(c, base); if (!dist.has(c.to) || g < dist.get(c.to)) { dist.set(c.to, g); prev.set(c.to, [from, c.id]); heap.push(g + Math.hypot(lanes[c.to].path.pts.at(-1)[0] - tx, lanes[c.to].path.pts.at(-1)[1] - tz) * 0.9, c.to); } };
      for (const cid of L.out) relax(START, conns[cid], L.len - fromS);
      let steps = 0;
      while (heap.size && ++steps < 80000) { const [, cur] = heap.pop(); if (done.has(cur)) continue; done.add(cur); if (cur === toLane) break; for (const cid of lanes[cur].out) relax(cur, conns[cid], dist.get(cur)); }
      if (!prev.has(toLane)) return null;
      const chain = []; let cur = toLane, guard = 0;
      while (cur !== START && guard++ < 5000) { const [p, cid] = prev.get(cur); chain.push({ lane: cur, cid }); cur = p; }
      chain.reverse();
      const segs2 = [{ kind: "lane", id: fromLane, s0: fromS, s1: L.len }];
      chain.forEach((c, i) => { segs2.push({ kind: "conn", id: c.cid }); segs2.push({ kind: "lane", id: c.lane, s0: 0, s1: i === chain.length - 1 ? toS : lanes[c.lane].len }); });
      return G.makeRoute(segs2, opts);
    },

    /**
     * A route that ENDS at lane/s and begins about `dist` metres upstream of it, found by walking the lanes backwards.
     * Used to bring a vehicle in to a pickup spot from out of sight.
     */
    upstreamRoute(lane, s, dist, rnd = Math.random, opts = {}) {
      const segs2 = [{ kind: "lane", id: lane, s0: Math.max(0, s - dist), s1: s }]; let need = dist - s, cur = lane, guard = 0;
      while (need > 0 && guard++ < 40) {
        const all = lanes[cur].in.map((cid) => conns[cid])  .filter((c) => lanes[c.from].comp === lanes[lane].comp && c.from !== cur && (lanes[lane].hw || !lanes[c.from].hw)), plain = all.filter((c) => c.kind !== "uturn"), ins = plain.length ? plain : all;   // a U-turn at a dead end is a fine way to arrive
        if (!ins.length) break;
        const c = ins[Math.floor(rnd() * ins.length)], pl = lanes[c.from]; segs2.unshift({ kind: "conn", id: c.id }); need -= c.len;
        const take = Math.min(pl.len, Math.max(0.5, need)); segs2.unshift({ kind: "lane", id: pl.id, s0: pl.len - take, s1: pl.len }); need -= take; cur = pl.id;
      }
      return G.makeRoute(segs2, opts);
    },

    /**
     * Joins route segments ([{kind: "lane"|"conn", id, s0, s1}]) into one smooth Path, with the bookkeeping vehicles need:
     * where each segment starts along it, and the speed each stretch allows (tight turns are slow, and a vehicle can always brake down to the next limit).
     * Returns { segs: [{kind, id, start, end, len, node?}], path, len, vAt(s) }.
     */
    makeRoute(segs0, { cruise = 14, aLat = 2.6, brake = 3.0, junctionSpeed = 7.5 } = {}) {
      const pts = [], segs3 = [], at = {};
      for (const sg of segs0) {
        const src = sg.kind === "lane" ? lanes[sg.id].path : conns[sg.id].path, a = sg.kind === "lane" ? sg.s0 : 0, b = sg.kind === "lane" ? sg.s1 : src.len;
        if (sg.kind === "lane" && b - a < 0.05 && segs0.length > 1) continue;
        const startS = routeLen(pts), n = Math.max(1, Math.ceil((b - a) / 1.0));
        for (let i = pts.length ? 1 : 0; i <= n; i++) { src.at(a + ((b - a) * i) / n, at); pts.push([at.x, at.z]); }
        segs3.push({ ...sg, start: startS, end: 0, len: 0 });
      }
      if (pts.length < 2) return null;
      const path = new Path(pts); segs3.forEach((s, i) => { s.end = i + 1 < segs3.length ? segs3[i + 1].start : path.len; s.len = s.end - s.start; if (s.kind === "conn") s.node = conns[s.id].node; });
      const N = Math.max(2, Math.ceil(path.len)), v = new Float32Array(N + 1), p = {}, q = {}, ds = path.len / N;
      for (let i = 0; i <= N; i++) { const s = ds * i; path.at(Math.max(0, s - 3), p); const a0 = Math.atan2(p.hx, p.hz); path.at(Math.min(path.len - 1e-6, s + 3), q); const kappa = Math.abs(angDiff(a0, Math.atan2(q.hx, q.hz))) / 6; v[i] = Math.min(cruise, kappa > 1e-4 ? Math.sqrt(aLat / kappa) : cruise); }
      for (const s of segs3) if (s.kind === "conn") for (let i = Math.floor(s.start / ds); i <= Math.ceil(s.end / ds) && i <= N; i++) v[i] = Math.min(v[i], junctionSpeed);
      for (let i = N - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * brake * ds));
      return { segs: segs3, path, len: path.len, vlim: v, vAt(s) { const f = Math.max(0, Math.min(N, s / ds)), i = Math.floor(f), k = f - i; return v[i] * (1 - k) + v[Math.min(N, i + 1)] * k; } };
    },
  };
  function routeLen(pts) { let t = 0; for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return t; }

  // ---- pedestrian crossings: at the mouth of every junction arm that is long enough, and halfway along long roads ----
  const crossings = [];
  for (const e of edges) {
    if (e.sw <= 0) continue;
    const add = (s) => { const p = e.path.at(s, {}); crossings.push({ x: p.x, z: p.z, hx: p.hx, hz: p.hz, half: e.half, sw: e.sw, edge: e.id, along: 1.7 }); };
    for (const [node, sFromA] of [[nodes[e.a], true], [nodes[e.b], false]]) {
      if (node.deg < 3 || e.len < 38) continue; const c = Math.min(0.42 * e.len - 2, mouth(e, node) + XS.crossingGap + 1.7); add(sFromA ? c : e.len - c);
    }
    if (e.len > 150) add(e.len / 2);
  }
  G.crossings = crossings;
  const chash = new Map(); crossings.forEach((c, i) => { for (let a = Math.floor((c.x - 12) / CELL); a <= Math.floor((c.x + 12) / CELL); a++) for (let b = Math.floor((c.z - 12) / CELL); b <= Math.floor((c.z + 12) / CELL); b++) { const k = key(a, b); if (!chash.has(k)) chash.set(k, []); chash.get(k).push(i); } });
  /** Is (x, z) on a marked crossing? */
  G.onCrossing = (x, z) => { for (const i of chash.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) { const c = crossings[i], dx = x - c.x, dz = z - c.z, al = dx * c.hx + dz * c.hz, ac = Math.abs(dx * -c.hz + dz * c.hx); if (Math.abs(al) <= c.along + 0.4 && ac <= c.half + c.sw) return true; } return false; };
  return G;
}

/** Loads the generated graph (browser). A failed load is not cached, so a retry can succeed. */
let cache;
export const loadRoadGraph = () => (cache ??= fetch(dataUrl("oau-roadgraph.json")).then((r) => { if (!r.ok) throw new Error("road graph " + r.status); return r.json(); }).then(buildRoadGraph).catch((e) => { cache = undefined; throw e; }));