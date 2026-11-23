// lib3d/homeLot.js
// Where a player's home compound stands ON THE MAP. The compound (lib/plot.js: lawn, house, garage, driveway, gates) is drawn in room cells; the map is in metres with a real road graph. A "lot" ties
// the two together: a spot beside a real road where the whole plot fits on bare ground, with the compound's vehicle gate opening straight onto that road's kerb, so a car rolls from the garage out
// through the gate onto the actual carriageway and a person walks out of the footgate onto the actual pavement. Nothing is pasted on: the lot is chosen from the same road graph and collision world the
// rest of the world is built from, so it never lies on a road, a building, water or a tree, and the same map data always gives the same lot (every player's browser agrees without a database).
// Pure JS (no three.js, no browser APIs): the tests use it, and lib3d/homeCompound.js draws and collides what it finds.
import { plotFor, PLOT_RULES } from "../lib/plot.js";
import { CELL_M } from "./compoundUnits.js";

const MARGIN_M = 1.6;    // bare ground wanted all round the fence (beyond the front, which is the road): a lane for neighbours, never a wall flush against a building
const GRID_M = 2.4;      // spacing of the ground samples
const STEP_S = 4;        // spacing of the stations tried along a road
const MIN_HALF = 4.0;    // never a lot on a footpath alley: only a road with a carriageway
const PICK_FROM = 12;    // the pick is among this many of the nearest lots (a seed spreads players over them)
const KEEP_APART = 20;   // two lots in the list are at least this far apart (m), so two different seeds are two different houses

/** Lot geometry for a room: where each corner of the plot (and the gate) is in the plot's own cells. Pure. */
export function lotShape(room) {
  const P = plotFor(room), a = { x: P.doorC, z: P.kerb }; // the anchor: the middle of the vehicle gate, on the carriageway's edge
  return { P, anchor: a, corners: [[P.plot.x0, P.plot.z0], [P.plot.x1, P.plot.z0], [P.plot.x1, P.plot.z1], [P.plot.x0, P.plot.z1]] };
}

/**
 * The frame of a lot: how plot cells map to world metres. `lot` is { x, z, dx, dz }: the anchor's position on the road edge, and the unit vector from the lot TOWARDS the road (the plot's +z).
 * Returns { toWorld(cx, cz) -> [x, z], rotY, group: { x, z, rotY, scale } } where `group` places a three.js Group built in room-centred cells (lib3d/plot3d.js, lib3d/houseShell.js).
 */
export function lotFrame(room, lot) {
  const { anchor } = lotShape(room), dx = lot.dx, dz = lot.dz, ax = dz, az = -dx; // the plot's x axis in the world (x-axis = (dz, -dx), z-axis = (dx, dz): a rotation, never a mirror)
  const toWorld = (cx, cz) => { const u = (cx - anchor.x) * CELL_M, v = (cz - anchor.z) * CELL_M; return [lot.x + u * ax + v * dx, lot.z + u * az + v * dz]; };
  const rotY = Math.atan2(dx, dz), lc = [(anchor.x - room.w / 2) * CELL_M, (anchor.z - room.d / 2) * CELL_M]; // the anchor in the group's local metres
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return { toWorld, rotY, group: { x: lot.x - (lc[0] * c + lc[1] * s), z: lot.z - (-lc[0] * s + lc[1] * c), rotY, scale: CELL_M } };
}

const stationPoints = (e, step) => { const out = [], at = {}; for (let s = step; s < e.len - step; s += step) { e.path.at(s, at); out.push({ s, x: at.x, z: at.z, hx: at.hx, hz: at.hz }); } return out; };

/** Is the whole lot on bare ground? Samples the plot (and a margin round all but the road side) against the collision world and the road graph. */
export function lotIsFree(svc, room, lot) {
  const { P } = lotShape(room), F = lotFrame(room, lot), p = P.plot, mc = MARGIN_M / CELL_M, g = GRID_M / CELL_M;
  const x0 = p.x0 - mc, x1 = p.x1 + mc, z0 = p.z0 - mc;
  for (let cz = z0; cz <= p.z1 + 1e-6; cz += g) for (let cx = x0; cx <= x1 + 1e-6; cx += g) {
    const [x, z] = F.toWorld(cx, Math.min(cz, p.z1));
    if (svc.graph.surfaceAt(x, z).cls !== 0) return false;                        // a road or its pavement
    if (svc.world.sdf(x, z, 4) < (cx < p.x0 || cx > p.x1 || cz < p.z0 ? MARGIN_M * 0.9 : 0.4)) return false; // a building, water, a tree
  }
  // The driveway corridor: the gate's width, from the front yard through the gate to the kerb's apron. A car swings out across it, so no lamp, sign or tree may stand in it. It is sampled every 0.6 m: the 2.4 m grid
  // above can step over a lamp post (0.4 m across) that stands between two samples.
  const fine = 0.6 / CELL_M;
  for (let cz = p.z1 - PLOT_RULES.frontYard; cz <= P.kerb + 1.4 + 1e-6; cz += fine) for (let cx = P.gate.x0; cx <= P.gate.x1 + 1e-6; cx += fine) { const [x, z] = F.toWorld(cx, cz); if (svc.world.sdf(x, z, 3) < 0.9) return false; }
  for (const [cx, cz] of [[p.x0, p.z1], [p.x1, p.z1]]) { // the front corners: nothing solid on the pavement either side of the gate
    const [x, z] = F.toWorld(cx, cz); if (svc.world.sdf(x, z, 3) < 0.6) return false;
  }
  return true;
}

/**
 * The lots that fit near `anchor` ({x, z} in metres), nearest first and spread apart: [{ x, z, dx, dz, edge, s, dist }]. Each stands beside a ground road with its gate on that road's kerb.
 * `radius` limits how far from the anchor to look. Deterministic for the same data.
 */
export function homeLots(svc, room, anchor, { radius = 420, limit = 40 } = {}) {
  const { P } = lotShape(room), sw0 = PLOT_RULES.pavement * CELL_M, found = [], midC = [(P.plot.x0 + P.plot.x1) / 2, (P.plot.z0 + P.plot.z1) / 2];
  const reach = radius + Math.hypot(P.plot.x1 - P.plot.x0, P.plot.z1 - P.plot.z0) * CELL_M;
  for (const e of svc.graph.edges) {
    if (e.hw || e.lv || e.fixed || !(e.mask & 1) || e.half < MIN_HALF || e.len < 24) continue;
    const mid = {}; e.path.at(e.len / 2, mid); if (Math.hypot(mid.x - anchor.x, mid.z - anchor.z) > reach + e.len / 2) continue;
    for (const st of stationPoints(e, STEP_S)) {
      if (Math.hypot(st.x - anchor.x, st.z - anchor.z) > radius) continue;
      for (const side of [1, -1]) {
        const nx = -st.hz * side, nz = st.hx * side, off = e.half + Math.max(0, (e.sw ?? 0) - sw0); // the fence stands at the outer edge of the pavement
        const lot = { x: st.x + nx * off, z: st.z + nz * off, dx: -nx, dz: -nz, edge: e.id, s: st.s };
        const [cx, cz] = lotFrame(room, lot).toWorld(midC[0], midC[1]); // the lot's middle
        lot.dist = Math.hypot(cx - anchor.x, cz - anchor.z); lot.mid = [cx, cz]; found.push(lot);
      }
    }
  }
  found.sort((a, b) => a.dist - b.dist || a.edge - b.edge || a.s - b.s || b.dx - a.dx);
  const out = [], mids = [];
  for (const lot of found) {
    if (mids.some((m) => Math.hypot(m[0] - lot.mid[0], m[1] - lot.mid[1]) < KEEP_APART)) continue;
    if (!lotIsFree(svc, room, lot)) continue;
    mids.push(lot.mid); delete lot.mid; out.push(lot); if (out.length >= limit) break;
  }
  return out;
}

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const CACHE = new WeakMap();

/** The home lot for this player: the `seed` (a character id) picks among the nearest few, so players with the same accommodation do not all pile onto one spot. Cached per map. */
export function homeLot(svc, room, anchor, seed = "") {
  const key = `${room.w}x${room.d}:${room.layout ?? ""}@${anchor.x.toFixed(1)},${anchor.z.toFixed(1)}`;
  let m = CACHE.get(svc); if (!m) CACHE.set(svc, (m = new Map()));
  let list = m.get(key); if (!list) m.set(key, (list = homeLots(svc, room, anchor, { limit: PICK_FROM })));
  return list.length ? list[hash(seed) % list.length] : null;
}
