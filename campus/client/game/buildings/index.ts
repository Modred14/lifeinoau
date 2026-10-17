import * as THREE from "three";
import { BUILDINGS, PX_PER_METER, type Building } from "@campuslife/shared/map";
import { buildBuilding } from "./archetypes";
import { paintAtlas } from "./atlas";
import { emptyBuffers, type BuildingBuffers } from "./types";

export type { BuildingBuffers } from "./types";

const NIGHT_GLOW = 0xffd28a;
const NIGHT_GLOW_STRENGTH = 0.8;

export interface BuildingLook {
  material: THREE.MeshLambertMaterial;
  setNight(night: number): void;
  dispose(): void;
}

function dataTexture(data: Uint8ClampedArray, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createBuildingLook(): BuildingLook {
  const atlas = paintAtlas();
  const map = dataTexture(atlas.color, atlas.width, atlas.height);
  const glow = dataTexture(atlas.glow, atlas.glowWidth, atlas.glowHeight);
  const material = new THREE.MeshLambertMaterial({ map, vertexColors: true, emissive: NIGHT_GLOW, emissiveMap: glow, emissiveIntensity: 0 });
  return {
    material,
    setNight(night) {
      material.emissiveIntensity = night * NIGHT_GLOW_STRENGTH;
    },
    dispose() {
      map.dispose();
      glow.dispose();
      material.dispose();
    },
  };
}

export function buildChunkBuffers(chunkSize: number, buildings: readonly Building[] = BUILDINGS): Map<string, BuildingBuffers> {
  const chunks = new Map<string, BuildingBuffers>();
  for (const b of buildings) {
    const x = (b.bbox.x + b.bbox.w / 2) / PX_PER_METER;
    const z = (b.bbox.y + b.bbox.h / 2) / PX_PER_METER;
    const key = `${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`;
    let buf = chunks.get(key);
    if (!buf) chunks.set(key, (buf = emptyBuffers()));
    buildBuilding(buf, b);
  }
  return chunks;
}

export function chunkGeometry(buf: BuildingBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buf.pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buf.uv, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buf.col, 3));
  geometry.setIndex(buf.idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
