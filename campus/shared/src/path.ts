/**
 * A* pathfinding over the campus (the map's GPS "walk me there").
 *
 * Runs on a 2 m navigation grid, keeps to roads, walkways and paved ground
 * (like people do), then "string-pulls" the result into straight segments
 * using the same collision rules as movement, so every segment is walkable on
 * the server. A shortcut is only taken when it costs no more than the cells it
 * replaces, so smoothing never drags a route off the road.
 *
 * The grid is built lazily on first use: buildings are stamped in
 * via their bounding boxes, roads are traced along their segments, so we never
 * test all ~800k cells one by one.
 */
import { AREAS, BUILDINGS, MAP_HEIGHT_PX, MAP_WIDTH_PX, PX_PER_METER, ROADS, distSqToSegment, pointInPoly, type Point } from "./map";
import { PLAYER_RADIUS } from "./constants";
import { isBlocked, segmentClear } from "./movement";
import { STALLS } from "./interiors";
import { SOLIDS, solidBounds } from "./solids";

export type { Point };

const CELL = 2 * PX_PER_METER;
const GW = Math.ceil(MAP_WIDTH_PX / CELL);
const GH = Math.ceil(MAP_HEIGHT_PX / CELL);
/** Walking off-road costs far more, so routes follow roads and walkways. */
const OFFROAD_COST = 6;
const PAVED_COST = 1.5;
const ROAD_EDGE_COST = 1.6;
const DIRECT_WALK_PX = 15 * PX_PER_METER;
const WALK_SEGMENT_PX = 60 * PX_PER_METER;
const DRIVE_SEGMENT_PX = 45 * PX_PER_METER;
const PULL_WINDOW = 80;
const PULL_SLACK = 0.5;
const ROAD_SEARCH_CELLS = 220;
const WALK_MARGIN = 0.5;
const DRIVE_MARGIN = 0.35;
const SURFACE_ROAD = 1;
const SURFACE_PAVED = 2;
const PAVED_AREAS = new Set(["plaza", "parking"]);

let blocked: Uint8Array | null = null;
let stamped = -1;
let road: Uint8Array | null = null;
let drive: Uint8Array | null = null;
let bufs: { g: Float32Array; f: Float32Array; came: Int32Array; closed: Uint8Array } | null = null;

function buildGrid() {
  blocked = new Uint8Array(GW * GH);
  road = new Uint8Array(GW * GH);
  drive = new Uint8Array(GW * GH);
  const centre = (c: number) => (c + 0.5) * CELL;
  const stamp = (x0: number, y0: number, x1: number, y1: number) => {
    const cx0 = Math.max(0, Math.floor(x0 / CELL));
    const cy0 = Math.max(0, Math.floor(y0 / CELL));
    const cx1 = Math.min(GW - 1, Math.floor(x1 / CELL));
    const cy1 = Math.min(GH - 1, Math.floor(y1 / CELL));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * GW + cx;
        if (!blocked![i] && isBlocked(centre(cx), centre(cy))) blocked![i] = 1;
      }
  };
  const pad = PLAYER_RADIUS + CELL;
  for (const b of BUILDINGS) stamp(b.bbox.x - pad, b.bbox.y - pad, b.bbox.x + b.bbox.w + pad, b.bbox.y + b.bbox.h + pad);
  for (const s of STALLS) stamp(s.col.x - pad, s.col.y - pad, s.col.x + s.col.w + pad, s.col.y + s.col.h + pad);
  for (const solid of SOLIDS) {
    const b = solidBounds(solid);
    stamp(b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y1 + pad);
  }
  stamped = SOLIDS.length;
  // Map edges.
  for (let cx = 0; cx < GW; cx++) blocked[cx] = blocked[(GH - 1) * GW + cx] = 1;
  for (let cy = 0; cy < GH; cy++) blocked[cy * GW] = blocked[cy * GW + GW - 1] = 1;

  for (const a of AREAS) {
    if (!PAVED_AREAS.has(a.kind)) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < a.poly.length; i += 2) {
      x0 = Math.min(x0, a.poly[i]);
      x1 = Math.max(x1, a.poly[i]);
      y0 = Math.min(y0, a.poly[i + 1]);
      y1 = Math.max(y1, a.poly[i + 1]);
    }
    const cx0 = Math.max(0, Math.floor(x0 / CELL));
    const cx1 = Math.min(GW - 1, Math.floor(x1 / CELL));
    const cy0 = Math.max(0, Math.floor(y0 / CELL));
    const cy1 = Math.min(GH - 1, Math.floor(y1 / CELL));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) if (pointInPoly(centre(cx), centre(cy), a.poly)) road[cy * GW + cx] = SURFACE_PAVED;
  }

  // Trace roads into the cheap-cost layer.
  for (const r of ROADS) {
    const half = r.width / 2;
    const walkReach = (half + CELL * WALK_MARGIN) ** 2;
    const driveReach = r.kind === "road" ? (half + CELL * DRIVE_MARGIN) ** 2 : -1;
    const pad = half + CELL;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
      const cx0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad) / CELL));
      const cx1 = Math.min(GW - 1, Math.floor((Math.max(ax, bx) + pad) / CELL));
      const cy0 = Math.max(0, Math.floor((Math.min(ay, by) - pad) / CELL));
      const cy1 = Math.min(GH - 1, Math.floor((Math.max(ay, by) + pad) / CELL));
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const d = distSqToSegment(centre(cx), centre(cy), ax, ay, bx, by);
          if (d <= walkReach) road[cy * GW + cx] = SURFACE_ROAD;
          if (d <= driveReach) drive[cy * GW + cx] = 1;
        }
    }
  }
  keepMainRoadNetwork();
}

function keepMainRoadNetwork() {
  const N = GW * GH;
  const label = new Int32Array(N);
  const stack: number[] = [];
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let i = 0; i < N; i++) {
    if (!drive![i] || blocked![i] || label[i]) continue;
    const id = ++next;
    let size = 0;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const cx = c % GW;
      const cy = (c / GW) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const ni = ny * GW + nx;
          if (!drive![ni] || blocked![ni] || label[ni]) continue;
          if (dx && dy && (blocked![cy * GW + nx] || blocked![ny * GW + cx])) continue;
          label[ni] = id;
          stack.push(ni);
        }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }
  for (let i = 0; i < N; i++) drive![i] = label[i] === best && best ? 1 : 0;
}

const walkCost = (i: number) => (road![i] === SURFACE_ROAD ? 1 : road![i] === SURFACE_PAVED ? PAVED_COST : OFFROAD_COST);

function driveCost(i: number) {
  const cx = i % GW;
  const cy = (i / GW) | 0;
  const inner = cx > 0 && cy > 0 && cx < GW - 1 && cy < GH - 1 && drive![i - 1] && drive![i + 1] && drive![i - GW] && drive![i + GW];
  return inner ? 1 : ROAD_EDGE_COST;
}

const toCell = (v: number) => Math.floor(v / CELL);

/** Nearest open cell to (cx, cy), searching outward in rings. */
function nearestOpen(cx: number, cy: number, only: Uint8Array | null = null, reach = 40): [number, number] | null {
  for (let r = 0; r < reach; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue; // ring only
        if (x < 0 || y < 0 || x >= GW || y >= GH || blocked![y * GW + x]) continue;
        if (only && !only[y * GW + x]) continue;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    if (best) return best;
  }
  return null;
}

/** Binary min-heap of cell indices keyed by an external score array. */
class Heap {
  private a: number[] = [];
  constructor(private score: Float32Array) {}
  get size() {
    return this.a.length;
  }
  push(i: number) {
    const a = this.a;
    const s = this.score;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (s[a[p]] <= s[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.a;
    const s = this.score;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < a.length && s[a[l]] < s[a[m]]) m = l;
        if (r < a.length && s[a[r]] < s[a[m]]) m = r;
        if (m === c) break;
        [a[m], a[c]] = [a[c], a[m]];
        c = m;
      }
    }
    return top;
  }
}

type Cell = [number, number];

function search(start: Cell, goal: Cell, roadsOnly: boolean): number[] {
  // Search buffers are reused between routes (the grid has ~2M cells; don't reallocate on phones).
  if (!bufs) {
    const N = GW * GH;
    bufs = { g: new Float32Array(N), f: new Float32Array(N), came: new Int32Array(N), closed: new Uint8Array(N) };
  }
  const { g, f, came, closed } = bufs;
  g.fill(Infinity);
  f.fill(Infinity);
  came.fill(-1);
  closed.fill(0);
  const open = new Heap(f);
  const [gx, gy] = goal;
  const h = (i: number) => {
    const dx = Math.abs((i % GW) - gx);
    const dy = Math.abs(((i / GW) | 0) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); // octile, admissible (min cost 1)
  };
  const s = start[1] * GW + start[0];
  const gi = gy * GW + gx;
  g[s] = 0;
  f[s] = h(s);
  open.push(s);
  while (open.size) {
    const cur = open.pop();
    if (cur === gi) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % GW;
    const cy = (cur / GW) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const ni = ny * GW + nx;
        if (blocked![ni] || closed[ni]) continue;
        if (roadsOnly && !drive![ni]) continue;
        if (dx && dy && (blocked![cy * GW + nx] || blocked![ny * GW + cx])) continue; // no corner cutting
        const step = (dx && dy ? Math.SQRT2 : 1) * (roadsOnly ? driveCost(ni) : walkCost(ni));
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          f[ni] = ng + h(ni);
          came[ni] = cur;
          open.push(ni);
        }
      }
  }
  if (came[gi] === -1 && gi !== s) return [];
  const cells: number[] = [];
  for (let i = gi; i !== -1; i = came[i]) {
    cells.push(i);
    if (i === s) break;
  }
  return cells.reverse();
}

const cellPoint = (i: number): Point => ({ x: ((i % GW) + 0.5) * CELL, y: (((i / GW) | 0) + 0.5) * CELL });
const cellAt = (x: number, y: number) => Math.min(GH - 1, Math.max(0, toCell(y))) * GW + Math.min(GW - 1, Math.max(0, toCell(x)));

function lineCost(a: Point, b: Point, roadsOnly: boolean): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / (CELL / 2)));
  let cost = 0;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const i = cellAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (roadsOnly) {
      if (!drive![i] || blocked![i]) return Infinity;
      cost += driveCost(i);
    } else cost += walkCost(i);
  }
  return (cost / n) * (len / CELL);
}

function pull(from: Point, pts: Point[], roadsOnly: boolean): Point[] {
  if (!pts.length) return [];
  const maxSeg = roadsOnly ? DRIVE_SEGMENT_PX : WALK_SEGMENT_PX;
  const along = [0];
  for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + lineCost(pts[k - 1], pts[k], roadsOnly));
  const out: Point[] = [];
  let anchor: Point = from;
  let spent = lineCost(from, pts[0], roadsOnly);
  if (!Number.isFinite(spent)) spent = 0;
  let i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + PULL_WINDOW);
    for (; j > i; j--) {
      const p = pts[j];
      if (Math.hypot(p.x - anchor.x, p.y - anchor.y) > maxSeg) continue;
      if (lineCost(anchor, p, roadsOnly) > spent + along[j] - along[i] + PULL_SLACK) continue;
      if (roadsOnly || segmentClear(anchor.x, anchor.y, p.x, p.y)) break;
    }
    out.push(pts[j]);
    anchor = pts[j];
    spent = 0;
    i = j + 1;
    if (i < pts.length) spent = along[i] - along[j];
  }
  return out;
}

/**
 * Path from `from` to `to` (map px). Returns waypoints excluding the start,
 * ending at `to` (or the nearest reachable spot), or [] if unreachable.
 */
export function findPath(from: Point, to: Point): Point[] {
  if (Math.hypot(to.x - from.x, to.y - from.y) < DIRECT_WALK_PX && segmentClear(from.x, from.y, to.x, to.y)) return [to];
  if (!blocked || stamped !== SOLIDS.length) buildGrid();
  const start = nearestOpen(toCell(from.x), toCell(from.y));
  const goal = nearestOpen(toCell(to.x), toCell(to.y));
  if (!start || !goal) return [];
  const cells = search(start, goal, false).map(cellPoint);
  if (!cells.length) return [];
  const last = cells[cells.length - 1];
  if (!isBlocked(to.x, to.y) && segmentClear(last.x, last.y, to.x, to.y)) cells.push(to);
  return pull(from, cells, false);
}

export function pathLength(from: Point, path: readonly Point[]): number {
  let len = 0;
  let a = from;
  for (const b of path) {
    len += Math.hypot(b.x - a.x, b.y - a.y);
    a = b;
  }
  return len;
}

export function nearestRoadPoint(p: Point): Point | null {
  if (!blocked || stamped !== SOLIDS.length) buildGrid();
  const cell = nearestOpen(toCell(p.x), toCell(p.y), drive, ROAD_SEARCH_CELLS);
  return cell ? cellPoint(cell[1] * GW + cell[0]) : null;
}

export function isDrivable(x: number, y: number): boolean {
  if (!blocked || stamped !== SOLIDS.length) buildGrid();
  if (x < 0 || y < 0 || x >= MAP_WIDTH_PX || y >= MAP_HEIGHT_PX) return false;
  return drive![cellAt(x, y)] === 1;
}

export function isWalkway(x: number, y: number): boolean {
  if (!blocked || stamped !== SOLIDS.length) buildGrid();
  if (x < 0 || y < 0 || x >= MAP_WIDTH_PX || y >= MAP_HEIGHT_PX) return false;
  return road![cellAt(x, y)] !== 0;
}

export interface RoadPath {
  points: Point[];
  length: number;
}

export function findRoadPath(from: Point, to: Point): RoadPath | null {
  if (!blocked || stamped !== SOLIDS.length) buildGrid();
  const start = nearestOpen(toCell(from.x), toCell(from.y), drive, ROAD_SEARCH_CELLS);
  const goal = nearestOpen(toCell(to.x), toCell(to.y), drive, ROAD_SEARCH_CELLS);
  if (!start || !goal) return null;
  const first = cellPoint(start[1] * GW + start[0]);
  const cells = search(start, goal, true).map(cellPoint);
  if (!cells.length) return null;
  const points = [first, ...pull(first, cells.slice(1), true)];
  return { points, length: pathLength(first, points.slice(1)) };
}
