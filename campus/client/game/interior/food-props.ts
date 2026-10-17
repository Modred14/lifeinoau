import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Dish, DrinkKind, Held } from "./dishes";

export const PLATE_RADIUS = 0.115;

let material: THREE.MeshLambertMaterial | undefined;
const cache = new Map<string, THREE.BufferGeometry>();

function foodMaterial() {
  material ??= new THREE.MeshLambertMaterial({ vertexColors: true });
  return material;
}

function tint(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const count = flat.getAttribute("position").count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

function merged(key: string, build: () => THREE.BufferGeometry[]): THREE.BufferGeometry {
  let geometry = cache.get(key);
  if (!geometry) {
    const parts = build();
    geometry = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    cache.set(key, geometry);
  }
  return geometry;
}

function cylinder(color: number, top: number, bottom: number, height: number, y: number, x = 0, z = 0, segments = 12) {
  return tint(new THREE.CylinderGeometry(top, bottom, height, segments).translate(x, y + height / 2, z), color);
}

function plateGeometry(dish: Dish) {
  return merged(`plate:${dish.id}`, () => {
    const rim = dish.bowl ? 0.045 : 0.014;
    const parts = [cylinder(0xf4f4f0, PLATE_RADIUS, dish.bowl ? 0.07 : 0.085, rim, 0, 0, 0, 16)];
    for (const mound of dish.plate ?? []) {
      const dome = new THREE.SphereGeometry(mound.r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.scale(1, mound.h / mound.r, 1).translate(mound.x, rim, mound.z);
      parts.push(tint(dome, mound.color));
    }
    return parts;
  });
}

function drinkGeometry(kind: DrinkKind, color: number) {
  return merged(`drink:${kind}:${color}`, () => {
    if (kind === "bottle") return [cylinder(color, 0.028, 0.03, 0.15, 0), cylinder(color, 0.012, 0.026, 0.06, 0.15), cylinder(0xd0d0d0, 0.014, 0.014, 0.012, 0.21)];
    if (kind === "cup") return [cylinder(0xf2f2ee, 0.036, 0.027, 0.1, 0), cylinder(color, 0.033, 0.033, 0.004, 0.097)];
    if (kind === "can") return [cylinder(color, 0.03, 0.03, 0.11, 0), cylinder(0xd0d0d0, 0.026, 0.03, 0.006, 0.11)];
    return [tint(new THREE.BoxGeometry(0.085, 0.03, 0.12).translate(0, 0.015, 0), color)];
  });
}

function heldGeometry(held: Held) {
  return merged(`held:${held.color}:${held.wrap ?? 0}:${held.size.join("x")}`, () => {
    const [w, h, d] = held.size;
    const parts = [tint(new THREE.CylinderGeometry(w / 2, w / 2, h, 8).scale(1, 1, d / w).translate(0, 0, 0), held.color)];
    if (held.wrap !== undefined) parts.push(tint(new THREE.CylinderGeometry(w / 2 + 0.004, w / 2 + 0.004, h * 0.5, 8).scale(1, 1, d / w).translate(0, -h * 0.25, 0), held.wrap));
    return parts;
  });
}

function mesh(geometry: THREE.BufferGeometry) {
  const m = new THREE.Mesh(geometry, foodMaterial());
  m.castShadow = false;
  return m;
}

export const makePlate = (dish: Dish) => mesh(plateGeometry(dish));
export const makeDrink = (kind: DrinkKind, color: number) => mesh(drinkGeometry(kind, color));
export const makeHeld = (held: Held) => mesh(heldGeometry(held));
export const makeSpoon = () => mesh(merged("spoon", () => [tint(new THREE.BoxGeometry(0.012, 0.006, 0.13), 0xc9c9c9), tint(new THREE.SphereGeometry(0.018, 8, 4).scale(1, 0.35, 1.3).translate(0, 0, 0.075), 0xc9c9c9)]));
export const makeNotebook = () => mesh(merged("notebook", () => [tint(new THREE.BoxGeometry(0.19, 0.012, 0.25).translate(0, 0.006, 0), 0xf7f5ee), tint(new THREE.BoxGeometry(0.19, 0.002, 0.012).translate(0, 0.013, -0.119), 0x1f4e9a)]));
export const makePen = () => mesh(merged("pen", () => [tint(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 6), 0x1f3f8a)]));

export function foodTriangles(): number {
  let total = 0;
  for (const geometry of cache.values()) total += geometry.getAttribute("position").count / 3;
  return total;
}
