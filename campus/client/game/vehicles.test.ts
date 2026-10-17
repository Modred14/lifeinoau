import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { VEHICLE_SPECS } from "@campuslife/shared/transit";
import { disposeVehicle, makeVehicle, setVehiclePassengers } from "./vehicles";

const SIZE_SLACK = 0.25;

for (const kind of ["okada", "keke"] as const) {
  test(`${kind} model matches its spec and seats its passengers`, () => {
    const model = makeVehicle(kind, "", false);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const [length, width] = VEHICLE_SPECS[kind].size;
    assert.ok(Math.abs(size.z - length) < SIZE_SLACK, `length ${size.z}`);
    assert.ok(Math.abs(size.x - width) < SIZE_SLACK, `width ${size.x}`);
    const seats: unknown = model.userData.passengers;
    assert.ok(Array.isArray(seats));
    assert.equal(seats.length, kind === "okada" ? 1 : 3);
    assert.equal(seats.length, VEHICLE_SPECS[kind].seats);
    assert.ok(seats.every((s) => s instanceof THREE.Object3D && !s.visible));
    setVehiclePassengers(model, 1);
    assert.deepEqual(seats.map((s) => (s instanceof THREE.Object3D ? s.visible : null)), kind === "okada" ? [true] : [true, false, false]);
    setVehiclePassengers(model, 0);
    assert.ok(seats.every((s) => s instanceof THREE.Object3D && !s.visible));
    disposeVehicle(model);
  });
}

test("bicycle model matches its spec and stands on its wheels", () => {
  const model = makeVehicle("bicycle", "", false);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const [length, width, height] = VEHICLE_SPECS.bicycle.size;
  assert.ok(Math.abs(size.z - length) < SIZE_SLACK, `length ${size.z}`);
  assert.ok(Math.abs(size.x - width) < SIZE_SLACK, `width ${size.x}`);
  assert.ok(Math.abs(size.y - height) < SIZE_SLACK, `height ${size.y}`);
  assert.ok(Math.abs(box.min.y) < 0.05, `floats at ${box.min.y}`);
  disposeVehicle(model);
});
