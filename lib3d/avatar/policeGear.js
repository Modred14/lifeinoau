// lib3d/avatar/policeGear.js
// The N-QRS patrol kit, added to an ordinary avatar (the same rig, so every animation, the clips in policeClips.js and the multiplayer sync keep working):
// a peaked cap with a gold band and badge, shoulder epaulettes, a chest badge, a shoulder radio, and a duty belt with a holster, a cuff pouch and a baton.
// Each piece is built in metres, placed where it belongs on the standing body, then handed to the nearest bone with Object3D.attach, which keeps its world position
// and cancels the bone's own scale, so it moves with the body whatever unit the model was exported in. Nothing here is medical: no hi-vis, no white, no cross.
import * as THREE from "three";

const NAVY = "#1d2b47", BLACK = "#0e121c", GOLD = "#e8b83a", STEEL = "#aab2bd";
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...o });

/** Where things are on THIS body, in metres relative to the avatar's feet: the models differ in height and build, so the kit is placed from the skeleton, not from fixed numbers. */
function measure(av) {
  const root = av.root, o = root.getWorldPosition(new THREE.Vector3()), at = (n) => { const b = av.bone(n); return b ? b.getWorldPosition(new THREE.Vector3()).sub(o) : null; };
  const head = at("Head") ?? new THREE.Vector3(0, (av.height ?? 1.76), 0), hips = at("Hips") ?? new THREE.Vector3(0, 0.95, 0);
  const l = at("LeftArm") ?? new THREE.Vector3(0.18, head.y - 0.2, 0), r = at("RightArm") ?? new THREE.Vector3(-0.18, head.y - 0.2, 0), chest = at("Spine2") ?? new THREE.Vector3(0, head.y - 0.3, 0);
  return { top: head.y + 0.25, headY: head.y, hipsY: hips.y, l, r, chest };
}

/** The pieces: [bone, Object3D placed in avatar space (x = the character's left, y = up, z = forward, metres)]. */
function pieces(m) {
  const mesh = (geo, mat, x, y, z, rx = 0, rz = 0) => { const q = new THREE.Mesh(geo, mat); q.position.set(x, y, z); q.rotation.set(rx, 0, rz); q.castShadow = true; return q; };
  const blk = M(BLACK, { roughness: 0.5 }), gold = M(GOLD, { metalness: 0.6, roughness: 0.35 }), navy = M(NAVY), steel = M(STEEL, { metalness: 0.7, roughness: 0.3 });
  const hips = new THREE.Group(), chest = new THREE.Group(), head = new THREE.Group(), by = m.hipsY + 0.06, cy = m.chest.y;
  const belt = mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.05, 20), blk, 0, by, 0); belt.scale.set(1.05, 1, 0.78); hips.add(belt);
  hips.add(mesh(new THREE.BoxGeometry(0.06, 0.045, 0.02), gold, 0, by, 0.145)); // buckle
  hips.add(mesh(new THREE.BoxGeometry(0.06, 0.15, 0.07), blk, -0.2, by - 0.08, 0.02)); // holster, right hip
  hips.add(mesh(new THREE.BoxGeometry(0.05, 0.1, 0.05), blk, 0.16, by - 0.03, 0.08)); // cuff pouch, left front
  hips.add(mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.36, 8), blk, 0.21, by - 0.15, -0.02, 0.08, 0)); // baton, left hip
  chest.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 6), gold, 0.1, cy + 0.06, 0.135, Math.PI / 2)); // badge, left chest
  chest.add(mesh(new THREE.BoxGeometry(0.05, 0.09, 0.04), blk, -0.13, cy + 0.1, 0.12)); chest.add(mesh(new THREE.BoxGeometry(0.012, 0.09, 0.012), steel, -0.13, cy + 0.19, 0.12)); // radio on the right chest, with its aerial
  for (const [p, s] of [[m.l, 1], [m.r, -1]]) { const e = mesh(new THREE.BoxGeometry(0.07, 0.014, 0.1), blk, p.x * 0.9, p.y + 0.05, p.z); e.rotation.z = -0.25 * s; chest.add(e); chest.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.07), gold, p.x * 0.9, p.y + 0.06, p.z)); } // epaulettes
  const top = m.top; // crown of the head
  head.add(mesh(new THREE.CylinderGeometry(0.118, 0.122, 0.09, 18), navy, 0, top - 0.04, 0));
  head.add(mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.016, 18), gold, 0, top - 0.08, 0)); // band
  head.add(mesh(new THREE.CylinderGeometry(0.132, 0.126, 0.03, 18), navy, 0, top + 0.015, 0)); // the flared top
  head.add(mesh(new THREE.BoxGeometry(0.17, 0.01, 0.07), M("#0b0e16", { roughness: 0.25 }), 0, top - 0.095, 0.13, 0.2)); // visor
  head.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 6), gold, 0, top - 0.04, 0.122, Math.PI / 2)); // cap badge
  return [["Hips", hips], ["Spine2", chest], ["Head", head]];
}

/** Puts the patrol kit on `av` (a createAvatar result). Returns true if it was fitted (a glTF body with a skeleton); the plain built-in figure is left as it is. */
export function dressPolice(av) {
  if (!av || av.kind !== "glb" || !av.bone || av._police) return false;
  const root = av.root, rs = root.getWorldScale(new THREE.Vector3());
  root.updateMatrixWorld(true);
  for (const [bone, group] of pieces(measure(av))) {
    const b = av.bone(bone); if (!b) continue;
    group.scale.set(1 / rs.x, 1 / rs.y, 1 / rs.z); // avatar space is in metres; the root may be scaled
      root.add(group); root.updateMatrixWorld(true); b.attach(group);
    group.traverse((o) => { if (o.isMesh) o.userData.npcMesh = true; });
  }
  root.traverse((o) => { if (o.isMesh && /ReflectiveStripe/i.test(o.name)) o.visible = false; }); // no hi-vis stripes: this is a police vest, not site work
  av._police = true; return true;
}
