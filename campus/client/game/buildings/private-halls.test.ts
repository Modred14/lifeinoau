import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PX_PER_METER, distSqToPolyEdge, pointInPoly } from "@campuslife/shared/map";
import { ROW } from "./atlas-layout";
import { at, footprintOf, type Footprint } from "./footprint";
import { buildPrivateHall } from "./private-halls";
import { emptyBuffers, rgb, type BuildingBuffers, type BuildingSpec } from "./types";

const spec: BuildingSpec = {
  archetype: "hostel", floors: 3, storey: 3.2, roof: "hip", slope: 0.3, overhang: 0.8,
  wall: rgb(0xf1e5c8), trim: rgb(0xf1e5c8), roofColor: rgb(0xa44735),
  frontRow: ROW.hostelCorridor, backRow: ROW.hostelCorridor, endRow: ROW.hostelRooms,
  groundRow: ROW.hostelCorridor, bandRow: ROW.plain, bay: 3.4, bandStep: 0,
  balconies: true, towers: false, sunshade: false, canopy: false, dome: false,
  cross: false, tanks: false, facade: "private",
};

function wing(length: number, depth: number, angle = 0, reverse = false) {
  let points = [[0, 0], [length, 0], [length, depth], [0, depth]].map(([x, z]) => [(x * Math.cos(angle) - z * Math.sin(angle) + 90) * PX_PER_METER, (x * Math.sin(angle) + z * Math.cos(angle) + 70) * PX_PER_METER]);
  if (reverse) points = points.reverse();
  const poly = points.flat();
  const fp = footprintOf(poly, 684);
  const buf = emptyBuffers();
  assert.equal(buildPrivateHall(buf, fp, spec), true);
  return { poly, fp, buf };
}

function meshOf(buf: BuildingBuffers) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buf.pos, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buf.col, 3));
  geometry.setIndex(buf.idx);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  return { mesh, dispose: () => { geometry.dispose(); material.dispose(); } };
}

function sideRay(fp: Footprint, side: "front" | "back", s: number, y: number) {
  assert.ok(fp.rect);
  const t = side === "front" ? -2 : fp.rect.depth + 2;
  const origin = at(fp.rect, s, t);
  const target = at(fp.rect, s, side === "front" ? 0 : fp.rect.depth);
  return new THREE.Raycaster(new THREE.Vector3(origin[0], y, origin[1]), new THREE.Vector3(target[0] - origin[0], 0, target[1] - origin[1]).normalize(), 0, 10);
}

test("private hall rejects an irregular footprint without changing the buffers", () => {
  const buf = emptyBuffers();
  const fp = footprintOf([0, 0, 300, 0, 300, 200, 150, 100, 0, 200], 1);
  assert.equal(fp.rect, null);
  assert.equal(buildPrivateHall(buf, fp, spec), false);
  assert.deepEqual(buf, emptyBuffers());
});

test("private hall wings keep valid geometry, overhang limits and triangle budgets", () => {
  for (const [length, depth, angle, reverse] of [[80, 7, 0, false], [80, 10, 0.7, false], [50, 7, 0.3, true], [25, 7, 0.4, false], [18, 8, 1.1, true]] as const) {
    const { poly, buf } = wing(length, depth, angle, reverse);
    const vertices = buf.pos.length / 3;
    assert.ok(buf.idx.length / 3 < 900, `${length} m wing uses ${buf.idx.length / 3} triangles`);
    assert.equal(buf.uv.length, vertices * 2);
    assert.equal(buf.col.length, vertices * 3);
    for (let i = 0; i < buf.pos.length; i += 3) {
      const x = buf.pos[i] * PX_PER_METER, y = buf.pos[i + 1], z = buf.pos[i + 2] * PX_PER_METER;
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
      assert.ok(y >= 0);
      if (pointInPoly(x, z, poly)) continue;
      const outside = Math.sqrt(distSqToPolyEdge(x, z, poly)) / PX_PER_METER;
      assert.ok(outside <= (y >= 2.6 ? 0.8 : 0) + 0.03, `outline exceeded by ${outside} m at ${y} m`);
    }
    for (const i of buf.idx) assert.ok(Number.isInteger(i) && i >= 0 && i < vertices);
    for (let i = 1; i < buf.uv.length; i += 2) assert.ok(buf.uv[i] >= 0 && buf.uv[i] <= 1);
    for (let i = 0; i < buf.idx.length; i += 3) {
      const [a, b, c] = [buf.idx[i], buf.idx[i + 1], buf.idx[i + 2]].map((v) => new THREE.Vector3(...buf.pos.slice(v * 3, v * 3 + 3) as [number, number, number]));
      assert.ok(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() > 1e-7);
    }
  }
});

test("both long facades expose recessed room walls behind black metal rails", () => {
  const { fp, buf } = wing(80, 7, 0.8, true);
  assert.ok(fp.rect);
  const s = 0.2 + (fp.rect.length - 0.4) / 32;
  const { mesh, dispose } = meshOf(buf);
  try {
    for (const side of ["front", "back"] as const) {
      const room = sideRay(fp, side, s, spec.storey + 1.8).intersectObject(mesh)[0];
      assert.ok(room && room.distance > 2.8 && room.distance < 3.4, `${side} corridor is filled at the outer facade`);
      const rail = sideRay(fp, side, s, spec.storey + 1.08).intersectObject(mesh)[0];
      assert.ok(rail?.face && rail.distance < room.distance - 0.6, `${side} rail is buried behind the wall`);
      const color = mesh.geometry.getAttribute("color");
      const expected = rgb(0x212321);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(color.getComponent(rail.face.a, i) - expected[i]) < 0.00001);
    }
  } finally {
    dispose();
  }
});

test("a connecting wing lattice has real gaps in front of its inset stair wall", () => {
  const { fp, buf } = wing(25, 7);
  assert.ok(fp.rect);
  const { mesh, dispose } = meshOf(buf);
  try {
    const origin = at(fp.rect, -2, fp.rect.depth / 2);
    const target = at(fp.rect, 0, fp.rect.depth / 2);
    const direction = new THREE.Vector3(target[0] - origin[0], 0, target[1] - origin[1]).normalize();
    const distances = [3.7, 4.1, 4.45, 4.8, 5.15].map((y) => new THREE.Raycaster(new THREE.Vector3(origin[0], y, origin[1]), direction, 0, 10).intersectObject(mesh)[0]?.distance);
    assert.ok(distances.some((d) => d !== undefined && d < 2.1), "lattice bars are missing");
    assert.ok(distances.some((d) => d !== undefined && d > 2.5), "lattice openings are covered by the end wall");
  } finally {
    dispose();
  }
});
