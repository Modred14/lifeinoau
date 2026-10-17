import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BUILDINGS, PX_PER_METER, distSqToPolyEdge, pointInPoly } from "@campuslife/shared/map";
import { buildBuilding } from "./archetypes";
import { paintAtlas } from "./atlas";
import { ATLAS_HEIGHT, ATLAS_WIDTH } from "./atlas-layout";
import { buildChunkBuffers, chunkGeometry } from "./index";
import { footprintOf } from "./footprint";
import { facadeFrame, facadePoint, type FacadeFrame } from "./landmark-details";
import { MIN_OVERHANG_HEIGHT } from "./roofs";
import { emptyBuffers, rgb, type Archetype, type BuildingBuffers } from "./types";

const MAX_OVERHANG = 0.8;
const OVERHANG_FLOOR = 2.6;
const TOLERANCE = 0.03;
const DETAILED_BUDGET = 900;
const GENERIC_AVERAGE_BUDGET = 200;
const CHUNK_METRES = 250;
const DETAILED: readonly Archetype[] = ["hostel", "faculty", "lectureTheatre", "mosque", "chapel"];

const built = BUILDINGS.map((b) => {
  const buf = emptyBuffers();
  const info = buildBuilding(buf, b);
  return { b, buf, info };
});

const triangles = (buf: BuildingBuffers) => buf.idx.length / 3;

test("reviewed hostels and market keep the roof types and levels visible in their photos", () => {
  const sites = [
    { name: "Ojaja Hostel", floors: 3, roof: "hip" },
    { name: "Amazing Grace Hostel", floors: 2, roof: "hip" },
    { name: "SHG Hostel", floors: 2, roof: "hip" },
    { name: "Ladoke Akintola Hall", floors: 3, roof: "flat" },
    { name: "OAU New Market", floors: 1, roof: "gable" },
  ];
  for (const site of sites) {
    const blocks = built.filter(({ b }) => b.site === site.name);
    assert.ok(blocks.length, site.name);
    assert.ok(blocks.some(({ info }) => info.spec.roof === site.roof), `${site.name}: roof changed`);
    for (const { b, info } of blocks) {
      const floors = b.preset === "Akintola Entrance" ? 1 : site.floors;
      assert.equal(info.spec.floors, floors, `${site.name}: ${b.id} has the wrong number of levels`);
    }
  }
});

function landmark(name: string) {
  const item = built.find(({ b }) => b.name === name);
  assert.ok(item, `${name} is missing`);
  return item;
}

function facadeHit(name: string, frame: FacadeFrame, s: number, y: number) {
  const geometry = chunkGeometry(landmark(name).buf);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const origin = facadePoint(frame, s, -3);
  const ray = new THREE.Raycaster(new THREE.Vector3(origin[0], y, origin[1]), new THREE.Vector3(-frame.normal[0], 0, -frame.normal[1]), 0, 10);
  const hit = ray.intersectObject(mesh)[0];
  assert.ok(hit?.face, `no visible facade at ${name}, height ${y}`);
  const colors = geometry.getAttribute("color");
  const color = [colors.getX(hit.face.a), colors.getY(hit.face.a), colors.getZ(hit.face.a)];
  geometry.dispose();
  material.dispose();
  return { distance: hit.distance, color };
}

function closeColor(actual: readonly number[], hex: number) {
  const expected = rgb(hex);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 0.0001, `unexpected facade colour ${actual}`);
}

test("the library door and circular opening stay visible through the entrance wall", () => {
  const { info } = landmark("Hezekiah Oluwasanmi Library");
  assert.equal(info.spec.floors, 3);
  const entrance = facadeFrame(info.footprint, 5);
  const door = facadeHit("Hezekiah Oluwasanmi Library", entrance, entrance.length / 2, 1.8);
  closeColor(door.color, 0x1c2528);
  assert.ok(door.distance > 3.08 && door.distance < 3.12);
  const circleY = (info.spec.floors * info.spec.storey + 0.6) * 0.65;
  const opening = facadeHit("Hezekiah Oluwasanmi Library", entrance, entrance.length / 2, circleY);
  closeColor(opening.color, 0x1c2528);
  assert.ok(opening.distance > 3.26 && opening.distance < 3.3);
});

test("the Senate vent and both kinds of sun fin are visible in front of recessed walls", () => {
  const name = "University Senate Building";
  const { info } = landmark(name);
  const tower = footprintOf(info.footprint.pts.slice(0, 4).flatMap((p) => [p[0] * PX_PER_METER, p[1] * PX_PER_METER]), 103);
  const front = facadeFrame(tower, 2);
  const vent = facadeHit(name, front, front.length * 0.58, info.spec.floors * info.spec.storey + 0.95);
  closeColor(vent.color, 0x2a2b27);
  assert.ok(vent.distance > 3.09 && vent.distance < 3.13);
  const podium = facadeFrame(info.footprint, 4);
  const count = Math.floor((podium.length - 1.6) / 1.5);
  const whiteFin = facadeHit(name, podium, 0.8 + 0.5 * (podium.length - 1.6) / count, 2);
  closeColor(whiteFin.color, 0xf4f2ec);
  assert.ok(whiteFin.distance > 3.04 && whiteFin.distance < 3.08);
  const office = facadeFrame(landmark("Senate Building").info.footprint, 1);
  const officeCount = Math.floor((office.length - 1.6) / 2.3);
  const redFin = facadeHit("Senate Building", office, 0.8 + 0.5 * (office.length - 1.6) / officeCount, 4.5);
  closeColor(redFin.color, 0x9b594d);
  assert.ok(redFin.distance > 3.04 && redFin.distance < 3.08);
  const officeWindow = facadeHit("Senate Building", office, office.length * 0.7, 2.55);
  closeColor(officeWindow.color, 0x252b2b);
  assert.ok(officeWindow.distance > 3.13 && officeWindow.distance < 3.17);
});

test("the Amphitheatre has solid raked seating below its canopy", () => {
  const { buf, info } = landmark("Amphi Theatre");
  const geometry = chunkGeometry(buf);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const [x, z] = info.footprint.centre;
  for (const [y, direction] of [[9, -1], [0.48, 1]] as const) {
    const hit = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, direction, 0)).intersectObject(mesh)[0];
    assert.ok(hit && hit.point.y > 1 && hit.point.y < 8, `missing seating ${direction === -1 ? "surface" : "underside"}`);
  }
  geometry.dispose();
  material.dispose();
});

test("Administration columns remain in front of its recessed facade", () => {
  const { info } = landmark("Faculty of Administration");
  const main = footprintOf(info.footprint.pts.slice(0, 4).flatMap((p) => [p[0] * PX_PER_METER, p[1] * PX_PER_METER]), 94);
  const front = facadeFrame(main, 0);
  const column = facadeHit("Faculty of Administration", front, 3, 6.5);
  closeColor(column.color, 0xf4f2ec);
  assert.ok(column.distance < 6, "column is buried behind the windows");
});

test("the Senate office wing stays lower than the tower and halls keep their varied levels", () => {
  const maximum = (buf: BuildingBuffers) => Math.max(...buf.pos.filter((_, i) => i % 3 === 1));
  assert.ok(maximum(landmark("University Senate Building").buf) > maximum(landmark("Senate Building").buf) * 1.8);
  for (const [id, floors] of [[211, 4], [218, 3], [201, 4], [255, 3]] as const) {
    assert.equal(built[id].info.spec.floors, floors, `floor count ${id}`);
    assert.equal(built[id].info.spec.roof, "flat", `roof ${id}`);
    assert.equal(built[id].info.spec.tanks, false, `unverified rooftop tank ${id}`);
  }
  assert.equal(built[117].info.spec.floors, 1);
  assert.equal(built[117].info.spec.roof, "gable");
});

test("every building produces a valid mesh", () => {
  for (const { b, buf } of built) {
    const vertices = buf.pos.length / 3;
    assert.ok(vertices > 0, `building ${b.id} is empty`);
    assert.equal(buf.uv.length / 2, vertices, `uv length ${b.id}`);
    assert.equal(buf.col.length / 3, vertices, `colour length ${b.id}`);
    assert.equal(buf.idx.length % 3, 0, `index length ${b.id}`);
    for (const v of buf.pos) assert.ok(Number.isFinite(v), `position ${b.id}`);
    for (const v of buf.uv) assert.ok(Number.isFinite(v), `uv ${b.id}`);
    for (const v of buf.col) assert.ok(Number.isFinite(v) && v >= 0, `colour ${b.id}`);
    for (const i of buf.idx) assert.ok(Number.isInteger(i) && i >= 0 && i < vertices, `index ${b.id}`);
    for (let i = 1; i < buf.uv.length; i += 2) assert.ok(buf.uv[i] >= 0 && buf.uv[i] <= 1, `v stays in the atlas ${b.id}`);
  }
});

test("geometry stays on the outline, with overhangs only above head height", () => {
  for (const { b, buf, info } of built) {
    for (let i = 0; i < buf.pos.length; i += 3) {
      const x = buf.pos[i] * PX_PER_METER, y = buf.pos[i + 1], z = buf.pos[i + 2] * PX_PER_METER;
      assert.ok(y >= -0.001, `below ground ${b.id}`);
      if (pointInPoly(x, z, b.poly)) continue;
      const outside = Math.sqrt(distSqToPolyEdge(x, z, b.poly)) / PX_PER_METER;
      const allowed = (y >= OVERHANG_FLOOR ? MAX_OVERHANG : 0) + TOLERANCE;
      assert.ok(outside <= allowed, `${info.spec.archetype} ${b.id} sticks out ${outside.toFixed(2)} m at height ${y.toFixed(2)}`);
    }
  }
  assert.ok(MIN_OVERHANG_HEIGHT >= OVERHANG_FLOOR);
});

test("triangle budgets hold", () => {
  let genericTotal = 0, genericCount = 0;
  for (const { b, buf, info } of built) {
    assert.ok(triangles(buf) <= DETAILED_BUDGET, `${info.spec.archetype} ${b.id} uses ${triangles(buf)} triangles`);
    if (DETAILED.includes(info.spec.archetype) || b.name) continue;
    genericTotal += triangles(buf);
    genericCount++;
  }
  assert.ok(genericTotal / genericCount <= GENERIC_AVERAGE_BUDGET, `generic average ${genericTotal / genericCount}`);
});

test("no triangle is degenerate", () => {
  for (const { b, buf } of built) {
    for (let t = 0; t < buf.idx.length; t += 3) {
      const [i, j, k] = [buf.idx[t] * 3, buf.idx[t + 1] * 3, buf.idx[t + 2] * 3];
      const ux = buf.pos[j] - buf.pos[i], uy = buf.pos[j + 1] - buf.pos[i + 1], uz = buf.pos[j + 2] - buf.pos[i + 2];
      const vx = buf.pos[k] - buf.pos[i], vy = buf.pos[k + 1] - buf.pos[i + 1], vz = buf.pos[k + 2] - buf.pos[i + 2];
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      assert.ok(area > 1e-7, `degenerate triangle in ${b.id}`);
    }
  }
});

test("walls face away from the building", () => {
  for (const { b, buf } of built) {
    let plinths = 0;
    for (let t = 0; t < buf.idx.length; t += 3) {
      const [i, j, k] = [buf.idx[t] * 3, buf.idx[t + 1] * 3, buf.idx[t + 2] * 3];
      if (Math.max(buf.pos[i + 1], buf.pos[j + 1], buf.pos[k + 1]) > 0.46) continue;
      plinths++;
      const ux = buf.pos[j] - buf.pos[i], uy = buf.pos[j + 1] - buf.pos[i + 1], uz = buf.pos[j + 2] - buf.pos[i + 2];
      const vx = buf.pos[k] - buf.pos[i], vy = buf.pos[k + 1] - buf.pos[i + 1], vz = buf.pos[k + 2] - buf.pos[i + 2];
      const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, nz) || 1;
      const mx = (buf.pos[i] + buf.pos[j] + buf.pos[k]) / 3, mz = (buf.pos[i + 2] + buf.pos[j + 2] + buf.pos[k + 2]) / 3;
      const probe = 0.05;
      assert.ok(!pointInPoly((mx + (nx / length) * probe) * PX_PER_METER, (mz + (nz / length) * probe) * PX_PER_METER, b.poly), `a wall of ${b.id} faces inward`);
    }
    assert.ok(plinths >= 6, `building ${b.id} has no base`);
  }
});

test("the same campus is built on every run", () => {
  for (const { b, buf, info } of built.filter((_, i) => i % 7 === 0)) {
    const again = emptyBuffers();
    const second = buildBuilding(again, b);
    assert.deepEqual(again, buf, `building ${b.id} changed between runs`);
    assert.deepEqual(second.spec, info.spec);
  }
});

test("every archetype is used and the others are not all alike", () => {
  const counts = new Map<Archetype, number>();
  const otherLooks = new Set<string>();
  for (const { b, info } of built) {
    counts.set(info.spec.archetype, (counts.get(info.spec.archetype) ?? 0) + 1);
    if (b.kind === "other") otherLooks.add(`${info.spec.archetype}|${info.spec.roof}|${info.spec.wall.join()}|${info.spec.roofColor.join()}`);
  }
  for (const a of ["hostel", "faculty", "lectureTheatre", "bungalow", "block", "mosque", "chapel", "shopRow", "kiosk", "civic", "sports", "shed", "generic"] as const) {
    assert.ok((counts.get(a) ?? 0) > 0, `no ${a}`);
  }
  assert.ok(otherLooks.size > 200, `only ${otherLooks.size} distinct looks`);
  console.log("archetypes", Object.fromEntries(counts));
});

test("chunks hold every building and report the totals", () => {
  const chunks = buildChunkBuffers(CHUNK_METRES);
  let total = 0, largest = 0;
  for (const buf of chunks.values()) {
    total += triangles(buf);
    largest = Math.max(largest, triangles(buf));
  }
  const separate = built.reduce((sum, item) => sum + triangles(item.buf), 0);
  assert.equal(total, separate);
  const before = BUILDINGS.reduce((sum, b) => sum + 3 * (b.poly.length / 2) - 2, 0);
  const hostels = built.filter((item) => item.info.spec.archetype === "hostel");
  console.log(`triangles before ${before}, after ${total}, draw calls ${chunks.size}, largest chunk ${largest}`);
  console.log(`hostel average ${Math.round(hostels.reduce((s, h) => s + triangles(h.buf), 0) / hostels.length)}, max ${Math.max(...hostels.map((h) => triangles(h.buf)))}`);
  console.log(`busiest building ${Math.max(...built.map((item) => triangles(item.buf)))}`);
});

test("the atlas paints the same pixels every time and has lit windows", () => {
  const first = paintAtlas();
  const second = paintAtlas();
  assert.equal(first.color.length, ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  assert.ok(first.width <= 2048 && first.height <= 2048);
  assert.deepEqual(first.color, second.color);
  let lit = 0;
  for (let i = 0; i < first.glow.length; i += 4) if (first.glow[i] > 200) lit++;
  assert.ok(lit > 1000 && lit < first.glow.length / 8, `lit pixels ${lit}`);
});
