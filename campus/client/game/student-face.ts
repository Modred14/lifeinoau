import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HAIR_COLORS, SKIN_TONES, type BodyType, type Look } from "@campuslife/shared/avatar";
import { FACE_OFFSET_Y, FACE_SCALE } from "./student-proportions";

const geometryCache = new Map<BodyType, Record<string, THREE.BufferGeometry>>();

function ellipsoid(scale: number[], position: number[], segments = 12) {
  const geometry = new THREE.SphereGeometry(1, segments, 8);
  geometry.scale(scale[0], scale[1], scale[2]);
  geometry.translate(position[0], position[1], position[2]);
  return geometry;
}

function combine(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  return geometry;
}

function faceGeometry(body: BodyType) {
  const cached = geometryCache.get(body);
  if (cached) return cached;
  const skull = new THREE.SphereGeometry(1, 40, 28);
  const positions = skull.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    const jaw = y < -0.25 ? 1 + (y + 0.25) * 0.25 : 1;
    const x = positions.getX(i) * (body === "m" ? 0.108 : 0.104) * jaw, height = y * 0.146;
    let depth = positions.getZ(i) * 0.096;
    if (depth > 0.03) {
      const bridge = 0.009 * Math.exp(-((x / 0.010) ** 2) - ((height - 0.006) / 0.030) ** 2);
      const tip = 0.020 * Math.exp(-((x / 0.017) ** 2) - ((height + 0.017) / 0.013) ** 2);
      const wings = 0.005 * Math.exp(-(((Math.abs(x) - 0.013) / 0.008) ** 2) - ((height + 0.023) / 0.008) ** 2);
      depth += bridge + tip + wings;
    }
    positions.setXYZ(i, x, height, depth);
  }
  skull.computeVertexNormals();
  const skin = combine([
    skull,
    ellipsoid([0.011, 0.024, 0.011], [-0.106, -0.006, -0.005]),
    ellipsoid([0.011, 0.024, 0.011], [0.106, -0.006, -0.005]),
  ]);
  const white = combine([
    ellipsoid([0.021, 0.009, 0.006], [0, 0, 0]),
    ellipsoid([0.0017, 0.0017, 0.001], [-0.002, 0.0025, 0.011], 10),
  ]);
  const iris = ellipsoid([0.0068, 0.0068, 0.002], [0, 0, 0.007], 12);
  const lids = combine([-1, 1].map((side) => new THREE.TubeGeometry(
    new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.021, 0, 0), new THREE.Vector3(0, side * 0.019, 0.006), new THREE.Vector3(0.021, 0, 0)), 12, 0.0018, 5, false,
  )));
  const brows = combine([-1, 1].map((side) => new THREE.TubeGeometry(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(side * 0.022, 0.049, 0.090),
      new THREE.Vector3(side * 0.043, 0.058, 0.089),
      new THREE.Vector3(side * 0.063, 0.048, 0.077),
    ), 8, body === "m" ? 0.0028 : 0.0022, 5, false,
  )));
  const mouth = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.024, -0.057, 0.082),
    new THREE.Vector3(0, -0.061, 0.091),
    new THREE.Vector3(0.024, -0.057, 0.082),
  ), 12, 0.0015, 5, false);
  const lips = combine([-1, 1].map((side) => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.023, -0.057, 0.082), new THREE.Vector3(0, -0.061 + side * 0.004, 0.091), new THREE.Vector3(0.023, -0.057, 0.082),
  ), 12, side === 1 ? 0.0016 : 0.0022, 5, false)));
  const geometries = { skin, white, iris, lids, brows, mouth, lips };
  geometryCache.set(body, geometries);
  return geometries;
}

export class StudentFace {
  readonly root = new THREE.Group();
  private eyes: THREE.Group[] = [];
  private irises: THREE.Mesh[] = [];
  private time = 0;
  private nextBlink = 3 + Math.random() * 2;
  private blinkTime = -1;
  private target = new THREE.Vector3();

  constructor(look: Look) {
    this.root.name = "student-face";
    this.root.scale.setScalar(FACE_SCALE);
    this.root.position.set(0, FACE_OFFSET_Y, 0);
    const geometries = faceGeometry(look.body);
    const skinColor = new THREE.Color(SKIN_TONES[look.skin]);
    const skin = new THREE.MeshStandardMaterial({ name: "head:skin", color: skinColor, roughness: 0.68 });
    const hair = new THREE.MeshStandardMaterial({ name: "head:brow", color: HAIR_COLORS[look.hair], roughness: 0.85 });
    const lip = new THREE.MeshStandardMaterial({ name: "head:lip", color: skinColor.clone().multiplyScalar(0.72).lerp(new THREE.Color(0x8a4848), 0.15), roughness: 0.72 });
    const mouth = new THREE.MeshStandardMaterial({ name: "head:mouth", color: skinColor.clone().multiplyScalar(0.35), roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ name: "head:eye-white", color: 0xfffaf0, roughness: 0.42 });
    const iris = new THREE.MeshStandardMaterial({ name: "head:iris", color: 0x261c18, roughness: 0.35 });
    this.root.add(new THREE.Mesh(geometries.skin, skin), new THREE.Mesh(geometries.brows, hair), new THREE.Mesh(geometries.mouth, mouth), new THREE.Mesh(geometries.lips, lip));
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.name = side === -1 ? "eye-left" : "eye-right";
      eye.position.set(side * 0.043, 0.025, 0.083);
      eye.rotation.y = side * 0.4;
      const pupil = new THREE.Mesh(geometries.iris, iris);
      pupil.name = "iris";
      eye.add(new THREE.Mesh(geometries.white, white), pupil, new THREE.Mesh(geometries.lids, skin));
      this.root.add(eye);
      this.eyes.push(eye);
      this.irises.push(pupil);
    }
    this.root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) object.frustumCulled = false;
    });
  }

  lookAt(point: THREE.Vector3) {
    this.root.worldToLocal(this.target.copy(point));
    const depth = Math.max(0.3, this.target.z);
    const x = THREE.MathUtils.clamp(this.target.x / depth * 0.014, -0.003, 0.003);
    const y = THREE.MathUtils.clamp((this.target.y - 0.025) / depth * 0.010, -0.0018, 0.0018);
    for (const iris of this.irises) iris.position.set(x, y, 0);
  }

  update(dt: number) {
    this.time += dt;
    if (this.blinkTime < 0 && this.time >= this.nextBlink) this.blinkTime = 0;
    if (this.blinkTime < 0) return;
    this.blinkTime += dt;
    const openness = Math.max(0.04, 1 - Math.sin(Math.min(1, this.blinkTime / 0.18) * Math.PI));
    for (const eye of this.eyes) eye.scale.y = openness;
    if (this.blinkTime >= 0.18) {
      this.blinkTime = -1;
      this.nextBlink = this.time + 3.2 + Math.random() * 2.3;
    }
  }
}
