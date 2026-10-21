// lib3d/toonFigure.js
// A small jointed, low-poly person for the cutscenes (the lecturer fight, the QRS pickup). Browser only.
// Everything is in metres, the figure faces +x, stands on y = 0, and its right side is +z.
// Poses are a handful of joint angles in radians (see CHANNELS); apply(target, k) eases the figure towards a pose.
import * as THREE from "three";

const mats = new Map();
/** One shared material per colour: there can be a dozen people on screen. */
export const mat = (color, o = {}) => {
  const k = color + JSON.stringify(o);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...o }));
  return mats.get(k);
};

/** Joint angles. Arms: s = swing forward, a = out to the side, e = elbow bend. Legs: h = hip swing forward, k = knee bend. */
export const CHANNELS = ["hipsY", "lean", "sway", "twist", "chest", "headX", "headZ", "headY", "aRs", "aRa", "aRe", "aLs", "aLa", "aLe", "lRh", "lRk", "lLh", "lLk"];
const ZERO = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
export const pose = (o = {}) => ({ ...ZERO, ...o });

function textTexture(text, { w = 256, h = 128, bg = "#c8e61a", fg = "#1b2a49", font = "800 78px system-ui, sans-serif" } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/**
 * makeFigure({ skin, top, bottom, shoe, hair, hairColor, long (sleeves), width, belly, tie, glasses, vest, cap, scale })
 * hair: "short" | "afro" | "long" | "bun" | "none".  Returns { root, hips, apply(target, k), expr(name), height, dispose() }.
 */
export function makeFigure(o = {}) {
  const { skin = "#7f5236", top = "#1f2f55", bottom = "#a8946a", shoe = "#1d1f23", hair = "short", hairColor = "#16110e", long = false, width = 1, belly = 0, tie = null, glasses = false, vest = false, police = false, cap = null, scale = 0.96 } = o;
  const geos = [], root = new THREE.Group(), hips = new THREE.Group(); hips.position.y = 0.97; root.add(hips);
  const add = (parent, geo, material, x = 0, y = 0, z = 0) => { geos.push(geo); const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const skinM = mat(skin), topM = mat(top), botM = mat(bottom);

  add(hips, new THREE.BoxGeometry(0.24, 0.2, 0.34 * width), botM, 0, 0, 0);
  const torso = new THREE.Group(); torso.position.y = 0.08; hips.add(torso);
  add(torso, new THREE.BoxGeometry(0.22, 0.5, 0.38 * width), topM, 0, 0.25, 0);
  if (belly) { const b = add(torso, new THREE.SphereGeometry(0.17, 14, 10), topM, 0.07, 0.12, 0); b.scale.set(0.8 + belly * 0.5, 1, 1.1 * width); }
  if (tie) { add(torso, new THREE.BoxGeometry(0.02, 0.3, 0.06), mat(tie), 0.115 + belly * 0.04, 0.27, 0); add(torso, new THREE.BoxGeometry(0.02, 0.18, 0.11), mat("#f2f2ee"), 0.113, 0.4, 0); }
  if (vest) {
    const vm = mat("#c8e61a", { roughness: 0.55, emissive: "#3a4a00", emissiveIntensity: 0.35 }), st = mat("#e8ecef", { roughness: 0.4, emissive: "#555", emissiveIntensity: 0.4 });
    add(torso, new THREE.BoxGeometry(0.245, 0.42, 0.4 * width), vm, 0, 0.27, 0);
    add(torso, new THREE.BoxGeometry(0.25, 0.04, 0.405 * width), st, 0, 0.2, 0); add(torso, new THREE.BoxGeometry(0.25, 0.04, 0.405 * width), st, 0, 0.36, 0);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshBasicMaterial({ map: textTexture("QRS", { w: 256, h: 128 }) })); geos.push(back.geometry);
    back.position.set(-0.126, 0.3, 0); back.rotation.y = -Math.PI / 2; torso.add(back);
  }

  if (police) { // N-QRS patrol uniform: a crisp navy shirt with epaulettes and a chest badge, a duty belt (radio, baton, cuffs, holster) and a black tie. Nothing medical: no hi-vis, no white.
    const navy = mat("#1d2b47"), blk = mat("#0e121c", { roughness: 0.5 }), gold = mat("#e8b83a", { metalness: 0.6, roughness: 0.35 }), steel = mat("#aab2bd", { metalness: 0.7, roughness: 0.3 });
    add(torso, new THREE.BoxGeometry(0.235, 0.34, 0.4 * width), navy, 0, 0.3, 0); // the shirt, a touch fuller than the body
    add(torso, new THREE.BoxGeometry(0.02, 0.28, 0.05), blk, 0.118 + belly * 0.04, 0.3, 0); // tie
    for (const s of [1, -1]) { add(torso, new THREE.BoxGeometry(0.07, 0.016, 0.1), blk, 0, 0.5, 0.2 * s * width); add(torso, new THREE.BoxGeometry(0.05, 0.004, 0.02), gold, 0, 0.51, 0.2 * s * width); } // epaulettes
    const badge = add(torso, new THREE.CylinderGeometry(0.035, 0.035, 0.008, 6), gold, 0.122 + belly * 0.04, 0.38, 0.1 * width); badge.rotation.z = Math.PI / 2; // badge on the left chest
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshBasicMaterial({ map: textTexture("N-QRS", { w: 256, h: 128, bg: "#1d2b47", fg: "#e8b83a", font: "800 70px system-ui, sans-serif" }) })); geos.push(patch.geometry);
    patch.position.set(-0.121, 0.34, 0); patch.rotation.y = -Math.PI / 2; torso.add(patch); // N-QRS across the back
    add(hips, new THREE.BoxGeometry(0.26, 0.05, 0.36 * width), blk, 0, 0.06, 0); // duty belt
    add(hips, new THREE.BoxGeometry(0.06, 0.05, 0.03), gold, 0.13, 0.06, 0); // buckle
    add(hips, new THREE.BoxGeometry(0.05, 0.12, 0.06), blk, 0.02, -0.02, 0.19 * width); // holster, right hip
    add(hips, new THREE.BoxGeometry(0.04, 0.1, 0.05), blk, 0.0, -0.01, -0.19 * width); // cuff pouch, left hip
    const bat = add(hips, new THREE.CylinderGeometry(0.014, 0.012, 0.3, 8), blk, -0.06, -0.12, -0.19 * width); bat.rotation.x = 0.12; // baton
    add(torso, new THREE.BoxGeometry(0.04, 0.09, 0.05), blk, 0.04, 0.5, -0.12 * width); add(torso, new THREE.BoxGeometry(0.01, 0.07, 0.01), steel, 0.04, 0.58, -0.13 * width); // shoulder radio and its antenna
  }
  const neckAt = 0.5; add(torso, new THREE.CylinderGeometry(0.04, 0.045, 0.08, 8), skinM, 0, neckAt + 0.02, 0);
  const head = new THREE.Group(); head.position.y = neckAt + 0.07; torso.add(head);
  const skull = add(head, new THREE.SphereGeometry(0.115, 18, 14), skinM, 0, 0.115, 0); skull.scale.set(0.95, 1.08, 0.9);
  const eyeM = mat("#15100d", { roughness: 0.4 }), eyes = [1, -1].map((s) => add(head, new THREE.SphereGeometry(0.017, 8, 6), eyeM, 0.099, 0.135, 0.045 * s));
  const brows = [1, -1].map((s) => add(head, new THREE.BoxGeometry(0.012, 0.014, 0.06), mat(hairColor), 0.104, 0.172, 0.048 * s));
  add(head, new THREE.BoxGeometry(0.03, 0.04, 0.03), skinM, 0.112, 0.105, 0);
  const mouth = add(head, new THREE.BoxGeometry(0.01, 0.012, 0.05), mat("#2a0f10"), 0.106, 0.06, 0);
  if (glasses) for (const s of [1, -1]) { const g = add(head, new THREE.TorusGeometry(0.03, 0.004, 6, 16), mat("#1a1a1a", { metalness: 0.6 }), 0.108, 0.135, 0.047 * s); g.rotation.y = Math.PI / 2; }
  if (glasses) add(head, new THREE.BoxGeometry(0.004, 0.004, 0.03), mat("#1a1a1a"), 0.108, 0.14, 0);
  const hm = mat(hairColor, { roughness: 0.9 });
  if (hair !== "none") {
    if (hair === "afro") add(head, new THREE.SphereGeometry(0.17, 14, 12), hm, -0.02, 0.17, 0);
    else {
      const capH = add(head, new THREE.SphereGeometry(0.124, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hm, -0.012, 0.125, 0); capH.scale.set(1, 1.05, 0.96); capH.rotation.z = 0.1;
      if (hair === "long") add(head, new THREE.BoxGeometry(0.06, 0.34, 0.22), hm, -0.1, 0.0, 0);
      if (hair === "bun") add(head, new THREE.SphereGeometry(0.06, 10, 8), hm, -0.07, 0.25, 0);
    }
  }
  if (cap) {
    const cm = mat(cap); add(head, new THREE.CylinderGeometry(0.13, 0.135, 0.06, 16), cm, 0, 0.215, 0); add(head, new THREE.BoxGeometry(0.1, 0.012, 0.18), cm, 0.13, 0.205, 0);
    if (police) { add(head, new THREE.CylinderGeometry(0.142, 0.142, 0.03, 16), cm, 0, 0.25, 0); add(head, new THREE.BoxGeometry(0.1, 0.012, 0.19), mat("#0b0e16", { roughness: 0.3 }), 0.14, 0.2, 0); add(head, new THREE.BoxGeometry(0.01, 0.012, 0.2), mat("#e8b83a"), 0.0, 0.232, 0); } // peaked patrol cap with a gold band
    add(head, new THREE.BoxGeometry(0.02, 0.025, 0.04), mat("#e8b83a", { metalness: 0.5 }), 0.133, 0.225, 0);
  }

  // arms: shoulder -> elbow -> hand. Right is +z.
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(0, 0.45, 0.2 * side * width); torso.add(sh);
    add(sh, new THREE.SphereGeometry(0.058, 10, 8), topM, 0, 0, 0);
    add(sh, new THREE.CylinderGeometry(0.052, 0.046, 0.28, 10), topM, 0, -0.14, 0);
    const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
    add(el, new THREE.CylinderGeometry(0.044, 0.04, 0.26, 10), long ? topM : skinM, 0, -0.13, 0);
    add(el, new THREE.SphereGeometry(0.048, 10, 8), skinM, 0, -0.285, 0);
    return { sh, el };
  };
  const aR = arm(1), aL = arm(-1);
  const leg = (side) => {
    const hp = new THREE.Group(); hp.position.set(0, -0.07, 0.1 * side * width); hips.add(hp);
    add(hp, new THREE.CylinderGeometry(0.078, 0.062, 0.44, 10), botM, 0, -0.22, 0);
    const kn = new THREE.Group(); kn.position.y = -0.44; hp.add(kn);
    add(kn, new THREE.CylinderGeometry(0.06, 0.05, 0.42, 10), botM, 0, -0.21, 0);
    add(kn, new THREE.BoxGeometry(0.24, 0.075, 0.105), mat(shoe, { roughness: 0.5 }), 0.05, -0.42, 0);
    return { hp, kn };
  };
  const lR = leg(1), lL = leg(-1);

  const cur = { ...ZERO };
  function apply(target = ZERO, k = 1) {
    for (const c of CHANNELS) cur[c] += ((target[c] ?? 0) - cur[c]) * k;
    hips.position.y = 0.97 + cur.hipsY; hips.rotation.z = -cur.lean; hips.rotation.x = cur.sway; torso.rotation.y = cur.twist; torso.rotation.z = -cur.chest;
    head.rotation.z = -cur.headX; head.rotation.x = cur.headZ; head.rotation.y = cur.headY;
    aR.sh.rotation.z = cur.aRs; aR.sh.rotation.x = -cur.aRa; aR.el.rotation.z = cur.aRe;
    aL.sh.rotation.z = cur.aLs; aL.sh.rotation.x = cur.aLa; aL.el.rotation.z = cur.aLe;
    lR.hp.rotation.z = cur.lRh; lR.kn.rotation.z = -cur.lRk; lL.hp.rotation.z = cur.lLh; lL.kn.rotation.z = -cur.lLk;
  }
  /** Face: "normal" | "angry" | "shock" | "ko". */
  function expr(name) {
    const e = { normal: [1, 0.35, 0, 0], angry: [0.8, 0.8, -0.45, 0], shock: [1.7, 2.6, 0.25, 0], ko: [0.12, 1.2, 0, 0], grin: [0.7, 0.9, -0.1, 0] }[name] ?? [1, 0.35, 0, 0];
    eyes.forEach((m) => m.scale.set(1, e[0], 1)); mouth.scale.set(1, e[1] * 1.2, name === "grin" ? 1.7 : 1);
    brows[0].rotation.x = e[2]; brows[1].rotation.x = -e[2];
  }
  root.scale.setScalar(scale); expr("normal");
  return { root, hips, torso, head, apply, expr, height: 1.8 * scale, dispose() { geos.forEach((g) => g.dispose()); } };
}