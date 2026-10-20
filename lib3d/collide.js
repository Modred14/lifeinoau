// lib3d/collide.js
// What is solid, and how to move through it. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
// Everything is EXACT geometry in metres (x east, z south), not a grid: building and water outlines are kept as their real edges in a spatial hash,
// walls and posts are edges too, and vehicles are oriented boxes that move every frame. A person is a circle.
//   pushOut()      moves a circle out of whatever it overlaps (deep inside a building too) and says which way it was pushed
//   moveCircle()   moves a circle by a step, in small sub-steps so it can never skip through a wall, sliding along what it touches
//   segmentClear() can a circle of radius r travel straight from a to b?
//   raycast()      where does a line first hit a wall? (the camera uses this so it does not end up inside a building)
//   sdf()          signed distance to the nearest static solid (negative inside)
// Vehicles are registered with setBody(); walkers collide with them, with an `ignore` list for the one vehicle being boarded.

const KEY = (i, j) => i * 73856093 ^ j * 19349663;
const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };

export class CollisionWorld {
  constructor(cell = 12) {
    this.cell = cell; this.hash = new Map(); this.phash = new Map(); this.polys = []; this.E = []; this.bodies = new Map(); this.stamp = 0; this.sd = [];
  }
  /** A solid area (a building, a lake). `pts` is a ring of [x, z]. */
  addPolygon(pts, tag = null) {
    if (pts.length < 3) return -1;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const pi = this.polys.length, first = this.E.length; this.polys.push({ pts, tag, bb: [x0, z0, x1, z1], first, count: pts.length });
    for (let i = 0; i < pts.length; i++) this._edge(pts[i], pts[(i + 1) % pts.length], pi);
    const c = this.cell; for (let a = Math.floor(x0 / c); a <= Math.floor(x1 / c); a++) for (let b = Math.floor(z0 / c); b <= Math.floor(z1 / c); b++) { const k = KEY(a, b); if (!this.phash.has(k)) this.phash.set(k, []); this.phash.get(k).push(pi); }
    return pi;
  }
  /** A thin barrier with no inside (a wall, a fence). */
  addWall(ax, az, bx, bz, tag = null) { this._edge([ax, az], [bx, bz], -1, tag); }
  addRect(x0, z0, x1, z1, tag = null) { return this.addPolygon([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], tag); }
  /** A post or pole: a small octagon. */
  addPost(x, z, r, tag = null) { const p = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; p.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return this.addPolygon(p, tag); }
  _edge(a, b, poly, tag = null) {
    const id = this.E.length; this.E.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], poly, tag }); this.sd.push(0);
    const c = this.cell, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) { const k = KEY(i, j); if (!this.hash.has(k)) this.hash.set(k, []); this.hash.get(k).push(id); }
  }

  // ---- vehicles and other moving boxes ----
  /** Registers or moves a box: centre (x, z), heading (hx, hz), half length hl along the heading, half width hw across it. */
  setBody(id, b) { const o = this.bodies.get(id); if (o) Object.assign(o, b); else this.bodies.set(id, { id, ...b }); }
  removeBody(id) { this.bodies.delete(id); }

  // ---- queries ----
  /** Calls fn(edgeIndex) once for every static edge in the cells around (x, z) within r. */
  _near(x, z, r, fn) {
    const c = this.cell, st = ++this.stamp;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) { const l = this.hash.get(KEY(i, j)); if (!l) continue; for (const id of l) { if (this._seen?.[id] === st) continue; (this._seen ??= new Int32Array(1 << 20))[id] = st; fn(id); } }
  }
  /** Index of the solid polygon containing (x, z), or -1. */
  inside(x, z) { const l = this.phash.get(KEY(Math.floor(x / this.cell), Math.floor(z / this.cell))); if (!l) return -1; for (const pi of l) { const p = this.polys[pi], b = p.bb; if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && inPoly(x, z, p.pts)) return pi; } return -1; }
  _seg(e, x, z) { const dx = e.bx - e.ax, dz = e.bz - e.az, l2 = dx * dx + dz * dz || 1; let t = ((x - e.ax) * dx + (z - e.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const px = e.ax + dx * t, pz = e.az + dz * t; return [Math.hypot(x - px, z - pz), px, pz, t]; }
  /** Signed distance to the nearest static solid within `max` metres: negative inside, `max` if none is near. */
  sdf(x, z, max = 40) {
    const pi = this.inside(x, z);
    if (pi >= 0) { const p = this.polys[pi]; let best = 1e9; for (let k = 0; k < p.count; k++) best = Math.min(best, this._seg(this.E[p.first + k], x, z)[0]); return -best; }
    let best = max; this._near(x, z, max, (id) => { const d = this._seg(this.E[id], x, z)[0]; if (d < best) best = d; }); return best;
  }
  /** True if a circle of radius r at (x, z) touches a static solid. */
  blockedAt(x, z, r = 0) { if (this.inside(x, z) >= 0) return true; let hit = false; this._near(x, z, r, (id) => { if (!hit && this._seg(this.E[id], x, z)[0] < r) hit = true; }); return hit; }
  /** Does a vehicle-sized box (three circles along its length) touch a static solid? */
  boxBlocked(x, z, hx, hz, hl, hw, margin = 0) { const r = hw + margin, n = Math.max(2, Math.ceil((2 * hl) / (hw * 1.5))); for (let i = 0; i < n; i++) { const u = -hl + hw + (i * (2 * hl - 2 * hw)) / (n - 1); if (this.blockedAt(x + hx * u, z + hz * u, r)) return true; } return false; }

  /** Pushes a circle (x, z, r) out of everything solid. Returns { x, z, hit, nx, nz } (nx, nz is the average direction it was pushed). */
  pushOut(x, z, r, { ignore = null, bodies = true } = {}) {
    let nx = 0, nz = 0, hit = false;
    for (let it = 0; it < 5; it++) {
      let moved = false; const pi = this.inside(x, z);
      if (pi >= 0) { // deep inside: go to the nearest edge of that solid and out the other side
        const p = this.polys[pi]; let best = null; for (let k = 0; k < p.count; k++) { const q = this._seg(this.E[p.first + k], x, z); if (!best || q[0] < best[0]) best = q; }
        let ux = best[1] - x, uz = best[2] - z; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; x = best[1] + ux * (r + 0.002); z = best[2] + uz * (r + 0.002); nx += ux; nz += uz; hit = moved = true; continue;
      }
      this._near(x, z, r, (id) => { const e = this.E[id], q = this._seg(e, x, z); if (q[0] >= r) return; let ux, uz; if (q[0] > 1e-6) { ux = (x - q[1]) / q[0]; uz = (z - q[2]) / q[0]; } else { const dx = e.bx - e.ax, dz = e.bz - e.az, l = Math.hypot(dx, dz) || 1; ux = -dz / l; uz = dx / l; } const pen = r - q[0] + 0.001; x += ux * pen; z += uz * pen; nx += ux; nz += uz; hit = moved = true; });
      if (bodies) for (const b of this.bodies.values()) {
        if (ignore && ignore.has(b.id)) continue; const rx = -b.hz, rz = b.hx, dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz > (b.hl + b.hw + r + 1) ** 2) continue;
        const u = dx * b.hx + dz * b.hz, w = dx * rx + dz * rz, cu = Math.max(-b.hl, Math.min(b.hl, u)), cw = Math.max(-b.hw, Math.min(b.hw, w)); let ux, uz, pen;
        if (Math.abs(u) < b.hl && Math.abs(w) < b.hw) { const pu = b.hl - Math.abs(u), pw = b.hw - Math.abs(w); if (pu < pw) { ux = Math.sign(u) * b.hx; uz = Math.sign(u) * b.hz; pen = pu + r; } else { ux = Math.sign(w) * rx; uz = Math.sign(w) * rz; pen = pw + r; } }
        else { const du = u - cu, dw = w - cw, d = Math.hypot(du, dw); if (d >= r) continue; ux = (du * b.hx + dw * rx) / (d || 1); uz = (du * b.hz + dw * rz) / (d || 1); pen = r - d; }
        x += ux * (pen + 0.001); z += uz * (pen + 0.001); nx += ux; nz += uz; hit = moved = true;
      }
      if (!moved) break;
    }
    const l = Math.hypot(nx, nz); return { x, z, hit, nx: l ? nx / l : 0, nz: l ? nz / l : 0 };
  }

  /**
   * Moves a circle by (dx, dz), in sub-steps no longer than half its radius so it cannot tunnel through a thin wall, sliding along what it touches
   * (the part of the step that pushes into a wall is dropped, the part along it kept). Returns { x, z, hit, nx, nz, moved }.
   */
  moveCircle(x, z, dx, dz, r, opts) {
    const len = Math.hypot(dx, dz), n = Math.max(1, Math.min(60, Math.ceil(len / (r * 0.5)))); let sx = dx / n, sz = dz / n, hit = false, nx = 0, nz = 0, m = 0; const x0 = x, z0 = z;
    for (let i = 0; i < n; i++) {
      x += sx; z += sz; const p = this.pushOut(x, z, r, opts);
      if (p.hit) { x = p.x; z = p.z; hit = true; nx = p.nx; nz = p.nz; const dot = sx * p.nx + sz * p.nz; if (dot < 0) { sx -= dot * p.nx; sz -= dot * p.nz; } }
    }
    m = Math.hypot(x - x0, z - z0); return { x, z, hit, nx, nz, moved: m };
  }
  /** Can a circle of radius r go straight from a to b without touching anything solid? */
  segmentClear(ax, az, bx, bz, r, opts) {
    const l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / Math.max(0.2, r * 0.5)));
    for (let i = 0; i <= n; i++) { const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n; if (this.blockedAt(x, z, r)) return false; if (opts?.bodies !== false) for (const b of this.bodies.values()) { if (opts?.ignore?.has(b.id)) continue; if (circleHitsBody(x, z, r, b)) return false; } }
    return true;
  }
  /** Parameter t in [0, 1] where the segment a->b first meets a static edge, or null. */
  raycast(ax, az, bx, bz) {
    const l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / (this.cell * 0.5))); let best = null; const seen = new Set();
    for (let i = 0; i <= n; i++) { const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n, c = this.cell;
      for (let a = Math.floor(x / c) - 0; a <= Math.floor(x / c); a++) for (let b = Math.floor(z / c); b <= Math.floor(z / c); b++) for (const id of this.hash.get(KEY(a, b)) ?? []) { if (seen.has(id)) continue; seen.add(id); const e = this.E[id], t = segHit(ax, az, bx, bz, e.ax, e.az, e.bx, e.bz); if (t != null && (best == null || t < best)) best = t; } }
    return best;
  }
}

function segHit(ax, az, bx, bz, cx, cz, dx, dz) { const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx; if (Math.abs(den) < 1e-12) return null; const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null; }

/** Does a circle overlap an oriented box? */
export function circleHitsBody(x, z, r, b) { const dx = x - b.x, dz = z - b.z, u = dx * b.hx + dz * b.hz, w = dx * -b.hz + dz * b.hx, cu = Math.max(-b.hl, Math.min(b.hl, u)), cw = Math.max(-b.hw, Math.min(b.hw, w)); return Math.hypot(u - cu, w - cw) < r; }

/** Do two oriented boxes ({x, z, hx, hz, hl, hw}) overlap? (separating axis test; `margin` shrinks it, so touching does not count) */
export function boxesOverlap(a, b, margin = 0) {
  const axes = [[a.hx, a.hz], [-a.hz, a.hx], [b.hx, b.hz], [-b.hz, b.hx]];
  const proj = (o, ax) => { const c = o.x * ax[0] + o.z * ax[1], e = o.hl * Math.abs(o.hx * ax[0] + o.hz * ax[1]) + o.hw * Math.abs(-o.hz * ax[0] + o.hx * ax[1]); return [c - e, c + e]; };
  for (const ax of axes) { const p = proj(a, ax), q = proj(b, ax); if (p[1] - margin <= q[0] || q[1] - margin <= p[0]) return false; } return true;
}

/**
 * Everything solid on the campus, from the map data: every building and lake outline, plus the walls, stage, stands and posts of the two game
 * grounds (mapExtras.js). `data` is the merged map ({ buildings, areas.water, grounds }).
 */
export function buildWorldCollision(data) {
  const w = new CollisionWorld();
  for (const b of data.buildings) w.addPolygon(b.pts, { kind: "building", id: b.id });
  for (const a of data.areas?.water ?? []) w.addPolygon(a.pts, { kind: "water" });
  const G = data.grounds;
  if (G?.religious) { const r = G.religious, cx = r.gate ?? (r.x0 + r.x1) / 2, t = 0.8, solid = (x0, z0, x1, z1, tag) => w.addRect(x0, z0, x1, z1, { kind: tag });
    solid(r.x0, r.z0, cx - 4, r.z0 + t, "wall"); solid(cx + 4, r.z0, r.x1, r.z0 + t, "wall"); solid(r.x0, r.z1 - t, r.x1, r.z1, "wall"); solid(r.x0, r.z0, r.x0 + t, r.z1, "wall"); solid(r.x1 - t, r.z0, r.x1, r.z1, "wall");
    for (const dx of [-4, 4]) solid(cx + dx - 0.7, r.z0 - 0.3, cx + dx + 0.7, r.z0 + 1.1, "pillar"); solid(cx - 1.5, 201.5, cx + 1.5, 204.5, "cross"); }
  if (G?.motion) { const m = G.motion, cx = (m.x0 + m.x1) / 2, width = m.x1 - m.x0, sw = 20, sd = 7, sz = m.z0 + 2 + sd / 2;
    w.addRect(cx - sw / 2, sz - sd / 2, cx + sw / 2, sz + sd / 2, { kind: "stage" });
    for (const dx of [-sw / 2 - 2.2, sw / 2 + 2.2]) w.addRect(cx + dx - 1, sz - 1, cx + dx + 1, sz + 1, { kind: "speaker" });
    w.addRect(cx - (width - 10) / 2, m.z1 + 2.9, cx + (width - 10) / 2, m.z1 + 4.2 + 2.6 * 2 + 1.3, { kind: "stands" });
    for (const [x, z] of [[m.x0 - 2, m.z0 - 2], [m.x1 + 2, m.z0 - 2], [m.x0 - 2, m.z1 + 2], [m.x1 + 2, m.z1 + 2]]) w.addPost(x, z, 0.4, { kind: "floodlight" }); }
  return w;
}