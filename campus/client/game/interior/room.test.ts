import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { SEATS, SPOTS, TEMPLATES, INTERIORS, type Spot, type TemplateId } from "@campuslife/shared/interiors";
import { activityLook } from "./activity";
import { dishFor } from "./dishes";
import { Kit, type KitStats } from "./kit";
import { buildRoom } from "./room";

function build(id: TemplateId): { stats: KitStats; group: THREE.Group } {
  const kit = new Kit();
  const group = new THREE.Group();
  buildRoom(kit, TEMPLATES[id], () => new THREE.MeshLambertMaterial());
  const stats = kit.build(group, false);
  return { stats: { triangles: stats.triangles + 4, drawCalls: stats.drawCalls + 2 }, group };
}

test("rooms stay inside the phone budget and produce valid geometry", () => {
  const budget: Partial<Record<TemplateId, [number, number]>> = { lecture: [16000, 18], classroom: [10000, 18], foodcourt: [11000, 24] };
  for (const id of Object.keys(TEMPLATES) as TemplateId[]) {
    const { stats, group } = build(id);
    const [triangles, drawCalls] = budget[id] ?? [8000, 16];
    assert.ok(stats.triangles <= triangles, `${id}: ${stats.triangles} triangles`);
    assert.ok(stats.drawCalls <= drawCalls, `${id}: ${stats.drawCalls} draw calls`);
    group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute("position");
      for (let i = 0; i < position.count * 3; i++) assert.ok(Number.isFinite(position.array[i]), `${id}: bad vertex`);
    });
  }
});

test("lecture benches are drawn at the height students sit at", () => {
  const { group } = build("lecture");
  const box = new THREE.Box3();
  const t = TEMPLATES.lecture;
  const seat = t.spots[t.spots.length - 1];
  const top = (seat.floor ?? 0) + SEATS.fixed.h;
  let found = false;
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || found) return;
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 36) {
      box.makeEmpty();
      for (let k = i; k < i + 36 && k < position.count; k++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, k));
      if (Math.abs(box.max.y - top) < 1e-4 && box.min.x <= seat.x && box.max.x >= seat.x && box.min.z <= seat.y && box.max.z >= seat.y && box.max.y - box.min.y < 0.06) found = true;
    }
  });
  assert.ok(found, "no bench board under the last lecture seat");
});

test("activities map to poses from synced state only", () => {
  const sub = INTERIORS.find((it) => it?.template.id === "foodcourt")!;
  const seatIndex = Array.from({ length: sub.spotEnd - sub.spotStart }, (_, k) => sub.spotStart + k).find((i) => SPOTS[i].menu !== undefined)!;
  const seat = SPOTS[seatIndex];
  const dining = activityLook("eat", seat);
  assert.equal(dining.pose, "sit");
  assert.equal(dining.detail?.variant, "eat");
  assert.equal(dining.detail?.dish, SPOTS[seat.menu!].label);
  assert.deepEqual(dining.detail?.surface, seat.surface);
  const counter = SPOTS[seat.menu!];
  assert.deepEqual(activityLook("eat", counter), { pose: "eat", detail: { variant: "eat", dish: counter.label } });
  assert.equal(activityLook("sit", seat).detail?.variant, "listen");
  const hall = INTERIORS.find((it) => it?.template.id === "lecture")!;
  const bench: Spot = SPOTS[hall.spotStart];
  assert.equal(activityLook("study", bench).detail?.variant, "write");
  assert.equal(activityLook("exam", bench).detail?.focused, true);
  assert.equal(activityLook("study", bench).detail?.seat, SEATS.fixed);
  assert.deepEqual(activityLook("none", undefined), { pose: "stand" });
  assert.deepEqual(activityLook("sleep", undefined), { pose: "lie" });
  assert.deepEqual(activityLook("atm", counter), { pose: "busy" });
  assert.deepEqual(activityLook("dance", undefined), { pose: "dance" });
  assert.deepEqual(activityLook("pray", { ...bench, seat: undefined }), { pose: "sit" });
});

test("every food label resolves to a dish", () => {
  const labels = new Set(SPOTS.filter((s) => s.kind === "eat").map((s) => s.label));
  const ids = new Set<string>();
  for (const label of labels) ids.add(dishFor(label).id);
  assert.ok(ids.size >= 8, `only ${ids.size} dishes for ${labels.size} labels`);
  assert.equal(dishFor("Amala & ewedu").id, "amala");
  assert.equal(dishFor("Shawarma").plate, null);
  assert.equal(dishFor("Mama Put: rice, beans & plantain").id, "rice-beans");
});
