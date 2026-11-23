// lib3d/trees.js
// The palms and bushes of a home's plot. Its own module so the map can draw a compound's trees without loading the whole home-room scene (lib3d/room.js, which re-exports nothing from here).
import * as THREE from "three";

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });

export function tree(kind, seed) {
  const g = new THREE.Group();
  if (kind === "palm") {
    const lean = 0.12 + (seed % 3) * 0.05,
      trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.16, 2.6, 8),
        mat("#8a6a45"),
      );
    trunk.position.y = 1.3;
    trunk.rotation.z = lean;
    trunk.castShadow = true;
    g.add(trunk);
    const crown = new THREE.Group();
    crown.position.set(-Math.sin(lean) * 2.6, 2.55, 0);
    g.add(crown);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 1.7, 4),
        mat(i % 2 ? "#2f9d63" : "#46b97a"),
      );
      leaf.scale.z = 0.25;
      leaf.geometry.translate(0, 0.85, 0);
      leaf.rotation.set(0, (i / 7) * Math.PI * 2, 1.15);
      const a = new THREE.Group();
      a.rotation.y = (i / 7) * Math.PI * 2;
      leaf.rotation.set(0, 0, 1.25);
      a.add(leaf);
      a.castShadow = true;
      crown.add(a);
      leaf.castShadow = true;
    }
  } else {
    for (const [x, y, z, r, c] of [
      [0, 0.32, 0, 0.42, "#3f9a64"],
      [0.36, 0.24, 0.1, 0.3, "#52b176"],
      [-0.3, 0.22, -0.1, 0.28, "#2f8553"],
    ]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat(c));
      b.position.set(x, y, z);
      b.scale.y = 0.85;
      b.castShadow = true;
      g.add(b);
    }
  }
  return g;
}
