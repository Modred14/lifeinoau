import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { AREAS, LINES, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, STALLS, isBlocked, nearBuilding, onRoad, pointInPoly } from "@campuslife/shared";
import { buildScenery } from "./index";
import { scatterGeometry } from "./meshes";
import { REAL_SHRUBS, REAL_TREES, REAL_TREE_STRIDE, SCATTER_CHUNK_M, SCATTER_KINDS, SCATTER_STRIDE, clearOfRoad, planScatter, treeScale } from "./plan";
import { BED_SIZE, bedPoint, insideBed } from "./planting";

const M = PX_PER_METER;
const plan = planScatter(1);
const each = (fn: (kind: (typeof SCATTER_KINDS)[number], x: number, y: number, scale: number) => void) => {
  for (const chunk of plan.chunks) for (const kind of SCATTER_KINDS) for (let i = 0; i < chunk.items[kind].length; i += SCATTER_STRIDE) fn(kind, chunk.items[kind][i] * M, chunk.items[kind][i + 1] * M, chunk.items[kind][i + 2]);
};

test("open lawns and a few planted beds stay within the phone scenery budget", () => {
  assert.ok(plan.counts.bed >= 12 && plan.counts.bed <= 24, `beds ${plan.counts.bed}`);
  assert.equal(plan.counts.bush, plan.counts.bed * 5);
  assert.ok(plan.counts.flower > plan.counts.bed * 25);
  assert.ok(plan.counts.tree + plan.counts.palm > 3000);
  assert.ok(plan.counts.rock > 1500);
  assert.ok(plan.counts.tuft < 6000);
  const total = SCATTER_KINDS.reduce((n, k) => n + plan.counts[k], 0);
  assert.ok(total < 21000, `total ${total}`);
  const low = planScatter(0.55);
  assert.deepEqual(low.beds, plan.beds);
  assert.equal(low.counts.bush, plan.counts.bush);
  assert.ok(low.counts.flower < plan.counts.flower * 0.75);
  assert.ok(low.counts.tree < plan.counts.tree * 0.65);
});

test("trees stand where the canopy survey found them and taller ones are drawn bigger", () => {
  const surveyed = REAL_TREES.length / REAL_TREE_STRIDE;
  assert.ok(surveyed > 8000, `surveyed ${surveyed}`);
  const cols = Math.ceil(MAP_WIDTH_PX / M) + 1;
  const real = new Set<number>();
  for (let i = 0; i < REAL_TREES.length; i += REAL_TREE_STRIDE) {
    const x = REAL_TREES[i];
    const y = REAL_TREES[i + 1];
    const h = REAL_TREES[i + 2];
    assert.ok(x >= 0 && y >= 0 && x * M <= MAP_WIDTH_PX && y * M <= MAP_HEIGHT_PX, `tree off the map at ${x},${y}`);
    assert.ok(h >= 4 && h <= 60, `tree height ${h}`);
    real.add(y * cols + x);
  }
  let placed = 0;
  each((kind, x, y) => {
    if (kind !== "tree" && kind !== "palm") return;
    placed++;
    assert.ok(real.has(Math.floor(y / M) * cols + Math.floor(x / M)), `${kind} at ${x},${y} is not in the survey`);
  });
  assert.equal(placed, plan.counts.tree + plan.counts.palm);
  assert.ok(placed > surveyed * 0.85, `${placed} of ${surveyed} surveyed trees placed`);
  assert.ok(treeScale(25) > treeScale(12) && treeScale(12) > treeScale(5));
});

test("wild shrubs only grow where the survey found low growth and never on a kept lawn", () => {
  const cols = Math.ceil(MAP_WIDTH_PX / M) + 1;
  const real = new Set<number>();
  for (let i = 0; i < REAL_SHRUBS.length; i += REAL_TREE_STRIDE) {
    assert.ok(REAL_SHRUBS[i + 2] >= 1 && REAL_SHRUBS[i + 2] < 4, `shrub height ${REAL_SHRUBS[i + 2]}`);
    real.add(REAL_SHRUBS[i + 1] * cols + REAL_SHRUBS[i]);
  }
  const lawns = AREAS.filter((a) => a.kind === "grass");
  each((kind, x, y) => {
    if (kind !== "scrub") return;
    assert.ok(real.has(Math.floor(y / M) * cols + Math.floor(x / M)), `shrub at ${x},${y} is not in the survey`);
    assert.ok(!lawns.some((a) => pointInPoly(x, y, a.poly)), "a wild shrub sits on a kept lawn");
  });
  assert.ok(plan.counts.scrub > 1000 && plan.counts.scrub <= REAL_SHRUBS.length / REAL_TREE_STRIDE, `scrub ${plan.counts.scrub}`);
  assert.ok(planScatter(0.55).counts.scrub < plan.counts.scrub * 0.65);
});

test("placement is the same every time so every player sees the same campus", () => {
  const again = planScatter(1);
  assert.deepEqual(again.counts, plan.counts);
  assert.deepEqual(again.beds, plan.beds);
  assert.deepEqual(again.chunks[7].items.bush.slice(0, 50), plan.chunks[7].items.bush.slice(0, 50));
});

test("every shrub and flower belongs to a deliberate bed and lawns have no wild flowers", () => {
  each((kind, x, y) => {
    if (kind === "bush" || kind === "flower") assert.ok(plan.beds.some((bed) => insideBed(bed, x, y)), `${kind} scattered outside a bed`);
    if (kind === "tree" || kind === "palm") assert.ok(!plan.beds.some((bed) => insideBed(bed, x, y, 3.6)), `${kind} crowds a bed`);
    if (kind === "tuft") assert.ok(!AREAS.some((a) => a.kind === "grass" && pointInPoly(x, y, a.poly)), "a maintained lawn has scattered tufts");
  });
  assert.equal(plan.beds.filter((b) => b.place === "oduduwa-hall").length, 2);
  assert.equal(plan.beds.filter((b) => b.place === "student-union-building").length, 2);
  for (const chunk of plan.chunks)
    for (let i = 4; i < chunk.items.tuft.length; i += SCATTER_STRIDE) assert.ok(chunk.items.tuft[i] < 1);
});

test("the whole bed border clears roads, buildings, entrances and other beds", () => {
  for (const [i, bed] of plan.beds.entries()) {
    for (const other of plan.beds.slice(i + 1)) assert.ok(Math.hypot(other.x - bed.x, other.y - bed.y) >= 15 * M);
    for (let n = 0; n < 64; n++) {
      const angle = n * Math.PI * 2 / 64;
      const at = bedPoint(bed, Math.cos(angle) * BED_SIZE.radiusX, Math.sin(angle) * BED_SIZE.radiusZ);
      assert.ok(clearOfRoad(at.x, at.y, M), `bed at ${bed.place} crosses a road`);
      assert.ok(!nearBuilding(at.x, at.y, M), `bed at ${bed.place} touches a building`);
      for (const door of PLACES.map((p) => p.door)) assert.ok(Math.hypot(at.x - door.x, at.y - door.y) > 4 * M);
    }
  }
});

test("nothing grows on a road, inside a building, on a pitch, in water or on a stall", () => {
  const hard = AREAS.filter((a) => a.kind === "water" || a.kind === "field" || a.kind === "parking" || a.kind === "plaza");
  let n = 0;
  each((kind, x, y) => {
    n++;
    assert.ok(!onRoad(x, y), `${kind} on a road at ${x},${y}`);
    if (kind !== "tuft") assert.ok(!isBlocked(x, y, 1), `${kind} inside something solid`);
    if (n % 7 === 0) assert.ok(!hard.some((a) => pointInPoly(x, y, a.poly)), `${kind} on a hard area`);
  });
  for (const s of STALLS) each((kind, x, y) => assert.ok(Math.hypot(x - s.x, y - s.y) > 3 * M, `${kind} on a stall`));
});

test("doors and bus stops are kept clear", () => {
  const clear = [...PLACES.map((p) => p.door), ...LINES.flatMap((l) => l.stops.map((s) => s.kerb))];
  each((kind, x, y) => {
    if (kind === "tuft") return;
    for (const c of clear) assert.ok(Math.abs(c.x - x) > 4 * M || Math.abs(c.y - y) > 4 * M || Math.hypot(c.x - x, c.y - y) > 4 * M, `${kind} blocks a door or stop`);
  });
});

test("each item sits in the chunk that owns it", () => {
  for (const chunk of plan.chunks)
    for (const kind of SCATTER_KINDS)
      for (let i = 0; i < chunk.items[kind].length; i += SCATTER_STRIDE) {
        assert.ok(Math.abs(chunk.items[kind][i] - chunk.cx) <= SCATTER_CHUNK_M / 2 + 1e-6);
        assert.ok(Math.abs(chunk.items[kind][i + 1] - chunk.cz) <= SCATTER_CHUNK_M / 2 + 1e-6);
      }
});

test("models are light, coloured and stand on the ground", () => {
  const budget = { tree: 420, palm: 200, bush: 60, scrub: 60, rock: 110, tuft: 14, flower: 260, bed: 300 };
  for (const kind of SCATTER_KINDS) {
    const g = scatterGeometry(kind);
    const tris = g.getAttribute("position").count / 3;
    assert.ok(tris <= budget[kind], `${kind} has ${tris} triangles`);
    assert.equal(g.getAttribute("color").count, g.getAttribute("position").count);
    assert.equal(g.getAttribute("normal").count, g.getAttribute("position").count);
    g.computeBoundingBox();
    assert.ok(g.boundingBox && Math.abs(g.boundingBox.min.y) < 0.2, `${kind} floats or sinks`);
    assert.ok(![...g.getAttribute("position").array].some((v) => Number.isNaN(v)));
    g.dispose();
  }
});

test("flowers have coloured blossoms above green stems and beds have a raised border", () => {
  const bloom = scatterGeometry("flower");
  const color = bloom.getAttribute("color");
  const pos = bloom.getAttribute("position");
  let leaves = 0;
  let petals = 0;
  for (let i = 0; i < pos.count; i++) {
    if (color.getY(i) > color.getX(i) && pos.getY(i) < 0.7) leaves++;
    if (color.getX(i) > color.getY(i) && pos.getY(i) > 0.55) petals++;
  }
  assert.ok(leaves > 0 && petals > 0);
  bloom.dispose();
  const border = scatterGeometry("bed");
  border.computeBoundingBox();
  assert.ok(border.boundingBox && border.boundingBox.max.y >= 0.13);
  border.dispose();
});

test("scenery builds as instanced chunks and hides what is far away", () => {
  let patched = 0;
  const scenery = buildScenery({ shadows: true, patch: () => void patched++ });
  assert.equal(patched, 1);
  const meshes = scenery.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
  assert.equal(meshes.length, scenery.group.children.length);
  assert.ok(meshes.length <= plan.chunks.length * SCATTER_KINDS.length);
  assert.equal(meshes.reduce((n, m) => n + m.count, 0), SCATTER_KINDS.reduce((n, k) => n + plan.counts[k], 0));
  assert.ok(meshes.every((m) => !m.visible));
  const door = PLACES[0].door;
  scenery.update(new THREE.Vector3(door.x / M, 0, door.y / M), 250);
  const shown = meshes.filter((m) => m.visible).length;
  assert.ok(shown > 0 && shown < meshes.length / 2, `${shown} of ${meshes.length} chunks shown`);
  scenery.dispose();
});
