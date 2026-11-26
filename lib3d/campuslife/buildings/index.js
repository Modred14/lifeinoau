// lib3d/campuslife/buildings/index.js
// All the buildings of the map in the Campuslife look, merged into one mesh per ~250 m block of campus, all sharing one painted facade atlas. Positions are in METRES (x east, y up, z south): the caller
// scales the group into the scene. paintAtlas works on plain pixel arrays, so this runs in Node as well as in the browser.
import * as THREE from "three";
import { buildBuilding } from "./archetypes.js";
import { paintAtlas } from "./atlas.js";
import { ROW } from "./atlas-layout.js";
import { classify } from "./classify.js";
import { footprintOf, outward } from "./footprint.js";
import { flatRoof } from "./roofs.js";
import { emptyBuffers, shade } from "./types.js";
import { wallRun } from "./walls.js";

const NIGHT_GLOW = 0xffd28a, NIGHT_GLOW_STRENGTH = 0.8;
export const CHUNK_M = 250;

function dataTexture(data, width, height) {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

/** The one material every building shares. setNight(0..1) lights the windows. */
export function createBuildingLook() {
  const atlas = paintAtlas(), map = dataTexture(atlas.color, atlas.width, atlas.height), glow = dataTexture(atlas.glow, atlas.glowWidth, atlas.glowHeight);
  const material = new THREE.MeshLambertMaterial({ map, vertexColors: true, emissive: NIGHT_GLOW, emissiveMap: glow, emissiveIntensity: 0 });
  return { material, setNight(night) { material.emissiveIntensity = night * NIGHT_GLOW_STRENGTH; }, dispose() { map.dispose(); glow.dispose(); material.dispose(); } };
}

/** Walls straight up to exactly `b.height` under a flat cap: for the churches (lib3d/grounds.js sets its own gable roof on top) and for any footprint the detailed builder cannot take. */
function buildPlain(buf, b) {
  const fp = footprintOf(b.poly, b.id); if (fp.pts.length < 3) return;
  const spec = { ...classify(b, fp), floors: 1, storey: b.height }, n = fp.pts.length;
  for (let i = 0; i < n; i++) { const p = fp.pts[i], q = fp.pts[(i + 1) % n]; wallRun(buf, { a: p, b: q, normal: outward(fp, p, q), row: ROW.worship, groundRow: ROW.worship, salt: i }, spec, b.id, b.height, spec.wall); }
  flatRoof(buf, fp, b.height, b.height, spec.roofColor, shade(spec.wall, 0.8));
}

/**
 * list: [{ id, poly: [x, z, x, z, ...] metres, bbox: { x, y, w, h }, height, kind, name?, preset?, paint?, plain? }]
 * Returns { chunks: [{ buf, ranges: [{ bid, v0, v1 }] }], tops: Map(id -> highest point drawn, metres), failed: [ids drawn plain after an error, or not at all] }.
 */
export function buildCampusBuildings(list, chunkSize = CHUNK_M) {
  const chunks = new Map(), tops = new Map(), failed = [];
  for (const b of list) {
    const key = `${Math.floor((b.bbox.x + b.bbox.w / 2) / chunkSize)},${Math.floor((b.bbox.y + b.bbox.h / 2) / chunkSize)}`;
    let c = chunks.get(key); if (!c) chunks.set(key, (c = { buf: emptyBuffers(), ranges: [] }));
    const { buf } = c, mark = [buf.pos.length, buf.uv.length, buf.col.length, buf.idx.length], rewind = () => { [buf.pos.length, buf.uv.length, buf.col.length, buf.idx.length] = mark; };
    try { (b.plain ? buildPlain : buildBuilding)(buf, b); }
    catch { rewind(); failed.push(b.id); try { buildPlain(buf, b); } catch { rewind(); /* a malformed footprint is skipped, never fatal */ } }
    if (buf.pos.length === mark[0]) continue;
    let top = 0; for (let i = mark[0] + 1; i < buf.pos.length; i += 3) top = Math.max(top, buf.pos[i]);
    tops.set(b.id, top); c.ranges.push({ bid: b.id, v0: mark[0] / 3, v1: buf.pos.length / 3 });
  }
  return { chunks: [...chunks.values()].filter((c) => c.ranges.length), tops, failed };
}

export function chunkGeometry(buf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(buf.pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(buf.uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(buf.col, 3));
  g.setIndex(buf.idx); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

/** Which building the vertex `v` of a chunk belongs to (ranges are in drawing order), or null. */
export function buildingAt(ranges, v) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, r = ranges[m]; if (v < r.v0) hi = m - 1; else if (v >= r.v1) lo = m + 1; else return r.bid; }
  return null;
}
