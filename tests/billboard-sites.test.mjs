// tests/billboard-sites.test.mjs
// Where the billboards stand (lib3d/mapExtras.js BILLBOARD_SITES, found by tools/oau/place-billboards.mjs) against the real road graph, buildings and street furniture:
//   1. every board obeys every rule in lib3d/billboardSite.js (beside a road, never on it, clear of junctions / bridge ends / the expressway / buildings / lakes / car parks / street lights, turned toward the traffic, seen from the lane)
//   2. checked again the slow way, independently of those rules: a 1 m sweep of the road surface round each board, polygon distances to every building, and a drive and a walk past each one
//   3. the boards are spread out and evenly over the road network, and sit on the roads people drive
//   4. only the two footings of each board are solid, they are small, and nothing that moves is made to detour round them
//   5. the rules are not vacuous: the six original placements that stood in the road, on the pavement, in a car park or in a field fail them
import fs from "node:fs";
import { buildServices } from "../lib3d/worldsvc.js";
import { withExtras, BILLBOARDS, BILLBOARD_SITES, EXTRA_META } from "../lib3d/mapExtras.js";
import { buildRoadFurniture } from "../lib3d/roadfurniture.js";
import { SCENE_S } from "../lib3d/roadsurface.js";
import { LV_GROUND, LV_DECK, LV_RAMP } from "../lib3d/roadgraph.js";
import { BB, BOARD_HALF, RULES, BUILDING_EX, makeContext, checkBillboard, billboardPosts, billboardRing, faceNormal, widthAxis, yawFor, lineBlocked, tooClose } from "../lib3d/billboardSite.js";

let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const raw = read("oau-roadgraph.json"), data = withExtras(read("oau-campus.json")), svc = buildServices(data, raw), G = svc.graph;
const ctx = makeContext(data, G, { furniture: buildRoadFurniture(G, SCENE_S).userData.spots });
const ALL = LV_GROUND | LV_DECK | LV_RAMP, EX = Math.PI / 180;

// ---- 1. the rules ----
chk("ten billboards, ids bb_1 to bb_10, one site each", BILLBOARDS.length === 10 && BILLBOARDS.every((b, i) => b.id === "bb_" + (i + 1) && b.n === i + 1) && BILLBOARD_SITES.length === 10);
chk("each carries its own yaw from the site list (not a formula)", BILLBOARDS.every((b, i) => b.yaw === BILLBOARD_SITES[i][3]) && new Set(BILLBOARDS.map((b) => b.yaw)).size >= 8);
chk("the merged map data carries them too, with their yaw", BILLBOARDS.every((b) => { const p = data.places.find((q) => q.id === b.id); return p && p.kind === "billboard" && p.x === b.x && p.z === b.z && p.yaw === b.yaw; }));
const res = new Map(); for (const b of BILLBOARDS) { const r = checkBillboard(b, ctx, { all: true }); res.set(b.id, r); chk(`${b.id} ${b.where}: obeys every placement rule` + (r.ok ? ` (${r.m.cls} road, footing ${r.m.gap.toFixed(1)} m off the pavement, ${Math.round(r.m.junction)} m from a junction, turned ${r.m.tilt.toFixed(0)} deg, seen for ${r.m.view?.near.m} / ${r.m.view?.far.m} m)` : ": " + r.fails.join("; ")), r.ok); }
chk("no two boards are closer than " + RULES.spacing + " m", tooClose(BILLBOARDS).length === 0);

// ---- 2. the slow way ----
const ringOf = (b) => billboardRing(b), posts = (b) => billboardPosts(b);
const toRectD = (b, px, pz) => { const [ax, az] = widthAxis(b.yaw), [nx, nz] = faceNormal(b.yaw), dx = px - b.x, dz = pz - b.z, u = Math.abs(dx * ax + dz * az) - BOARD_HALF[0], w = Math.abs(dx * nx + dz * nz) - BOARD_HALF[1]; return Math.hypot(Math.max(u, 0), Math.max(w, 0)); };
const surf = {};
{ let worst = null; for (const b of BILLBOARDS) { let minPost = Infinity, minRect = Infinity, onRoad = 0; const P = posts(b);
    for (let dx = -80; dx <= 80; dx += 1) for (let dz = -80; dz <= 80; dz += 1) { const x = b.x + dx, z = b.z + dz; if (G.surfaceAt(x, z, surf, ALL).cls === 0) continue;
      minRect = Math.min(minRect, toRectD(b, x, z)); for (const q of P) minPost = Math.min(minPost, Math.hypot(x - q.x, z - q.z) - q.r); if (toRectD(b, x, z) === 0 || P.some((q) => Math.hypot(x - q.x, z - q.z) < q.r)) onRoad++; }
    if (!worst || minPost < worst.minPost) worst = { id: b.id, minPost, minRect }; if (onRoad) chk(b.id + " stands on road surface at " + onRoad + " points", false); }
  chk(`sweeping the road surface round every board: nothing paved within ${RULES.postGap[0]} m of a footing (closest ${worst.minPost.toFixed(1)} m, ${worst.id}) or ${RULES.boardGap} m of a screen`, BILLBOARDS.every((b) => { let mp = Infinity, mr = Infinity; for (let dx = -40; dx <= 40; dx += 1) for (let dz = -40; dz <= 40; dz += 1) { const x = b.x + dx, z = b.z + dz; if (G.surfaceAt(x, z, surf, ALL).cls === 0) continue; mr = Math.min(mr, toRectD(b, x, z)); for (const q of posts(b)) mp = Math.min(mp, Math.hypot(x - q.x, z - q.z) - q.r); } return mp >= RULES.postGap[0] - 0.5 && mr >= RULES.boardGap - 0.5; })); }
const polyEdgeD = (pts, px, pz) => { let d = Infinity; for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length], dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)); d = Math.min(d, Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t)); } return d; };
const inPoly = (pts, x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > z) !== (pts[j][1] > z) && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c; return c; };
chk("no board's footprint touches, or comes within " + RULES.buildingGap[1] + " m of, any building, lake or car park (polygon distances to every one)", BILLBOARDS.every((b) => { const pts = [...ringOf(b), ...posts(b).map((q) => [q.x, q.z])]; for (const poly of [...data.buildings.map((q) => q.pts), ...data.areas.water.map((q) => q.pts), ...data.areas.parking.map((q) => q.pts)]) for (const [x, z] of pts) { if (inPoly(poly, x, z) || polyEdgeD(poly, x, z) < RULES.buildingGap[1] - 0.5) return false; } return true; }));
chk("no board stands in the wood, a pitch, a park or a sports ground", BILLBOARDS.every((b) => ["wood", "pitch", "park", "sports"].every((k) => data.areas[k].every((a) => !inPoly(a.pts, b.x, b.z) && polyEdgeD(a.pts, b.x, b.z) > RULES.areaGap))));
chk("no board shares a spot with a place's marker, a street light, a tree or a stop sign", BILLBOARDS.every((b) => ctx.places.every((p) => Math.hypot(p.x - b.x, p.z - b.z) >= RULES.placeGap) && ctx.furniture.every(([x, z]) => toRectD(b, x, z) >= RULES.furnitureGap - 0.01 && posts(b).every((q) => Math.hypot(q.x - x, q.z - z) - q.r >= RULES.furnitureGap - 0.01))));
// a drive past: every lane sample within 120 m of a board keeps well clear of the footings, so a car in its lane never meets one
{ let min = Infinity, lanes = 0; for (const b of BILLBOARDS) for (const L of G.lanes) { if (L.hw) continue; for (let s = 0; s <= L.len; s += 1) { const p = L.path.at(s, {}); if (Math.abs(p.x - b.x) > 120 || Math.abs(p.z - b.z) > 120) continue; lanes++; for (const q of posts(b)) min = Math.min(min, Math.hypot(p.x - q.x, p.z - q.z) - q.r); } }
  chk(`a car driving the centre of any lane passes at least ${RULES.postGap[0] + 2} m from every footing (closest ${min.toFixed(1)} m over ${lanes} lane samples)`, lanes > 100 && min >= RULES.postGap[0] + 2); }
// a walk past and through: the planner finds a route over the pavement beside each board, and one straight across the verge behind it, and neither touches a footing
{ let fine = 0, tried = 0; for (const b of BILLBOARDS) { const [ax, az] = widthAxis(b.yaw), [nx, nz] = faceNormal(b.yaw), P = posts(b);
    for (const [from, to] of [[[b.x - ax * 18, b.z - az * 18], [b.x + ax * 18, b.z + az * 18]], [[b.x + nx * 16, b.z + nz * 16], [b.x - nx * 16, b.z - nz * 16]]]) { const r = svc.nav.plan(from[0], from[1], to[0], to[1]); if (!r.ok || r.pts.length < 2) continue; tried++;
      let min = Infinity; for (let i = 1; i < r.pts.length; i++) for (const q of P) { const a = r.pts[i - 1], c = r.pts[i], dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((q.x - a[0]) * dx + (q.z - a[1]) * dz) / l2)); min = Math.min(min, Math.hypot(q.x - a[0] - dx * t, q.z - a[1] - dz * t) - q.r); } if (min > 0.25) fine++; } }
  chk(`people can walk across the verge in front of and behind every board (${fine} of ${tried} planned routes clear the footings)`, tried >= 14 && fine === tried); }

// ---- 3. spread and use ----
{ const b = data.bounds, demand = []; for (const e of G.edges) { if (e.hw || e.foot || e.kind === "ramp") continue; for (let s = 0; s <= e.len; s += 40) { const p = e.path.at(s, {}); if (p.x > b.x0 + 120 && p.x < b.x1 - 120 && p.z > b.z0 + 120 && p.z < b.z1 - 120) demand.push(p); } }
  const avg = demand.reduce((t, p) => t + Math.min(700, ...BILLBOARDS.map((q) => Math.hypot(q.x - p.x, q.z - p.z))), 0) / demand.length;
  chk(`every part of the road network has a board near: on average ${avg.toFixed(0)} m from a road to its nearest board (the original placement gave 320 m)`, avg <= 290);
  const xs = BILLBOARDS.map((q) => q.x), zs = BILLBOARDS.map((q) => q.z); chk(`the boards cover the campus, not one corner of it (${Math.round(Math.max(...xs) - Math.min(...xs))} m east to west, ${Math.round(Math.max(...zs) - Math.min(...zs))} m north to south)`, Math.max(...xs) - Math.min(...xs) >= 1800 && Math.max(...zs) - Math.min(...zs) >= 900);
  chk("no quarter of the road network is left without a board within 600 m", [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([sx, sz]) => { const mine = demand.filter((p) => (p.x - 100) * sx > 0 && (p.z - 150) * sz > 0); if (mine.length < 5) return true; return mine.filter((p) => BILLBOARDS.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 600)).length / mine.length > 0.6; })); }
chk("most boards stand on roads that carry traffic (arterial or collector)", [...res.values()].filter((r) => r.m.cls === "arterial" || r.m.cls === "collector").length >= 6);
chk("every board is beside a road, not in a field: its footings are between " + RULES.postGap[0] + " and " + RULES.postGap[1] + " m from the paved edge", [...res.values()].every((r) => r.m.gap >= RULES.postGap[0] - 1e-6 && r.m.gap <= RULES.postGap[1]));
chk("every board is turned " + RULES.tilt[0] + " to " + RULES.tilt[1] + " degrees from its road, with its front face looking at it", [...res.values()].every((r) => r.m.tilt >= RULES.tilt[0] && r.m.tilt <= RULES.tilt[1] && r.m.face >= RULES.faceDot));
chk("lamps and a sign are not hidden: the board is seen from the lane beside it for 56 m or more, and from the other lane for 32 m or more", [...res.values()].every((r) => r.m.view.near.m >= 56 && r.m.view.far.m >= 32));
chk("the nearest junction is at least " + RULES.junctionClear + " m off, the nearest bridge ramp " + RULES.bridgeClear + " m, the deck " + RULES.deckClear + " m", [...res.values()].every((r) => r.m.junction >= RULES.junctionClear && r.m.bridge >= RULES.bridgeClear && r.m.deck >= RULES.deckClear));

// ---- 4. collision and the model ----
const bbPolys = svc.world.polys.filter((p) => p.tag?.kind === "billboard");
chk("each board has exactly two solid footings (20 in all), each tagged with its board", bbPolys.length === 20 && BILLBOARDS.every((b) => bbPolys.filter((p) => p.tag.id === b.id).length === 2));
chk("a footing is a small solid: under 3 m across, about the size of the concrete (not the screen)", bbPolys.every((p) => p.bb[2] - p.bb[0] < 2 * BB.R_POST + 0.1 && p.bb[3] - p.bb[1] < 2 * BB.R_POST + 0.1) && BB.R_POST >= (BB.FOOT * Math.SQRT2) / 2 - 1e-9 && BB.R_POST <= BB.FOOT);
chk("the space between the footings and under the screen is open (nothing solid is made of the screen, the catwalk or the lamps)", BILLBOARDS.every((b) => { const [ax, az] = widthAxis(b.yaw); return !svc.world.blockedAt(b.x, b.z, 0.4) && !svc.world.blockedAt(b.x + ax * (BB.W / 2 - 0.5), b.z + az * (BB.W / 2 - 0.5), 0.4) && posts(b).every((q) => svc.world.blockedAt(q.x, q.z, 0.1)); }));
{ const solidW = 4 * BB.R_POST, boardW = BB.W + 2 * BB.FRAME, gap = 2 * (BB.POST_AT - BB.R_POST); chk(`at ground level only ${solidW.toFixed(1)} m of a ${boardW.toFixed(1)} m wide board is solid (two footings, ${(100 * solidW / boardW).toFixed(0)} percent), with a ${gap.toFixed(1)} m opening between them`, solidW / boardW < 0.3 && gap > 5); }
chk("the screen is clear of the ground (a board stands on its posts, never floats): the posts reach from the footing into the frame", BB.POST_H > BB.FOOT_H + 1 && BB.POST_H >= 6 && BB.POST_H <= 12 && BB.W <= 20 && BB.W / BB.H > 1.7 && BB.W / BB.H < 2);
chk("buildings are drawn as tall as the sight-line rules assume", await import("../lib3d/campusReal.js").then((m) => m.EX === BUILDING_EX));
chk("the old city-sized boards are gone: 14 m wide, 15.6 m tall at most", BB.W === 14 && BB.POST_H + BB.H <= 16);
chk("each board still has its map blurb", BILLBOARDS.every((b) => EXTRA_META[b.id]?.blurb.includes(b.where)));

// ---- yaw and sight-line helpers ----
{ const ok = []; for (const [hx, hz] of [[1, 0], [0, 1], [-0.6, 0.8], [0.6, -0.8]]) for (const side of [1, -1]) for (const lean of [1, -1]) { const y = yawFor(hx, hz, side, 40, lean), [nx, nz] = faceNormal(y), px = side * hz, pz = -side * hx;   // from the board toward the road
    const toRoad = nx * px + nz * pz, along = (nx * hx + nz * hz) * side * lean;   // along: how far the face leans toward the heading of the traffic that has the board on its right (negative = looks back up the lane)
    ok.push(Math.abs(toRoad - Math.cos(40 * EX)) < 1e-9 && Math.abs(along + Math.sin(40 * EX)) < 1e-9); }
  chk("yawFor turns the face 40 degrees from straight at the road, and leans it back up the near lane (or the other way), on either side of any road", ok.every(Boolean)); }
{ const b = data.buildings.find((q) => q.h >= 8 && q.area < 1500); const xs = b.pts.map((p) => p[0]), zs = b.pts.map((p) => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, R = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 10;
  chk("a sight line low through a building is blocked, and one that clears its drawn height is not", lineBlocked(ctx, cx - R, cz, 2.5, cx + R, cz, 10) && !lineBlocked(ctx, cx - R, cz, 2.5, cx + R, cz, b.h * BUILDING_EX * 4 + 50)); }

// ---- 5. the rules are not vacuous ----
const OLD = [["Senate Plaza", 292, 40, 0.35], ["Library Road", 60, -40, 0.7], ["Law Corner", 90, -312, 1.05], ["Student Union Strip", -180.4, 156, 0.35], ["Moremi Junction", -394, -29.6, 0.7], ["Alumni Road", -560, -260, 1.05], ["Halls Row", -780, 120, 0.35], ["Fajuyi Crossing", -400, 330, 0.7], ["Ede Road Banks", 20, 560, 1.05], ["Nightlife Strip", -183.8, 823.2, 0.35]].map(([where, x, z, yaw]) => ({ where, x, z, yaw }));
const oldRes = OLD.map((s) => ({ s, r: checkBillboard(s, ctx, { all: true }) }));
for (const [name, why] of [["Law Corner", "in the carriageway"], ["Halls Row", "on the pavement"], ["Ede Road Banks", "in the carriageway"], ["Alumni Road", "in a car park"], ["Moremi Junction", "in a field far from any road"], ["Fajuyi Crossing", "in a field far from any road"]]) { const o = oldRes.find((q) => q.s.where === name); chk(`the original "${name}" (${why}) is refused: ${o.r.fails[0]}`, !o.r.ok); }
chk(`of the ten original placements ${oldRes.filter((q) => !q.r.ok).length} fail the rules`, oldRes.filter((q) => !q.r.ok).length >= 8);
process.exit(bad ? 1 : 0);
