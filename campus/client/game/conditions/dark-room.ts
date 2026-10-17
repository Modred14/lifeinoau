import * as THREE from "three";
import { SPOTS, type Interior } from "@campuslife/shared/interiors";
import { toWorld } from "../coords";

const GLOW = {
  most: 6,
  lights: 2,
  height: 0.95,
  lantern: 0xffb45a,
  torch: 0xd6e6ff,
  size: 1.5,
  power: 9,
  range: 7,
  flicker: 0.12,
  flickerRate: 7,
};
const GLOW_KINDS = new Set(["study", "sit", "sleep", "tv", "eat"]);

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

function glowSpots(it: Interior): THREE.Vector3[] {
  const all: THREE.Vector3[] = [];
  for (let i = it.spotStart; i < it.spotEnd; i++) {
    const spot = SPOTS[i];
    if (GLOW_KINDS.has(spot.kind)) all.push(new THREE.Vector3(toWorld(spot.x), (spot.floor ?? 0) + GLOW.height, toWorld(spot.y)));
  }
  if (all.length <= GLOW.most) return all;
  const step = all.length / GLOW.most;
  return Array.from({ length: GLOW.most }, (_, k) => all[Math.floor(k * step + step / 2)]);
}

export class DarkRoom {
  private group?: THREE.Group;
  private it?: Interior;
  private scene?: THREE.Scene;
  private texture?: THREE.CanvasTexture;
  private materials: THREE.SpriteMaterial[] = [];
  private lights: THREE.PointLight[] = [];
  private clock = 0;

  enter(it: Interior, scene: THREE.Scene) {
    this.leave();
    this.it = it;
    this.scene = scene;
    for (let i = 0; i < GLOW.lights; i++) {
      const light = new THREE.PointLight(i % 2 ? GLOW.torch : GLOW.lantern, 0, GLOW.range, 2);
      scene.add(light);
      this.lights.push(light);
    }
  }

  leave() {
    this.clear();
    for (const light of this.lights) light.removeFromParent();
    this.lights = [];
    this.it = undefined;
    this.scene = undefined;
  }

  set(dark: boolean) {
    if (dark === !!this.group) return;
    if (!dark) return this.clear();
    if (!this.it || !this.scene) return;
    const group = new THREE.Group();
    this.texture = glowTexture();
    glowSpots(this.it).forEach((at, i) => {
      const color = i % 2 ? GLOW.torch : GLOW.lantern;
      const material = new THREE.SpriteMaterial({ map: this.texture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(GLOW.size);
      sprite.position.copy(at);
      group.add(sprite);
      this.materials.push(material);
      const light = this.lights[i];
      if (!light) return;
      light.position.copy(at);
      light.intensity = GLOW.power;
    });
    this.scene.add(group);
    this.group = group;
  }

  animate(dt: number) {
    if (!this.group) return;
    this.clock += dt;
    this.lights.slice(0, this.materials.length).forEach((light, i) => {
      light.intensity = GLOW.power * (1 + GLOW.flicker * Math.sin(this.clock * GLOW.flickerRate + i * 2.1));
    });
  }

  private clear() {
    this.group?.removeFromParent();
    this.materials.forEach((material) => material.dispose());
    this.texture?.dispose();
    this.group = undefined;
    this.texture = undefined;
    this.materials = [];
    for (const light of this.lights) light.intensity = 0;
  }
}
