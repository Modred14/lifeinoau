// lib3d/roadrefine.js
// Turns the road generator's raw centrelines (tools/oau/roadgraph.py: a pixel skeleton of the map's road polygons) into a road network that is pleasant to drive.
// Pure JS (no three.js, no DOM): the offline script tools/oau/refine-roads.mjs runs it and bakes the result into public/data/oau-roadgraph.json, the tests run it too.
//
// Why it is needed. The generator thins every road polygon to a one-pixel line and traces it, so every edge carries the wobble of the pixel grid (a 600 m road that is dead straight
// on the map turns through 500 degrees in little zig-zags), it leaves whiskers (a dead-end spur wherever a polygon had a bump), little loops where it circled a wide junction, doubled
// roads and road fragments that join nothing. And it knows nothing of what a road is FOR: every road is just "as wide as its polygon", capped at 14 m, with one centre dash.
// This module, in order:
//   1. straightens  every edge: Douglas-Peucker removes the wobble, then each remaining corner gets a gentle arc (a bigger radius on a bigger road). Junctions never move.
//   2. prunes       whiskers, spurs that lead nowhere, loops, duplicates and disconnected fragments, but only when every building, parking area and landmark keeps its access
//                   (no destination may end up more than a few metres further from a drivable road than it was).
//   3. classifies   every road: arterial (the campus' express roads), collector or local, which roadgraph.js turns into lanes, median and shoulders of the right size.
//   4. renumbers    nodes and edges 0..n-1 and recomputes the connected components (0 = the main network).
// Metres, x east, z south, like the rest of lib3d.

export const REFINE = {
  /** Douglas-Peucker tolerances tried in turn (metres); the first that keeps the road inside `maxDev` of the original and no closer to a wall is used. */
  eps: [3.2, 2.2, 1.4],
  /** Arc radius at a corner by class (metres). An arterial bends gently; a campus lane may turn tighter. */
  radius: { arterial: 160, collector: 70, local: 32 },
  /** The straightened road may stray this far (m) from the road the map shows. */
  maxDev: 4.6,
  /** Roads shorter than this (m) keep their shape: they are all junction. */
  minStraighten: 36,
  /** A polygon wider than this (m) is an express road. */
  arterialWidth: 15.5,
  /** Dead-end spurs shorter than this (m) are whiskers; longer ones go only if they lead nowhere. */
  whisker: 70,
  /** A place or parking area may end up at most this much further from a road than before... */
  accessSlack: 12,
  /** ...and one already this close (m) to a road is never a problem. */
  accessClose: 30,
  /** Ordinary buildings (not a named place) are on foot from the road anyway: they get more room. */
  buildingSlack: 45, buildingClose: 70,
};

const TAU = Math.PI * 2;
const hyp = Math.hypot;

// ---------------------------------------------------------------- geometry
const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; return hyp(px - ax - dx * t, pz - az - dz * t); };
const polyD = (px, pz, P) => { let d = Infinity; for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segD(px, pz, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1])); return d; };
const plen = (P) => { let t = 0; for (let i = 1; i < P.length; i++) t += hyp(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return t; };
/** Total absolute turning along a polyline (radians). */
export function totalTurn(P) {
  let t = 0;
  for (let i = 1; i < P.length - 1; i++) { const a1 = Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]), a2 = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]); t += Math.abs(((a2 - a1 + Math.PI * 3) % TAU) - Math.PI); }
  return t;
}
/** Samples a polyline every `step` metres (the end point is always included). */
export function resample(P, step) {
  const L = plen(P), n = Math.max(1, Math.ceil(L / step)), out = [P[0]]; let seg = 0, run = 0;
  for (let i = 1; i < n; i++) {
    const want = (L * i) / n; while (seg < P.length - 2 && run + hyp(P[seg + 1][0] - P[seg][0], P[seg + 1][1] - P[seg][1]) < want) { run += hyp(P[seg + 1][0] - P[seg][0], P[seg + 1][1] - P[seg][1]); seg++; }
    const l = hyp(P[seg + 1][0] - P[seg][0], P[seg + 1][1] - P[seg][1]) || 1, t = (want - run) / l; out.push([P[seg][0] + (P[seg + 1][0] - P[seg][0]) * t, P[seg][1] + (P[seg + 1][1] - P[seg][1]) * t]);
  }
  out.push(P[P.length - 1]); return out;
}

/** Douglas-Peucker without recursion. Returns the kept points. */
export function rdp(P, eps) {
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1; const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) { const d = segD(P[i][0], P[i][1], P[a][0], P[a][1], P[b][0], P[b][1]); if (d > worst) { worst = d; wi = i; } }
    if (worst > eps) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return P.filter((_, i) => keep[i]);
}

/**
 * Rounds every corner of a polyline with a circular arc of radius R (smaller where the neighbouring segments are too short to hold it). A corner that is almost straight is dropped.
 * The first and last points never move. Returns a polyline with a point about every 2 m on the arcs.
 */
export function fillet(V, R) {
  if (V.length < 3) return V.slice();
  const out = [V[0]];
  for (let i = 1; i < V.length - 1; i++) {
    const p = V[i], a = V[i - 1], b = V[i + 1], ux = p[0] - a[0], uz = p[1] - a[1], vx = b[0] - p[0], vz = b[1] - p[1], lu = hyp(ux, uz), lv = hyp(vx, vz);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const th = Math.abs(((Math.atan2(vz, vx) - Math.atan2(uz, ux) + Math.PI * 3) % TAU) - Math.PI);   // deflection angle
    if (th < 0.02) continue;
    // the arc touches each segment T from the corner; T may use at most 48% of a segment (the other half belongs to the next corner), and the first and last segment all of it
    const room = (len, isEnd) => (isEnd ? len * 0.92 : len * 0.48), tmax = Math.min(room(lu, i === 1), room(lv, i === V.length - 2)), T = Math.min(R * Math.tan(th / 2), tmax), r = T / Math.tan(th / 2);
    const sx = p[0] - (ux / lu) * T, sz = p[1] - (uz / lu) * T, ex = p[0] + (vx / lv) * T, ez = p[1] + (vz / lv) * T, turn = Math.sign(ux * vz - uz * vx) || 1;
    // arc centre: r from the entry point, on the side the road turns towards
    const cx = sx + -(uz / lu) * turn * r, cz = sz + (ux / lu) * turn * r, a0 = Math.atan2(sz - cz, sx - cx), n = Math.max(2, Math.ceil((r * th) / 2));
    out.push([sx, sz]); for (let k = 1; k < n; k++) { const ang = a0 + turn * th * (k / n); out.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]); } out.push([ex, ez]);
  }
  out.push(V[V.length - 1]); return out;
}

/** Straightens one polyline. Returns the new points, or null when no setting keeps it close enough to the road the map shows and clear of walls. */
export function straighten(pts, cls, { sdf = null, eps = REFINE.eps, maxDev = REFINE.maxDev } = {}) {
  const dense = resample(pts, 2), clr = (P) => { if (!sdf) return Infinity; let lo = Infinity; const q = resample(P, 4), edge = Math.min(10, plen(P) * 0.2); let s = 0; for (let i = 0; i < q.length; i++) { if (i) s += hyp(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); if (s < edge || s > plen(P) - edge) continue; lo = Math.min(lo, sdf(q[i][0], q[i][1])); } return lo; };
  const before = clr(dense);
  for (const e of eps) {
    const cand = fillet(rdp(dense, e), REFINE.radius[cls] ?? REFINE.radius.local); let dev = 0;
    for (const q of resample(cand, 3)) dev = Math.max(dev, polyD(q[0], q[1], dense)); for (const q of resample(dense, 3)) dev = Math.max(dev, polyD(q[0], q[1], cand));
    if (dev > maxDev) continue;
    if (sdf && clr(cand) < Math.min(before, 4.2) - 0.35) continue;      // it would come closer to a wall than the original (or than a car needs)
    return cand;
  }
  return null;
}

// ---------------------------------------------------------------- graph helpers
function components(nodes, edges) {
  const par = nodes.map((_, i) => i), find = (a) => (par[a] === a ? a : (par[a] = find(par[a])));
  for (const e of edges) par[find(e.a)] = find(e.b);
  const len = new Map(); for (const e of edges) len.set(find(e.a), (len.get(find(e.a)) ?? 0) + plen(e.pts));
  const order = [...len.entries()].sort((p, q) => q[1] - p[1]).map((x) => x[0]), idx = new Map(order.map((r, i) => [r, i]));
  return { of: (n) => idx.get(find(n)) ?? -1, count: order.length };
}
const degrees = (nodes, edges) => { const d = nodes.map(() => 0); for (const e of edges) { d[e.a]++; d[e.b]++; } return d; };

/** Destinations whose access must be kept: every place on the map, every building and the middle of every parking area. */
export function destinations(data) {
  const out = []; for (const p of data.places ?? []) if (Number.isFinite(p.x) && Number.isFinite(p.z)) out.push({ x: p.x, z: p.z, what: p.id ?? p.name });
  const mid = (pts, what) => { let x = 0, z = 0; for (const q of pts) { x += q[0]; z += q[1]; } out.push({ x: x / pts.length, z: z / pts.length, what }); };
  for (const a of data.areas?.parking ?? []) mid(a.pts, "parking");
  for (const b of data.buildings ?? []) mid(b.pts, "building");
  return out;
}

/**
 * The generator cuts a road in two wherever two road polygons barely touch, so whole stretches of road end a few metres short of the network (the north-west hostels, 1.2 km of road, are
 * 11 m from it). This joins every such fragment: a short, clear link from the nearest fragment node to the nearest point of the main network (splitting that road there).
 * Returns the links made. A fragment with no clear link within `reach` metres is left alone (the pruner decides about it).
 */
function joinFragments(nodes, edges, { sdf = null, reach = 70, log = () => {} } = {}) {
  const joined = []; let nextId = Math.max(...edges.map((e) => e.id)) + 1;
  for (let guard = 0; guard < 20; guard++) {
    const live = edges.filter((e) => !e.__off), comp = components(nodes, live), main = live.filter((e) => comp.of(e.a) === 0); let best = null;
    const frag = new Map(); for (const e of live) { const k = comp.of(e.a); if (k !== 0) { if (!frag.has(k)) frag.set(k, new Set()); frag.get(k).add(e.a); frag.get(k).add(e.b); } }
    for (const [k, ids] of frag) for (const id of ids) for (const m of main) for (let i = 0; i < m.pts.length - 1; i++) {
      const A = m.pts[i], B = m.pts[i + 1], dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz || 1; let t = ((nodes[id].x - A[0]) * dx + (nodes[id].z - A[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = A[0] + dx * t, pz = A[1] + dz * t, d = hyp(nodes[id].x - px, nodes[id].z - pz);
      if (d < reach && (!best || d < best.d)) { // the link must be clear of walls (its two ends are junctions, so they are allowed to be close to buildings)
        let ok = true; if (sdf) { const n = Math.max(2, Math.ceil(d / 2)); for (let q = 1; q < n; q++) { const x = nodes[id].x + ((px - nodes[id].x) * q) / n, z = nodes[id].z + ((pz - nodes[id].z) * q) / n; if (sdf(x, z) < 2.6) { ok = false; break; } } }
        if (ok) best = { d, id, m, i, t, px, pz, k };
      }
    }
    if (!best) break;
    // the main road is split at the foot of the link (or the link goes to the road's own end when that is within 5 m)
    const { m, i, t, px, pz, id } = best; let target;
    const ea = nodes[m.a], eb = nodes[m.b];
    if (hyp(px - ea.x, pz - ea.z) < 5) target = m.a; else if (hyp(px - eb.x, pz - eb.z) < 5) target = m.b;
    else { target = nodes.length; nodes.push({ id: target, x: px, z: pz, rim: false, comp: 0 }); const tail = { ...m, id: nextId++, a: target, pts: [[px, pz], ...m.pts.slice(i + 1)] }; m.pts = [...m.pts.slice(0, i + 1), [px, pz]]; m.b = target; edges.push(tail); }
    if (target !== id) edges.push({ id: nextId++, a: id, b: target, pts: [[nodes[id].x, nodes[id].z], [nodes[target].x, nodes[target].z]], w: 10, clr: 10, comp: 0, cls: "local", link: true });
    joined.push({ from: id, to: target, gap: Math.round(best.d) });
  }
  return joined;
}

/**
 * Refines the generator's graph. `raw` = { nodes: [{id,x,z,rim,comp}], edges: [{id,a,b,pts,w,clr,comp}] }; `data` = the merged map; `sdf(x, z)` = distance to the nearest wall (optional).
 * Returns { raw: the refined graph (same shape plus cls/med fields), report }.
 */
export function refineRoadNetwork(raw, data, { sdf = null, log = () => {} } = {}) {
  const nodes = raw.nodes.map((n) => ({ ...n })), report = { before: { nodes: raw.nodes.length, edges: raw.edges.length }, straightened: 0, kept: 0, removed: [], classes: {} };
  let edges = raw.edges.map((e) => ({ ...e, pts: e.pts.map((p) => [p[0], p[1]]) }));
  const dests = destinations(data);

  // ---- 1. class of every road (before anything changes, from the polygon width the generator measured) ----
  for (const e of edges) { e.cls = e.w >= REFINE.arterialWidth ? "arterial" : e.w >= 9.8 ? "collector" : "local"; }
  // the north-east ring road is made of express-width pieces joined by one ordinary-width one; it is one road
  const EXTRA_ARTERIAL = [10];
  for (const e of edges) if (EXTRA_ARTERIAL.includes(e.id)) e.cls = "arterial";

  // ---- 2. straighten ----
  for (const e of edges) {
    if (plen(e.pts) < REFINE.minStraighten) { report.kept++; continue; }
    const s = straighten(e.pts, e.cls, { sdf }); if (s) { e.pts = s; report.straightened++; } else report.kept++;
  }

  // ---- 2b. join the fragments that stop a few metres short of the network ----
  report.joined = joinFragments(nodes, edges, { sdf });

  // ---- 3. prune ----
  const access = (eList) => dests.map((d) => { let best = Infinity; for (const e of eList) { if (e.__off) continue; for (let i = 0; i < e.pts.length - 1; i++) best = Math.min(best, segD(d.x, d.z, e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1])); } return best; });
  const mainOnly = () => { const c = components(nodes, edges.filter((e) => !e.__off)); return edges.filter((e) => !e.__off && c.of(e.a) === 0); };
  const slackOf = (d) => (d.what === "building" ? [REFINE.buildingSlack, REFINE.buildingClose] : [REFINE.accessSlack, REFINE.accessClose]);
  const worse = (after, base) => { for (let i = 0; i < dests.length; i++) { const [sl, cl] = slackOf(dests[i]); if (after[i] > Math.max(base[i] + sl, cl)) return true; } return false; };
  const accessOK = (e, base) => { e.__off = true; const after = access(mainOnly()); e.__off = false; return !worse(after, base); };
  const drop = (e, why) => { e.__off = true; report.removed.push({ id: e.id, why, len: Math.round(plen(e.pts)) }); };
  let changed = true, guard = 0;
  while (changed && guard++ < 12) {
    changed = false; const live = edges.filter((e) => !e.__off), deg = degrees(nodes, live), base = access(mainOnly());
    // a loop that circles one junction is not a road (a ring road with a junction on it, a roundabout, is: it has traffic entering it)
    for (const e of live) if (e.a === e.b && deg[e.a] <= 3 && accessOK(e, base)) { drop(e, "loop"); changed = true; }
    // the same pair of junctions joined twice along (nearly) the same line: one road
    const seen = new Map();
    for (const e of live.filter((x) => !x.__off && x.a !== x.b)) {
      const k = Math.min(e.a, e.b) + "-" + Math.max(e.a, e.b), twin = seen.get(k);
      if (!twin) { seen.set(k, e); continue; }
      let dev = 0; for (const q of resample(e.pts, 6)) dev = Math.max(dev, polyD(q[0], q[1], twin.pts));
      if (dev < 22) { const longer = plen(e.pts) > plen(twin.pts) ? e : twin; if (accessOK(longer, base)) { drop(longer, "duplicate"); changed = true; } }
    }
    // dead ends: whiskers always, longer spurs when nothing is lost by dropping them (a dead end at the rim of the map is a road leaving the map, not a spur)
    for (const e of live) {
      if (e.__off || e.a === e.b) continue; const d2 = degrees(nodes, edges.filter((x) => !x.__off)), na = nodes[e.a], nb = nodes[e.b];
      const dead = (d2[e.a] === 1 && !na.rim) || (d2[e.b] === 1 && !nb.rim); if (!dead) continue;
      const bothDead = d2[e.a] === 1 && d2[e.b] === 1; if (bothDead) continue;    // a lone road: the fragment pass decides
      const b2 = access(mainOnly()); if (accessOK(e, b2)) { drop(e, plen(e.pts) <= REFINE.whisker ? "whisker" : "spur"); changed = true; }
    }
  }
  // fragments: pieces of road that join the main network nowhere (they cannot be driven to or from)
  { const live = edges.filter((e) => !e.__off), c = components(nodes, live), base = access(live.filter((e) => c.of(e.a) === 0));
    const byComp = new Map(); for (const e of live) { const k = c.of(e.a); if (k === 0) continue; if (!byComp.has(k)) byComp.set(k, []); byComp.get(k).push(e); }
    for (const [, list] of byComp) { for (const e of list) e.__off = true; const after = access(mainOnly()), ok = !worse(after, base);
      if (ok) for (const e of list) report.removed.push({ id: e.id, why: "fragment", len: Math.round(plen(e.pts)) }); else for (const e of list) e.__off = false; } }

  // ---- 4. renumber ----
  edges = edges.filter((e) => !e.__off); const deg = degrees(nodes, edges), used = nodes.filter((n, i) => deg[i] > 0), remap = new Map(used.map((n, i) => [n.id, i]));
  const outNodes = used.map((n, i) => ({ id: i, x: n.x, z: n.z, rim: !!n.rim, comp: 0 })), outEdges = edges.map((e, i) => ({ id: i, a: remap.get(e.a), b: remap.get(e.b), pts: e.pts.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]), w: e.w, clr: e.clr, comp: 0, cls: e.cls }));
  // keep each end of an edge exactly on its node
  for (const e of outEdges) { e.pts[0] = [outNodes[e.a].x, outNodes[e.a].z]; e.pts[e.pts.length - 1] = [outNodes[e.b].x, outNodes[e.b].z]; }
  const comp = components(outNodes, outEdges); for (const n of outNodes) n.comp = comp.of(n.id); for (const e of outEdges) e.comp = comp.of(e.a);
  for (const e of outEdges) report.classes[e.cls] = (report.classes[e.cls] ?? 0) + 1;
  report.after = { nodes: outNodes.length, edges: outEdges.length, components: comp.count };
  return { raw: { ...raw, nodes: outNodes, edges: outEdges, refined: true }, report };
}
