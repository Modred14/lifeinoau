// lib3d/glow.js
// The soft round light-spill used for street lights (a pool on the road) and car headlamps (a beam on the road ahead). One shared texture, drawn once on a canvas.
// Browser only: with no document (the node tests) glowTexture() is null and callers simply skip the glow.
import * as THREE from "three";

let tex;
/** A white radial falloff (opaque centre, transparent edge) on a small canvas. */
export function glowTexture() {
  if (tex !== undefined) return tex;
  if (typeof document === "undefined") return (tex = null);
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.55)"); r.addColorStop(0.7, "rgba(255,255,255,0.14)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

/** An additive, unlit material for a glow: it adds light to what is behind it and never writes depth, so overlapping glows just brighten. Opacity is driven by the night level. */
export function glowMaterial(color = 0xffc46b) {
  const map = glowTexture();
  return new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
