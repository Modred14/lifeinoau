// lib3d/dsaVan.js
// The DSA's patrol van: white with a blue stripe and a light bar, a sliding door on the right-hand side (+z), two rear doors,
// and a HOLLOW cargo area with benches so people can really be put inside. Metres; the nose points to -x, the rear is at +x, wheels on y = 0.
import * as THREE from "three";
import { mat } from "./toonFigure.js";

export const VAN = { L: 5.4, W: 2.0, rearX: 2.7, doorX: 0.1, floorY: 0.63 };

function decal(w, h) {
  const c = document.createElement("canvas"); c.width = 512; c.height = Math.round(512 * (h / w));
  const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = "#14377a"; g.font = `900 ${Math.round(c.height * 0.62)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("DSA", c.width / 2, c.height * 0.42);
  g.font = `700 ${Math.round(c.height * 0.14)}px system-ui, sans-serif`; g.fillStyle = "#b3283c"; g.fillText("STUDENT AFFAIRS", c.width / 2, c.height * 0.86);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return new THREE.MeshBasicMaterial({ map: t, transparent: true });
}

export function makeDsaVan() {
  const { L, W } = VAN, root = new THREE.Group(), geos = [];
  const add = (parent, w, h, l, x, y, z, m) => { const g = new THREE.BoxGeometry(w, h, l); geos.push(g); const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; parent.add(me); return me; };
  const white = mat("#f4f6f8", { roughness: 0.4, metalness: 0.15 }), blue = mat("#1d4fa3", { roughness: 0.45 }), red = mat("#c4202b"), dark = mat("#1a1d23", { roughness: 0.6 });
  const glass = mat("#27374a", { roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.42 }), inside = mat("#8d95a1", { roughness: 0.9 }), bench = mat("#2b3140", { roughness: 0.8 });
  const cx0 = -0.8, cx1 = L / 2, cw = cx1 - cx0, cmid = (cx0 + cx1) / 2, wallH = 1.67, wallY = 0.63 + wallH / 2, t = 0.07;

  // ---- the cab and bonnet ----
  add(root, 0.8, 0.62, W - 0.06, -2.3, 0.95, 0, white);                         // bonnet
  add(root, 1.3, 0.55, W - 0.04, -1.45, 0.78, 0, white);                          // cab lower
  add(root, 1.25, 0.7, W - 0.1, -1.4, 1.42, 0, white).castShadow = true;         // cab upper
  add(root, 1.1, 0.5, W + 0.01, -1.4, 1.5, 0, glass);                             // side glass band
  const ws = add(root, 0.06, 0.62, W - 0.2, -1.98, 1.58, 0, glass); ws.rotation.z = 0.5; // windscreen
  add(root, 1.3, 0.07, W - 0.04, -1.42, 1.82, 0, white);                          // cab roof
  add(root, 0.06, 0.18, W - 0.1, -2.72, 0.7, 0, dark);                            // bumper
  add(root, 0.04, 0.12, 0.34, -2.71, 1.0, 0.7, mat("#fff3c4", { emissive: "#fff3c4", emissiveIntensity: 0.9 })); add(root, 0.04, 0.12, 0.34, -2.71, 1.0, -0.7, mat("#fff3c4", { emissive: "#fff3c4", emissiveIntensity: 0.9 }));
  // ---- the cargo area: floor, walls with a door opening on the right, roof, benches, a cage behind the cab ----
  add(root, cw, 0.18, W - 0.04, cmid, 0.54, 0, white);                            // floor slab (top at 0.63)
  add(root, cw, 0.08, W, cmid, 0.63 + wallH + 0.04, 0, white);                    // roof
  add(root, cw - 0.02, wallH, t, cmid, wallY, -(W / 2 - t / 2), white);          // left wall (far side, -z)
  const dx0 = -0.4, dx1 = 0.6;                                                    // the sliding-door opening, world x
  add(root, dx0 - cx0, wallH, t, (cx0 + dx0) / 2, wallY, W / 2 - t / 2, white); add(root, cx1 - dx1, wallH, t, (dx1 + cx1) / 2, wallY, W / 2 - t / 2, white);
  add(root, 0.06, wallH, W - 0.1, cx0 + 0.03, wallY, 0, dark);                    // bulkhead behind the cab
  for (const s of [1, -1]) { add(root, cw - 0.1, 0.1, 0.42, cmid + 0.05, 0.9, 0.68 * s, bench); add(root, cw - 0.1, 0.5, 0.05, cmid + 0.05, 1.18, 0.88 * s, bench); } // benches along both sides
  add(root, cw - 0.1, 0.02, W - 0.1, cmid, 0.64, 0, inside);                      // inside floor
  const stripe = (y, h, m) => [1, -1].forEach((s) => add(root, L - 0.9, h, 0.012, 0.45, y, (W / 2 + 0.006) * s, m)); stripe(1.02, 0.16, blue); stripe(0.86, 0.04, red);
  const dc = decal(1.5, 0.75), side = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), dc); geos.push(side.geometry); side.position.set(1.85, 1.55, -(W / 2 + 0.012)); side.rotation.y = Math.PI; root.add(side);
  // ---- the sliding door (carries the decal with it) ----
  const slide = new THREE.Group(); slide.position.set(0, 0, 0); root.add(slide);
  add(slide, dx1 - dx0 + 0.06, wallH - 0.05, 0.07, (dx0 + dx1) / 2, wallY, W / 2 + 0.03, white);
  add(slide, 0.5, 0.35, 0.02, (dx0 + dx1) / 2, 1.95, W / 2 + 0.07, glass);
  add(slide, 0.05, 0.16, 0.05, dx1 - 0.12, 1.35, W / 2 + 0.09, dark);
  const d2 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), dc); geos.push(d2.geometry); d2.position.set((dx0 + dx1) / 2, 1.5, W / 2 + 0.072); slide.add(d2);
  // ---- the rear doors, hinged at the back corners ----
  const rear = (s) => { const p = new THREE.Group(); p.position.set(cx1, wallY, (W / 2 - 0.04) * s); root.add(p); add(p, 0.06, wallH, 0.95, 0, 0, -0.475 * s, white); add(p, 0.07, 0.34, 0.5, 0.02, 0.3, -0.475 * s, glass); return p; };
  const rr = rear(1), rl = rear(-1);
  // ---- lights ----
  const rb = mat("#e11d2e", { emissive: "#e11d2e", emissiveIntensity: 0.2 }), bb = mat("#2b6bff", { emissive: "#2b6bff", emissiveIntensity: 0.2 });
  add(root, 0.28, 0.12, 0.45, -1.4, 1.94, 0.3, rb); add(root, 0.28, 0.12, 0.45, -1.4, 1.94, -0.3, bb); add(root, 0.3, 0.04, 1.2, -1.4, 1.87, 0, dark);
  const lR = new THREE.PointLight(0xff2030, 0, 14, 1.6), lB = new THREE.PointLight(0x2b6bff, 0, 14, 1.6); lR.position.set(-1.4, 2.3, 0.6); lB.position.set(-1.4, 2.3, -0.6); root.add(lR, lB);
  add(root, 0.04, 0.12, 0.3, cx1 + 0.02, 1.0, 0.8, mat("#c4202b", { emissive: "#c4202b", emissiveIntensity: 0.6 })); add(root, 0.04, 0.12, 0.3, cx1 + 0.02, 1.0, -0.8, mat("#c4202b", { emissive: "#c4202b", emissiveIntensity: 0.6 }));
  // ---- wheels ----
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 18); wg.rotateX(Math.PI / 2); geos.push(wg);
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 10); hub.rotateX(Math.PI / 2); geos.push(hub);
  const wheels = [[-1.7, 0.88], [-1.7, -0.88], [1.7, 0.88], [1.7, -0.88]].map(([x, z]) => {
    const w = new THREE.Mesh(wg, mat("#15171b", { roughness: 0.9 })); w.position.set(x, 0.42, z); w.castShadow = true; const h = new THREE.Mesh(hub, mat("#aeb4be", { metalness: 0.6, roughness: 0.4 })); h.position.x = 0.06; w.add(h); root.add(w); return w;
  });
  // where the driver sits (left-hand drive: the left is +z when the nose points to -x)
  const driverSlot = new THREE.Group(); driverSlot.position.set(-1.35, 0.07, 0.42); root.add(driverSlot);

  return {
    root, driverSlot, L, W,
    /** 0 = shut, 1 = fully open (it slides back along the side). */
    slideDoor: (k) => { slide.position.x = k * 1.12; },
    rearDoors: (k) => { rr.rotation.y = -k * 2.95; rl.rotation.y = k * 2.95; }, // swing right out to the sides
    /** Flash the light bar red / blue. */
    lights: (on, t) => { const a = on && Math.sin(t * 16) > 0, b = on && !a; lR.intensity = a ? 40 : 0; lB.intensity = b ? 40 : 0; rb.emissiveIntensity = a ? 2.4 : 0.2; bb.emissiveIntensity = b ? 2.4 : 0.2; return a ? 0xff2030 : b ? 0x2b6bff : 0; },
    /** Wheels turned for a distance driven in metres (towards -x); pitch (+ = nose dips). */
    rollTo: (m) => wheels.forEach((w) => { w.rotation.z = m / 0.42; }),
    pitch: (r) => { root.rotation.z = r; },
    dispose() { geos.forEach((g) => g.dispose()); },
  };
}
