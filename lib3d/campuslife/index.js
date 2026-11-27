// lib3d/campuslife/index.js
// THE Campuslife look of the main map (commit c2b9477), for lib3d/campusReal.js. It only draws: footprints, roads, places, collision and driving stay those of the game's map.
import * as THREE from "three";
import { setPresets } from "./map.js";
import { buildCampusBuildings, chunkGeometry, createBuildingLook, buildingAt } from "./buildings/index.js";
import { describeBuildings } from "./describe.js";
import { groundTextures, tiled, buildGrass, buildStrips, vergeLines } from "./ground.js";
import { planScatter } from "./scenery/plan.js";
import { buildScenery } from "./scenery/index.js";
import { buildProps } from "./props/index.js";
import { plantingKeepOut, treeKey } from "./decor.js";
import { isPhone } from "./device.js";

const inRing = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };

export function createCampuslifeLook(data, look, S) {
  setPresets(look.presets);
  const textures = groundTextures(), material = createBuildingLook();
  const ground = buildGrass(data, S, textures.grass);

  // ---- buildings: merged per block, one material; the group is in metres ----
  const lite = isPhone(), built = buildCampusBuildings(describeBuildings(data, look), lite ? 800 : undefined), buildings = new THREE.Group(); buildings.name = "buildings"; buildings.scale.setScalar(S);
  const meshes = built.chunks.map((c) => { const m = new THREE.Mesh(chunkGeometry(c.buf), material.material); m.castShadow = m.receiveShadow = true; m.userData.ranges = c.ranges; buildings.add(m); return m; });

  // ---- footpaths ----
  const paths = buildStrips(look.paths.map((p) => ({ pts: p.pts, half: p.w / 2 })), S, textures.path, 0.045, 2);

  // ---- planting ----
  const scenery = buildScenery(planScatter(data, look, { density: lite ? 0.6 : 1, chunkSize: lite ? 500 : undefined, keepOut: plantingKeepOut() }), { lite }); scenery.group.scale.setScalar(S);
  // ---- stalls, banners and the gate: which of them stand (and are solid) is decided with the world's collision (decor.js) and arrives with the road graph ----
  const dressing = new THREE.Group(); dressing.name = "dressing"; dressing.scale.setScalar(S);
  let graph = null, rings = [], verge = null, props = null, propsOf = null;
  const taken = (x, z) => rings.some((r) => inRing(x, z, r));
  const surf = {}, onRoad = (x, z, m) => [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].some(([dx, dz]) => graph.surfaceAt(x + dx, z + dz, surf).cls !== 0);
  let blocked = new Map();   // per plant: is it off the map's roads and props? Worked out once for each road graph, so clearing a yard is quick
  const refresh = () => {
    const decor = graph?.campusDecor, cellOf = (x, z) => Math.floor(x / 8) + "," + Math.floor(z / 8);
    const under = new Map(); for (const [x, z] of decor ? [...decor.stalls, ...decor.pitches, ...decor.banners.map((b) => [b.x, b.z])] : []) { const k = cellOf(x, z); let l = under.get(k); if (!l) under.set(k, (l = [])); l.push([x, z]); }
    const underProp = (x, z) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [px, pz] of under.get(cellOf(x + i * 8, z + j * 8)) ?? []) if (Math.hypot(px - x, pz - z) < 2) return true; return false; };
    scenery.setHidden((x, z, kind) => {
      if (taken(x, z)) return true;
      if (kind === "tree" || kind === "palm") return !!graph && (decor ? !decor.trees.has(treeKey(x, z)) : onRoad(x, z, 2.4));   // exactly the trunks that are solid stand
      if (!graph) return false;
      const key = treeKey(x, z); let no = blocked.get(key); if (no === undefined) blocked.set(key, (no = onRoad(x, z, 1.2) || underProp(x, z))); return no;
    });
  };
  /** Builds the props of this graph's decoration (once), or takes them away. */
  const dress = (decor) => {
    if (decor === propsOf) return;
    if (props) { dressing.remove(props.group); props.dispose(); props = null; }
    propsOf = decor;
    if (!decor) return;
    try { props = buildProps(look, decor, { doors: decor.doors, lite }); } catch (e) { console.warn("campus props unavailable", e); return; }
    if (rings.length) props.setHidden(taken);
    props.setNight(night); dressing.add(props.group);
  };
  let night = 0;
  const eye = new THREE.Vector3();
  ground.onBeforeRender = (renderer, scene, camera) => { eye.setFromMatrixPosition(camera.matrixWorld).divideScalar(S); scenery.update(eye); props?.update(eye); };

  return {
    ground, buildings, meshes, paths, scenery: scenery.group, dressing, tops: built.tops,
    textures, areaMap: (kind) => (textures[kind] ? tiled(textures[kind], S) : null),
    /** The building under a raycast hit on one of `meshes`. */
    buildingOf: (hit) => buildingAt(hit.object.userData.ranges, hit.face.a),
    /** The road graph has arrived (or changed): lay the verges and take the planting off the real carriageways. Returns the verge mesh (the caller puts it on the map), or null. */
    setRoadGraph(g) {
      if (verge) { verge.geometry.dispose(); verge.material.dispose(); verge = null; }
      graph = g; blocked = new Map(); if (g) verge = buildStrips(vergeLines(g), S, textures.verge, 0.055, 3);
      dress(g?.campusDecor ?? null); refresh(); return verge;
    },
    /** Takes the planting and the props out of these areas (each a ring of [x, z] in metres), such as the player's home compound. [] puts them back. */
    clear(list) { rings = list ?? []; refresh(); props?.setHidden(rings.length ? taken : null); },
    setNight(n) { night = n; material.setNight(n); props?.setNight(n); },
    dispose() { dress(null); scenery.dispose(); textures.dispose(); material.dispose(); },
  };
}
