// lib3d/furnitureplan.js
// WHERE the street furniture stands (street lights, trees, stop signs), as pure data: no three.js, so the collision world (lib3d/worldsvc.js) and the meshes (lib3d/roadfurniture.js) are built from
// the very same plan, and what you see standing in the street is what you cannot walk or drive through. A candidate spot is rejected unless it is pavement (or median, for the lights on it), at least `clear`
// metres from a building or water, and outside the expressway's corridor; nothing is ever placed in a carriageway.
import { corridorKeepOut } from "./highway.js";

const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** The solid footprint of each kind (radius in metres at its foot): a light pole's base plate, a tree's trunk (times the tree's scale), a sign's post. A little over the modelled thickness, so nothing clips into it. */
export const SOLID = { lamp: 0.22, tree: 0.24, sign: 0.1 };

/** graph: from buildRoadGraph. Returns { seed, lamps, trees, signs, taken, posts, solids }: `lamps` has one entry per arm [x, z, yaw] (a median pole carries two), `solids` one [x, z, r, kind] per standing thing. */
export function planFurniture(graph, { seed = 11 } = {}) {
  const rnd = rng(seed), keep = corridorKeepOut(), sdf = graph.sdf ?? (() => Infinity), surf = {};
  const inCorridor = (x, z) => { for (const [kx, kz, kr] of keep) if (Math.abs(kx - x) < kr && Math.abs(kz - z) < kr && Math.hypot(kx - x, kz - z) < kr) return true; return false; };
  const crossings = graph.crossings, nearCrossing = (x, z, r) => { for (const c of crossings) if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r && Math.hypot(c.x - x, c.z - z) < r) return true; return false; };
  const lamps = [], trees = [], signs = [], taken = [], solids = []; let posts = 0;   // `lamps` holds one entry per arm (a median pole carries two); `posts` counts the poles
  const free = (x, z, r) => { for (const t of taken) if (Math.abs(t[0] - x) < r && Math.abs(t[1] - z) < r && Math.hypot(t[0] - x, t[1] - z) < r) return false; return true; };
  const onPavement = (x, z) => graph.surfaceAt(x, z, surf).cls === 2;
  const CLEAR = 0.3;   // every standing thing keeps this far (plus its own radius) from any carriageway or swept turn: a car that takes a corner wide must not touch a pole
  const roadClear = (x, z, r) => { r += CLEAR; for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (graph.surfaceAt(x + dx, z + dz, surf).cls === 1) return false; return true; };
  const at = (e, s, off) => { const p = e.path.at(s, {}); return { x: p.x - p.hz * off, z: p.z + p.hx * off, hx: p.hx, hz: p.hz }; };
  const cutOf = (e) => { const na = graph.nodes[e.a], nb = graph.nodes[e.b]; return [na.deg >= 3 ? na.J?.pave.cut.get(e.id * 2) ?? 0 : 0, nb.deg >= 3 ? nb.J?.pave.cut.get(e.id * 2 + 1) ?? 0 : 0]; };

  // ---- street lights: every road is lit ----
  // A light is tried on the preferred side of the road, then the other, then a few metres along, so a building or a crossing beside one spot never leaves a stretch dark. A road with no
  // pavement gets its lights on the bare verge. Short roads get one in the middle. Neighbouring lights are LAMP_GAP apart and each spills a pool wider than that, so the pools overlap and
  // the road is lit end to end. Lights are placed before trees and signs, so a tree never takes the place of a light.
  const LAMP_GAP = 22;
  const lampStations = (e, ca, cb, gap) => {
    const a = ca + 4, b = e.len - cb - 4, span = b - a;
    if (span < gap * 0.5) return e.len >= 12 ? [e.len / 2] : [];   // a short road still gets one, in the middle
    const n = Math.max(1, Math.round(span / gap)), step = span / n, out = []; for (let i = 0; i <= n; i++) out.push(a + i * step); return out;
  };
  const SHIFT = [0, 4, -4, 8, -8];
  const medianLamp = (e, s) => {   // a double-arm light on the median (an arm over each carriageway)
    for (const d of SHIFT) {
      const s2 = s + d; if (s2 < 2 || s2 > e.len - 2) continue; const p = at(e, s2, 0);
      if (inCorridor(p.x, p.z) || !roadClear(p.x, p.z, SOLID.lamp) || sdf(p.x, p.z) < 4 || nearCrossing(p.x, p.z, 7) || !free(p.x, p.z, 8)) continue;   // the median is not carriageway: if another road overlaps it, no light
      const yaw = Math.atan2(-p.hx, -p.hz);   // the two arms lie across the road: along the right-hand vector (-hz, hx), yaw = atan2(-dz, dx)
      lamps.push([p.x, p.z, yaw], [p.x, p.z, yaw + Math.PI]); posts++; taken.push([p.x, p.z]); solids.push([p.x, p.z, SOLID.lamp, "lamp"]); return true;   // one arm each way: two single-arm lights back to back on one pole
    }
    return false;
  };
  const SHIFT_FAR = [0, 3, -3, 6, -6, 10, -10];
  const sideLamp = (e, s, sgn, relax = false) => {   // a single-arm light by the pavement (or the verge, where the road has none or another road lies over it). `relax`: the last try for a road that has none, allowing a light closer to a crossing or another light
    const lat0 = e.half + Math.min(1.1, Math.max(0.5, e.sw * 0.55)), crossR = relax ? 3 : 6, apart = relax ? 4 : 8;
    for (const more of relax ? [0, 1.5, 3.5, 6, 9] : [0, 1.5, 3.5]) for (const d of relax ? SHIFT_FAR : SHIFT) for (const sd of [sgn, -sgn]) {   // nearest to the kerb first, then further out
      const s2 = s + d; if (s2 < 2 || s2 > e.len - 2) continue; const p = at(e, s2, sd * (lat0 + more));
      if (inCorridor(p.x, p.z) || !roadClear(p.x, p.z, SOLID.lamp) || sdf(p.x, p.z) < 1.2 || nearCrossing(p.x, p.z, crossR) || !free(p.x, p.z, apart)) continue;   // never on a carriageway, nor in or against a building
      // the arm reaches over the road, toward the centreline: direction -sd * (-hz, hx) = (sd hz, -sd hx)
      lamps.push([p.x, p.z, Math.atan2(sd * p.hx, sd * p.hz)]); posts++; taken.push([p.x, p.z]); solids.push([p.x, p.z, SOLID.lamp, "lamp"]); return true;
    }
    return false;
  };
  for (const e of graph.edges) {
    if (e.hw || e.foot || e.len < 12) continue;   // (the expressway has its own lamps, lib3d/highwaymesh.js; footpaths are not roads)
    const [ca, cb] = cutOf(e);
    const divided = e.cls === "arterial" && e.med > 0; let sgn = rnd() < 0.5 ? 1 : -1;
    let got = 0; for (const s of lampStations(e, ca, cb, divided ? LAMP_GAP + 2 : LAMP_GAP)) { if (divided && medianLamp(e, s) || sideLamp(e, s, sgn)) got++; sgn = -sgn; }   // where the median is blocked (a crossing, an overlapping road) the light goes by the pavement instead
    if (!got) for (const f of [0.5, 0.3, 0.7]) if (sideLamp(e, e.len * f, sgn, true)) break;   // a road must not be left dark: try again with the rules loosened
  }
  // ---- trees ----
  for (const e of graph.edges) {
    if (e.hw || e.foot || e.len < 30) continue;
    const [ca, cb] = cutOf(e), s0 = ca + 10, s1 = e.len - cb - 10; if (s1 - s0 < 12) continue;
    if (e.sw >= 1.9) {
      for (const sgn of [-1, 1]) for (let s = s0 + 4 + rnd() * 6; s < s1 - 4; s += 15 + rnd() * 6) {
        const p = at(e, s, sgn * (e.half + e.sw * 0.62));
        if (inCorridor(p.x, p.z) || !onPavement(p.x, p.z) || !roadClear(p.x, p.z, SOLID.tree * 1.3) || sdf(p.x, p.z) < 2.4 || nearCrossing(p.x, p.z, 7) || !free(p.x, p.z, 6)) continue;
        { const k = 0.8 + rnd() * 0.5; trees.push([p.x, p.z, k, rnd()]); taken.push([p.x, p.z]); solids.push([p.x, p.z, SOLID.tree * k, "tree"]); }
      }
    }
  }
  // ---- stop signs: at the end of every lane that runs into a bigger road ----
  const RANK = { local: 0, collector: 1, arterial: 2 };
  for (const l of graph.lanes) {
    if (l.hw) continue; const e = graph.byEdge.get(l.edge), node = graph.nodes[l.to]; if (node.deg < 3 || e.sw < 0.6 || l.len < 14) continue;
    const bigger = node.edges.some((id) => { const o = graph.byEdge.get(id); return o && o !== e && !o.hw && (RANK[o.cls] ?? 0) > (RANK[e.cls] ?? 0); }); if (!bigger) continue;
    // at the stop line itself the swept corner of a turn can cover the pavement: take the first spot back along the lane that is pavement
    for (let s = l.len - 0.5; s > Math.max(4, l.len - 16); s -= 1.5) {
      const p = l.path.at(s, {}), rx = -p.hz, rz = p.hx, off = e.half + Math.min(0.7, Math.max(0.3, e.sw * 0.5)) - l.off, x = p.x + rx * off, z = p.z + rz * off;
      if (!onPavement(x, z) || !roadClear(x, z, SOLID.sign) || sdf(x, z) < 0.5 || inCorridor(x, z) || nearCrossing(x, z, 3.2) || !free(x, z, 3)) continue;
      signs.push([x, z, Math.atan2(-p.hx, -p.hz)]); taken.push([x, z]); solids.push([x, z, SOLID.sign, "sign"]); break;   // the plate faces the traffic that comes up to it
    }
  }
  return { seed, lamps, trees, signs, taken, posts, solids };
}
