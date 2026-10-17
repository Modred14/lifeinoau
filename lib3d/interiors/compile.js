// lib3d/interiors/compile.js
// Turns a plan (rooms, doors, items; see plans.js) into what the scene needs: wall pieces, floors, ceilings, stairs, solid colliders and a walkable
// navigation grid per floor. Pure functions, no 3D library, so Node tests can check every interior for blocked doors and unreachable rooms.
//
// Coordinates: metres, x east, z south, y up. A plan's ground floor is y = 0; the upper floor (if any) stands on a slab at y = floorH + SLAB.

import { dimsOf, footprint } from "./items.js";

export const SLAB = 0.2, WALL_IN = 0.1, WALL_OUT = 0.12, WALL_COLLIDE = 0.3, DOOR_H = 2.25, PLAYER_R = 0.28, NPC_R = 0.3, CELL = 0.4, PORCH_D = 3.2, EXIT_DEPTH = 1.3;
const EPS = 0.02;

const SIDES = {
  n: { axis: "x", inward: [0, 1] }, s: { axis: "x", inward: [0, -1] },
  w: { axis: "z", inward: [1, 0] }, e: { axis: "z", inward: [-1, 0] },
};
const lineOf = (r, s) => (s === "n" ? r.z0 : s === "s" ? r.z1 : s === "w" ? r.x0 : r.x1);
const spanOf = (r, s) => (SIDES[s].axis === "x" ? [r.x0, r.x1] : [r.z0, r.z1]);

export function compile(plan) {
  const floors = plan.floors ?? 1, floorH = plan.floorH ?? 3.4, floorY = [0]; for (let f = 1; f < floors; f++) floorY.push(f * (floorH + SLAB));
  const rooms = plan.rooms.map((r) => ({ surface: "tile", ...r, h: r.h ?? floorH }));
  const byId = new Map(rooms.map((r) => [r.id, r])); if (byId.size !== rooms.length) throw new Error("duplicate room id in " + plan.id);
  const inRoom = (r, x, z, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
  const roomAt = (x, z, floor) => rooms.find((r) => r.floor === floor && inRoom(r, x, z)) ?? null;
  const occupied = (x, z, floor) => rooms.some((r) => r.floor === floor && inRoom(r, x, z));
  const stairs = (plan.stairs ?? []).map((s) => ({ ...s, y1: floorY[1] ?? floorH + SLAB }));
  const ent = plan.entrance ? { ...plan.entrance, floor: 0 } : null;

  // ---------- openings in walls ----------
  const openingsFor = (room, side) => {
    const line = lineOf(room, side), axis = SIDES[side].axis, out = [];
    for (const d of plan.doors ?? []) if (d.floor === room.floor && d.axis === axis && Math.abs(d.coord - line) < EPS && (d.a === room.id || d.b === room.id)) out.push([d.pos - d.w / 2, d.pos + d.w / 2, d]);
    if (ent && ent.room === room.id && ent.side === side) out.push([ent.pos - ent.w / 2, ent.pos + ent.w / 2, ent]);
    return out.sort((p, q) => p[0] - q[0]);
  };

  // ---------- walls, lintels, windows ----------
  const solids = [], colliders = [], windows = [], frames = [], seen = new Set();
  const addCollider = (c) => { const k = [c.x0, c.z0, c.x1, c.z1, c.fl].map((v) => v.toFixed(2)).join(); if (seen.has(k)) return; seen.add(k); colliders.push(c); };
  for (const room of rooms) for (const side of ["n", "s", "w", "e"]) {
    const line = lineOf(room, side), [a0, a1] = spanOf(room, side), { axis, inward } = SIDES[side], ops = openingsFor(room, side), y0 = floorY[room.floor], H = room.open ? 1.1 : room.h;
    // wall pieces: the span minus the openings
    const pieces = []; let cur = a0; for (const [o0, o1] of ops) { if (o0 > cur + 0.005) pieces.push([cur, Math.min(o0, a1)]); cur = Math.max(cur, o1); } if (cur < a1 - 0.005) pieces.push([cur, a1]);
    for (const [p0, p1] of pieces) {
      // split into chunks so the outer facade layer is only drawn where nothing is next door
      const n = Math.max(1, Math.ceil((p1 - p0) / 0.5)); let runStart = p0, runExt = null;
      const flush = (end) => { if (runExt == null || end - runStart < 0.005) return; box(runStart, end, runExt); };
      const mid = (a, b) => (a + b) / 2;
      const box = (s0, s1, ext) => {
        const len = s1 - s0, m = mid(s0, s1);
        const put = (off, thick, kind, color) => { const c = axis === "x" ? { x: m, z: line + inward[1] * off } : { x: line + inward[0] * off, z: m }; solids.push({ floor: room.floor, x: c.x, z: c.z, w: axis === "x" ? len : thick, d: axis === "x" ? thick : len, y0, y1: y0 + H, kind, color, room: room.id }); };
        put(WALL_IN / 2, WALL_IN, "wall", room.wall ?? plan.style?.wall ?? "#e8e2d2");
        if (ext && !room.open) put(-WALL_OUT / 2, WALL_OUT, "facade", plan.style?.facade ?? "#d8cdb2");
      };
      for (let i = 0; i < n; i++) { const s0 = p0 + ((p1 - p0) * i) / n, s1 = p0 + ((p1 - p0) * (i + 1)) / n, m = mid(s0, s1), px = axis === "x" ? m : line - inward[0] * 0.2, pz = axis === "x" ? line - inward[1] * 0.2 : m, ext = !occupied(px, pz, room.floor);
        if (runExt === null) { runStart = s0; runExt = ext; } else if (ext !== runExt) { flush(s0); runStart = s0; runExt = ext; } }
      flush(p1);
      // collision: one slab centred on the line (open yards and fences are solid too)
      const t = WALL_COLLIDE / 2; addCollider(axis === "x" ? { x0: p0, x1: p1, z0: line - t, z1: line + t, fl: room.floor, kind: "wall" } : { x0: line - t, x1: line + t, z0: p0, z1: p1, fl: room.floor, kind: "wall" });
      // windows on outside walls
      if (!room.open && !plan.style?.noWindows && room.kind !== "stair") for (let s0 = p0 + 1.2; s0 + 1.4 <= p1 - 0.6; s0 += 2.6) { const m = s0 + 0.7, px = axis === "x" ? m : line - inward[0] * 0.2, pz = axis === "x" ? line - inward[1] * 0.2 : m; if (occupied(px, pz, room.floor)) continue; windows.push({ floor: room.floor, axis, inward, x: axis === "x" ? m : line, z: axis === "x" ? line : m, y: y0 + 1.0, w: 1.4, h: Math.min(1.2, H - 1.5), room: room.id }); }
    }
    // lintels above doorways
    for (const [o0, o1, d] of ops) { const m = (o0 + o1) / 2, len = o1 - o0, top = y0 + H; if (top - (y0 + DOOR_H) > 0.02) solids.push({ floor: room.floor, x: axis === "x" ? m : line, z: axis === "x" ? line : m, w: axis === "x" ? len : 0.2, d: axis === "x" ? 0.2 : len, y0: y0 + DOOR_H, y1: top, kind: "lintel", color: room.wall ?? plan.style?.wall ?? "#e8e2d2", room: room.id });
      if (room.id === (d.a ?? d.room)) frames.push({ floor: room.floor, axis, x: axis === "x" ? m : line, z: axis === "x" ? line : m, w: len, y: y0, entrance: d === ent }); }
  }

  // ---------- floors, ceilings ----------
  const floorsOut = [], ceilings = [];
  for (const r of rooms) {
    const y = floorY[r.floor];
    if (r.kind === "stair" && r.floor > 0) continue; // the stairwell is open down to the ground floor
    floorsOut.push({ room: r.id, floor: r.floor, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, y, surface: r.surface, color: r.color, slab: r.floor > 0 });
    if (!r.open && !(r.kind === "stair" && r.floor === 0 && floors > 1)) ceilings.push({ room: r.id, floor: r.floor, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, y: y + r.h, color: r.ceil ?? plan.style?.ceil ?? "#f1eee6", lit: r.lights !== false, kind: r.kind });
  }

  // ---------- entrance, porch, spawn ----------
  let porch = null, spawn = { x: rooms[0].x0 + 1, z: rooms[0].z0 + 1, yaw: 0, floor: 0 };
  if (ent) {
    const room = byId.get(ent.room), side = ent.side, { axis, inward } = SIDES[side], line = lineOf(room, side), out = [-inward[0], -inward[1]], half = ent.w / 2 + 1.3;
    const rect = axis === "x" ? { x0: ent.pos - half, x1: ent.pos + half, z0: Math.min(line, line + out[1] * PORCH_D), z1: Math.max(line, line + out[1] * PORCH_D) } : { x0: Math.min(line, line + out[0] * PORCH_D), x1: Math.max(line, line + out[0] * PORCH_D), z0: ent.pos - half, z1: ent.pos + half };
    const t = WALL_COLLIDE / 2, fence = [];
    if (axis === "x") { fence.push({ x0: rect.x0 - t, x1: rect.x0 + t, z0: rect.z0, z1: rect.z1 }, { x0: rect.x1 - t, x1: rect.x1 + t, z0: rect.z0, z1: rect.z1 }, out[1] > 0 ? { x0: rect.x0, x1: rect.x1, z0: rect.z1 - t, z1: rect.z1 + t } : { x0: rect.x0, x1: rect.x1, z0: rect.z0 - t, z1: rect.z0 + t }); }
    else { fence.push({ z0: rect.z0 - t, z1: rect.z0 + t, x0: rect.x0, x1: rect.x1 }, { z0: rect.z1 - t, z1: rect.z1 + t, x0: rect.x0, x1: rect.x1 }, out[0] > 0 ? { z0: rect.z0, z1: rect.z1, x0: rect.x1 - t, x1: rect.x1 + t } : { z0: rect.z0, z1: rect.z1, x0: rect.x0 - t, x1: rect.x0 + t }); }
    for (const f of fence) addCollider({ ...f, fl: 0, kind: "fence" });
    porch = { rect, fence, side, out, line, pos: ent.pos, w: ent.w, axis, canopy: 3.0 };
    spawn = { x: axis === "x" ? ent.pos : line + inward[0] * 1.6, z: axis === "x" ? line + inward[1] * 1.6 : ent.pos, yaw: Math.atan2(inward[0], inward[1]), floor: 0 };
  }
  /** How far outside the doorway a point is (metres, negative while still inside). Walking past EXIT_DEPTH leaves the building. */
  const outsideDepth = (x, z) => (porch ? (porch.axis === "x" ? (z - porch.line) * porch.out[1] : (x - porch.line) * porch.out[0]) : -9);

  // ---------- items -> colliders ----------
  const items = (plan.items ?? []).map((it, i) => ({ ry: 0, floor: 0, ...it, id: i }));
  for (const it of items) { const d = dimsOf(it); if (!d.solid) continue; const f = footprint(it), k = 0.02; addCollider({ x0: f.x0 + k, x1: f.x1 - k, z0: f.z0 + k, z1: f.z1 - k, fl: it.floor, kind: "item", item: it.id }); }

  // ---------- stairs ----------
  for (const s of stairs) { const dx = s.dir === "+x" ? 1 : s.dir === "-x" ? -1 : 0, dz = s.dir === "+z" ? 1 : s.dir === "-z" ? -1 : 0; s.dx = dx; s.dz = dz; s.len = dx ? s.x1 - s.x0 : s.z1 - s.z0; }
  const rampAt = (x, z) => { for (const s of stairs) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) { const t = s.dx ? (s.dx > 0 ? (x - s.x0) / s.len : (s.x1 - x) / s.len) : (s.dz > 0 ? (z - s.z0) / s.len : (s.z1 - z) / s.len); return { stair: s, t: Math.max(0, Math.min(1, t)), y: s.y1 * Math.max(0, Math.min(1, t)) }; } return null; };

  // ---------- bounds ----------
  const bounds = rooms.reduce((b, r) => ({ x0: Math.min(b.x0, r.x0), z0: Math.min(b.z0, r.z0), x1: Math.max(b.x1, r.x1), z1: Math.max(b.z1, r.z1) }), { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity });
  if (porch) { bounds.x0 = Math.min(bounds.x0, porch.rect.x0); bounds.x1 = Math.max(bounds.x1, porch.rect.x1); bounds.z0 = Math.min(bounds.z0, porch.rect.z0); bounds.z1 = Math.max(bounds.z1, porch.rect.z1); }

  const byFloor = Array.from({ length: floors }, (_, f) => colliders.filter((c) => c.fl === f)), wallsByFloor = byFloor.map((l) => l.filter((c) => c.kind === "wall" || c.kind === "fence"));
  const out = { plan, id: plan.id, floors, floorH, floorY, rooms, byId, solids, windows, frames, floorsOut, ceilings, porch, spawn, items, stairs, colliders, byFloor, wallsByFloor, bounds, roomAt, rampAt, outsideDepth, ent, hubs: plan.hubs ?? [], npcs: plan.npcs ?? [] };
  out.nav = Array.from({ length: floors }, (_, f) => buildNav(out, f, NPC_R));
  out.navPlayer = Array.from({ length: floors }, (_, f) => buildNav(out, f, PLAYER_R + 0.07));
  out.reach = reachability(out);
  out.spots = spotsOf(out);
  return out;
}

// -------------------------------------------------------------------------------------------- navigation

/** A grid of walkable cells for one floor. A cell is free if its centre is in a room (or on the stairs) and farther than `r` from every collider. */
export function buildNav(c, floor, r) {
  const b = c.bounds, x0 = b.x0 - 0.5, z0 = b.z0 - 0.5, nx = Math.ceil((b.x1 - b.x0 + 1) / CELL), nz = Math.ceil((b.z1 - b.z0 + 1) / CELL), free = new Uint8Array(nx * nz), cols = c.byFloor[floor] ?? [];
  const stairRects = c.stairs;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * CELL, z = z0 + (j + 0.5) * CELL; let ok = c.rooms.some((q) => q.floor === floor && x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) || stairRects.some((s) => x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1);
    if (ok) for (const q of cols) { const dx = Math.max(q.x0 - x, 0, x - q.x1), dz = Math.max(q.z0 - z, 0, z - q.z1); if (dx * dx + dz * dz < r * r) { ok = false; break; } }
    free[j * nx + i] = ok ? 1 : 0;
  }
  const cell = (x, z) => [Math.floor((x - x0) / CELL), Math.floor((z - z0) / CELL)], at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < nz && free[j * nx + i] === 1);
  const centre = (i, j) => [x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL];
  const isFree = (x, z) => { const [i, j] = cell(x, z); return at(i, j); };
  /** The nearest free cell to a point (search in growing squares). */
  const snap = (x, z) => { const [i0, j0] = cell(x, z); for (let d = 0; d < 12; d++) { let best = null, bd = Infinity; for (let j = j0 - d; j <= j0 + d; j++) for (let i = i0 - d; i <= i0 + d; i++) { if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== d || !at(i, j)) continue; const [cx, cz] = centre(i, j), q = (cx - x) ** 2 + (cz - z) ** 2; if (q < bd) { bd = q; best = [cx, cz]; } } if (best) return best; } return null; };
  const los = (ax, az, bx, bz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5)); for (let k = 0; k <= n; k++) { const t = k / n; if (!isFree(ax + (bx - ax) * t, az + (bz - az) * t)) return false; } return true; };
  /** A* over the free cells (8 neighbours, no corner cutting), then straightened. Returns [[x,z],...] or null. */
  const path = (ax, az, bx, bz) => {
    const A = snap(ax, az), Bp = snap(bx, bz); if (!A || !Bp) return null; const [si, sj] = cell(A[0], A[1]), [ti, tj] = cell(Bp[0], Bp[1]); const key = (i, j) => j * nx + i, g = new Map([[key(si, sj), 0]]), from = new Map(), open = [[0, si, sj]], done = new Set();
    const h = (i, j) => Math.hypot(i - ti, j - tj);
    while (open.length) { let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k; const [, i, j] = open.splice(bi, 1)[0], k0 = key(i, j); if (done.has(k0)) continue; done.add(k0); if (i === ti && j === tj) break;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (!at(ni, nj)) continue; if (di && dj && (!at(i + di, j) || !at(i, j + dj))) continue; const nk = key(ni, nj), ng = g.get(k0) + (di && dj ? 1.4142 : 1); if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); from.set(nk, k0); open.push([ng + h(ni, nj), ni, nj]); } } }
    const goal = key(ti, tj); if (!g.has(goal)) return null; const cells = []; for (let k = goal; k !== undefined; k = from.get(k)) cells.push(k); cells.reverse();
    const pts = cells.map((k) => centre(k % nx, Math.floor(k / nx))); const out = [pts[0]]; let a = 0; while (a < pts.length - 1) { let b = pts.length - 1; while (b > a + 1 && !los(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--; out.push(pts[b]); a = b; } return out;
  };
  return { x0, z0, nx, nz, free, cell, centre, isFree, snap, path, los, at };
}

/** Which free cells can the player reach from the doorway, per floor (stairs join the floors). Used by tests and to place NPCs only where people can go. */
function reachability(c) {
  const out = c.nav.map((n) => new Uint8Array(n.nx * n.nz)), flood = (n, seen, seeds) => { const q = [...seeds]; for (const [i, j] of seeds) seen[j * n.nx + i] = 1; while (q.length) { const [i, j] = q.pop(); for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (n.at(a, b) && !seen[b * n.nx + a]) { seen[b * n.nx + a] = 1; q.push([a, b]); } } } };
  const n0 = c.navPlayer[0], s0 = n0.snap(c.spawn.x, c.spawn.z), seeds0 = []; if (s0) seeds0.push(n0.cell(s0[0], s0[1])); out.player = c.navPlayer.map((n) => new Uint8Array(n.nx * n.nz));
  flood(n0, out.player[0], seeds0);
  for (let f = 1; f < c.floors; f++) { const n = c.navPlayer[f], seeds = []; for (const s of c.stairs) for (let j = 0; j < n.nz; j++) for (let i = 0; i < n.nx; i++) { const [x, z] = n.centre(i, j); if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && out.player[f - 1][j * n.nx + i] && n.at(i, j)) seeds.push([i, j]); } flood(n, out.player[f], seeds); }
  return out.player;
}

/** Standing spots for NPCs: free, reachable cells inside each room, away from walls, about 1.6 m apart. */
function spotsOf(c) {
  const spots = new Map();
  for (const r of c.rooms) { const n = c.nav[r.floor], rp = c.reach[r.floor], list = []; if (r.kind === "stair") continue;
    for (let z = r.z0 + 0.7; z <= r.z1 - 0.7; z += 1.6) for (let x = r.x0 + 0.7; x <= r.x1 - 0.7; x += 1.6) { const [i, j] = n.cell(x, z); if (n.at(i, j) && rp[j * n.nx + i]) list.push([x, z]); }
    spots.set(r.id, list); }
  return spots;
}

// -------------------------------------------------------------------------------------------- movement helpers

/** Pushes a circle out of the colliders (walls, furniture). Works for any approach angle, so you slide along walls. */
export function pushOut(cols, x, z, r) {
  for (let pass = 0; pass < 3; pass++) { let moved = false;
    for (const q of cols) { const cx = Math.max(q.x0, Math.min(x, q.x1)), cz = Math.max(q.z0, Math.min(z, q.z1)), dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue; moved = true;
      if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; x += dx * k; z += dz * k; }
      else { const l = x - q.x0, rr = q.x1 - x, t = z - q.z0, b = q.z1 - z, m = Math.min(l, rr, t, b); if (m === l) x = q.x0 - r; else if (m === rr) x = q.x1 + r; else if (m === t) z = q.z0 - r; else z = q.z1 + r; } }
    if (!moved) break; }
  return [x, z];
}
/** First hit (0..1) of the segment a->b against the colliders in the XZ plane, or 1. Used to keep the camera out of walls. */
export function rayClip(cols, ax, az, bx, bz, pad = 0.2) {
  let best = 1; const dx = bx - ax, dz = bz - az;
  for (const q of cols) { let t0 = 0, t1 = 1; const x0 = q.x0 - pad, x1 = q.x1 + pad, z0 = q.z0 - pad, z1 = q.z1 + pad;
    for (const [p, d, lo, hi] of [[ax, dx, x0, x1], [az, dz, z0, z1]]) { if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 2; break; } continue; } let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { t0 = 2; break; } }
    if (t0 <= 1 && t0 < best && t0 >= 0) best = t0; }
  return best;
}

/**
 * One movement step of the player, the same code the 3D scene runs: move by (mx, mz) metres (keep each call under about 0.08 m), slide along
 * walls and furniture, ride the stair ramp, and switch floor when you are past halfway up. Changes and returns P = { x, z, y, fl }.
 */
export function movePlayer(c, P, mx, mz) {
  [P.x, P.z] = pushOut(c.byFloor[P.fl], P.x + mx, P.z + mz, PLAYER_R);
  const ramp = c.rampAt(P.x, P.z); P.y = ramp ? ramp.y : c.floorY[P.fl];
  const nf = c.floors > 1 && P.y > c.floorY[1] * 0.5 ? 1 : 0; if (nf !== P.fl) { P.fl = nf; if (!ramp) P.y = c.floorY[nf]; }
  return P;
}