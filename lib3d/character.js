// lib3d/character.js
// A stylised human built from smooth shapes (no model files needed). Runs in the browser only.
import * as THREE from "three";
import { SKIN_TONES, ACCENTS, cleanLook } from "../lib/look.js";

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...o });
const darker = (hex, f) => "#" + new THREE.Color(hex).multiplyScalar(f).getHexString();

function fabricMap(kind, accent) {
  if (kind === "plain") return null;
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  if (kind === "ankara") { // wax-print: bold rings and leaf shapes
    g.fillStyle = accent; g.fillRect(0, 0, 256, 256);
    const cols = ["#f3e2b0", "#17181a", "#c8372d", "#1d7c8c"];
    for (const [cx, cy] of [[64, 64], [192, 64], [64, 192], [192, 192]]) for (let r = 54, i = 0; r > 6; r -= 9, i++) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = cols[i % 4]; g.fill(); }
    g.fillStyle = "#f3e2b0"; for (const [x, y] of [[128, 0], [128, 128], [0, 128], [256, 128], [128, 256]]) for (const a of [0.8, -0.8]) { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, 22, 7, 0, 0, 7); g.fill(); g.restore(); }
  } else if (kind === "adire") { // indigo with white resist-dye circles
    g.fillStyle = "#18255a"; g.fillRect(0, 0, 256, 256); g.strokeStyle = "#e9efff"; g.lineWidth = 3;
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let r = 4; r < 26; r += 6) { g.beginPath(); g.arc(32 + x * 64, 32 + y * 64, r, 0, Math.PI * 2); g.stroke(); }
    g.lineWidth = 2; for (let i = 0; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  } else { // aso-oke: woven stripes
    g.fillStyle = accent; g.fillRect(0, 0, 256, 256);
    const cols = ["#f1d98d", "#7d1f2b", "#1f5a3a", "#f1d98d"];
    for (let x = 0; x < 256; x += 32) { g.fillStyle = cols[(x / 32) % 4]; g.fillRect(x, 0, 12, 256); g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(x + 14, 0, 2, 256); }
    g.fillStyle = "rgba(0,0,0,.12)"; for (let y = 0; y < 256; y += 4) g.fillRect(0, y, 256, 1);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const latheOf = (pts, seg = 40) => new THREE.LatheGeometry([...pts].sort((a, b) => a[1] - b[1]).map(([r, y]) => new THREE.Vector2(r, y)), seg); // sorted bottom-to-top so faces point outward
function limb(parent, r1, r2, len, mat, x, y, z) { // a tapered limb segment hanging down from (x,y,z)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 20, 1), mat); m.position.set(x, y - len / 2, z); m.castShadow = true; parent.add(m);
  for (const [yy, rr] of [[y, r1], [y - len, r2]]) { const s = new THREE.Mesh(new THREE.SphereGeometry(rr, 18, 14), mat); s.position.set(x, yy, z); s.castShadow = true; parent.add(s); }
  return m;
}

export function buildCharacter(lookIn, gender = "F") {
  const look = cleanLook(lookIn, gender), F = gender === "F";
  const accent = ACCENTS[look.accent], skinHex = SKIN_TONES[look.skin];
  const skin = std(skinHex, { roughness: 0.5, emissive: new THREE.Color(skinHex).multiplyScalar(0.07) }), lip = std(new THREE.Color(skinHex).multiplyScalar(0.86).lerp(new THREE.Color("#8a3a3a"), 0.22), { roughness: 0.45 });
  const hairMat = std("#120e0c", { roughness: 0.85 });
  const map = fabricMap(look.fabric, accent), fab = std(map ? "#ffffff" : accent, { map, roughness: 0.8 });
  // Distinct male and female builds: men get broad shoulders, a thick neck, heavy limbs and a straight torso; women get narrow shoulders, a slim neck, a small waist and wide hips.
  const P = F ? { sc: 0.96, sh: 0.172, chest: 0.142, waist: 0.104, hip: 0.186, thigh: 0.086, neck: 0.043, arm: 0.86, lg: 0.94, depth: 0.62 }
              : { sc: 1.04, sh: 0.258, chest: 0.205, waist: 0.172, hip: 0.158, thigh: 0.098, neck: 0.068, arm: 1.22, lg: 1.12, depth: 0.7 };
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); body.scale.setScalar(P.sc);
  const add = (geo, mat, x = 0, y = 0, z = 0, p = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; p.add(m); return m; };

  // ---- body ----
  const torsoPts = [[P.hip * 0.86, 0.86], [P.hip, 0.93], [P.waist, 1.08], [P.chest, 1.27], [P.sh * 0.84, 1.37], [P.sh * 0.6, 1.415], [0.1, 1.46], [0.058, 1.50]];
  const torso = add(latheOf(torsoPts), skin); torso.scale.set(1.12, 1, P.depth);
  add(new THREE.CylinderGeometry(P.neck, P.neck * 1.2, 0.14, 24), skin, 0, 1.53, 0.006);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(F ? 0.05 : 0.07, 20, 16), skin, s * P.sh, 1.4, 0);
  const pelvis = add(new THREE.SphereGeometry(P.hip * 0.97, 24, 18), skin, 0, 0.9, 0); pelvis.scale.set(1.08, 0.72, 0.62);
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * (P.sh + 0.006), 1.405, 0); arm.rotation.z = s * 0.17; body.add(arm);
    const A = P.arm; limb(arm, 0.052 * A, 0.042 * A, 0.28, skin, 0, 0, 0); const fore = new THREE.Group(); fore.position.set(0, -0.28, 0); fore.rotation.x = -0.14; arm.add(fore);
    limb(fore, 0.042 * A, 0.032 * A, 0.25, skin, 0, 0, 0); add(new THREE.SphereGeometry(0.036 * (F ? 0.9 : 1.2), 16, 12), skin, 0, -0.29, 0.004, fore).scale.set(0.8, 1.25, 0.6);
    arms.push({ arm, fore, s });
    const leg = new THREE.Group(); leg.position.set(s * P.hip * 0.5, 0.92, 0); body.add(leg);
    limb(leg, P.thigh * 1.08, 0.062 * P.lg, 0.43, skin, 0, 0, 0); limb(leg, 0.062 * P.lg, 0.042 * P.lg, 0.42, skin, 0, -0.43, 0.004); add(new THREE.SphereGeometry(0.056 * P.lg, 18, 14), skin, 0, -0.6, -0.012, leg).scale.set(1, 1.7, 1.05);
    add(new THREE.SphereGeometry(0.05, 16, 12), skin, 0, -0.865, 0.04, leg).scale.set(0.95, 0.55, 1.65);
    legs.push({ leg, s });
  }

  // ---- head and face ----
  const head = new THREE.Group(); head.position.set(0, 1.64, 0.006); head.scale.setScalar(F ? 1.04 : 1.1); body.add(head);
  add(new THREE.SphereGeometry(0.105, 36, 28), skin, 0, 0, 0, head).scale.set(0.9, 1.12, 1.0);
  add(new THREE.SphereGeometry(0.07, 28, 22), skin, 0, -0.046, 0.026, head).scale.set(F ? 0.88 : 1.12, F ? 0.82 : 0.92, 0.9); // jaw and chin: soft and narrow for women, square and wide for men
  if (!F) add(new THREE.SphereGeometry(0.03, 16, 12), skin, 0, -0.095, 0.05, head).scale.set(1.5, 0.7, 0.8); // stronger chin
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(F ? 0.019 : 0.024, 14, 10), skin, s * 0.093, -0.004, -0.004, head).scale.set(0.5, 1.2, 0.8);
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(s * 0.04, 0.012, 0.088); head.add(eye); eyes.push(eye);
    add(new THREE.SphereGeometry(0.0195, 18, 14), std("#f4f0ea", { roughness: 0.2 }), 0, 0, 0, eye).scale.set(1.2, 0.8, 0.55);
    add(new THREE.SphereGeometry(0.0108, 14, 12), std("#2a1a10", { roughness: 0.15 }), 0, 0, 0.008, eye);
    add(new THREE.SphereGeometry(0.0055, 10, 8), std("#050302"), 0, 0, 0.0135, eye);
    const lid = add(new THREE.CapsuleGeometry(F ? 0.0052 : 0.0034, F ? 0.042 : 0.036, 4, 8), std("#0c0807"), 0, F ? 0.0125 : 0.0115, 0.0045, eye); // women: heavier lash line
    if (F) { const lash = add(new THREE.CapsuleGeometry(0.0022, 0.012, 3, 6), std("#0c0807"), s * 0.021, 0.014, 0.006, eye); lash.rotation.z = -s * 0.9; } lid.rotation.z = Math.PI / 2 + s * 0.06; lid.scale.z = 0.8;
    const brow = add(new THREE.CapsuleGeometry(F ? 0.0028 : 0.0058, F ? 0.034 : 0.04, 4, 8), hairMat, s * 0.042, F ? 0.062 : 0.052, 0.088, head); brow.rotation.z = Math.PI / 2 + s * (F ? 0.22 : 0.08); // women: thin arched brows, men: straight and heavy
  }
  add(new THREE.CapsuleGeometry(0.0075, 0.03, 4, 10), skin, 0, -0.008, 0.098, head).rotation.x = -0.2; add(new THREE.SphereGeometry(F ? 0.0135 : 0.0165, 16, 12), skin, 0, -0.026, 0.106, head).scale.set(F ? 1.1 : 1.35, 0.9, 1.0); // nose
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.0072, 10, 8), skin, s * 0.011, -0.03, 0.1, head);
  add(new THREE.SphereGeometry(0.026, 18, 12), lip, 0, -0.062, 0.094, head).scale.set(F ? 1.55 : 1.4, F ? 0.5 : 0.3, 0.6); // women: fuller lips, men: thinner
  add(new THREE.SphereGeometry(0.0235, 18, 12), lip, 0, -0.0745, 0.09, head).scale.set(F ? 1.5 : 1.35, F ? 0.62 : 0.36, 0.6);

  // ---- hair ----
  const cap = (r = 0.111, len = 0.56) => { const m = add(new THREE.SphereGeometry(r, 32, 22, 0, Math.PI * 2, 0, Math.PI * (len - 0.04)), hairMat, 0, 0.006, -0.012, head); m.scale.set(0.93, 1.13, 1.03); m.rotation.x = -0.3; return m; };
  const strands = (n, rad, len, spread, yBase = 0.02, back = true) => { const rnd = mulberry(7);
    for (let i = 0; i < n; i++) { const a = (back ? Math.PI * 0.62 : 0) + (rnd() - 0.5) * spread * Math.PI * 2 + (back ? 0 : 0), ph = 0.5 + rnd() * 0.5;
      const L = len * (0.75 + rnd() * 0.5), m = add(new THREE.CapsuleGeometry(rad, L, 4, 8), hairMat, Math.sin(a) * 0.1 * ph, yBase - L / 2 - 0.02, Math.cos(a) * 0.1 * ph - 0.04, head); m.rotation.set((rnd() - 0.5) * 0.12, 0, (rnd() - 0.5) * 0.12); } };
  switch (look.hair) {
    case "lowcut": cap(0.108, 0.5); break;
    case "classic": cap(0.113, 0.6); add(new THREE.SphereGeometry(0.06, 20, 14), hairMat, 0.02, 0.11, 0.02, head).scale.set(1.3, 0.6, 1.2); break;
    case "afro": { const g = new THREE.SphereGeometry(0.168, 56, 40), pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = 1 + 0.035 * Math.sin(x * 70) * Math.sin(y * 64 + 1) * Math.cos(z * 58); pos.setXYZ(i, x * k, y * k, z * k); } g.computeVertexNormals();
      add(g, hairMat, 0, 0.062, -0.07, head).scale.set(1, 0.94, 0.9); cap(0.108, 0.46); break; }
    case "bun": cap(0.111, 0.58); add(new THREE.SphereGeometry(0.058, 22, 16), hairMat, 0, 0.128, -0.045, head); break;
    case "ponytail": cap(0.111, 0.58); { const t = add(new THREE.CapsuleGeometry(0.03, 0.3, 6, 12), hairMat, 0, -0.03, -0.14, head); t.rotation.x = 0.5; } break;
    case "long": cap(0.113, 0.6); { const sheet = add(new THREE.CylinderGeometry(0.118, 0.13, 0.46, 28, 1, true, Math.PI * 0.62, Math.PI * 0.76), hairMat, 0, -0.17, -0.02, head); sheet.material = hairMat.clone(); sheet.material.side = THREE.DoubleSide; } break;
    case "braids": cap(0.111, 0.58); strands(46, 0.0075, 0.43, 0.46); break;
    case "locs": cap(0.112, 0.6); strands(38, 0.0125, 0.26, 0.5); break;
    case "gele": { cap(0.108, 0.5); const w = fab;
      for (let i = 0; i < 3; i++) { const t = add(new THREE.TorusGeometry(0.1 + i * 0.006, 0.036, 14, 32), w, 0, 0.055 + i * 0.045, 0, head); t.rotation.x = Math.PI / 2 + 0.18; t.scale.set(1, 1.1, 1); }
      const fan = add(new THREE.CylinderGeometry(0.11, 0.07, 0.04, 20, 1), w, 0.05, 0.185, 0.04, head); fan.rotation.set(0.4, 0, -0.5); fan.scale.set(1.5, 1, 0.8); break; }
  }

  // ---- clothes ----
  const sleeve = (len, bot = 0.056) => { bot *= P.arm; for (const { arm, fore } of arms) { const up = Math.min(len, 0.28);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.061 * P.arm, len <= 0.28 ? bot : 0.054 * P.arm, up, 18), CL.top); m.position.set(0, -up / 2 + 0.01, 0); m.castShadow = true; arm.add(m);
    if (len > 0.28) { const fl = len - 0.28, f = new THREE.Mesh(new THREE.CylinderGeometry(0.054 * P.arm, bot, fl, 18), CL.top); f.position.set(0, -fl / 2 + 0.005, 0); f.castShadow = true; fore.add(f); } } };
  const flat = (g) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.094, 0.5); return g; }; // one plain spot of the fabric
  const shell = (pts, mat, sz = P.depth + 0.08) => { const m = add(latheOf(pts.map(([r, y]) => [r + 0.009, y])), mat); m.scale.set(1.12, 1, sz); for (const s of [-1, 1]) add(flat(new THREE.SphereGeometry(F ? 0.056 : 0.077, 20, 16)), mat, s * P.sh, 1.4, 0); return m; };
  const trousers = (mat, flare = 1) => { const g = P.lg; add(new THREE.SphereGeometry(P.hip * 0.88, 22, 16), mat, 0, 0.88, 0).scale.set(1.02, 0.7, 0.56); for (const { leg } of legs) { const a = new THREE.Mesh(new THREE.CylinderGeometry(P.thigh * 1.06, 0.067 * g * flare, 0.43, 20), mat); a.position.y = -0.225; a.castShadow = true; leg.add(a);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.067 * g * flare, 0.05 * g * flare, 0.42, 20), mat); b.position.set(0, -0.64, 0.004); b.castShadow = true; leg.add(b); } };
  const shoes = (mat, tall = 0) => { for (const { leg } of legs) { const s = add(new THREE.SphereGeometry(0.056, 18, 14), mat, 0, -0.9, 0.045, leg); s.scale.set(0.95, 0.62 + tall, 1.95); if (tall) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.052, 0.14, 16), mat); b.position.set(0, -0.82, 0.004); leg.add(b); } } };
  const jeans = std("#2d4263", { roughness: 0.85 }), dark = std("#1d2026", { roughness: 0.8 }), white = std("#ecebe6", { roughness: 0.7 }), tee = std(darker(accent, 0.8), { roughness: 0.8 });
  const CL = { top: white };
  const fullTop = [...(F ? [[P.hip * 1.18, 0.72], [P.hip * 1.12, 0.8]] : [[P.hip * 1.12, 0.8]]), [P.hip * 1.04, 0.88], [P.hip, 0.93], [P.waist, 1.08], [P.chest, 1.27], [P.sh * 0.84, 1.37], [P.sh * 0.6, 1.415], [0.105, 1.46], [0.064, 1.5]];
  switch (look.outfit) {
    case "casual": CL.top = tee; shell(fullTop, tee); sleeve(0.13, 0.057); trousers(jeans); shoes(white); break;
    case "office": CL.top = F ? std(darker(accent, 1.1)) : white; shell(fullTop, CL.top); sleeve(0.5, 0.05);
      if (F) { const sk = add(latheOf([[P.waist + 0.016, 1.02], [P.hip + 0.03, 0.88], [P.hip + 0.026, 0.6], [P.hip * 0.82, 0.5]]), dark); sk.scale.set(1.1, 1, 0.68); shoes(dark); }
      else { trousers(dark); shoes(dark); add(new THREE.BoxGeometry(0.034, 0.22, 0.012), std(accent), 0, 1.22, 0.172); }
      break;
    case "owambe": CL.top = fab;
      if (F) { shell(fullTop, fab); sleeve(0.2, 0.078); const iro = add(latheOf([[P.waist + 0.012, 1.1], [P.hip + 0.04, 0.92], [P.hip + 0.075, 0.5], [P.hip + 0.1, 0.06]]), fab); iro.scale.z = 0.8; shoes(std("#c9a24a", { metalness: 0.4, roughness: 0.4 })); }
      else { const top = std(darker(accent, 0.55)); CL.top = fab; shell(fullTop, top); trousers(std(darker(accent, 0.55))); shoes(std("#2a1d17"));
        const robe = add(latheOf([[0.07, 1.47], [P.sh * 0.95, 1.4], [0.27, 1.12], [0.34, 0.55], [0.4, 0.2]]), fab); robe.scale.z = 0.72; sleeve(0.34, 0.11);
        add(new THREE.CylinderGeometry(0.075, 0.095, 0.1, 20), top, 0, 1.76, 0.0, head).position.y = 0.14; } break;
    case "sitework": CL.top = std("#4b5560"); shell(fullTop, CL.top); sleeve(0.16, 0.057); trousers(std("#3a3f47")); shoes(std("#3b2a1f"), 0.5);
      { const v = std("#e8631f", { roughness: 0.6 }); shell([[P.hip * 0.9, 0.95], [P.waist, 1.08], [P.chest, 1.26], [P.sh * 0.78, 1.37], [P.sh * 0.5, 1.4]].map(([r, y]) => [r + 0.012, y]), v);
        const stripe = std("#d8dde0", { metalness: 0.3, roughness: 0.4 }), vestR = (y) => (y < 1.08 ? P.waist + (1.08 - y) * 0.5 + 0.02 : P.waist + (y - 1.08) * 0.9 + 0.02);
        for (const y of [1.0, 1.14]) { const st = add(new THREE.CylinderGeometry(vestR(y) + 0.012, vestR(y) + 0.012, 0.028, 40, 1, true), stripe, 0, y, 0); st.scale.set(1.12, 1, 0.64); } } break;
  }

  // women: a bust under the top (a lathe body is round, so it is added as two shapes in the top's fabric)
  if (F && look.outfit !== "owambe") for (const s of [-1, 1]) add(new THREE.SphereGeometry(look.outfit === "sitework" ? 0.034 : 0.042, 22, 16), CL.top, s * 0.048, 1.185, P.depth * 0.146 - 0.002).scale.set(1.05, 0.9, 0.62);

  // ---- life ----
  const bodyBase = { sh: body.scale.y };
  function update(t) {
    body.scale.y = P.sc * (1 + Math.sin(t * 1.7) * 0.0035); head.rotation.y = Math.sin(t * 0.55) * 0.12; head.rotation.x = Math.sin(t * 0.37) * 0.025;
    arms.forEach(({ arm, s }, i) => { arm.rotation.x = Math.sin(t * 1.1 + i) * 0.03; arm.rotation.z = s * (0.17 + Math.sin(t * 1.7) * 0.006); });
    const blink = (t % 4.3) < 0.13 ? 0.1 : 1; eyes.forEach((e) => (e.scale.y = blink)); body.position.y = 0;
  }
  const dispose = () => root.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose(); }); });
  return { root, update, dispose, height: 1.76 * P.sc };
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Soft three-point lighting that flatters faces. Returns the key light so callers can tune shadows. */
export function addCharacterLights(scene) {
  scene.add(new THREE.HemisphereLight(0xc4d6ff, 0x7a6350, 0.95));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.5); key.position.set(2.6, 4.2, 3.4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.5, bottom: -1, near: 0.5, far: 12 }); key.shadow.bias = -0.0004; scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe0c4, 0.9); fill.position.set(-1.5, 0.8, 3.5); scene.add(fill); // lifts the chin and eyes
  const rim = new THREE.DirectionalLight(0x7fb0ff, 1.6); rim.position.set(-3, 2.4, -3); scene.add(rim);
  return key;
}