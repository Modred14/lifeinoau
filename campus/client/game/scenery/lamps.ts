import * as THREE from "three";
import { PX_PER_METER, ROADS, nearBuilding, onRoad, type GameTime } from "@campuslife/shared";
import { lampPower } from "../conditions/lamp-zones";

export interface Lamps {
  group: THREE.Group;
  count: number;
  setNight(night: number): void;
  setTime(t: GameTime): void;
  update(focus: THREE.Vector3): void;
  dispose(): void;
}

const M = PX_PER_METER;
const BULB_STEPS = 20;
const LAMP = {
  minRoadWidth: 4.5 * M,
  spacing: 36 * M,
  setback: 1.1 * M,
  height: 6.2,
  reach: 2.5,
  poolRadius: 6.4,
  coneRadius: 3.4,
  warm: 0xffc878,
  glow: 0xffe2a8,
  poolOpacity: 0.6,
  coneOpacity: 0.085,
  realLights: 4,
  lightPower: 46,
  lightRange: 19,
  lightsOnBelow: 0.55,
  reassignEvery: 20,
};

function lampSpots(): { at: THREE.Vector3; yaw: number }[] {
  const out: { at: THREE.Vector3; yaw: number }[] = [];
  for (const r of ROADS) {
    if (r.kind !== "road" || r.width < LAMP.minRoadWidth) continue;
    const off = r.width / 2 + LAMP.setback;
    let carry = 0;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      let d = LAMP.spacing - carry;
      for (; d < len; d += LAMP.spacing) {
        const x = ax + ((bx - ax) * d) / len + nx * off;
        const y = ay + ((by - ay) * d) / len + ny * off;
        if (nearBuilding(x, y, 1.5 * M) || onRoad(x, y, 0.3 * M)) continue;
        out.push({ at: new THREE.Vector3(x / M, 0, y / M), yaw: Math.atan2(-nx, -ny) });
      }
      carry = len - (d - LAMP.spacing);
    }
  }
  return out;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}

export function buildLamps(opts: { shadows: boolean }): Lamps {
  const group = new THREE.Group();
  const spots = lampSpots();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  const H = LAMP.height;
  const pole = track(new THREE.CylinderGeometry(0.06, 0.1, H, 6));
  pole.translate(0, H / 2, 0);
  const arm = track(new THREE.BoxGeometry(0.08, 0.08, LAMP.reach + 0.1));
  arm.translate(0, H - 0.05, LAMP.reach / 2);
  const head = track(new THREE.BoxGeometry(0.3, 0.12, 0.62));
  head.translate(0, H - 0.1, LAMP.reach);
  const bulb = track(new THREE.BoxGeometry(0.22, 0.05, 0.5));
  bulb.translate(0, H - 0.19, LAMP.reach);
  const pool = track(new THREE.CircleGeometry(LAMP.poolRadius, 24));
  pool.rotateX(-Math.PI / 2);
  pool.scale(1, 1, 1.25);
  pool.translate(0, 0.045, LAMP.reach + 0.6);
  const cone = track(new THREE.CylinderGeometry(0.12, LAMP.coneRadius, H - 0.25, 18, 1, true));
  cone.translate(0, (H - 0.25) / 2 + 0.05, LAMP.reach);

  const metal = track(new THREE.MeshLambertMaterial({ color: 0x5b6066 }));
  const headMat = track(new THREE.MeshLambertMaterial({ color: 0x3a3d42 }));
  const bulbMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const glow = track(glowTexture());
  const poolMat = track(new THREE.MeshBasicMaterial({ color: LAMP.warm, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, map: glow }));
  const coneMat = track(new THREE.MeshBasicMaterial({ color: LAMP.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));

  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const instanced: THREE.InstancedMesh[] = [];
  const lit: THREE.InstancedMesh[] = [];
  let bulbs: THREE.InstancedMesh | undefined;
  if (spots.length)
    for (const [geo, mat, glows] of [[pole, metal, false], [arm, metal, false], [head, headMat, false], [bulb, bulbMat, false], [pool, poolMat, true], [cone, coneMat, true]] as const) {
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
      spots.forEach((s, i) => mesh.setMatrixAt(i, m4.compose(s.at, quat.setFromAxisAngle(up, s.yaw), one)));
      mesh.computeBoundingSphere();
      mesh.castShadow = opts.shadows && !glows && geo === pole;
      if (glows) {
        mesh.visible = false;
        mesh.renderOrder = 2;
        lit.push(mesh);
      }
      if (geo === bulb) bulbs = mesh;
      instanced.push(mesh);
      group.add(mesh);
    }

  const heads = spots.map((s) => new THREE.Vector3(s.at.x + Math.sin(s.yaw) * LAMP.reach, H - 0.5, s.at.z + Math.cos(s.yaw) * LAMP.reach));
  const lights: THREE.PointLight[] = [];
  if (opts.shadows && spots.length)
    for (let i = 0; i < LAMP.realLights; i++) {
      const light = new THREE.PointLight(LAMP.warm, 0, LAMP.lightRange, 2);
      light.visible = false;
      lights.push(light);
      group.add(light);
    }

  const dark = new THREE.Color(0x8d8778);
  const bright = new THREE.Color(0xfff0c2);
  let night = 0;
  let frame = 0;
  const nearest: number[] = [];
  const power = lampPower(spots.map((s) => s.at));
  const assigned: boolean[] = lights.map(() => false);
  const shine = new THREE.Color();
  let painted = "";
  let minute = Number.NaN;
  let cut = "";
  const levelOf = (n: number) => Math.min(1, Math.max(0, (n - (1 - LAMP.lightsOnBelow)) / 0.25));
  const paintBulbs = () => {
    if (!bulbs) return;
    const step = Math.round(levelOf(night) * BULB_STEPS);
    const key = `${step}|${cut}`;
    if (key === painted) return;
    painted = key;
    shine.copy(dark).lerp(bright, step / BULB_STEPS);
    for (let i = 0; i < spots.length; i++) bulbs.setColorAt(i, power.dark(i) ? dark : shine);
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  };
  paintBulbs();
  return {
    group,
    count: spots.length,
    setNight(n) {
      night = n;
      const on = Math.min(1, Math.max(0, (n - (1 - LAMP.lightsOnBelow)) / 0.25));
      poolMat.opacity = on * LAMP.poolOpacity;
      coneMat.opacity = on * LAMP.coneOpacity;
      for (const mesh of lit) mesh.visible = on > 0.01;
      paintBulbs();
      lights.forEach((light, k) => {
        light.intensity = assigned[k] ? on * LAMP.lightPower : 0;
        light.visible = on > 0.01;
      });
    },
    setTime(t) {
      power.apply(t, lit);
      if (t.total === minute) return;
      minute = t.total;
      let next = "";
      for (let i = 0; i < spots.length; i++) next += power.dark(i) ? "0" : "1";
      cut = next;
      paintBulbs();
    },
    update(focus) {
      if (!lights.length || night <= 1 - LAMP.lightsOnBelow || frame++ % LAMP.reassignEvery !== 0) return;
      nearest.length = 0;
      for (let i = 0; i < heads.length; i++) {
        const d = (heads[i].x - focus.x) ** 2 + (heads[i].z - focus.z) ** 2;
        if (d > 90 * 90 || power.dark(i)) continue;
        let k = nearest.length;
        nearest.push(i, d);
        while (k >= 2 && nearest[k - 1] > nearest[k + 1]) {
          const ti = nearest[k - 2], td = nearest[k - 1];
          nearest[k - 2] = nearest[k];
          nearest[k - 1] = nearest[k + 1];
          nearest[k] = ti;
          nearest[k + 1] = td;
          k -= 2;
        }
        if (nearest.length > lights.length * 2) nearest.length = lights.length * 2;
      }
      lights.forEach((light, k) => {
        const i = nearest[k * 2];
        assigned[k] = i !== undefined;
        if (i === undefined) light.intensity = 0;
        else {
          light.position.copy(heads[i]);
          light.intensity = Math.min(1, Math.max(0, (night - (1 - LAMP.lightsOnBelow)) / 0.25)) * LAMP.lightPower;
        }
      });
    },
    dispose() {
      for (const mesh of instanced) mesh.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
