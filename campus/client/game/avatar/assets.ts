import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { SLOTS, type Look, type Slot } from "@campuslife/shared/avatar";
import { CHARACTER_ASSET_VERSIONS } from "../character-assets";
import { SharedAssetCache } from "./asset-cache";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const versions: Readonly<Record<string, string>> = CHARACTER_ASSET_VERSIONS;
const assetUrl = (name: string) => `/campus/models/chars/${name}?v=${versions[name]}`;

function disposeAsset(asset: GLTF) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  for (const scene of asset.scenes) scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
  });
  skeletons.forEach((skeleton) => skeleton.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

const assets = new SharedAssetCache<GLTF>((url) => loader.loadAsync(url), disposeAsset);

export interface LookAssets {
  animations: GLTF;
  parts: Record<Slot, GLTF>;
  release: () => void;
  invalidate: () => void;
}

export async function acquireLookAssets(look: Look): Promise<LookAssets> {
  const animationUrl = assetUrl(`${look.body}-anims.glb`);
  const partUrls = Object.fromEntries(SLOTS.map((slot) => [slot, assetUrl(`${look.body}-${look[slot]}.glb`)])) as Record<Slot, string>;
  const urls = [...new Set([animationUrl, ...Object.values(partUrls)])];
  const results = await Promise.allSettled(urls.map((url) => assets.acquire(url)));
  const failure = results.find((result) => result.status === "rejected");
  const leases = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const release = () => leases.forEach((lease) => lease.release());
  if (failure?.status === "rejected") {
    release();
    throw failure.reason;
  }
  const sources = new Map(urls.map((url, index) => [url, leases[index].value]));
  return {
    animations: sources.get(animationUrl)!,
    parts: Object.fromEntries(SLOTS.map((slot) => [slot, sources.get(partUrls[slot])!])) as Record<Slot, GLTF>,
    release,
    invalidate: () => urls.forEach((url) => assets.invalidate(url)),
  };
}

export function prefetchLookAssets(look: Look) {
  void acquireLookAssets(look).then((sources) => sources.release()).catch(() => {});
}
