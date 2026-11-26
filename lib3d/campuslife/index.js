// lib3d/campuslife/index.js
// THE Campuslife look of the main map (commit c2b9477), for lib3d/campusReal.js. It only draws: footprints, roads, places, collision and driving stay those of the game's map.
import * as THREE from "three";
import { corridorKeepOut, connectorKeepOut } from "../highway.js";
import { setPresets } from "./map.js";
import { buildCampusBuildings, chunkGeometry, createBuildingLook, buildingAt } from "./buildings/index.js";
import { describeBuildings } from "./describe.js";
import { groundTextures, tiled, buildGrass, buildStrips, vergeLines } from "./ground.js";
import { planScatter } from "./scenery/plan.js";
import { buildScenery } from "./scenery/index.js";

const inRing = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
/** Fewer plants on a small touch device. */
const plantDensity = () => (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 0.6 : 1);

export function createCampuslifeLook(data, look, S) {
  setPresets(look.presets);
  const textures = groundTextures(), material = createBuildingLook();
  const ground = buildGrass(data, S, textures.grass);

  // ---- buildings: merged per block, one material; the group is in metres ----
  const built = buildCampusBuildings(describeBuildings(data, look)), buildings = new THREE.Group(); buildings.name = "buildings"; buildings.scale.setScalar(S);
  const meshes = built.chunks.map((c) => { const m = new THREE.Mesh(chunkGeometry(c.buf), material.material); m.castShadow = m.receiveShadow = true; m.userData.ranges = c.ranges; buildings.add(m); return m; });

  // ---- footpaths ----
  const paths = buildStrips(look.paths.map((p) => ({ pts: p.pts, half: p.w / 2 })), S, textures.path, 0.045, 2);

  // ---- planting ----
  const keepOut = corridorKeepOut().concat(connectorKeepOut());
  const scenery = buildScenery(planScatter(data, look, { density: plantDensity(), keepOut })); scenery.group.scale.setScalar(S);
  let graph = null, rings = [], verge = null;
  const surf = {}, onRoad = (x, z, m) => [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].some(([dx, dz]) => graph.surfaceAt(x + dx, z + dz, surf).cls !== 0);
  const refresh = () => {
    const furniture = new Map(); for (const [x, z] of graph?.furniturePlan?.taken ?? []) { const k = Math.floor(x / 8) + "," + Math.floor(z / 8); let l = furniture.get(k); if (!l) furniture.set(k, (l = [])); l.push([x, z]); }
    const nearFurniture = (x, z) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [fx, fz] of furniture.get(Math.floor(x / 8) + i + "," + (Math.floor(z / 8) + j)) ?? []) if (Math.hypot(fx - x, fz - z) < 3) return true; return false; };
    scenery.setHidden((x, z, kind) => rings.some((r) => inRing(x, z, r)) || (!!graph && (onRoad(x, z, kind === "tree" || kind === "palm" ? 2.4 : 1.2) || ((kind === "tree" || kind === "palm") && nearFurniture(x, z)))));
  };
  const eye = new THREE.Vector3();
  ground.onBeforeRender = (renderer, scene, camera) => { eye.setFromMatrixPosition(camera.matrixWorld).divideScalar(S); scenery.update(eye); };

  return {
    ground, buildings, meshes, paths, scenery: scenery.group, tops: built.tops,
    textures, areaMap: (kind) => (textures[kind] ? tiled(textures[kind], S) : null),
    /** The building under a raycast hit on one of `meshes`. */
    buildingOf: (hit) => buildingAt(hit.object.userData.ranges, hit.face.a),
    /** The road graph has arrived (or changed): lay the verges and take the planting off the real carriageways. Returns the verge mesh (the caller puts it on the map), or null. */
    setRoadGraph(g) {
      if (verge) { verge.geometry.dispose(); verge.material.dispose(); verge = null; }
      graph = g; if (g) verge = buildStrips(vergeLines(g), S, textures.verge, 0.055, 3);
      refresh(); return verge;
    },
    /** Takes the planting out of these areas (each a ring of [x, z] in metres), such as the player's home compound. [] puts it back. */
    clear(list) { rings = list ?? []; refresh(); },
    setNight: (n) => material.setNight(n),
    dispose() { scenery.dispose(); textures.dispose(); material.dispose(); },
  };
}
