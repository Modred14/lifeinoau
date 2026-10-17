import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PX_PER_METER, distSqToPolyEdge, pointInPoly } from "@campuslife/shared/map";
import { ROW } from "./atlas-layout";
import { at, footprintOf, type Footprint } from "./footprint";
import { buildMaintenanceHall } from "./maintenance-halls";
import { emptyBuffers, rgb, type BuildingBuffers, type BuildingSpec } from "./types";

const spec: BuildingSpec = {
  archetype: "block", floors: 2, storey: 3.1, roof: "hip", slope: 0.36, overhang: 0.8,
  wall: rgb(0xa75d65), trim: rgb(0xc49a54), roofColor: rgb(0x90877b),
  frontRow: ROW.office, backRow: ROW.office, endRow: ROW.office, groundRow: ROW.office,
  bandRow: ROW.plain, bay: 3.4, bandStep: 0, balconies: false, towers: false,
  sunshade: false, canopy: false, dome: false, cross: false, tanks: false, facade: "maintenance",
};

function wing(length: number, depth: number, angle = 0, reverse = false) {
  let points = [[0, 0], [length, 0], [length, depth], [0, depth]].map(([x, z]) => [(x * Math.cos(angle) - z * Math.sin(angle) + 90) * PX_PER_METER, (x * Math.sin(angle) + z * Math.cos(angle) + 70) * PX_PER_METER]);
  if (reverse) points = points.reverse();
  const poly = points.flat();
  const fp = footprintOf(poly, 1755);
  const buf = emptyBuffers();
  assert.equal(buildMaintenanceHall(buf, fp, spec), true);
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
  const origin = at(fp.rect, s, side === "front" ? -2 : fp.rect.depth + 2);
  const target = at(fp.rect, s, side === "front" ? 0 : fp.rect.depth);
  return new THREE.Raycaster(new THREE.Vector3(origin[0], y, origin[1]), new THREE.Vector3(target[0] - origin[0], 0, target[1] - origin[1]).normalize(), 0, 10);
}

test("maintenance hall rejects irregular outlines without changing buffers", () => {
  const buf = emptyBuffers();
  const fp = footprintOf([0, 0, 300, 0, 300, 200, 150, 100, 0, 200], 1);
  assert.equal(fp.rect, null);
  assert.equal(buildMaintenanceHall(buf, fp, spec), false);
  assert.deepEqual(buf, emptyBuffers());
});

test("maintenance wings preserve their outline, outward base winding and geometry budget", () => {
  for (const [length, depth, angle, reverse] of [[80, 7, 0, false], [80, 10, 0.7, true], [71, 5, 0.4, false], [25, 7, 1.2, true], [80, 80 / 17 + 1.4, 0.2, false], [12, 2, 0.9, true]] as const) {
    const { poly, fp, buf } = wing(length, depth, angle, reverse);
    const vertices = buf.pos.length / 3;
    assert.ok(buf.idx.length / 3 < 900, `${length} m wing uses ${buf.idx.length / 3} triangles`);
    assert.equal(buf.uv.length, vertices * 2);
    assert.equal(buf.col.length, vertices * 3);
    for (let i = 0; i < buf.pos.length; i += 3) {
      const x = buf.pos[i] * PX_PER_METER, y = buf.pos[i + 1], z = buf.pos[i + 2] * PX_PER_METER;
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
      assert.ok(y >= 0);
      if (!pointInPoly(x, z, poly)) assert.ok(Math.sqrt(distSqToPolyEdge(x, z, poly)) / PX_PER_METER < 0.03, "geometry projects outside the original outline");
    }
    for (let i = 1; i < buf.uv.length; i += 2) assert.ok(buf.uv[i] >= 0 && buf.uv[i] <= 1);
    for (const index of buf.idx) assert.ok(Number.isInteger(index) && index >= 0 && index < vertices);
    let baseFaces = 0;
    for (let i = 0; i < buf.idx.length; i += 3) {
      const [a, b, c] = [buf.idx[i], buf.idx[i + 1], buf.idx[i + 2]].map((v) => new THREE.Vector3(...buf.pos.slice(v * 3, v * 3 + 3) as [number, number, number]));
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      assert.ok(normal.length() > 1e-7, "degenerate triangle");
      if (Math.max(a.y, b.y, c.y) > 0.46) continue;
      baseFaces++;
      const centre = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
      assert.ok(normal.dot(new THREE.Vector3(centre.x - fp.centre[0], 0, centre.z - fp.centre[1])) > 0, "base face points into the building");
    }
    assert.equal(baseFaces, 8);
  }
});

test("both floors have solid mauve bays and ochre recessed bays on each long face", () => {
  const { fp, buf } = wing(80, 10, 0.6, true);
  const { mesh, dispose } = meshOf(buf);
  try {
    for (const side of ["front", "back"] as const) {
      for (const floor of [0, 1]) {
        const mauve = sideRay(fp, side, 1, floor * spec.storey + 2.6).intersectObject(mesh)[0];
        const ochre = sideRay(fp, side, 10.8, floor * spec.storey + 2.6).intersectObject(mesh)[0];
        assert.ok(mauve?.face && ochre?.face, "a solid exterior bay is missing");
        assert.ok(mauve.distance > 2 && mauve.distance < 2.1);
        assert.ok(ochre.distance > 2.6 && ochre.distance < 2.8);
        const colors = mesh.geometry.getAttribute("color");
        for (let component = 0; component < 3; component++) {
          assert.ok(Math.abs(colors.getComponent(mauve.face.a, component) - spec.wall[component]) < 0.00001);
          assert.ok(Math.abs(colors.getComponent(ochre.face.a, component) - spec.trim[component]) < 0.00001);
        }
      }
    }
  } finally {
    dispose();
  }
});

test("white framed window panels remain visible in front of both ochre walls", () => {
  const { fp, buf } = wing(80, 10, 0.6, true);
  const { mesh, dispose } = meshOf(buf);
  try {
    const frameColor = rgb(0xf4f1e6);
    for (const side of ["front", "back"] as const) {
      for (const floor of [0, 1]) {
        const hit = sideRay(fp, side, 9.31, floor * spec.storey + 1.5).intersectObject(mesh)[0];
        assert.ok(hit?.face, "window panel is missing");
        assert.ok(hit.distance > 2.65 && hit.distance < 2.695, "window panel is behind its solid wall");
        const colors = mesh.geometry.getAttribute("color");
        for (let component = 0; component < 3; component++) assert.ok(Math.abs(colors.getComponent(hit.face.a, component) - frameColor[component]) < 0.00001);
      }
    }
  } finally {
    dispose();
  }
});

test("a long wing has repeated metal roof peaks with valleys between them", () => {
  const { fp, buf } = wing(80, 10, 0.3);
  assert.ok(fp.rect);
  const { mesh, dispose } = meshOf(buf);
  try {
    const height = spec.floors * spec.storey;
    let peaks = 0, raised = false;
    for (let s = 0.05; s < fp.rect.length; s += 0.25) {
      const origin = at(fp.rect, s, fp.rect.depth / 2);
      const hit = new THREE.Raycaster(new THREE.Vector3(origin[0], height + 5, origin[1]), new THREE.Vector3(0, -1, 0), 0, 10).intersectObject(mesh)[0];
      assert.ok(hit && hit.point.y >= height - 0.01, "roof has a gap");
      const next = hit.point.y > height + 0.7;
      if (next && !raised) peaks++;
      raised = next;
    }
    assert.ok(peaks >= 6, `only ${peaks} roof peaks were built`);
  } finally {
    dispose();
  }
});
