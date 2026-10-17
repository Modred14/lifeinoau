import * as THREE from "three";
import { Character } from "./characters";
import type { Slot } from "@campuslife/shared/avatar";

export interface StudioThumbnailRequest {
  key: string;
  look: string;
  slot: Slot | "full";
}

export class StudioThumbnails {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 30);
  private disposed = false;

  constructor() {
    this.renderer.setSize(240, 240);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new THREE.HemisphereLight(0xf1f3ff, 0x858177, 2.6));
    const key = new THREE.DirectionalLight(0xfff2de, 3.3);
    key.position.set(-2, 3, 4);
    const fill = new THREE.DirectionalLight(0xe4edff, 2);
    fill.position.set(2, 1.5, 3);
    this.scene.add(key, fill);
  }

  async render(request: StudioThumbnailRequest, active: () => boolean): Promise<string | undefined> {
    if (this.disposed || !active()) return;
    const character = new Character(request.look);
    try {
      await character.whenReady();
      if (this.disposed || !active()) return;
      character.update(0, 0);
      character.root.rotation.y = request.slot === "shoes" ? -0.45 : 0.12;
      character.root.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      character.root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        mesh.visible = mesh.visible && (request.slot === "full" || material.name.startsWith(`${request.slot}:`));
        if (mesh.visible) {
          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).skeleton.update();
          meshes.push(mesh);
        }
      });
      const bounds = new THREE.Box3();
      const point = new THREE.Vector3();
      for (const mesh of meshes) {
        const count = mesh.geometry.getAttribute("position").count;
        for (let i = 0; i < count; i++) bounds.expandByPoint(mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld));
      }
      if (bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const distance = Math.max(size.x, size.y) * 0.62 / Math.tan(Math.PI / 12) + size.z * 0.5;
      this.camera.position.set(center.x, center.y + (request.slot === "shoes" ? size.y * 0.4 : 0), center.z + distance);
      this.camera.lookAt(center);
      character.lookAt(this.camera.position);
      this.scene.add(character.root);
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL("image/webp", 0.85);
    } finally {
      character.dispose();
    }
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
