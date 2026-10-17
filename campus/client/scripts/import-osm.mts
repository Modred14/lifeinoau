/**
 * Imports the real OAU campus layout from OpenStreetMap.
 *
 *   npm run osm -w web            (uses the cached download if present)
 *   npm run osm -w web -- --fresh (re-download)
 *
 * Map data © OpenStreetMap contributors, available under the Open Database
 * License (ODbL): https://www.openstreetmap.org/copyright. The game credits
 * this wherever the map is shown.
 *
 * Output: shared/src/data/campus.json, compact integer coordinates in game
 * map pixels (20 px = 1 m, x east, y south), used by client AND server:
 *   buildings  extruded + collided
 *   roads      drawn as ribbons (walkable)
 *   areas      fields, car parks, water (visual)
 *   places     named landmarks with a label point and an entrance point (GPS)
 *   transit    shuttle / bus lines: a driving line along real roads + stops
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BBOX, PX_PER_M, mPerLat, mPerLon } from "./campus-frame.mts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheFile = path.join(webRoot, ".cache/osm/oau.osm");
const outFile = path.resolve(webRoot, "../shared/src/data/campus.json");

/** Download a little wider so roads/compounds crossing the edge are complete. */
const FETCH = { west: 4.505, east: 4.535, south: 7.4935, north: 7.528 };

// ------------------------------------------------------------- download

async function loadOsm(fresh: boolean): Promise<string> {
  if (!fresh) {
    try {
      return await readFile(cacheFile, "utf8");
    } catch {
      /* not cached yet */
    }
  }
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${FETCH.west},${FETCH.south},${FETCH.east},${FETCH.north}`;
  console.log("downloading", url);
  const res = await fetch(url, { headers: { "User-Agent": "Campus-Life/0.1 (fan-made game; map import)" } });
  if (!res.ok) throw new Error(`OSM download failed: ${res.status}`);
  const xml = await res.text();
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, xml);
  return xml;
}

// ------------------------------------------------------------- tiny OSM XML parser

type Tags = Record<string, string>;
interface Way {
  id: string;
  refs: string[];
  tags: Tags;
}
interface Relation {
  id: string;
  members: { type: string; ref: string; role: string }[];
  tags: Tags;
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (s: string, name: string) => {
  const m = s.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : "";
};
const parseTags = (body: string): Tags => {
  const tags: Tags = {};
  for (const m of body.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"/g)) tags[decode(m[1])] = decode(m[2]);
  return tags;
};

function parseOsm(xml: string) {
  const nodes = new Map<string, [number, number]>(); // id -> [lat, lon]
  const gates: { name: string; at: [number, number] }[] = [];
  const pois: { name: string; kind: string; at: [number, number] }[] = [];
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const a = m[1];
    const id = attr(a, "id");
    const lat = Number(attr(a, "lat"));
    const lon = Number(attr(a, "lon"));
    nodes.set(id, [lat, lon]);
    if (m[3]) {
      const t = parseTags(m[3]);
      if (t.name && /main gate/i.test(t.name)) gates.push({ name: t.name, at: [lat, lon] });
      // Named eateries / hangouts mapped as points (e.g. "New Buka").
      if (t.name && /^(restaurant|fast_food|cafe|food_court|bar|pub|marketplace)$/.test(t.amenity ?? "")) {
        pois.push({ name: t.name, kind: /bar|pub/.test(t.amenity) || /lounge/i.test(t.name) ? "nightlife" : "food", at: [lat, lon] });
      }
    }
  }
  const ways = new Map<string, Way>();
  for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const id = attr(m[1], "id");
    const refs = [...m[2].matchAll(/<nd\s+ref="(\d+)"/g)].map((r) => r[1]);
    ways.set(id, { id, refs, tags: parseTags(m[2]) });
  }
  const relations: Relation[] = [];
  for (const m of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)) {
    const members = [...m[2].matchAll(/<member\s+type="(\w+)"\s+ref="(\d+)"\s+role="([^"]*)"/g)].map((x) => ({ type: x[1], ref: x[2], role: x[3] }));
    relations.push({ id: attr(m[1], "id"), members, tags: parseTags(m[2]) });
  }
  return { nodes, ways, relations, gates, pois };
}

// ------------------------------------------------------------- geometry

const lat0 = BBOX.north;
const lon0 = BBOX.west;
type P = [number, number]; // map px
const project = ([lat, lon]: [number, number]): P => [(lon - lon0) * mPerLon * PX_PER_M, (lat0 - lat) * mPerLat * PX_PER_M];
const W = Math.round((BBOX.east - BBOX.west) * mPerLon * PX_PER_M);
const H = Math.round((BBOX.north - BBOX.south) * mPerLat * PX_PER_M);
const inside = ([x, y]: P, margin = 0) => x >= -margin && y >= -margin && x <= W + margin && y <= H + margin;

function simplify(pts: P[], tol: number): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring (no repeated end point): split at the farthest point, simplify both halves. */
function simplifyRing(ring: P[], tol: number): P[] {
  if (ring.length < 4) return ring;
  let far = 1;
  let fd = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = simplify(ring.slice(0, far + 1), tol);
  const b = simplify([...ring.slice(far), ring[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const area = (poly: P[]) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};
const centroid = (poly: P[]): P => {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-6) return poly[0];
  return [cx / (3 * a), cy / (3 * a)];
};

/** Clip a polyline to the map rectangle (Cohen–Sutherland per segment). */
function clipLine(pts: P[]): P[][] {
  const out: P[][] = [];
  let cur: P[] = [];
  const code = ([x, y]: P) => (x < 0 ? 1 : x > W ? 2 : 0) | (y < 0 ? 4 : y > H ? 8 : 0);
  for (let i = 0; i < pts.length - 1; i++) {
    let a: P = [...pts[i]];
    let b: P = [...pts[i + 1]];
    let ca = code(a);
    let cb = code(b);
    let accept = false;
    for (;;) {
      if (!(ca | cb)) {
        accept = true;
        break;
      }
      if (ca & cb) break;
      const c = ca || cb;
      let x = 0;
      let y = 0;
      const [x0, y0] = a;
      const [x1, y1] = b;
      if (c & 8) [x, y] = [x0 + ((x1 - x0) * (H - y0)) / (y1 - y0), H];
      else if (c & 4) [x, y] = [x0 + ((x1 - x0) * (0 - y0)) / (y1 - y0), 0];
      else if (c & 2) [x, y] = [W, y0 + ((y1 - y0) * (W - x0)) / (x1 - x0)];
      else [x, y] = [0, y0 + ((y1 - y0) * (0 - x0)) / (x1 - x0)];
      if (c === ca) {
        a = [x, y];
        ca = code(a);
      } else {
        b = [x, y];
        cb = code(b);
      }
    }
    if (accept) {
      const last = cur[cur.length - 1];
      if (!last || last[0] !== a[0] || last[1] !== a[1]) {
        if (cur.length > 1) out.push(cur);
        cur = [a];
      }
      cur.push(b);
    } else if (cur.length) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// ------------------------------------------------------------- classification

type Kind = "academic" | "hostel" | "residence" | "worship" | "commercial" | "sports" | "civic" | "other";

function buildingKind(tags: Tags, inHall: boolean): Kind {
  const b = tags.building ?? "";
  const name = tags.name ?? "";
  if (/church|chapel|mosque|cathedral|religious|temple/.test(b) || tags.amenity === "place_of_worship") return "worship";
  if (/lecture|theat|auditorium/i.test(name)) return "academic";
  if (/bank|shop|store|mart|needs/i.test(name) || /commercial|retail|kiosk|supermarket/.test(b) || tags.amenity === "bank") return "commercial";
  if (/sport|stadium|gym|squash|court|pavilion/i.test(name) || /sports|stadium|grandstand/.test(b)) return "sports";
  if (inHall || /dormitory/.test(b) || /hall$/i.test(name.trim()) && !/oduduwa/i.test(name)) return "hostel";
  if (/university|school|college|lecture|faculty|theatre|aud|lab|library|senate|admin/i.test(b + " " + name)) return "academic";
  if (/house|residential|apartments|detached|semidetached|terrace|bungalow/.test(b)) return "residence";
  if (/civic|public|government|hospital|clinic/.test(b)) return "civic";
  return "other";
}

/** Height in metres from building:levels, a few known landmarks, or the kind. */
function buildingHeight(tags: Tags, kind: Kind, footprintM2: number): number {
  const name = tags.name ?? "";
  if (/oduduwa hall/i.test(name)) return 15;
  if (/senate/i.test(name)) return 26;
  if (/hezekiah oluwasanmi library/i.test(name)) return 16;
  if (/amphi/i.test(name)) return 6;
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return Math.min(40, levels * 3.3 + 1);
  switch (kind) {
    case "academic":
      return footprintM2 > 1200 ? 13 : footprintM2 > 300 ? 10 : 6;
    case "hostel":
      return footprintM2 > 400 ? 13 : 9;
    case "residence":
      return 4.2;
    case "worship":
      return 9;
    case "commercial":
      return 5;
    case "sports":
      return 9;
    case "civic":
      return 7;
    default:
      return footprintM2 > 600 ? 8 : 4.5;
  }
}

function roadWidthM(highway: string): number | null {
  switch (highway) {
    case "primary":
    case "secondary":
      return 10;
    case "tertiary":
      return 8;
    case "residential":
    case "unclassified":
      return 6;
    case "service":
      return 4.5;
    case "living_street":
      return 5;
    case "footway":
    case "path":
    case "pedestrian":
    case "steps":
    case "cycleway":
      return 2.2;
    case "track":
      return 3;
    default:
      return null;
  }
}

function areaKind(tags: Tags): "field" | "parking" | "water" | "plaza" | "grass" | null {
  if (tags.leisure === "pitch" || tags.leisure === "stadium" || tags.leisure === "track" || tags.leisure === "sports_centre") return "field";
  if (tags.amenity === "parking") return "parking";
  if (tags.natural === "water" || tags.water || tags.landuse === "reservoir" || tags.landuse === "basin") return "water";
  if (tags.highway === "pedestrian" || tags.place === "square" || tags.amenity === "marketplace") return "plaza";
  if (tags.landuse === "grass" || tags.leisure === "park" || tags.leisure === "garden") return "grass";
  return null;
}

// ------------------------------------------------------------- main

const fresh = process.argv.includes("--fresh");
const { nodes, ways, relations, gates, pois } = parseOsm(await loadOsm(fresh));
const wayPts = (w: Way): P[] => w.refs.map((r) => nodes.get(r)).filter((n): n is [number, number] => !!n).map(project);
const closed = (w: Way) => w.refs.length > 3 && w.refs[0] === w.refs[w.refs.length - 1];
const round = (n: number) => Math.round(n);
const flat = (pts: P[]) => pts.flatMap(([x, y]) => [round(x), round(y)]);

// Hall compounds (named areas like "Moremi Hall"): buildings inside them are hostels.
const hallAreas: { name: string; poly: P[] }[] = [];
for (const w of ways.values()) {
  const n = w.tags.name ?? "";
  if (!w.tags.building && closed(w) && /hall/i.test(n) && !/car park|mosque|oduduwa/i.test(n)) hallAreas.push({ name: n, poly: wayPts(w).slice(0, -1) });
}
const pointInPoly = ([x, y]: P, poly: P[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Buildings: closed ways + outer rings of multipolygon relations.
interface OutBuilding {
  name?: string;
  kind: Kind;
  h: number;
  pts: number[];
}
const buildings: OutBuilding[] = [];
const polys: { poly: P[]; tags: Tags }[] = [];
for (const w of ways.values()) if (w.tags.building && closed(w)) polys.push({ poly: wayPts(w).slice(0, -1), tags: w.tags });
for (const r of relations) {
  if (!r.tags.building) continue;
  for (const m of r.members) {
    const w = m.type === "way" && m.role === "outer" ? ways.get(m.ref) : undefined;
    if (w && closed(w)) polys.push({ poly: wayPts(w).slice(0, -1), tags: { ...w.tags, ...r.tags } });
  }
}
for (const { poly, tags } of polys) {
  const c = centroid(poly);
  if (!inside(c)) continue;
  let simple = simplifyRing(poly, 0.6 * PX_PER_M);
  if (simple.length < 3) continue;
  const a = area(simple);
  if (Math.abs(a) < 12 * PX_PER_M * PX_PER_M) continue; // drop sheds < 12 m²
  if (a < 0) simple = simple.reverse(); // consistent winding (clockwise on screen)
  const m2 = Math.abs(a) / (PX_PER_M * PX_PER_M);
  const inHall = hallAreas.some((h) => pointInPoly(c, h.poly));
  const kind = buildingKind(tags, inHall);
  buildings.push({ name: tags.name, kind, h: Math.round(buildingHeight(tags, kind, m2) * 10) / 10, pts: flat(simple) });
}

// Roads + footpaths.
interface OutRoad {
  w: number;
  kind: "road" | "path";
  name?: string;
  pts: number[];
}
const roads: OutRoad[] = [];
for (const w of ways.values()) {
  const hw = w.tags.highway;
  if (!hw || w.tags.area === "yes") continue;
  const widthM = roadWidthM(hw);
  if (!widthM) continue;
  for (const piece of clipLine(wayPts(w))) {
    const s = simplify(piece, 0.5 * PX_PER_M);
    if (s.length < 2) continue;
    roads.push({ w: widthM, kind: widthM < 3 ? "path" : "road", name: w.tags.name, pts: flat(s) });
  }
}

// Areas.
const areas: { kind: string; pts: number[] }[] = [];
for (const w of ways.values()) {
  if (!closed(w) || w.tags.building) continue;
  const k = areaKind(w.tags);
  if (!k) continue;
  const poly = wayPts(w).slice(0, -1);
  if (!poly.some((p) => inside(p))) continue;
  areas.push({ kind: k, pts: flat(simplifyRing(poly, 0.8 * PX_PER_M)) });
}

// Named places (labels + GPS entrances). Entrance = point on the outline nearest a road, 1.5 m outside.
const roadPts: P[] = roads.filter((r) => r.kind === "road" || r.w >= 2).flatMap((r) => {
  const out: P[] = [];
  for (let i = 0; i + 3 < r.pts.length; i += 2) {
    const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (4 * PX_PER_M)));
    for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
});
const nearestRoad = (p: P): P => {
  let best = roadPts[0];
  let bd = Infinity;
  for (const q of roadPts) {
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
};
function entrance(poly: P[]): P {
  const c = centroid(poly);
  const road = nearestRoad(c);
  // Closest point on the outline to that road point.
  let best: P = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((road[0] - ax) * dx + (road[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    const p: P = [ax + dx * t, ay + dy * t];
    const d = (p[0] - road[0]) ** 2 + (p[1] - road[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  const ox = best[0] - c[0];
  const oy = best[1] - c[1];
  const len = Math.hypot(ox, oy) || 1;
  return [best[0] + (ox / len) * 1.5 * PX_PER_M, best[1] + (oy / len) * 1.5 * PX_PER_M];
}

interface OutPlace {
  name: string;
  kind: string;
  label: [number, number];
  door: [number, number];
  building?: number;
}
const places: OutPlace[] = [];
const seen = new Set<string>();
buildings.forEach((b, i) => {
  if (!b.name || seen.has(b.name)) return;
  const poly: P[] = [];
  for (let k = 0; k < b.pts.length; k += 2) poly.push([b.pts[k], b.pts[k + 1]]);
  seen.add(b.name);
  const c = centroid(poly);
  const d = entrance(poly);
  places.push({ name: b.name, kind: b.kind, label: [round(c[0]), round(c[1])], door: [round(d[0]), round(d[1])], building: i });
});
for (const w of ways.values()) {
  const n = w.tags.name;
  if (!n || w.tags.building || w.tags.highway || !closed(w) || seen.has(n)) continue;
  const isPlace = /hall|sports|bowl|park|garden|square/i.test(n) || w.tags.leisure || w.tags.amenity === "university";
  if (!isPlace || /car park/i.test(n) || w.tags.amenity === "university") continue;
  const poly = wayPts(w).slice(0, -1);
  const c = centroid(poly);
  if (!inside(c)) continue;
  seen.add(n);
  const door = nearestRoad(c);
  places.push({ name: n, kind: /hall/i.test(n) ? "hostel" : "area", label: [round(c[0]), round(c[1])], door: [round(door[0]), round(door[1])] });
}

// The Main Gate: a named node on Road 1. Becomes a place + the gate landmark.
let gate: { x: number; y: number; angle: number; span: number } | undefined;
for (const g of gates) {
  const p = project(g.at);
  if (!inside(p)) continue;
  // Road direction at the gate, so the arch spans the road.
  let best = { d: Infinity, angle: 0 };
  for (const r of roads) {
    if (r.kind !== "road") continue;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(ax + dx * t - p[0], ay + dy * t - p[1]);
      if (d < best.d) best = { d, angle: Math.atan2(dy, dx) };
    }
  }
  // Road 1 is a dual carriageway: find the other carriageway across the median
  // so the arch can be centred on the median and span both.
  const nx = -Math.sin(best.angle);
  const ny = Math.cos(best.angle);
  let other = 0;
  for (const side of [1, -1]) {
    for (let d = 8; d <= 40 && !other; d += 0.5) {
      const q: P = [p[0] + nx * side * d * PX_PER_M, p[1] + ny * side * d * PX_PER_M];
      const hit = roads.some((r) => {
        if (r.kind !== "road") return false;
        for (let i = 0; i + 3 < r.pts.length; i += 2) {
          const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
          const dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
          if (Math.hypot(ax + dx * t - q[0], ay + dy * t - q[1]) < 0.6 * PX_PER_M) return true;
        }
        return false;
      });
      if (hit) other = d * side;
    }
  }
  const cx = p[0] + nx * other * PX_PER_M * 0.5;
  const cy = p[1] + ny * other * PX_PER_M * 0.5;
  gate = { x: round(cx), y: round(cy), angle: Math.round(best.angle * 1000) / 1000, span: Math.round(Math.abs(other) + 8) };
  const door = nearestRoad([p[0] + 25 * PX_PER_M * Math.cos(best.angle + Math.PI / 2), p[1] + 25 * PX_PER_M * Math.sin(best.angle + Math.PI / 2)]);
  places.push({ name: "Main Gate", kind: "area", label: [round(p[0]), round(p[1])], door: [round(door[0]), round(door[1])] });
  break;
}

// Named eateries / lounges mapped as points.
for (const poi of pois) {
  const p = project(poi.at);
  if (!inside(p) || seen.has(poi.name)) continue;
  seen.add(poi.name);
  places.push({ name: poi.name, kind: poi.kind, label: [round(p[0]), round(p[1])], door: [round(p[0]), round(p[1])] });
}

// ------------------------------------------------------------- transit (shuttle + bus lines)

/**
 * Lines are routed over the real drivable road graph (OSM ways share node ids
 * at junctions), stop to stop, then offset to the right-hand lane (Nigeria
 * drives on the right).
 */
const LINES = [
  {
    name: "Gate Shuttle",
    kind: "shuttle",
    stops: [/^main gate$/i, /student union/i],
  },
  {
    name: "Halls Shuttle",
    kind: "shuttle",
    stops: [/student union/i, /fajuyi/i, /^etf hall$/i, /awolowo hall/i, /angola/i, /mozambique/i, /postgraduate/i, /alumni/i, /moremi/i],
  },
  {
    name: "Campus Bus",
    kind: "bus",
    stops: [/student union/i, /oduduwa hall/i, /oluwasanmi library/i, /faculty of arts \(block 1\)/i, /faculty of technology/i, /faculty of pharmacy/i, /wema bank/i, /oau sports centre/i],
  },
];
const DRIVABLE = new Set(["primary", "secondary", "tertiary", "residential", "unclassified", "service", "living_street", "primary_link", "secondary_link", "tertiary_link"]);

const adj = new Map<string, { to: string; d: number; w: number }[]>();
const nodePx = (id: string) => project(nodes.get(id)!);
for (const w of ways.values()) {
  const hw = w.tags.highway;
  if (!hw || !DRIVABLE.has(hw) || w.tags.area === "yes" || w.tags.service === "parking_aisle" || w.tags.access === "private") continue;
  const widthM = roadWidthM(hw) ?? 6;
  const oneway = false; // campus dual carriageways are split oneways; the lane offset keeps sides apart
  for (let i = 0; i + 1 < w.refs.length; i++) {
    const a = w.refs[i];
    const b = w.refs[i + 1];
    if (!nodes.has(a) || !nodes.has(b)) continue;
    const pa = nodePx(a);
    const pb = nodePx(b);
    if (!inside(pa, -5 * PX_PER_M) || !inside(pb, -5 * PX_PER_M)) continue; // stay on the map
    const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    // Prefer bigger roads a little, like real drivers.
    const cost = d * (widthM >= 8 ? 1 : widthM >= 6 ? 1.15 : 1.6);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, d: cost, w: widthM });
    if (!oneway) (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, d: cost, w: widthM });
  }
}
// Largest connected component only, so every stop is reachable.
const component = new Map<string, number>();
let bestComp = -1;
let bestSize = 0;
let compId = 0;
for (const start of adj.keys()) {
  if (component.has(start)) continue;
  const stack = [start];
  component.set(start, compId);
  let size = 0;
  while (stack.length) {
    const n = stack.pop()!;
    size++;
    for (const e of adj.get(n) ?? []) if (!component.has(e.to)) component.set(e.to, compId), stack.push(e.to);
  }
  if (size > bestSize) (bestSize = size), (bestComp = compId);
  compId++;
}
const graphNodes = [...adj.keys()].filter((n) => component.get(n) === bestComp);
const nearestNode = (p: P) => {
  let best = graphNodes[0];
  let bd = Infinity;
  for (const n of graphNodes) {
    const q = nodePx(n);
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bd) (bd = d), (best = n);
  }
  return best;
};
function dijkstra(from: string, to: string): string[] {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  const done = new Set<string>();
  while (open.size) {
    let cur = "";
    let cd = Infinity;
    for (const n of open) if (dist.get(n)! < cd) (cd = dist.get(n)!), (cur = n);
    open.delete(cur);
    if (cur === to) break;
    done.add(cur);
    for (const e of adj.get(cur) ?? []) {
      if (done.has(e.to)) continue;
      const nd = cd + e.d;
      if (nd < (dist.get(e.to) ?? Infinity)) dist.set(e.to, nd), prev.set(e.to, cur), open.add(e.to);
    }
  }
  if (!dist.has(to)) throw new Error(`no road route ${from} -> ${to}`);
  const out = [to];
  while (out[out.length - 1] !== from) out.push(prev.get(out[out.length - 1])!);
  return out.reverse();
}

/** Shift a closed polyline to the right of travel by `off` px (screen y down: right = (-dy, dx)). */
function offsetRight(pts: P[], off: number): P[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const n1 = norm([p[0] - a[0], p[1] - a[1]]);
    const n2 = norm([b[0] - p[0], b[1] - p[1]]);
    let nx = -(n1[1] + n2[1]);
    let ny = n1[0] + n2[0];
    const len = Math.hypot(nx, ny);
    if (len < 0.3) return [p[0] - n2[1] * off, p[1] + n2[0] * off] as P; // U-turn: just use the outgoing side
    nx /= len;
    ny /= len;
    const miter = Math.min(2, 1 / Math.max(0.5, (nx * -n2[1] + ny * n2[0])));
    return [p[0] + nx * off * miter, p[1] + ny * off * miter] as P;
  });
}
function norm(v: P): P {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

interface OutLine {
  name: string;
  kind: string;
  pts: number[];
  stops: { name: string; i: number }[];
}
const transit: OutLine[] = [];
for (const line of LINES) {
  const stopPlaces = line.stops.map((re) => {
    const p = places.find((pl) => re.test(pl.name));
    if (!p) throw new Error(`transit stop not found: ${re}`);
    return p;
  });
  const stopNodes = stopPlaces.map((p) => nearestNode(p.door));
  const ids: string[] = [];
  const stopAt: number[] = [];
  for (let k = 0; k < stopNodes.length; k++) {
    const seg = dijkstra(stopNodes[k], stopNodes[(k + 1) % stopNodes.length]);
    stopAt.push(ids.length);
    ids.push(...seg.slice(0, -1));
  }
  // Raw points, then drop near-duplicates (keep stop indices pointing at the right vertex).
  const raw = ids.map(nodePx);
  const keepIdx: number[] = [];
  const pts: P[] = [];
  for (let i = 0; i < raw.length; i++) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(raw[i][0] - last[0], raw[i][1] - last[1]) < 2 * PX_PER_M && !stopAt.includes(i)) {
      keepIdx.push(pts.length - 1);
      continue;
    }
    keepIdx.push(pts.length);
    pts.push(raw[i]);
  }
  const lane = offsetRight(pts, 1.6 * PX_PER_M);
  transit.push({
    name: line.name,
    kind: line.kind,
    pts: flat(lane),
    stops: stopPlaces.map((p, k) => ({ name: p.name, i: keepIdx[stopAt[k]] })),
  });
  let len = 0;
  for (let i = 0; i < lane.length; i++) {
    const a = lane[i];
    const b = lane[(i + 1) % lane.length];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  console.log(`${line.name}: ${stopPlaces.length} stops, ${(len / PX_PER_M / 1000).toFixed(2)} km loop`);
}

// Spawn: in front of the Student Union Building.
const sub = places.find((p) => /student union/i.test(p.name));
const spawn = sub ? sub.door : [round(W / 2), round(H / 2)];


const data = {
  attribution: "Map data © OpenStreetMap contributors (ODbL)",
  generated: new Date().toISOString().slice(0, 10),
  pxPerMeter: PX_PER_M,
  width: W,
  height: H,
  spawn,
  buildings,
  roads,
  areas,
  places,
  transit,
  gate,
};
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(data));
const kinds: Record<string, number> = {};
for (const b of buildings) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
console.log(
  `map ${(W / PX_PER_M).toFixed(0)}m x ${(H / PX_PER_M).toFixed(0)}m (${W}x${H}px)\n` +
    `buildings ${buildings.length} ${JSON.stringify(kinds)}\nroads ${roads.length}  areas ${areas.length}  places ${places.length}\n` +
    `output ${(JSON.stringify(data).length / 1024).toFixed(0)} KB -> ${path.relative(process.cwd(), outFile)}`,
);
