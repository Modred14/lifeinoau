// lib3d/thumbs.js
// Small pictures of the furniture for the shop, rendered once from the same 3D models the room uses. Browser only.
import * as THREE from "three";
import { buildFurniture } from "./furnitureModels.js";

const cache = new Map();
let renderer = null, scene = null, camera = null;

function setup(size) {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); renderer.setSize(size, size, false); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a8, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 }); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 40), new THREE.ShadowMaterial({ opacity: 0.22 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
}

/** Renders one item to a PNG data URL (cached). */
export function thumbnail(key, size = 240) {
  if (cache.has(key)) return cache.get(key);
  if (!renderer) setup(size);
  const g = buildFurniture(key); scene.add(g);
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), r = Math.max(s.x, s.z) * 0.78 + s.y * 0.42 + 0.15;
  camera.left = -r; camera.right = r; camera.top = r; camera.bottom = -r; camera.updateProjectionMatrix();
  camera.position.set(c.x + 6, c.y + 6.2, c.z + 6); camera.lookAt(c.x, c.y - 0.1, c.z);
  renderer.render(scene, camera); const url = renderer.domElement.toDataURL("image/png");
  scene.remove(g); g.traverse((o) => { o.geometry?.dispose?.(); for (const m of [].concat(o.material ?? [])) m.dispose?.(); });
  cache.set(key, url); return url;
}