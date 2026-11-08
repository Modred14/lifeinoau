// lib3d/billboardSite.js
// What a roadside billboard is made of, where it may stand, and how to check that it does. Pure JS (no three.js, no DOM): runs in the browser, in the tests and in
// tools/oau/place-billboards.mjs, so the model that is drawn (billboards3d.js), the footings that are solid (worldsvc.js) and the rules the sites are chosen by can never drift apart.
// Metres, x east, z south, like the rest of lib3d. A board's yaw is the three.js rotation.y of its group: its front face looks along (sin yaw, cos yaw), its width runs along (cos yaw, -sin yaw).
import { LV_GROUND, LV_DECK, LV_RAMP } from "./roadgraph.js";
import { buildWorldCollision } from "./collide.js";

/** The structure, in metres. A double-faced board on two steel posts, each on a concrete footing, with a catwalk under the screen. Only the footings touch the ground. */
export const BB = {
  W: 14, H: 7.6,          // screen (the picture keeps the old 3.6 : 1.95 shape, so uploaded posters still fit)
  POST_H: 8,              // ground to the bottom of the screen
  FRAME: 0.25, THICK: 0.5,// the frame round the screen, and how thick the board is
  POST_AT: 4.2, POST: 0.7,// the posts stand this far each side of the middle, and are this thick
  FOOT: 1.3, FOOT_H: 0.5, // the concrete footing under each post
  R_POST: 0.95,           // solid circle round a footing (a footing is 1.3 m square: its corner is 0.92 m from the middle)
  LIGHT: 1.1,             // the lamp arms stand this far out of each face
};
/** Half the screen's footprint seen from above, lamp arms included: across the board and out of its faces. */
export const BOARD_HALF = [BB.W / 2 + BB.FRAME, BB.THICK / 2 + BB.LIGHT];
/** Buildings are drawn this many times taller than they are (lib3d/campusReal.js EX); a sight line has to clear what is drawn. */
export const BUILDING_EX = 2;
/** Eye height of someone driving (camera included), and the heights on the screen a sight line must reach. */
export const EYE = 2.5;
export const TARGETS = [[0, BB.POST_H + BB.H * 0.5], [-BB.W / 3, BB.POST_H + BB.H * 0.35], [BB.W / 3, BB.POST_H + BB.H * 0.35]];

/** The rules a site must meet. Metres unless it says degrees. */
export const RULES = {
  postGap: [7, 16],        // footing to the nearest paved edge (carriageway or pavement): never closer than the first, never farther than the second
  boardGap: 4.5,           // the screen overhangs, so its nearest corner keeps this far from the paved edge too
  junctionClear: 45,       // from a junction's mouth (its radius) to the middle of the board
  bridgeClear: 90,         // from the nodes where a ramp or the deck begins or ends
  deadEndClear: 40,        // from the end of a road
  deckClear: 24,           // from the edge of the expressway deck and each of its ramps
  pierClear: 14,           // from a column of the expressway
  buildingGap: [7, 5],     // footing, screen: clear of every building and lake
  areaGap: 6,              // from the middle of the board to a car park, pitch, sports ground, park or lake (plus the board's own reach)
  woodGap: 30,             // the map's wood has trees up to 30 m tall: keep well away
  placeGap: 20,            // from the marker of any place on the map
  groundGap: 25,           // from the Motion Ground and the Religious Ground
  furnitureGap: 3,         // from any street light, tree or stop sign
  inset: 160,              // inside the edge of the map (the rim has its own belt of trees)
  rimClear: 250,           // from a road that runs off the map
  tilt: [28, 55],          // degrees between the screen and the road: far enough round that traffic coming from either way sees a face, not far enough to be edge-on
  faceDot: 0.45,           // how squarely the front face must look at the road (1 = straight at it)
  viewCos: 0.4,            // from the road a face must be seen at least this squarely (cosine of the angle off its normal)
  spacing: 280,            // between two boards
};

const D2R = Math.PI / 180;
export const faceNormal = (yaw) => [Math.sin(yaw), Math.cos(yaw)];
export const widthAxis = (yaw) => [Math.cos(yaw), -Math.sin(yaw)];
/** A point on the board in its own frame (u across the width, w out of the front face) as a world position. */
export const toWorld = (s, u, w) => { const [ax, az] = widthAxis(s.yaw), [nx, nz] = faceNormal(s.yaw); return [s.x + ax * u + nx * w, s.z + az * u + nz * w]; };

/** The solid parts of a board: a circle round each footing. Nothing else of a billboard is in reach of a person or a vehicle (the screen is 8 m up). */
export function billboardPosts(s) { return [-BB.POST_AT, BB.POST_AT].map((u) => { const [x, z] = toWorld(s, u, 0); return { x, z, r: BB.R_POST }; }); }
/** The screen's footprint as a ring of four corners, lamp arms included. */
export function billboardRing(s) { const [hu, hw] = BOARD_HALF; return [[-hu, -hw], [hu, -hw], [hu, hw], [-hu, hw]].map(([u, w]) => toWorld(s, u, w)); }
/** Puts the footings into a collision world as small octagons (like the expressway's columns). Returns how many. */
export function addBillboardCollision(world, places) { let n = 0; for (const p of places) { if (p.kind !== "billboard") continue; for (const q of billboardPosts(p)) { world.addPost(q.x, q.z, q.r, { kind: "billboard", id: p.id }); n++; } } return n; }

/**
 * The yaw for a board that stands on `side` (+1 the right of the road's heading, -1 the left) of a road whose heading there is (hx, hz), turned `tiltDeg` from the road.
 * `lean` (+1 or -1) says which way the face leans along the road. Traffic keeps right, so the near lane is the one whose right-hand side the board is on: with lean +1 the face looks a little
 * back up that lane, toward the cars that are coming, and the other lane sees the far side of the screen, which shows the same picture.
 */
export function yawFor(hx, hz, side, tiltDeg = 40, lean = 1) {
  const rx = -hz, rz = hx, px = -side * rx, pz = -side * rz;   // from the board toward the road
  const dx = side * hx, dz = side * hz;                          // the heading of the traffic that has the board on its right
  const a = tiltDeg * D2R, nx = Math.cos(a) * px - lean * Math.sin(a) * dx, nz = Math.cos(a) * pz - lean * Math.sin(a) * dz;
  return Math.atan2(nx, nz);
}

// ---- small geometry helpers ----
const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
const polyD = (px, pz, pts) => { if (inPoly(px, pz, pts)) return 0; let d = Infinity; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; d = Math.min(d, segD(px, pz, a[0], a[1], b[0], b[1])); } return d; };
const lineD = (px, pz, pts) => { let d = Infinity; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segD(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; };
const bboxOf = (pts) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return [x0, z0, x1, z1]; };
const segHit = (ax, az, bx, bz, cx, cz, dx, dz) => { const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx; if (Math.abs(den) < 1e-12) return null; const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null; };
/** Distance from a point to the screen's footprint (0 inside it). */
const ringD = (s, px, pz) => { const [hu, hw] = BOARD_HALF, [ax, az] = widthAxis(s.yaw), [nx, nz] = faceNormal(s.yaw), dx = px - s.x, dz = pz - s.z, u = Math.abs(dx * ax + dz * az) - hu, w = Math.abs(dx * nx + dz * nz) - hw; return Math.hypot(Math.max(u, 0), Math.max(w, 0)); };

/**
 * Everything the rules look at, gathered once from the merged map data (withExtras) and a built road graph (buildRoadGraph). `furniture` is an optional list of [x, z] street lights, trees and signs
 * (the group made by lib3d/roadfurniture.js carries it in userData.spots). The collision world is built here from the map alone, so a board's own footings never count against it.
 */
export function makeContext(data, graph, { furniture = [] } = {}) {
  const world = buildWorldCollision(data), X = graph.expressway ?? null;
  const blds = data.buildings.map((b) => ({ pts: b.pts, bb: bboxOf(b.pts), h: (b.h ?? 8) * BUILDING_EX }));
  const areas = []; for (const k of ["water", "pitch", "sports", "park", "parking", "wood"]) for (const a of data.areas?.[k] ?? []) areas.push({ k, pts: a.pts, bb: bboxOf(a.pts) });
  const hwLines = graph.edges.filter((e) => e.mask & (LV_DECK | LV_RAMP)).map((e) => ({ pts: e.path.pts, half: e.half, bb: bboxOf(e.path.pts) }));
  const grounds = Object.values(data.grounds ?? {}).map((g) => ({ x0: g.x0, x1: g.x1, z0: g.z0, z1: g.z1 }));
  return { data, graph, world, blds, areas, hwLines, grounds, X, furniture,
    places: data.places.filter((p) => p.kind !== "billboard" && p.x != null && !p.offmap),
    rim: graph.nodes.filter((n) => n.rim), junctions: graph.nodes.filter((n) => n.deg >= 3), ends: graph.nodes.filter((n) => n.deg === 1 && !n.rim), bridge: graph.nodes.filter((n) => n.mask & (LV_DECK | LV_RAMP)),
    piers: [...(X?.piers ?? []), ...(X?.rampPiers ?? [])], b: data.bounds, surf: {}, s2: {} };
}

/** Is there any road surface (carriageway, pavement, crossing, junction, ramp) within r metres of (x, z)? Looks at the point and a ring of 16 around it. */
export function pavedWithin(ctx, x, z, r) {
  const G = ctx.graph, all = LV_GROUND | LV_DECK | LV_RAMP;
  if (G.surfaceAt(x, z, ctx.surf, all).cls !== 0) return true;
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; if (G.surfaceAt(x + Math.cos(a) * r, z + Math.sin(a) * r, ctx.surf, all).cls !== 0) return true; }
  return false;
}

/** Is the straight line from (ax, az) at height ah to (bx, bz) at height bh stopped by a building (as drawn) or by the wood? */
export function lineBlocked(ctx, ax, az, ah, bx, bz, bh) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  for (const b of ctx.blds) {
    if (b.bb[2] < x0 || b.bb[0] > x1 || b.bb[3] < z0 || b.bb[1] > z1) continue; let t = null;
    for (let i = 0; i < b.pts.length; i++) { const p = b.pts[i], q = b.pts[(i + 1) % b.pts.length], h = segHit(ax, az, bx, bz, p[0], p[1], q[0], q[1]); if (h != null && (t == null || h < t)) t = h; }
    if (t != null && b.h > ah + (bh - ah) * t) return true;
  }
  const len = Math.hypot(bx - ax, bz - az);
  for (const w of ctx.areas) { if (w.k !== "wood" || w.bb[2] < x0 || w.bb[0] > x1 || w.bb[3] < z0 || w.bb[1] > z1) continue; for (let d = 0; d <= len; d += 4) { const t = d / (len || 1), x = ax + (bx - ax) * t, z = az + (bz - az) * t; if (inPoly(x, z, w.pts) && ah + (bh - ah) * t < 14) return true; } }
  return false;
}

/**
 * How well a board can be seen from the road. For each of the two ways of travel on the nearest ground road it walks back up the lane from the board and, every 8 m between 16 m and 144 m, asks whether
 * a driver there would see the screen: the face squarely enough (viewCos) and no building or wood in the way (two of the three marks on the screen reached). Returns
 * { near, far, nearFrac, farFrac, nearM, farM } for the lane the board is beside (traffic keeps right) and the other one.
 */
export function visibility(ctx, s) {
  const G = ctx.graph, r = G.nearestOnRoad(s.x, s.z, 120, false, LV_GROUND); if (!r) return null; const e = G.byEdge.get(r.edge), [nx, nz] = faceNormal(s.yaw), [ax, az] = widthAxis(s.yaw), out = {};
  for (const dir of [0, 1]) {
    const lane = e.lanes[dir]; if (!lane) continue; const s0 = G.laneS(lane, s.x, s.z), at = {}; let seen = 0, total = 0;
    for (let d = 16; d <= 144; d += 8) {
      const q = s0 - d; if (q < 0) break; lane.path.at(q, at); total++;
      const vx = at.x - s.x, vz = at.z - s.z, vl = Math.hypot(vx, vz) || 1; if (Math.abs((vx * nx + vz * nz) / vl) < RULES.viewCos) continue;
      let ok = 0; for (const [u, h] of TARGETS) { if (!lineBlocked(ctx, at.x, at.z, EYE, s.x + ax * u, s.z + az * u, h)) ok++; } if (ok >= 2) seen++;
    }
    // the lane is the near one when the board is on the right of the lane's own heading: the right-hand side of (hx, hz) is (-hz, hx), so the board is there when (board - lane) . (-hz, hx) > 0
    const l1 = lane.path.at(Math.min(lane.len, s0 + 1), {}), l0 = lane.path.at(s0, {}), hx = l1.x - l0.x, hz = l1.z - l0.z, onRight = -hz * (s.x - l0.x) + hx * (s.z - l0.z) > 0;
    out[onRight ? "near" : "far"] = { frac: total ? seen / total : 0, m: seen * 8, total: total * 8 };
  }
  const n = out.near ?? { frac: 0, m: 0, total: 0 }, f = out.far ?? { frac: 0, m: 0, total: 0 };
  return { near: n, far: f };
}

/**
 * Checks one site against every rule. Returns { ok, fails: [string], m: metrics }. `site` is { x, z, yaw }. `opts.skipView` leaves out the sight-line test (the slow one), `opts.skipSpacing` is for a single site.
 * Cheap rules first, so a search can throw most candidates away without ever reaching the expensive ones.
 */
export function checkBillboard(site, ctx, opts = {}) {
  const fails = [], m = {}, G = ctx.graph, R = RULES, posts = billboardPosts(site), ring = billboardRing(site), fail = (s) => { fails.push(s); return fails; };
  const bad = () => !!fails.length && !opts.all;
  // --- the map: inside it, and away from the rim ---
  const b = ctx.b; if (ring.some(([x, z]) => x < b.x0 + R.inset || x > b.x1 - R.inset || z < b.z0 + R.inset || z > b.z1 - R.inset)) fail("too close to the edge of the map"); if (bad()) return { ok: false, fails, m };
  for (const n of ctx.rim) if (Math.hypot(n.x - site.x, n.z - site.z) < R.rimClear) { fail("near a road that runs off the map"); break; } if (bad()) return { ok: false, fails, m };
  // --- junctions, bridge ends, dead ends, the expressway ---
  m.junction = Infinity; for (const n of ctx.junctions) m.junction = Math.min(m.junction, Math.hypot(n.x - site.x, n.z - site.z) - n.radius); if (m.junction < R.junctionClear) fail(`junction ${m.junction.toFixed(0)} m away (needs ${R.junctionClear})`);
  m.bridge = Infinity; for (const n of ctx.bridge) m.bridge = Math.min(m.bridge, Math.hypot(n.x - site.x, n.z - site.z)); if (m.bridge < R.bridgeClear) fail(`bridge entrance or exit ${m.bridge.toFixed(0)} m away (needs ${R.bridgeClear})`);
  for (const n of ctx.ends) if (Math.hypot(n.x - site.x, n.z - site.z) < R.deadEndClear) { fail("at the end of a road"); break; } if (bad()) return { ok: false, fails, m };
  m.deck = Infinity; for (const l of ctx.hwLines) { if (site.x < l.bb[0] - 80 || site.x > l.bb[2] + 80 || site.z < l.bb[1] - 80 || site.z > l.bb[3] + 80) continue; m.deck = Math.min(m.deck, lineD(site.x, site.z, l.pts) - l.half - BOARD_HALF[0]); }
  if (m.deck < R.deckClear) fail(`${m.deck.toFixed(0)} m from the expressway (needs ${R.deckClear})`);
  for (const p of ctx.piers) if (Math.hypot(p.x - site.x, p.z - site.z) - BOARD_HALF[0] < R.pierClear) { fail("beside an expressway column"); break; } if (bad()) return { ok: false, fails, m };
  // --- buildings, lakes, car parks, pitches, the wood, other places ---
  m.building = Infinity; for (const q of posts) m.building = Math.min(m.building, ctx.world.sdf(q.x, q.z, 20) - q.r); if (m.building < R.buildingGap[0]) fail(`footing ${m.building.toFixed(1)} m from a building or lake (needs ${R.buildingGap[0]})`);
  let rb = Infinity; for (let u = -BOARD_HALF[0]; u <= BOARD_HALF[0] + 1e-6; u += BOARD_HALF[0] / 3) for (const w of [-BOARD_HALF[1], 0, BOARD_HALF[1]]) { const [x, z] = toWorld(site, u, w); rb = Math.min(rb, ctx.world.sdf(x, z, 20)); }
  m.screenBuilding = rb; if (rb < R.buildingGap[1]) fail(`screen ${rb.toFixed(1)} m from a building or lake (needs ${R.buildingGap[1]})`); if (bad()) return { ok: false, fails, m };
  const reach = Math.hypot(BOARD_HALF[0], BOARD_HALF[1]);
  for (const a of ctx.areas) { if (site.x < a.bb[0] - 80 || site.x > a.bb[2] + 80 || site.z < a.bb[1] - 80 || site.z > a.bb[3] + 80) continue; const need = a.k === "wood" ? R.woodGap : R.areaGap, d = polyD(site.x, site.z, a.pts) - reach; if (d < need) { fail(`${d.toFixed(0)} m from ${a.k === "parking" ? "a car park" : "the " + a.k} (needs ${need})`); break; } }
  for (const g of ctx.grounds) if (site.x > g.x0 - R.groundGap - reach && site.x < g.x1 + R.groundGap + reach && site.z > g.z0 - R.groundGap - reach && site.z < g.z1 + R.groundGap + reach) { fail("beside the Motion or Religious Ground"); break; }
  for (const p of ctx.places) if (Math.hypot(p.x - site.x, p.z - site.z) < R.placeGap) { fail(`on top of ${p.name ?? p.id}`); break; } if (bad()) return { ok: false, fails, m };
  // --- the road: not on it, clear of it, but not far from it ---
  const surf = G.surfaceAt(site.x, site.z, ctx.s2, LV_GROUND | LV_DECK | LV_RAMP); if (surf.cls !== 0) fail("stands on the road");
  for (const q of posts) if (pavedWithin(ctx, q.x, q.z, R.postGap[0] + q.r)) { fail(`a footing is within ${R.postGap[0]} m of the road or its pavement`); break; }
  let near = false; for (let u = -BOARD_HALF[0]; u <= BOARD_HALF[0] + 1e-6 && !near; u += BOARD_HALF[0] / 3) for (const w of [-BOARD_HALF[1], BOARD_HALF[1]]) { const [x, z] = toWorld(site, u, w); if (pavedWithin(ctx, x, z, R.boardGap)) { near = true; break; } }
  if (near) fail(`the screen reaches within ${R.boardGap} m of the road or its pavement`); if (bad()) return { ok: false, fails, m };
  const rd = G.nearestOnRoad(site.x, site.z, 160, false, LV_GROUND); if (!rd) { fail("no road within reach"); return { ok: false, fails, m }; }
  const e = G.byEdge.get(rd.edge), pe = e.path.at(rd.s, {}); m.edge = e.id; m.cls = e.cls; m.gap = Infinity; for (const q of posts) { const r2 = G.nearestOnRoad(q.x, q.z, 160, false, LV_GROUND); if (r2) m.gap = Math.min(m.gap, r2.d - (G.byEdge.get(r2.edge).half + G.byEdge.get(r2.edge).sw) - q.r); }
  if (m.gap > R.postGap[1]) fail(`footing ${m.gap.toFixed(0)} m from the road (needs at most ${R.postGap[1]})`);
  // --- orientation ---
  const [ax, az] = widthAxis(site.yaw), [nx, nz] = faceNormal(site.yaw), tl = Math.hypot(pe.hx, pe.hz) || 1; m.tilt = Math.acos(Math.min(1, Math.abs((ax * pe.hx + az * pe.hz) / tl))) / D2R;
  if (m.tilt < R.tilt[0] || m.tilt > R.tilt[1]) fail(`turned ${m.tilt.toFixed(0)} degrees from the road (needs ${R.tilt[0]} to ${R.tilt[1]})`);
  const tx = rd.x - site.x, tz = rd.z - site.z, tn = Math.hypot(tx, tz) || 1; m.face = (nx * tx + nz * tz) / tn; if (m.face < R.faceDot) fail(`front face looks ${m.face.toFixed(2)} at the road (needs ${R.faceDot})`);
  // --- street furniture ---
  for (const [fx, fz] of ctx.furniture) { if (Math.abs(fx - site.x) > 20 || Math.abs(fz - site.z) > 20) continue; if (ringD(site, fx, fz) < R.furnitureGap || posts.some((q) => Math.hypot(q.x - fx, q.z - fz) - q.r < R.furnitureGap)) { fail("a street light, tree or sign stands in it"); break; } }
  // --- can a driver see it? ---
  if (!opts.skipView && (!fails.length || opts.all)) {
    const v = visibility(ctx, site); m.view = v;
    if (!v) fail("no lane to see it from"); else {
      if (v.near.m < 56 || v.near.frac < 0.75) fail(`the lane beside it sees it for only ${v.near.m} m (${Math.round(v.near.frac * 100)} percent of the approach)`);
      if (v.far.m < 32 || v.far.frac < 0.6) fail(`the opposite lane sees it for only ${v.far.m} m (${Math.round(v.far.frac * 100)} percent of the approach)`);
    }
  }
  return { ok: !fails.length, fails, m };
}

/** Pairs of boards closer than RULES.spacing. */
export function tooClose(sites) { const out = []; for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) { const d = Math.hypot(sites[i].x - sites[j].x, sites[i].z - sites[j].z); if (d < RULES.spacing) out.push([sites[i].id ?? i, sites[j].id ?? j, d]); } return out; }
