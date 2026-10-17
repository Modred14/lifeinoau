import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { PX_PER_METER, STALLS } from "@campuslife/shared";
import { buildStalls, cullStalls, shutterStalls } from "./stalls";

const MAX_MESHES_PER_STALL = 4;
const VIEW_FAR_M = 120;

function build() {
  const tracked: { dispose(): void }[] = [];
  let patched = 0;
  const group = buildStalls({ shadows: true, track: (d) => (tracked.push(d), d), patch: () => patched++ });
  return { group, tracked, patched: () => patched };
}

test("each stall is a few merged meshes with shared materials", () => {
  const { group, patched } = build();
  assert.equal(group.children.length, STALLS.length);
  const materials = new Set<THREE.Material>();
  let meshes = 0;
  group.children.forEach((stall, i) => {
    assert.ok(stall.children.length <= MAX_MESHES_PER_STALL, `stall ${i} has ${stall.children.length} meshes`);
    assert.equal(stall.children.filter((part) => part.userData.cover === true).length, 1);
    for (const part of stall.children) {
      assert.ok(part instanceof THREE.Mesh);
      materials.add(part.material as THREE.Material);
      assert.ok(part.geometry.getAttribute("position").count > 0);
      meshes++;
    }
  });
  assert.ok(meshes <= STALLS.length * MAX_MESHES_PER_STALL);
  assert.ok(materials.size <= MAX_MESHES_PER_STALL);
  assert.equal(patched(), 1);
});

test("a closed stall shows only its cover, and far stalls are hidden", () => {
  const { group } = build();
  shutterStalls(group, (index) => index === 0);
  assert.deepEqual(group.children[0].children.map((part) => part.visible), group.children[0].children.map((part) => part.userData.cover === true));
  assert.deepEqual(group.children[1].children.map((part) => part.visible), group.children[1].children.map((part) => part.userData.cover !== true));
  const first = STALLS[0];
  const focus = new THREE.Vector3(first.x / PX_PER_METER, 0, first.y / PX_PER_METER);
  cullStalls(group, focus, VIEW_FAR_M);
  assert.equal(group.children[0].visible, true);
  STALLS.forEach((s, i) => assert.equal(group.children[i].visible, Math.hypot(s.x - first.x, s.y - first.y) / PX_PER_METER < VIEW_FAR_M + 6, `stall ${i}`));
  assert.ok(group.children.some((stall) => !stall.visible));
});
