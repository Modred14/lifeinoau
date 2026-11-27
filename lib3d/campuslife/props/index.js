// lib3d/campuslife/props/index.js
// Draws the solid decoration chosen by lib3d/campuslife/decor.js (stalls, hawkers' trays, signs, banners, the Main Gate, the gates of the hostel compounds): merged into a few meshes per block of campus,
// in METRES (the caller scales the group into the scene), and only drawn near the camera.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mergeParts } from "../scenery/kit.js";
import { BANNER_SIZES } from "../banners.js";
import { GATE_PILLAR, GATEHOUSE, bannerPoints, pointsOf, stallPoints } from "../decor.js";
import { FENCE_M } from "../describe.js";
import { ATLAS_SIZE, ATLAS_SIZE_LOW, FONT, cellUv, packAtlas, paintAtlas } from "./faces.js";
import { GATE_LOOK, SIGN, bannerBag, compoundGateBag, gatehouseBag, pillarBag, signBag, stallBag, trayBag } from "./shapes.js";

const NIGHT_GLOW = 0.42;
const canvasOf = (w, h) => { if (typeof document === "undefined") return null; const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const textureOf = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
function lettering(w, h, draw) { const c = canvasOf(w, h), g = c?.getContext("2d"); if (!g) return null; g.textAlign = "center"; g.textBaseline = "middle"; draw(g, w, h); return textureOf(c); }
const businessSign = () => lettering(512, 132, (g, w, h) => {
  g.fillStyle = "#f4f1e6"; g.fillRect(0, 0, w, h); g.fillStyle = "#c8322a"; g.fillRect(0, h - 12, w, 12); g.fillStyle = "#1f3b73";
  g.font = `800 54px ${FONT}`; g.fillText("BUSINESS CENTRE", w / 2, h * 0.36, w - 24); g.font = `600 26px ${FONT}`; g.fillText("Typing · Printing · Photocopy", w / 2, h * 0.72, w - 24);
});
const gateSign = () => lettering(1024, 88, (g, w, h) => { g.fillStyle = "#2f6b4f"; g.fillRect(0, 0, w, h); g.fillStyle = "#f6d55c"; g.font = `800 56px ${FONT}`; g.fillText("WELCOME · MAIN GATE", w / 2, 47, w - 30); });
const quadGeometry = (w, h) => new THREE.PlaneGeometry(w, h).toNonIndexed();

/**
 * look: oau-campuslife.json. decor: graph.campusDecor. doors: [{ x, z, nx, nz }] of the hostel compounds. Options: lite (a phone: smaller textures, shorter ranges, no shadows).
 * Returns { group, update(eye), setNight(n), setHidden(hidden(x, z)), dispose() }. A prop is hidden if any of its points is (as in the collision world).
 */
export function buildProps(look, decor, { doors = [], lite = false } = {}) {
  const group = new THREE.Group(); group.name = "campus-props";
  const CHUNK = lite ? 400 : 250, RANGE = lite ? 260 : 420, size = lite ? ATLAS_SIZE_LOW : ATLAS_SIZE;

  // ---- the banners' faces: one atlas of every artwork in every shape it is hung in ----
  const faces = [], faceAt = new Map(), faceOf = (b, slot) => {
    const shape = BANNER_SIZES[b.k].shape, a = b.a[slot] ?? b.a[0], art = look.art?.[a]; if (!shape || !art) return -1;
    const key = shape + ":" + a; let i = faceAt.get(key); if (i === undefined) { faceAt.set(key, (i = faces.length)); faces.push({ art, shape }); } return i;
  };
  for (const b of decor.banners) for (let s = 0; s < Math.max(1, BANNER_SIZES[b.k].slots); s++) faceOf(b, s);
  const cells = packAtlas(faces.map((f) => f.shape), size), atlas = faces.length ? canvasOf(size, size) : null, atlasMap = atlas && paintAtlas(atlas, faces, cells) ? textureOf(atlas) : null;

  const signMap = businessSign(), gateMap = gateSign();
  const materials = {
    solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
    canopy: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    coals: new THREE.MeshBasicMaterial({ vertexColors: true }),
    face: new THREE.MeshLambertMaterial(atlasMap ? { map: atlasMap, emissiveMap: atlasMap, emissive: 0xffffff, emissiveIntensity: 0 } : { color: 0x8b8f94 }),
    sign: new THREE.MeshBasicMaterial(signMap ? { map: signMap } : { color: 0xf4f1e6 }),
    gate: new THREE.MeshBasicMaterial(gateMap ? { map: gateMap } : { color: GATE_LOOK.trim }),
  };

  // ---- every object: the points that say whether it is in somebody's yard, and a maker of its pieces ----
  const items = [], place = (x, z, yaw) => new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  const item = (pts, make) => items.push({ pts, make }), facing = (face) => Math.atan2(Math.cos(face), Math.sin(face));
  for (const s of decor.stalls) item(stallPoints(s), () => ({ bag: stallBag(s, s[6]), matrix: place(s[0], s[1], facing(s[2])) }));
  for (const [x, z, yaw] of decor.pitches) item([[x, z]], () => ({ bag: trayBag(), matrix: place(x, z, yaw) }));
  for (const [x, z, face, stall] of decor.signs) item(stallPoints(decor.stalls[stall]), () => { const matrix = place(x, z, facing(face)); return { bag: signBag(), matrix, extra: [{ kind: "sign", geo: quadGeometry(SIGN.width, SIGN.height).translate(0, SIGN.y, SIGN.z + 0.035).applyMatrix4(matrix) }] }; });
  for (const b of decor.banners) item(bannerPoints(b), () => {
    const bag = bannerBag(b, b.i), extra = bag.quads.map((q) => {
      const f = faceOf(b, q.slot), [u0, v0, u1, v1] = cells[f] ? cellUv(cells[f], size) : [0, 0, 0, 0], uv = [];
      for (let k = 0; k < q.cols; k++) { const a = u0 + ((u1 - u0) * k) / q.cols, c = u0 + ((u1 - u0) * (k + 1)) / q.cols; uv.push(a, v0, c, v0, c, v1, a, v0, c, v1, a, v1); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(q.positions, 3)); geo.setAttribute("normal", new THREE.Float32BufferAttribute(q.normals, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      return { kind: "face", geo };
    });
    return { bag, extra };
  });
  for (const d of doors) item([[d.x, d.z]], () => ({ bag: compoundGateBag(d, FENCE_M) }));

  // ---- meshes: per block of campus; a block is built again only when something in it is taken away or put back (a home compound) ----
  const gather = (into, { bag, matrix, extra = [] }) => {
    for (const [kind, parts] of [["solid", bag.solid], ["canopy", bag.canopy], ["coals", bag.coals]]) if (parts.length) { const g = mergeParts(parts); if (matrix) g.applyMatrix4(matrix); (into[kind] ??= []).push(g); }
    for (const e of extra) (into[e.kind] ??= []).push(e.geo);
  };
  const meshOf = (kind, list) => { const geo = list.length === 1 ? list[0] : mergeGeometries(list); if (list.length > 1) list.forEach((g) => g.dispose()); const m = new THREE.Mesh(geo, materials[kind]); m.castShadow = !lite && (kind === "solid" || kind === "canopy"); m.receiveShadow = !lite && kind === "solid"; geo.computeBoundingSphere(); return m; };
  const emit = (parent, lists) => Object.entries(lists).map(([kind, list]) => { const m = meshOf(kind, list); parent.add(m); return m; });
  const drop = (meshes) => { for (const m of meshes) { m.parent?.remove(m); m.geometry.dispose(); } };
  const byBlock = new Map();
  for (const it of items) { const [x, z] = it.pts[0], i = Math.floor(x / CHUNK), j = Math.floor(z / CHUNK), key = i + "," + j; let b = byBlock.get(key); if (!b) byBlock.set(key, (b = { x: (i + 0.5) * CHUNK, z: (j + 0.5) * CHUNK, items: [], shown: null, meshes: [] })); b.items.push(it); }
  const blocks = [...byBlock.values()];

  // the Main Gate: pillars and gatehouse, and the beam over the road with the lettering on both its sides while every pillar stands
  const G = decor.gate, gate = { shown: null, meshes: [] }, gateGroup = new THREE.Group(); gateGroup.name = "main-gate"; group.add(gateGroup);
  const buildGate = (gone) => {
    const standing = G.pillars.filter((p) => !gone(p)), house = !!G.house && !gone(G.house), shown = G.pillars.map((p) => (gone(p) ? 0 : 1)).join("") + (house ? 1 : 0);
    if (shown === gate.shown) return;
    drop(gate.meshes); gate.shown = shown;
    const lists = {};
    for (const p of standing) gather(lists, { bag: pillarBag(p, GATE_PILLAR), matrix: place(p.x, p.z, G.yaw) });
    if (house) gather(lists, { bag: gatehouseBag(GATEHOUSE.half), matrix: place(G.house.x, G.house.z, G.yaw) });
    if (standing.length === G.pillars.length) {
      const a = G.pillars[0], c = G.pillars.at(-1), span = Math.hypot(c.x - a.x, c.z - a.z), matrix = place((a.x + c.x) / 2, (a.z + c.z) / 2, G.yaw);
      gather(lists, { bag: { solid: [{ geo: new THREE.BoxGeometry(span + GATE_PILLAR, 1.6, 2.2), color: GATE_LOOK.concrete, at: [0, GATE_LOOK.beamY, 0] }], canopy: [], coals: [] }, matrix });
      const w = Math.min(GATE_LOOK.sign[0], span - 1);
      for (const side of [-1, 1]) { const g = quadGeometry(w, GATE_LOOK.sign[1]); if (side < 0) g.rotateY(Math.PI); g.translate(0, GATE_LOOK.beamY, side * 1.12).applyMatrix4(matrix); (lists.gate ??= []).push(g); }
    }
    gate.meshes = emit(gateGroup, lists);
  };
  const setHidden = (hidden) => {
    const out = (pts) => !!hidden && pts.some(([x, z]) => hidden(x, z));
    for (const b of blocks) {
      const on = b.items.filter((it) => !out(it.pts)), shown = on.map((it) => b.items.indexOf(it)).join();
      if (shown === b.shown) continue;
      drop(b.meshes); b.shown = shown;
      const lists = {}; for (const it of on) gather(lists, it.make());
      b.meshes = emit(group, lists);
    }
    if (G) buildGate((p) => out(pointsOf(p)));
  };
  setHidden(null);

  return {
    group,
    /** eye: the camera's position in METRES. The gate is always drawn; the small things only from near by. */
    update(eye) { const reach = CHUNK * Math.SQRT1_2; for (const b of blocks) { const on = Math.hypot(b.x - eye.x, eye.y, b.z - eye.z) - reach < RANGE; for (const m of b.meshes) m.visible = on; } },
    setNight(n) { if (materials.face.emissiveMap) materials.face.emissiveIntensity = Math.min(1, Math.max(0, n)) * NIGHT_GLOW; },
    setHidden,
    dispose() { for (const b of blocks) drop(b.meshes); drop(gate.meshes); for (const m of Object.values(materials)) m.dispose(); atlasMap?.dispose(); signMap?.dispose(); gateMap?.dispose(); },
  };
}
