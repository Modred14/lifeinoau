// lib3d/osm.js
// Converts an OpenStreetMap "Overpass" export into the compact map data the 3D campus draws. Pure functions: no 3D library, runs in Node and the browser.
// OSM data is (c) OpenStreetMap contributors, licensed ODbL: any screen that shows it must credit them.
export const M_PER_DEG_LAT = 110574;
export const mPerDegLon = (lat) => 111319.49 * Math.cos((lat * Math.PI) / 180);
/** Local metres from a chosen origin. x grows east, z grows SOUTH (so north is up the screen). */
export const project = (lat, lon, o) => [Math.round((lon - o.lon) * mPerDegLon(o.lat) * 10) / 10, Math.round(-(lat - o.lat) * M_PER_DEG_LAT * 10) / 10];

const ROAD_W = { motorway: 14, trunk: 14, primary: 12, secondary: 9.5, tertiary: 8, unclassified: 6.5, residential: 6, living_street: 5, service: 4, track: 3.2, footway: 1.8, path: 1.6, pedestrian: 3, cycleway: 1.8 };
const ROAD_CLASS = { motorway: "major", trunk: "major", primary: "major", secondary: "major", tertiary: "street", unclassified: "street", residential: "street", living_street: "street", service: "service", track: "path", footway: "path", path: "path", pedestrian: "path", cycleway: "path" };
export const roadClass = (hw) => ROAD_CLASS[hw] ?? null;
export const roadWidth = (hw) => ROAD_W[hw] ?? 5;

export const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; a += x1 * z2 - x2 * z1; } return Math.abs(a) / 2; };
export const centroid = (pts) => [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
const closed = (g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
const buildingHeight = (tags, id) => { const h = parseFloat(tags.height); if (h > 0) return Math.min(h, 120); const lv = parseFloat(tags["building:levels"]); if (lv > 0) return Math.min(lv * 3.2, 120); return 5 + ((id * 2654435761) % 5000) / 1000 * 1.2; };

/**
 * overpass: JSON from an Overpass query using `out geom;`.
 * opts: { bbox: [south, west, north, east], maxBuildings = 6000 }. Returns { origin, bounds, roads, buildings, trees, named, stats }.
 */
export function fromOverpass(overpass, opts = {}) {
  const els = overpass.elements ?? [], maxB = opts.maxBuildings ?? 6000;
  let bb = opts.bbox; if (!bb) { const ll = els.flatMap((e) => (e.geometry ?? (e.lat != null ? [e] : []))); if (!ll.length) throw new Error("No geometry found. Use `out geom;` in the Overpass query."); bb = [Math.min(...ll.map((p) => p.lat)), Math.min(...ll.map((p) => p.lon)), Math.max(...ll.map((p) => p.lat)), Math.max(...ll.map((p) => p.lon))]; }
  const origin = { lat: (bb[0] + bb[2]) / 2, lon: (bb[1] + bb[3]) / 2 }, inside = (p) => p.lat >= bb[0] && p.lat <= bb[2] && p.lon >= bb[1] && p.lon <= bb[3];
  const roads = [], buildings = [], trees = [], named = [], stats = { ways: 0, skippedRelations: 0, roadsSkippedKind: 0, buildingsCulled: 0 };
  for (const e of els) {
    const t = e.tags ?? {};
    if (e.type === "relation") { stats.skippedRelations++; continue; }
    if (e.type === "node") { if (!inside(e)) continue; const [x, z] = project(e.lat, e.lon, origin); if (t.natural === "tree") trees.push([x, z]); else if (t.name) named.push({ name: t.name, x, z, kind: "point", tag: t.amenity ?? t.tourism ?? t.place ?? "" }); continue; }
    if (e.type !== "way" || !e.geometry?.length) continue; stats.ways++;
    const g = e.geometry.filter(inside); if (g.length < 2) continue; const pts = e.geometry.map((p) => project(p.lat, p.lon, origin));
    if (t.highway) { const cls = roadClass(t.highway); if (!cls) { stats.roadsSkippedKind++; continue; } roads.push({ name: t.name ?? null, hw: t.highway, cls, w: roadWidth(t.highway), pts }); if (t.name) named.push({ name: t.name, x: pts[Math.floor(pts.length / 2)][0], z: pts[Math.floor(pts.length / 2)][1], kind: "road" }); }
    else if (t.building && closed(e.geometry) && g.length >= 4) { const ring = pts.slice(0, -1); buildings.push({ id: e.id, name: t.name ?? null, h: Math.round(buildingHeight(t, e.id) * 10) / 10, area: Math.round(area(ring)), pts: ring }); if (t.name) { const [cx, cz] = centroid(ring); named.push({ name: t.name, x: cx, z: cz, kind: "building", h: buildingHeight(t, e.id), area: area(ring) }); } }
    else if (t.name && closed(e.geometry)) { const ring = pts.slice(0, -1), [cx, cz] = centroid(ring); named.push({ name: t.name, x: cx, z: cz, kind: "area", area: area(ring) }); }
  }
  if (buildings.length > maxB) { buildings.sort((a, b) => (b.name ? 1e9 : 0) + b.area - ((a.name ? 1e9 : 0) + a.area)); stats.buildingsCulled = buildings.length - maxB; buildings.length = maxB; }
  const xs = [], zs = []; for (const r of roads) for (const p of r.pts) { xs.push(p[0]); zs.push(p[1]); } for (const b of buildings) for (const p of b.pts) { xs.push(p[0]); zs.push(p[1]); }
  const bounds = xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) } : { x0: -500, x1: 500, z0: -500, z1: 500 };
  return { origin, bbox: bb, bounds, roads, buildings, trees, named, stats, attribution: "Map data (c) OpenStreetMap contributors (ODbL)" };
}

/** Find each game landmark in the real data by name. Returns { found: [{id, x, z, h, source}], missing: [id] }. Largest matching feature wins. */
export function matchLandmarks(data, landmarks) {
  const found = [], missing = [];
  for (const L of landmarks) {
    const hits = data.named.filter((n) => n.kind !== "road" && L.osm.some((a) => n.name.toLowerCase().includes(a))).sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
    if (hits.length) found.push({ id: L.id, x: hits[0].x, z: hits[0].z, h: hits[0].h ?? 6, source: "osm", matched: hits[0].name }); else missing.push(L.id);
  }
  return { found, missing };
}