// lib3d/interiors/openSpaces.js
// Open-air places (the amphitheatre, the Main Bowl, the gardens ...) as walkable social spaces. They are still "outdoors" for the registry (no building inside,
// no activity rings); this file only draws a fenced open yard with benches, trees and a crowd of student NPCs, using the same plan/compile/scene pipeline as the
// rooms. Real players in the same place are drawn by the scene's remote-player layer, exactly as inside a building; the NPCs here are never real players.
// Pure (no 3D library) so Node tests can check the layouts: density, nobody inside a solid, nobody on the doorstep.
import { Plan, rng } from "./planKit.js";
import { compile } from "./compile.js";
import { dimsOf } from "./items.js";

export const OPEN_SPACES = {
  amphitheatre: { w: 38, d: 28, feature: "stage", label: "Amphitheatre", benches: 8, trees: 6 },
  motion_ground: { w: 44, d: 32, feature: "stage", label: "Event ground", benches: 8, trees: 8 },
  religious_ground: { w: 36, d: 28, feature: "none", label: "Religious ground", benches: 10, trees: 9 },
  main_bowl: { w: 48, d: 34, feature: "none", label: "Main Bowl", benches: 10, trees: 8 },
  sports_centre: { w: 40, d: 28, feature: "none", label: "Sports ground", benches: 8, trees: 6 },
  basketball: { w: 26, d: 20, feature: "none", label: "Court side", benches: 5, trees: 4 },
  bio_gardens: { w: 36, d: 28, feature: "none", label: "Gardens", benches: 9, trees: 14 },
  zoo: { w: 36, d: 26, feature: "none", label: "Zoo path", benches: 7, trees: 10 },
  pit_theatre: { w: 30, d: 22, feature: "stage", label: "Pit theatre", benches: 7, trees: 4 },
};
export const isOpenSpace = (id) => !!OPEN_SPACES[id];
const hashId = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const SEATED = ["sit", "read", "eatSit"], WALL = 1.6; // the crowd keeps this far from the fence

/** The plan: one open grass room with a gap in the south fence, a feature, benches facing the middle, trees around the edge, and the people. */
export function openPlan(place) {
  const S = OPEN_SPACES[place.id]; if (!S) return null; const r = rng(hashId(place.id)), { w: W, d: D } = S;
  const p = new Plan(place.id, place.name ?? S.label, { floors: 1, style: { wall: "#7c8a6a", facade: "#8d9a7a", noWindows: true } });
  p.room("ground", S.label, 0, 0, W, D, { kind: "yard", surface: "grass", open: true, h: 8, wall: "#7c8a6a" });
  p.enter("ground", "s", W / 2, 3.0);
  const keep = [], at = (type, x, z, ry = 0, o = {}) => { p.item(type, x, z, ry, o); const d = dimsOf({ type, ...o }); keep.push({ x, z, r: Math.max(d.w, d.d) / 2 + 0.35 }); };
  if (S.feature === "stage") { at("stage", W / 2, 3.2, 0, { w: Math.min(14, W * 0.4) }); }
  const cx = W / 2, cz = D * 0.55, faceMid = (x, z) => Math.atan2(cx - x, cz - z);
  // benches on an oval around the middle, trees between them and along the fence
  const benches = [];
  for (let i = 0; i < S.benches; i++) { const a = (i / S.benches) * Math.PI * 2 + 0.3, x = cx + Math.cos(a) * (W * 0.33), z = cz + Math.sin(a) * (D * 0.3); if (z < (S.feature === "stage" ? 8.5 : 3) || z > D - WALL - 1 || Math.hypot(x - W / 2, z - D) < 5) continue; at("bench", x, z, faceMid(x, z), { w: 2.0 }); benches.push({ x, z, ry: faceMid(x, z) }); }
  for (let i = 0; i < S.trees; i++) { const a = (i / S.trees) * Math.PI * 2 + r(), x = cx + Math.cos(a) * (W * 0.46), z = cz + Math.sin(a) * (D * 0.46); if (x < WALL || x > W - WALL || z < WALL || z > D - WALL || Math.hypot(x - W / 2, z - D) < 6) continue; at("tree", x, z, 0); }
  at("plant", 2.2, D - 2.2); at("plant", W - 2.2, D - 2.2);
  const free = (x, z, pad = 1.1) => x > WALL && x < W - WALL && z > WALL && z < D - WALL && Math.hypot(x - W / 2, z - (D - 1.5)) > 4 && keep.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + pad);
  const spot = () => { for (let n = 0; n < 60; n++) { const x = WALL + r() * (W - 2 * WALL), z = WALL + r() * (D - 2 * WALL); if (free(x, z)) return [x, z]; } return null; };
  // people: some on the benches, some chatting in little circles, some strolling
  const seats = benches.slice().sort(() => r() - 0.5).slice(0, Math.max(2, Math.round(benches.length * 0.6)));
  for (const b of seats) { const off = (r() - 0.5) * 0.8, sx = Math.cos(b.ry) * off, sz = -Math.sin(b.ry) * off; p.npc("student", { room: "ground", floor: 0, x: b.x + sx - Math.sin(b.ry) * 0.05, z: b.z + sz - Math.cos(b.ry) * 0.05, yaw: b.ry, mode: "sit", clips: SEATED, social: true }); }
  const groups = Math.max(2, Math.round(W * D / 330));
  for (let g = 0, tries = 0; g < groups && tries < groups * 6; tries++) {
    const c = spot(); if (!c) continue; const n = 2 + (r() < 0.45 ? 1 : 0), ph = r() * 6.28, ring = [];
    for (let k = 0; k < n; k++) { const a = ph + (k / n) * Math.PI * 2, x = c[0] + Math.cos(a) * 0.75, z = c[1] + Math.sin(a) * 0.75; if (free(x, z, 0.5)) ring.push([x, z]); }
    if (ring.length < 2) continue; // a conversation needs at least two people
    ring.forEach(([x, z], k) => p.npc("student", { room: "ground", floor: 0, x, z, yaw: Math.atan2(c[0] - x, c[1] - z), mode: "talk", group: g, gi: k, gn: ring.length, social: true })); g++;
  }
  const walkers = Math.max(3, Math.round(W * D / 260));
  for (let k = 0; k < walkers; k++) { const c = spot(); if (c) p.npc("student", { room: "ground", floor: 0, x: c[0], z: c[1], yaw: r() * 6.28, mode: "wander", social: true }); }
  return p;
}
/** The plan compiled for the scene, or null if this place is not an open space. */
export const buildOpenInterior = (place) => { const pl = openPlan(place); if (!pl) return null; pl.family = "open"; return compile(pl); };
