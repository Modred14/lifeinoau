// lib3d/campuslife/describe.js
// Says how each building of the game's map should look: it pairs the game's footprints (public/data/oau-campus.json, trimmed back from the roads and renumbered) with the Campuslife records of what stands
// there (public/data/oau-campuslife.json) by POSITION, so a re-import that renumbers buildings keeps their looks. Pure JS.
const PLACE_KIND = { hostel: "hostel", block: "hostel", lecture: "academic", faculty: "academic", hall: "civic", library: "civic", admin: "civic", social: "civic", hospital: "civic", jail: "civic", bank: "commercial", shop: "commercial", club: "commercial", worship: "worship", sports: "sports" };
/** Height (m) of the wall round a compound. */
export const FENCE_M = 1.8;
/** Colours the game itself gives to places that must stand out. */
const PLACE_PAINT = { club: { wall: "#5b4a8a" }, jail: { wall: "#8d99a8" } };
const NEAR_M = 12, CELL = 64, MIN_BLOCK_M2 = 12;
const inRing = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
const boxOf = (p) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, z0, x1, z1 }; };
const areaOf = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return Math.abs(a) / 2; };
/** Is the record's exact outline the same building as the game's footprint (nothing was trimmed off it that matters)? */
const sameShape = (a, b) => { const p = boxOf(a), q = boxOf(b); return Math.abs(p.x0 - q.x0) < 1 && Math.abs(p.z0 - q.z0) < 1 && Math.abs(p.x1 - q.x1) < 1 && Math.abs(p.z1 - q.z1) < 1 && Math.abs(areaOf(a) - areaOf(b)) < 0.03 * areaOf(b) + 2; };

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const convex = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const t = Math.sign(cross(p[i], p[(i + 1) % p.length], p[(i + 2) % p.length])); if (t && s && t !== s) return false; s ||= t; } return true; };
const near = (x, z, p, m) => inRing(x, z, p) || p.some(([ax, az], i) => { const [bx, bz] = p[(i + 1) % p.length], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - ax - dx * t, z - az - dz * t) <= m; });
/** `subject` (any polygon) cut down to the inside of the convex polygon `window` (Sutherland-Hodgman). */
function clipTo(subject, window) {
  let out = subject; const turn = Math.sign(window.reduce((s, p, i) => s + p[0] * window[(i + 1) % window.length][1] - window[(i + 1) % window.length][0] * p[1], 0)) || 1;
  for (let i = 0; i < window.length && out.length; i++) {
    const a = window[i], b = window[(i + 1) % window.length], side = (p) => turn * cross(a, b, p), from = out; out = [];
    for (let j = 0; j < from.length; j++) { const p = from[j], q = from[(j + 1) % from.length], u = side(p), v = side(q); if (u >= 0) out.push(p); if ((u >= 0) !== (v >= 0)) { const t = u / (u - v); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } }
  }
  return out;
}
/** The separate blocks of a compound that fit the game's footprint: as they are where they lie inside it (1.5 m to spare), else cut down to it (the game trims footprints back from its roads). */
const blocksIn = (parts, footprint) => parts.map((q) => ({ p: q.p, pts: q.o.every(([x, z]) => near(x, z, footprint, 1.5)) ? q.o : convex(q.o) ? clipTo(footprint, q.o) : [] })).filter((q) => q.pts.length > 2 && areaOf(q.pts) >= MIN_BLOCK_M2);

/** data: the merged game map (withExtras). look: oau-campuslife.json. Returns the list buildCampusBuildings takes (a hostel compound gives one entry per block and one, `fence`, for its wall). */
export function describeBuildings(data, look) {
  const grid = new Map(), key = (i, j) => i + "," + j;
  for (const r of look.buildings) { const k = key(Math.floor(r.x / CELL), Math.floor(r.z / CELL)); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(r); }
  const placeAt = new Map(); for (const p of data.places) if (p.bid != null) placeAt.set(p.bid, p);
  const churches = new Set((data.grounds?.religious?.churches ?? []).map((c) => c.id));
  return data.buildings.flatMap((b) => {
    const box = boxOf(b.pts), cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2, place = placeAt.get(b.id), placed = b.hSrc === "game-placement";
    let rec = null, best = Infinity;
    if (!placed) for (let i = Math.floor((box.x0 - NEAR_M) / CELL); i <= Math.floor((box.x1 + NEAR_M) / CELL); i++) for (let j = Math.floor((box.z0 - NEAR_M) / CELL); j <= Math.floor((box.z1 + NEAR_M) / CELL); j++) for (const r of grid.get(key(i, j)) ?? []) {
      const d = Math.hypot(r.x - cx, r.z - cz), inside = inRing(r.x, r.z, b.pts);
      if (!inside && d > NEAR_M) continue;
      const score = inside ? d - 10000 - (r.o ? 10000 : 0) - (r.parts ? 10000 : 0) : d;   // a record standing inside the footprint beats a neighbour; a named one beats an unnamed one; a compound beats both
      if (score < best) { best = score; rec = r; }
    }
    const ring = rec?.o && sameShape(rec.o, b.pts) ? rec.o : b.pts;
    const paint = { ...PLACE_PAINT[place?.kind], ...(b.wall ? { wall: b.wall } : {}), ...(b.roof ? { roof: b.roof } : {}) };
    const entry = { id: b.id, poly: ring.flat(), bbox: { x: box.x0, y: box.z0, w: box.x1 - box.x0, h: box.z1 - box.z0 }, height: (rec?.o ? rec.h : b.h) || 5,
      kind: rec?.k ?? PLACE_KIND[place?.kind] ?? "other", name: rec?.n ?? place?.name, preset: rec?.p, paint, plain: churches.has(place?.id),
      tall: place && b.hSrc?.startsWith("published") ? b.h : undefined };   // a published height of a named place wins over the preset's storeys (the Senate Building)
    const blocks = rec?.parts && inRing(rec.x, rec.z, b.pts) ? blocksIn(rec.parts, b.pts) : [];
    if (!blocks.length) return [entry];
    // the whole footprint stays solid, so the ground between the blocks is shut in by a wall
    return [{ ...entry, poly: b.pts.flat(), height: FENCE_M, fence: true }, ...blocks.map((q) => { const s = boxOf(q.pts); return { ...entry, poly: q.pts.flat(), preset: q.p ?? entry.preset, bbox: { x: s.x0, y: s.z0, w: s.x1 - s.x0, h: s.z1 - s.z0 } }; })];
  });
}
