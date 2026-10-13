// lib3d/grounds.js
// The Motion Ground and the Religious Ground (with its churches), drawn from the rectangles in mapExtras.js (GROUNDS).
// Game placements: the real-map render shows neither, so the shapes are stylised and nobody has surveyed them.
// 1 scene unit = 10 m; heights use the same EX exaggeration as the real buildings so the two read together.
import * as THREE from "three";

export function buildGrounds(G, { S, EX }) {
  const root = new THREE.Group(), H = (m) => m * S * EX; // a real height in metres -> scene units
  const mats = new Map(), mat = (color, layer = 0, o = {}) => { const k = color + layer + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.9, polygonOffset: layer > 0, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer, ...o })); return mats.get(k); };
  const add = (geo, m, x, y, z, o = {}) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); if (o.ry) mesh.rotation.y = o.ry; mesh.castShadow = o.shadow !== false; mesh.receiveShadow = true; root.add(mesh); return mesh; };
  const box = (w, h, d) => new THREE.BoxGeometry(w * S, h, d * S); // w, d in metres; h already in scene units
  // a flat slab covering the metre rectangle [x0,x1] x [z0,z1], its top face at y (scene units)
  const slab = (x0, x1, z0, z1, color, layer, y) => add(box(x1 - x0, 0.06, z1 - z0), mat(color, layer), ((x0 + x1) / 2) * S, y - 0.03, ((z0 + z1) / 2) * S, { shadow: false });
  const pole = (x, z, hM, r = 0.05, color = "#6b7280") => add(new THREE.CylinderGeometry(r, r * 1.3, H(hM), 8), mat(color), x * S, H(hM) / 2, z * S);
  const tree = (x, z, k = 1) => { add(new THREE.CylinderGeometry(0.07 * k, 0.1 * k, 0.9 * k, 6), mat("#4a3426"), x * S, 0.45 * k, z * S); add(new THREE.IcosahedronGeometry(0.62 * k, 0), mat("#3f8a45", 0, { flatShading: true, roughness: 1 }), x * S, 1.3 * k, z * S); };

  // ================= Motion Ground: an open event field with a stage, stands and floodlights =================
  { const m = G.motion, cx = (m.x0 + m.x1) / 2, w = m.x1 - m.x0;
    slab(m.x0 - 3, m.x1 + 3, m.z0 - 3, m.z1 + 3, "#d3cbb6", 5, 0.12);                              // paved apron round the field
    slab(m.x0, m.x1, m.z0, m.z1, "#55a458", 6, 0.15);                                              // turf
    const n = 8; for (let i = 0; i < n; i += 2) slab(m.x0 + (w / n) * i, m.x0 + (w / n) * (i + 1), m.z0, m.z1, "#4b9a50", 7, 0.16); // mowing stripes
    const line = (x0, x1, z0, z1) => slab(x0, x1, z0, z1, "#f4f4ee", 8, 0.17), t = 0.4;
    line(m.x0, m.x1, m.z0, m.z0 + t); line(m.x0, m.x1, m.z1 - t, m.z1); line(m.x0, m.x0 + t, m.z0, m.z1); line(m.x1 - t, m.x1, m.z0, m.z1);
    line(cx - t / 2, cx + t / 2, m.z0, m.z1);
    { const r = 6, c = new THREE.Mesh(new THREE.RingGeometry((r - 0.4) * S, r * S, 40), new THREE.MeshBasicMaterial({ color: "#f4f4ee", polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9, side: THREE.DoubleSide })); c.rotation.x = -Math.PI / 2; c.position.set(cx * S, 0.18, ((m.z0 + m.z1) / 2) * S); root.add(c); }
    // stage at the north end (towards the Amphitheatre side of the road), facing the field
    { const sw = 20, sd = 7, sz = m.z0 + 2 + sd / 2, st = H(1.4); add(box(sw, st, sd), mat("#3b4150"), cx * S, 0.15 + st / 2, sz * S);
      const roofY = 0.15 + st + H(6.5); for (const dx of [-sw / 2 + 0.6, sw / 2 - 0.6]) for (const dz of [-sd / 2 + 0.6, sd / 2 - 0.6]) add(box(0.8, H(6.5), 0.8), mat("#9aa3b2"), (cx + dx) * S, 0.15 + st + H(6.5) / 2, (sz + dz) * S);
      add(box(sw + 2, 0.12, sd + 1.5), mat("#242a38"), cx * S, roofY + 0.06, sz * S);
      add(box(sw - 4, H(5), 0.4), new THREE.MeshStandardMaterial({ color: "#1a2540", emissive: "#4aa8ff", emissiveIntensity: 0.9, roughness: 0.4 }), cx * S, 0.15 + st + H(2.6), (sz - sd / 2 + 0.8) * S); // LED backdrop
      for (const dx of [-sw / 2 - 2.2, sw / 2 + 2.2]) add(box(2, H(3.4), 2), mat("#14171f"), (cx + dx) * S, 0.15 + H(1.7), sz * S); } // speaker stacks
    // stands along the south side, three tiers
    for (let i = 0; i < 3; i++) add(box(w - 10, H(0.9 + i * 0.9), 2.6), mat(i % 2 ? "#aab4c4" : "#9aa4b3"), cx * S, 0.12 + H(0.9 + i * 0.9) / 2, (m.z1 + 4.2 + i * 2.6) * S);
    // floodlights on the corners
    for (const [x, z] of [[m.x0 - 2, m.z0 - 2], [m.x1 + 2, m.z0 - 2], [m.x0 - 2, m.z1 + 2], [m.x1 + 2, m.z1 + 2]]) { pole(x, z, 16); add(box(3.2, 0.16, 1), new THREE.MeshStandardMaterial({ color: "#fff4d0", emissive: "#ffe9a8", emissiveIntensity: 1.4 }), x * S, H(16) + 0.08, z * S, { shadow: false }); }
    // a goal at each end so the field also reads as a football pitch
    for (const x of [m.x0 + 0.5, m.x1 - 0.5]) { const gz = (m.z0 + m.z1) / 2 + 3; add(box(0.3, H(2.4), 7.3), mat("#f4f4ee", 0, { transparent: true, opacity: 0.55 }), x * S, 0.15 + H(1.2), gz * S - 0.3, { shadow: false }); }
  }

  // ================= Religious Ground: a walled compound, a cross path, four churches =================
  { const r = G.religious, cx = r.gate ?? (r.x0 + r.x1) / 2;
    slab(r.x0, r.x1, r.z0, r.z1, "#d9d2bf", 5, 0.12);                                              // paved base
    slab(r.x0 + 2, r.x1 - 2, r.z0 + 7, r.z1 - 2, "#6fae6a", 6, 0.15);                              // lawn (the first 7 m inside the gate stay paved)
    slab(cx - 2, cx + 2, r.z0, r.z1, "#ece5d2", 7, 0.16);                                          // central path from the gate
    slab(r.x0 + 2, r.x1 - 2, 198.5, 207.5, "#ece5d2", 7, 0.16);                                    // cross path between the two rows
    // low wall all round with a gap at the gate (north side), gate pillars either side
    const wall = (x0, x1, z0, z1) => add(box(x1 - x0, H(1.3), z1 - z0), mat("#f1ede2"), ((x0 + x1) / 2) * S, 0.12 + H(1.3) / 2, ((z0 + z1) / 2) * S), wt = 0.8;
    wall(r.x0, cx - 4, r.z0, r.z0 + wt); wall(cx + 4, r.x1, r.z0, r.z0 + wt); wall(r.x0, r.x1, r.z1 - wt, r.z1); wall(r.x0, r.x0 + wt, r.z0, r.z1); wall(r.x1 - wt, r.x1, r.z0, r.z1);
    for (const dx of [-4, 4]) add(box(1.4, H(2.6), 1.4), mat("#e6dfcc"), (cx + dx) * S, 0.12 + H(2.6) / 2, (r.z0 + 0.4) * S);
    // a cross standing where the paths meet
    { const y0 = 0.16, zc = 203; add(box(3, 0.12, 3), mat("#cfc7b0"), cx * S, y0 + 0.06, zc * S); add(box(0.5, H(7), 0.5), mat("#f6f2e6"), cx * S, y0 + 0.12 + H(3.5), zc * S); add(box(2.4, H(0.7), 0.5), mat("#f6f2e6"), cx * S, y0 + 0.12 + H(5.3), zc * S); }
    for (const [x, z, k] of [[r.x0 + 4, r.z0 + 10, 1], [r.x1 - 4, r.z0 + 10, 1.1], [r.x0 + 4, r.z1 - 5, 1.1], [r.x1 - 4, r.z1 - 5, 1], [cx, r.z1 - 5, 0.9], [r.x0 + 4, 203, 0.9], [r.x1 - 4, 203, 0.9]]) tree(x, z, k);
    // the churches: gabled nave (the extruded box from the data is the walls), front tower with a spire and cross, a dark door
    const dark = mat("#2a2f3b"), white = mat("#f6f2e6");
    for (const c of r.churches) { const w = c.w, d = c.d, top = H(c.h), yb = 0, front = c.z - d / 2;
      slab(c.x - w / 2 - 2, c.x + w / 2 + 2, front - 3, c.z + d / 2 + 1.5, "#e8e1cd", 8, 0.17); // paved forecourt and plinth
      const rise = H(w * 0.42), sh = new THREE.Shape([new THREE.Vector2(-(w / 2 + 0.8) * S, 0), new THREE.Vector2((w / 2 + 0.8) * S, 0), new THREE.Vector2(0, rise)]), g = new THREE.ExtrudeGeometry(sh, { depth: (d + 1.6) * S, bevelEnabled: false });
      add(g, mat(c.roof), c.x * S, yb + top, (front - 0.8) * S);                                  // gable roof, ridge running front to back
      const tw = 4.6, tz = front - 1.2, th = H(c.tower); add(box(tw, th, tw), mat("#efe9d8"), c.x * S, yb + th / 2, tz * S);
      add(box(tw + 0.8, 0.08, tw + 0.8), mat(c.roof), c.x * S, yb + th + 0.04, tz * S);
      const sp = H(5.5), cone = new THREE.ConeGeometry((tw * 0.75) * S, sp, 4); cone.rotateY(Math.PI / 4); add(cone, mat(c.roof), c.x * S, yb + th + 0.08 + sp / 2, tz * S);
      const cy = yb + th + 0.08 + sp; add(box(0.35, H(2.2), 0.35), white, c.x * S, cy + H(1.1), tz * S); add(box(1.3, H(0.45), 0.35), white, c.x * S, cy + H(1.5), tz * S);
      add(box(2.4, H(3.3), 0.4), dark, c.x * S, yb + H(1.65), (tz - tw / 2 - 0.1) * S, { shadow: false });   // door
      add(new THREE.CircleGeometry(0.2, 16), new THREE.MeshStandardMaterial({ color: "#7fb7e8", emissive: "#3b79b8", emissiveIntensity: 0.7, side: THREE.DoubleSide }), c.x * S, yb + th - H(2.2), (tz - tw / 2 - 0.12) * S, { shadow: false }); // round window under the spire
    }
  }
  return root;
}