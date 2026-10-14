// lib3d/roadnet.js
// The campus as a grid, for routing and collision. Pure JS (no three.js, no DOM), so it runs in the browser and in the tests.
// It turns public/data/oau-campus.json (roads, buildings, water) into 2 m cells, then offers:
//   - findPath(): the way from A to B along the roads (for vehicles) or on foot (anywhere that is not a building or water),
//   - doorOf() / destinationOf(): where the front door of any building is, and the kerb nearest to it,
//   - walkable() / drivable(): collision for the trek and the self-driven car,
//   - Path: a smooth polyline you can ask "where am I after s metres, and which way am I facing?".
// Coordinates are the data's own: metres, x east, z south.

export const CELL = 2;
const SQ2 = Math.SQRT2;

/** Even-odd scanline fill of one or more rings (a polygon and its holes) into `grid`. */
function fillRings(g, rings, val) {
  let zmin = Infinity, zmax = -Infinity;
  for (const r of rings) for (const p of r) { if (p[1] < zmin) zmin = p[1]; if (p[1] > zmax) zmax = p[1]; }
  const j0 = Math.max(0, Math.floor((zmin - g.z0) / CELL)), j1 = Math.min(g.nz - 1, Math.ceil((zmax - g.z0) / CELL));
  for (let j = j0; j <= j1; j++) {
    const z = g.z0 + (j + 0.5) * CELL, xs = [];
    for (const r of rings) for (let i = 0, n = r.length; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / CELL - 0.5)), i1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) g.cells[j * g.nx + i] = val;
    }
  }
}

/** Distance (in cells) from every cell to the nearest cell whose value is `want`. Two-pass chamfer: good enough for steering and costs. */
function chamfer(src, nx, nz, want) {
  const d = new Float32Array(nx * nz), BIG = 1e6;
  for (let i = 0; i < d.length; i++) d[i] = src[i] === want ? 0 : BIG;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = d[k]; if (v === 0) continue;
    if (i > 0) v = Math.min(v, d[k - 1] + 1);
    if (j > 0) { v = Math.min(v, d[k - nx] + 1); if (i > 0) v = Math.min(v, d[k - nx - 1] + SQ2); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + SQ2); }
    d[k] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = d[k]; if (v === 0) continue;
    if (i < nx - 1) v = Math.min(v, d[k + 1] + 1);
    if (j < nz - 1) { v = Math.min(v, d[k + nx] + 1); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + SQ2); if (i > 0) v = Math.min(v, d[k + nx - 1] + SQ2); }
    d[k] = v;
  }
  return d;
}

const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const centroid = (pts) => [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];

/** A min-heap of (priority, node) pairs held in two typed arrays. */
class Heap {
  constructor(cap = 1 << 16) { this.p = new Float32Array(cap); this.n = new Int32Array(cap); this.size = 0; }
  push(pri, node) {
    if (this.size === this.p.length) { const p = new Float32Array(this.size * 2), n = new Int32Array(this.size * 2); p.set(this.p); n.set(this.n); this.p = p; this.n = n; }
    let i = this.size++; const P = this.p, N = this.n;
    while (i > 0) { const up = (i - 1) >> 1; if (P[up] <= pri) break; P[i] = P[up]; N[i] = N[up]; i = up; }
    P[i] = pri; N[i] = node;
  }
  pop() {
    const P = this.p, N = this.n, top = N[0], pri = P[--this.size], node = N[this.size]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= this.size) break; if (c + 1 < this.size && P[c + 1] < P[c]) c++; if (P[c] >= pri) break; P[i] = P[c]; N[i] = N[c]; i = c; }
    if (this.size) { P[i] = pri; N[i] = node; }
    return top;
  }
}

/** A smooth route. `at(s)` gives the point s metres along it and the way it faces; `nearest(x, z)` is how far along the route the closest point is. */
export class Path {
  constructor(pts) {
    this.pts = pts; this.cum = new Float32Array(pts.length); let t = 0;
    for (let i = 1; i < pts.length; i++) { t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); this.cum[i] = t; }
    this.len = t;
  }
  at(s, out = {}) {
    const P = this.pts, C = this.cum, n = P.length;
    if (n === 1) { out.x = P[0][0]; out.z = P[0][1]; out.hx = 0; out.hz = 1; return out; }
    s = Math.max(0, Math.min(this.len, s));
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], seg = C[hi] - C[lo] || 1, k = (s - C[lo]) / seg, dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    out.x = a[0] + dx * k; out.z = a[1] + dz * k; out.hx = dx / l; out.hz = dz / l; return out;
  }
  /** Distance along the route of the point closest to (x, z), searched near `hint` so a route that doubles back is not confused. */
  nearest(x, z, hint = 0, window = 60) {
    const P = this.pts, C = this.cum; let best = hint, bd = Infinity;
    for (let i = 0; i < P.length - 1; i++) {
      if (C[i + 1] < hint - window || C[i] > hint + window) continue;
      const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - (ax + dx * k), z - (az + dz * k));
      if (d < bd) { bd = d; best = C[i] + Math.sqrt(l2) * k; }
    }
    return best;
  }
}

/** Chaikin corner cutting: rounds the turns of a polyline without moving it far. */
function chaikin(pts, rounds) {
  for (let r = 0; r < rounds; r++) {
    if (pts.length < 3) break; const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    out.push(pts[pts.length - 1]); pts = out;
  }
  return pts;
}
/** Re-points a polyline at an even spacing. */
function resample(pts, step) {
  const path = new Path(pts), out = [], n = Math.max(1, Math.round(path.len / step));
  for (let i = 0; i <= n; i++) { const p = path.at((path.len * i) / n); out.push([p.x, p.z]); }
  return out;
}

/** Clears every connected piece of `cells` except the biggest one (4-connected). */
function keepLargest(cells, nx, nz) {
  const lab = new Int32Array(cells.length), sizes = [0]; let best = 0;
  const stack = new Int32Array(cells.length);
  for (let s = 0; s < cells.length; s++) {
    if (!cells[s] || lab[s]) continue; const id = sizes.length; let top = 0, n = 0; stack[top++] = s; lab[s] = id;
    while (top) { const k = stack[--top]; n++; const i = k % nx, j = (k - i) / nx;
      if (i > 0 && cells[k - 1] && !lab[k - 1]) { lab[k - 1] = id; stack[top++] = k - 1; }
      if (i < nx - 1 && cells[k + 1] && !lab[k + 1]) { lab[k + 1] = id; stack[top++] = k + 1; }
      if (j > 0 && cells[k - nx] && !lab[k - nx]) { lab[k - nx] = id; stack[top++] = k - nx; }
      if (j < nz - 1 && cells[k + nx] && !lab[k + nx]) { lab[k + nx] = id; stack[top++] = k + nx; } }
    sizes.push(n); if (n > sizes[best || 1] || !best) best = id;
  }
  for (let k = 0; k < cells.length; k++) if (cells[k] && lab[k] !== best) cells[k] = 0;
}

/** Builds the grid from the campus data (the same JSON the 3D map draws, with mapExtras already merged in). */
export function buildRoadNet(data) {
  let x0 = data.bounds.x0, x1 = data.bounds.x1, z0 = data.bounds.z0, z1 = data.bounds.z1;
  for (const b of data.buildings) for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  x0 = Math.floor(x0 - 40); z0 = Math.floor(z0 - 40); x1 = Math.ceil(x1 + 40); z1 = Math.ceil(z1 + 40);
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL), N = nx * nz;
  const layer = () => ({ x0, z0, nx, nz, cells: new Uint8Array(N) });
  const road = layer(), bld = layer(), water = layer();
  for (const r of data.roads) fillRings(road, [r.pts, ...(r.holes ?? [])], 1);
  for (const w of data.areas?.water ?? []) fillRings(water, [w.pts, ...(w.holes ?? [])], 1);
  // buildings carve themselves out of the road layer too (a stray sliver of road under a footprint is not a road)
  for (const b of data.buildings) { fillRings(bld, [b.pts], 1); }
  const solid = new Uint8Array(N), carSolid = new Uint8Array(N);
  for (let i = 0; i < N; i++) solid[i] = bld.cells[i] | water.cells[i];
  // Thin roads are only a cell or two wide at 2 m, so they are fattened by a cell (otherwise they break into pieces), then only the one big connected network is kept:
  // that is what vehicles may follow. (The 3D map still draws every road; this is only the routing grid.)
  const fat = new Uint8Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!road.cells[k]) continue; fat[k] = 1;
    if (i > 0) fat[k - 1] = 1; if (i < nx - 1) fat[k + 1] = 1; if (j > 0) fat[k - nx] = 1; if (j < nz - 1) fat[k + nx] = 1;
  }
  for (let i = 0; i < N; i++) if (solid[i]) fat[i] = 0;
  keepLargest(fat, nx, nz);
  road.cells = fat;
  // cars are wider than people: one extra cell of clearance from walls
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!solid[k]) continue; carSolid[k] = 1;
    if (i > 0) carSolid[k - 1] = 1; if (i < nx - 1) carSolid[k + 1] = 1; if (j > 0) carSolid[k - nx] = 1; if (j < nz - 1) carSolid[k + nx] = 1;
  }
  const roadCells = road.cells, edgeDist = chamfer(roadCells, nx, nz, 0), toRoad = chamfer(roadCells, nx, nz, 1); // edgeDist: inside a road, how far from its edge. toRoad: anywhere, how far from a road.
  const net = { x0, z0, x1, z1, nx, nz, roadCells, solid, carSolid, edgeDist, toRoad, data, doors: new Map(), stamp: new Uint32Array(N), closed: new Uint32Array(N), gs: new Float32Array(N), from: new Int32Array(N), gen: 0, heap: new Heap() };
  net.buildingById = new Map(data.buildings.map((b) => [b.id, b]));
  return net;
}

const ci = (net, x) => Math.floor((x - net.x0) / CELL), cj = (net, z) => Math.floor((z - net.z0) / CELL);
const inGrid = (net, i, j) => i >= 0 && j >= 0 && i < net.nx && j < net.nz;
const cx = (net, i) => net.x0 + (i + 0.5) * CELL, cz = (net, j) => net.z0 + (j + 0.5) * CELL;

export const isRoad = (net, x, z) => { const i = ci(net, x), j = cj(net, z); return inGrid(net, i, j) && net.roadCells[j * net.nx + i] === 1; };
/** Can a person stand here? (Not inside a building, not in water, and on the map.) */
export const walkable = (net, x, z) => { const i = ci(net, x), j = cj(net, z); return inGrid(net, i, j) && !net.solid[j * net.nx + i]; };
/** Can a car be here? Roads plus a little shoulder: not within a cell of a wall. */
export const drivable = (net, x, z) => { const i = ci(net, x), j = cj(net, z); return inGrid(net, i, j) && !net.carSolid[j * net.nx + i]; };
/** How many metres from the nearest road edge (0 off the road). */
export const roadHalfWidth = (net, x, z) => { const i = ci(net, x), j = cj(net, z); return inGrid(net, i, j) ? net.edgeDist[j * net.nx + i] * CELL : 0; };

/** The nearest road cell centre to (x, z), searching outward up to `max` metres. Null if there is none. */
export function nearestRoad(net, x, z, max = 400) {
  const i0 = ci(net, x), j0 = cj(net, z), R = Math.ceil(max / CELL); let best = null, bd = Infinity;
  if (inGrid(net, i0, j0) && net.roadCells[j0 * net.nx + i0]) return { x: cx(net, i0), z: cz(net, j0) };
  for (let r = 1; r <= R; r++) {
    if (best && r * CELL > bd + CELL * 1.5) break;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = i0 + di, j = j0 + dj; if (!inGrid(net, i, j) || !net.roadCells[j * net.nx + i]) continue;
      const d = Math.hypot(di, dj) * CELL; if (d < bd) { bd = d; best = { x: cx(net, i), z: cz(net, j) }; }
    }
  }
  return best;
}
/** The nearest cell a person (or, with kind "car", a car) can be in. */
export function nearestWalkable(net, x, z, max = 60, kind = "walk") {
  const ok = kind === "car" ? drivable : walkable;
  if (ok(net, x, z)) return { x, z };
  const i0 = ci(net, x), j0 = cj(net, z), R = Math.ceil(max / CELL); let best = null, bd = Infinity;
  for (let r = 1; r <= R; r++) {
    if (best && r * CELL > bd + CELL) break;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = i0 + di, j = j0 + dj; if (!inGrid(net, i, j) || (kind === "car" ? net.carSolid : net.solid)[j * net.nx + i]) continue;
      const d = Math.hypot(di, dj) * CELL; if (d < bd) { bd = d; best = { x: cx(net, i), z: cz(net, j) }; }
    }
  }
  return best;
}

const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];
const HEUR = { road: 1.9, car: 1.7, walk: 1.5 }; // inflated A*: a slightly longer route found far faster

/**
 * A* over the grid. Modes:
 *   "road"  road cells only (vehicles on the main network), keeping to the middle of the road
 *   "car"   anywhere a car can fit, strongly preferring roads (the short stretch between a road and a door)
 *   "walk"  anywhere that is not a building or water, preferring roads
 * Returns a list of [x, z] cell centres or null.
 */
function astar(net, a, b, mode, cap = 900000) {
  const { nx, nz } = net, onlyRoad = mode === "road", car = mode !== "walk";
  const si = ci(net, a.x), sj = cj(net, a.z), ti = ci(net, b.x), tj = cj(net, b.z);
  if (!inGrid(net, si, sj) || !inGrid(net, ti, tj)) return null;
  const blocked = (k) => (onlyRoad ? !net.roadCells[k] : car ? net.carSolid[k] === 1 : net.solid[k] === 1);
  const S = sj * nx + si, T = tj * nx + ti; if (blocked(S) || blocked(T)) return null;
  const gen = ++net.gen, { stamp, closed, gs, from, heap } = net; heap.size = 0;
  const cost = (k) => (onlyRoad ? 1 + 7 / Math.pow(0.6 + net.edgeDist[k], 1.6) : car ? (net.roadCells[k] ? 1 : 3.2) : net.roadCells[k] ? 1 : 1.35 + 0.5 / (1 + net.toRoad[k]));
  const W = HEUR[mode], h = (i, j) => { const dx = Math.abs(i - ti), dj = Math.abs(j - tj); return (Math.max(dx, dj) + (SQ2 - 1) * Math.min(dx, dj)) * W; };
  stamp[S] = gen; gs[S] = 0; from[S] = -1; heap.push(h(si, sj), S);
  let steps = 0;
  while (heap.size) {
    const k = heap.pop(); if (closed[k] === gen) continue; closed[k] = gen; const i = k % nx, j = (k - i) / nx; if (k === T) break;
    const g0 = gs[k]; if (++steps > cap) return null;
    for (const [di, dj, w] of N8) {
      const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue; const nk = nj * nx + ni; if (blocked(nk)) continue;
      if (di && dj && (blocked(j * nx + ni) || blocked(nj * nx + i))) continue; // no cutting a corner
      const g = g0 + w * cost(nk);
      if (stamp[nk] !== gen || g < gs[nk]) { stamp[nk] = gen; gs[nk] = g; from[nk] = k; heap.push(g + h(ni, nj), nk); }
    }
  }
  if (stamp[T] !== gen) return null;
  const out = []; for (let k = T; k !== -1; k = from[k]) { const i = k % nx, j = (k - i) / nx; out.push([cx(net, i), cz(net, j)]); }
  return out.reverse();
}

/** Is the straight line p -> q clear for this mode? Road mode also wants to stay clear of the road's edge. */
function lineClear(net, p, q, mode) {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(l / (CELL * 0.5)));
  for (let t = 0; t <= n; t++) {
    const x = p[0] + ((q[0] - p[0]) * t) / n, z = p[1] + ((q[1] - p[1]) * t) / n, i = ci(net, x), j = cj(net, z); if (!inGrid(net, i, j)) return false; const k = j * net.nx + i;
    if (mode === "road") { if (!net.roadCells[k] || net.edgeDist[k] < 1.5) return false; } else if (mode === "car") { if (net.carSolid[k]) return false; } else if (net.solid[k]) return false;
  }
  return true;
}
function pull(net, pts, mode) { // string pulling: drop every point the route can skip in a straight line
  const out = [pts[0]]; let a = 0;
  while (a < pts.length - 1) { let b = pts.length - 1; while (b > a + 1 && !lineClear(net, pts[a], pts[b], mode)) b--; out.push(pts[b]); a = b; }
  return out;
}

/** The raw, unsmoothed cells of a route as a polyline, ends set exactly. */
function rawRoute(net, a, b, mode, cap) {
  let s, t;
  if (mode === "road") { s = nearestRoad(net, a.x, a.z); t = nearestRoad(net, b.x, b.z); }
  else { const kind = mode === "car" ? "car" : "walk"; s = nearestWalkable(net, a.x, a.z, 60, kind); t = nearestWalkable(net, b.x, b.z, 60, kind); }
  if (!s || !t) return null;
  const raw = astar(net, s, t, mode, cap); if (!raw) return null;
  const core = raw.length > 2 ? pull(net, raw, mode) : raw;
  const pts = [[s.x, s.z], ...core.slice(1, -1), [t.x, t.z]].filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 0.01);
  return pts.length < 2 ? [[s.x, s.z], [t.x + 0.5, t.z]] : pts;
}

/**
 * The way from a to b ({ x, z } in metres). "road" follows the road network, "car" may leave it for a short stretch, "walk" goes anywhere on foot.
 * Returns a Path, or null when no route exists.
 */
export function findPath(net, a, b, mode = "road", cap) {
  const pts = rawRoute(net, a, b, mode, cap); if (!pts) return null;
  return new Path(resample(chaikin(pts, mode === "walk" ? 2 : 3), 1));
}

/**
 * A vehicle's whole route from the front of one door to the front of another: out to the road, along the roads, then off the road again to the other door.
 * Falls back to a direct off-road route if the road leg cannot be found. Returns a Path or null.
 */
export function drivePlan(net, from, to) {
  const A = from.front, B = to.front, ka = from.kerb, kb = to.kerb;
  const legA = rawRoute(net, A, ka, "car", 150000), legB = rawRoute(net, kb, B, "car", 150000), main = Math.hypot(ka.x - kb.x, ka.z - kb.z) < 3 ? [[ka.x, ka.z], [kb.x + 0.5, kb.z]] : rawRoute(net, ka, kb, "road", 900000);
  if (!main) { const direct = rawRoute(net, A, B, "car", 900000); return direct ? new Path(resample(chaikin(direct, 3), 1)) : null; }
  const pts = [...(legA ?? [[A.x, A.z]]), ...main.slice(1), ...(legB ?? [[B.x, B.z]]).slice(1)].filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 0.01);
  return pts.length < 2 ? null : new Path(resample(chaikin(pts, 3), 1));
}

/** Where the front door of a building is: the point on its outline closest to a road, with the wall's outward direction. Cached per building. */
export function doorOf(net, bd) {
  const hit = net.doors.get(bd.id); if (hit) return hit;
  const pts = bd.pts, c = centroid(pts); let best = null;
  for (let e = 0; e < pts.length; e++) {
    const a = pts[e], b = pts[(e + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1) continue;
    const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l; let nx = uz, nz = -ux; // a normal; flip it so it points out of the building
    if (inPoly(a[0] + ux * l / 2 + nx * 0.8, a[1] + uz * l / 2 + nz * 0.8, pts)) { nx = -nx; nz = -nz; }
    const steps = Math.max(1, Math.floor(l / 1.5));
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0.5, px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t, ox = px + nx * 1.6, oz = pz + nz * 1.6;
      if (!walkable(net, ox, oz)) continue;
      const i = ci(net, ox), j = cj(net, oz); let score = net.toRoad[j * net.nx + i] * CELL;
      const edgeGap = Math.min(s * l / steps, (steps - s) * l / steps); if (edgeGap < 2.5) score += 4; // not on a corner
      if (!best || score < best.score) best = { score, x: px, z: pz, nx, nz, ox, oz, len: l };
    }
  }
  const door = best ? { x: best.x, z: best.z, nx: best.nx, nz: best.nz, ox: best.ox, oz: best.oz, width: Math.min(3, Math.max(1.6, best.len * 0.25)) } : { x: c[0], z: c[1], nx: 0, nz: 1, ox: c[0], oz: c[1] + 3, width: 2 };
  net.doors.set(bd.id, door); return door;
}

/**
 * Everything a trip needs to know about a place: where its door is, where the kerb is (the road cell nearest the door) and the footprint.
 * `place` is a row from the campus data ({ id, x, z, bid? }); a building with no name is passed as { id, bid }.
 */
export function destinationOf(net, place) {
  const bd = place.bid != null ? net.buildingById.get(place.bid) : null;
  if (bd) {
    const d = doorOf(net, bd), kerb = nearestRoad(net, d.ox, d.oz) ?? { x: d.ox, z: d.oz };
    return { id: place.id, building: bd, centre: centroid(bd.pts), door: { x: d.x, z: d.z, nx: d.nx, nz: d.nz, width: d.width }, front: { x: d.ox, z: d.oz }, kerb };
  }
  const p = nearestWalkable(net, place.x, place.z) ?? { x: place.x, z: place.z }, kerb = nearestRoad(net, p.x, p.z) ?? p;
  return { id: place.id, building: null, centre: [place.x, place.z], door: { x: p.x, z: p.z, nx: 0, nz: 1, width: 2 }, front: p, kerb };
}

/** Pushes a moving point out of walls: tries the full step, then each axis on its own, so you slide along a wall instead of sticking to it. */
export function slide(net, x, z, nx, nz, kind = "walk") {
  const ok = kind === "car" ? drivable : walkable;
  if (ok(net, nx, nz)) return [nx, nz, false];
  if (ok(net, nx, z)) return [nx, z, true];
  if (ok(net, x, nz)) return [x, nz, true];
  return [x, z, true];
}

/** A random road point between rMin and rMax metres from (x, z). Used to place traffic around the camera. */
export function randomRoadNear(net, rnd, x, z, rMin, rMax, tries = 40) {
  for (let t = 0; t < tries; t++) {
    const a = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, i = ci(net, px), j = cj(net, pz);
    if (inGrid(net, i, j) && net.roadCells[j * net.nx + i] && !net.carSolid[j * net.nx + i] && net.edgeDist[j * net.nx + i] >= 1.5) return { x: cx(net, i), z: cz(net, j) };
  }
  return null;
}