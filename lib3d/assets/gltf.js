// lib3d/assets/gltf.js
// Shared, reference-counted 3D model and texture loading on top of the asset loader (lib3d/assets/loader.js).
//
//   const h = await acquireGltf("/models/avatars/base_male.glb");   // downloads once, parses once, shared by everyone who asks
//   use(h.value.scene.clone()) ...                                  // clone per use: the cached scene itself is shared and read-only
//   h.release();                                                    // when this use is over (an entry nobody holds may be evicted; one somebody holds never is)
//
// WHAT IS SHARED: the parsed glTF (geometry, materials, textures, animation clips). Every user clones the scene graph (SkeletonUtils.clone for skinned models), so two cars or two
// characters share vertex data and textures and nothing else. Whatever changes per object (colours, morph weights, visibility) must be set on that object's own clone or on a material
// the object made for itself; never on the shared one.
// FREEING: when the last holder lets go the entry stays warm and is evicted, least recently used first, once the cache is over its budget. Eviction disposes the GPU copy of its geometry,
// materials and textures (three.js uploads them again if something still draws them), so a shared resource is never destroyed while any holder has it.
// COMPRESSION: Meshopt and Draco compressed models are supported (the decoders load only when a model needs them). KTX2 textures are not wired up (they need the renderer).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createAssetCache, geometryBytes } from "../assetCache.js";
import { assetUrl, cleanPath, manifest } from "./manifest.js";

const MB = 1048576;
export const DRACO_PATH = `/draco/r${THREE.REVISION}/gltf/`; // copied from three by scripts/copy-draco.mjs at build time; the folder name carries the revision, so the files never change under one URL

/** Everything a parsed glTF (or any Object3D) holds that needs freeing: { geometries, materials, textures }. */
export function resourcesOf(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const addMat = (m) => { if (!m || materials.has(m)) return; materials.add(m); for (const k in m) { const v = m[k]; if (v?.isTexture) textures.add(v); } };
  root?.traverse?.((o) => { if (o.geometry) geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) addMat(m); });
  return { geometries, materials, textures };
}
const textureBytes = (t) => { const i = t.image; const w = i?.width ?? 0, h = i?.height ?? 0; return w && h ? Math.round(w * h * 4 * 1.33) : 0; }; // as uploaded, with mipmaps
export function gltfBytes(gltf) { const r = resourcesOf(gltf?.scene); let n = 0; for (const g of r.geometries) n += geometryBytes(g); for (const t of r.textures) n += textureBytes(t); return n; }
export function disposeGltf(gltf) { const r = resourcesOf(gltf?.scene); for (const g of r.geometries) g.dispose?.(); for (const m of r.materials) m.dispose?.(); for (const t of r.textures) t.dispose?.(); }

export const defaultModelBudget = (env = globalThis) => {
  const mem = Number(env.navigator?.deviceMemory) || 0, phone = /Android|iPhone|iPad|iPod|Mobile/i.test(String(env.navigator?.userAgent ?? ""));
  return (mem && mem <= 4) || phone ? 64 * MB : 160 * MB;
};

/** The model + texture service. `assets` is a lib3d/assets/loader.js loader. Made once by lib3d/assets/index.js; tests make their own. */
export function createModelService({ assets, budgetBytes = defaultModelBudget() }) {
  const cache = createAssetCache({ budgetBytes });
  let loader = null;

  function getLoader() {
    if (loader) return loader;
    const manager = new THREE.LoadingManager();
    // anything a .gltf pulls in by relative URL (its .bin, its textures) goes through the versioned URL too, so it is cached like everything else
    manager.setURLModifier((url) => { if (/^(data|blob):/i.test(url)) return url; const p = cleanPath(url); return manifest.has(p) ? assetUrl(p) : url; });
    loader = new GLTFLoader(manager);
    try { loader.setMeshoptDecoder(MeshoptDecoder); } catch { /* optional */ }
    try { loader.setDRACOLoader(new DRACOLoader(manager).setDecoderPath(DRACO_PATH)); } catch { /* optional */ }
    return loader;
  }
  const parse = (buf, path) => new Promise((resolve, reject) => {
    const base = cleanPath(path).replace(/[^/]*$/, "");
    // parse a COPY: the bytes are shared with the persistent store's caller and the parser may keep views into what it is given
    try { getLoader().parse(buf.slice(0), base, resolve, reject); } catch (e) { reject(e); }
  });

  /** The parsed model at `path`, shared. Resolves with a handle { value: gltf, release() }. A download or parse that fails caches nothing, so asking again retries. */
  async function acquireGltf(path, { priority = 2, signal } = {}) {
    const key = `gltf:${cleanPath(path)}:${manifest.info(path)?.v ?? ""}`;
    try {
      return await cache.acquireAsync(key, async () => parse(await assets.bytes(path, { priority, signal }), path), { bytes: gltfBytes, dispose: disposeGltf, priority: 2 - Math.min(2, manifest.info(path)?.tier === "critical" ? 0 : manifest.info(path)?.tier === "high" ? 1 : 2) });
    } catch (e) {
      // a copy in the store that downloads fine but does not parse is a bad copy: drop it and fetch the file again once
      if (e?.final || e?.status || e?.name === "AbortError") throw e;
      try { await assets.dropCached?.(path); } catch { /* ignore */ }
      return cache.acquireAsync(key, async () => parse(await assets.bytes(path, { priority, signal }), path), { bytes: gltfBytes, dispose: disposeGltf });
    }
  }

  /** A texture from an image file, shared. opt: { colorSpace: "srgb" | "none", repeat: bool, anisotropy, priority }. Handle: { value: THREE.Texture, release() }. Do not change the shared texture's settings; ask for the variant you need. */
  function acquireTexture(path, { colorSpace = "srgb", repeat = false, anisotropy = 1, priority = 2, signal } = {}) {
    const key = `tex:${cleanPath(path)}:${manifest.info(path)?.v ?? ""}:${colorSpace}:${repeat ? "r" : "c"}:${anisotropy}`;
    return cache.acquireAsync(key, async () => {
      const buf = await assets.bytes(path, { priority, signal });
      const bmp = await createImageBitmap(new Blob([buf]), { imageOrientation: "flipY", premultiplyAlpha: "none" }); // flipped here: WebGL cannot flip an ImageBitmap on upload
      const t = new THREE.Texture(bmp); t.flipY = false;
      t.colorSpace = colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
      return t;
    }, { bytes: (t) => textureBytes(t), dispose: (t) => { t.dispose(); t.image?.close?.(); }, priority: 1 });
  }

  return { acquireGltf, acquireTexture, cache, stats: () => cache.stats(), clear: () => cache.clear() };
}
