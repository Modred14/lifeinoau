import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CameraRig, OUTDOOR_LIMITS } from "./camera";

const FRAME = 1 / 60;

function settle(rig: CameraRig, follow: THREE.Vector3, camera: THREE.PerspectiveCamera, seconds: number) {
  for (let t = 0; t < seconds; t += FRAME) rig.update(FRAME, follow, camera);
}

test("zooms out far past the old limit and glides there", () => {
  const rig = new CameraRig();
  const camera = new THREE.PerspectiveCamera();
  const follow = new THREE.Vector3(500, 0, 500);
  rig.snap();
  rig.zoomBy(1000);
  assert.equal(rig.zoom, OUTDOOR_LIMITS.zoomMax);
  assert.ok(OUTDOOR_LIMITS.zoomMax >= 600);
  rig.update(FRAME, follow, camera);
  assert.ok(rig.distance > 14 && rig.distance < 30);
  settle(rig, follow, camera, 3);
  assert.ok(Math.abs(rig.distance - OUTDOOR_LIMITS.zoomMax) < 1);
});

test("a flick keeps turning, slows down and stops", () => {
  const rig = new CameraRig();
  const camera = new THREE.PerspectiveCamera();
  const follow = new THREE.Vector3();
  rig.snap();
  rig.fling(2, 0);
  rig.update(FRAME, follow, camera);
  const early = rig.yaw;
  assert.ok(early > 0);
  settle(rig, follow, camera, 4);
  const rest = rig.yaw;
  assert.ok(rest > early);
  settle(rig, follow, camera, 1);
  assert.equal(rig.yaw, rest);
});

test("pressing down stops a flick", () => {
  const rig = new CameraRig();
  const camera = new THREE.PerspectiveCamera();
  rig.fling(2, 0);
  rig.halt();
  settle(rig, new THREE.Vector3(), camera, 1);
  assert.equal(rig.yaw, 0);
});

test("panning stops at the edge of the map", () => {
  const rig = new CameraRig();
  const camera = new THREE.PerspectiveCamera();
  const follow = new THREE.Vector3(100, 0, 100);
  rig.setBounds({ minX: 0, maxX: 1000, minZ: 0, maxZ: 1000 });
  rig.snap();
  rig.panMetres(3000, 0);
  settle(rig, follow, camera, 3);
  assert.ok(Math.abs(rig.focus.x - 1000) < 1);
  assert.ok(rig.free);
  rig.recenter();
  settle(rig, follow, camera, 3);
  assert.ok(Math.abs(rig.focus.x - 100) < 1);
});

test("a player outside the map bounds is still followed", () => {
  const rig = new CameraRig();
  const camera = new THREE.PerspectiveCamera();
  const follow = new THREE.Vector3(2600, 0, 50);
  rig.setBounds({ minX: 0, maxX: 1000, minZ: 0, maxZ: 1000 });
  rig.snap();
  settle(rig, follow, camera, 1);
  assert.equal(rig.focus.x, 2600);
});

test("a saved pose is restored inside the limits", () => {
  const rig = new CameraRig();
  rig.apply({ yaw: 1.2, pitch: 0.9, zoom: 99999 });
  assert.deepEqual(rig.pose, { yaw: 1.2, pitch: 0.9, zoom: OUTDOOR_LIMITS.zoomMax });
});
