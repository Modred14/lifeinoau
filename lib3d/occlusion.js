// lib3d/occlusion.js
// Fades the furniture that stands between the home camera and the player, so a sofa or a TV never hides them. Each piece owns its materials
// (lib3d/furnitureModels.js builds them per piece), so fading one never touches another. Pure maths lives in lib/homeCamera.js.
import { blocksView } from "../lib/homeCamera.js";

export function createOccluder(THREE) {
  const box = new THREE.Box3(), state = new WeakMap(), pt = new THREE.Vector3();
  const boxOf = (g) => { const s = state.get(g) ?? {}, sig = `${g.position.x}|${g.position.z}|${g.rotation.y}|${g.scale.x}|${g.visible}`; if (s.sig !== sig || !s.min) { g.updateMatrixWorld(true); box.setFromObject(g); s.min = box.min.toArray(); s.max = box.max.toArray(); s.sig = sig; state.set(g, s); } return s; };
  const mats = (g) => { const out = []; g.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && "opacity" in m) out.push(m); }); return out; };
  function apply(g, s, k, floor) { // k: 0 = solid, 1 = fully faded to `floor` opacity
    s.mats ??= mats(g).map((m) => ({ m, t: m.transparent, o: m.opacity, w: m.depthWrite }));
    for (const e of s.mats) { if (k <= 0.001) { e.m.transparent = e.t; e.m.opacity = e.o; e.m.depthWrite = e.w; } else { e.m.transparent = true; e.m.depthWrite = k < 0.5 ? e.w : false; e.m.opacity = e.o * (1 - k * (1 - floor)); } e.m.needsUpdate = e.m.needsUpdate; }
  }
  /** groups: the pieces to test; skip: a Set of groups never faded (the one being arranged); cam/head/chest: THREE.Vector3. Returns how many pieces are faded. */
  function update(dt, cam, player, groups, { floor = 0.18, skip = null, enabled = true } = {}) {
    let n = 0; const c = cam.toArray();
    for (const g of groups) {
      const s = boxOf(g); let want = 0;
      if (enabled && !(skip && skip.has(g)) && g.visible && s.max[1] > 0.45) { // a low rug or a mat never blocks the view
        for (const y of [0.45, 1.05, 1.6]) { pt.set(player.x, y, player.z); if (blocksView(c, pt.toArray(), s.min, s.max)) { want = 1; break; } }
      }
      s.k = (s.k ?? 0) + (want - (s.k ?? 0)) * (1 - Math.exp(-dt * 10));
      if (s.k < 0.01 && want === 0) { if (s.applied) { apply(g, s, 0, floor); s.applied = false; } } else { apply(g, s, s.k, floor); s.applied = true; }
      if (s.k > 0.5) n++;
    }
    return n;
  }
  const reset = (groups) => { for (const g of groups) { const s = state.get(g); if (s?.applied) { apply(g, s, 0, 1); s.applied = false; s.k = 0; } } };
  return { update, reset };
}
