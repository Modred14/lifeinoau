import assert from "node:assert/strict";
import { test } from "node:test";
import { MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER } from "../src/map.ts";
import {
  DELIVERY_PLACES,
  VENDORS,
  findDeliveryPlace,
  findVendor,
  formatNaira,
  latLngToMap,
  normalizeNigerianPhone,
  orderCode,
  vendorDistanceM,
  vendorsByDistance,
} from "../src/market.ts";

test("real coordinates land on the matching game place", () => {
  const newBuka = PLACES.find((p) => p.name === "New Buka");
  const vendor = findVendor("new-buka");
  assert.ok(newBuka && vendor?.point);
  const metres = Math.hypot(vendor.point.x - newBuka.label.x, vendor.point.y - newBuka.label.y) / PX_PER_METER;
  assert.ok(metres < 60, `New Buka vendor is ${metres.toFixed(0)} m from the New Buka label`);
  const corner = latLngToMap(7.5248, 4.509);
  assert.deepEqual([Math.round(corner.x), Math.round(corner.y)], [0, 0]);
});

test("every vendor has a unique id, a source and a point that is on the map or absent", () => {
  assert.equal(new Set(VENDORS.map((v) => v.id)).size, VENDORS.length);
  for (const vendor of VENDORS) {
    assert.match(vendor.source, /^https:\/\//, vendor.id);
    assert.ok(vendor.name && vendor.area, vendor.id);
    if (!vendor.point) continue;
    assert.ok(vendor.point.x >= 0 && vendor.point.x <= MAP_WIDTH_PX && vendor.point.y >= 0 && vendor.point.y <= MAP_HEIGHT_PX, vendor.id);
  }
});

test("vendors off the map have no point and vendors pinned to a building are marked approximate", () => {
  assert.equal(findVendor("daily-needs")?.point, null);
  assert.equal(findVendor("jopa-foodie")?.point, null);
  const forks = findVendor("forks-and-fingers");
  assert.equal(forks?.approximate, true);
  assert.deepEqual(forks?.point, PLACES.find((p) => p.name === "Student Union Building")?.door);
  assert.equal(findVendor("white-hands")?.approximate, false);
  assert.ok(findVendor("spectra-main-gate")?.point, "the gate branch sits half a metre past the map edge and snaps onto it");
});

test("cyber cafes are listed for directions only", () => {
  for (const vendor of VENDORS) assert.equal(vendor.delivers, vendor.category !== "cyber", vendor.id);
});

test("nearby vendors come first and vendors without a spot go last", () => {
  const sub = PLACES.find((p) => p.name === "Student Union Building")!.door;
  const food = vendorsByDistance(sub, "food");
  assert.equal(food[0].id, "forks-and-fingers");
  assert.ok(food.every((v) => v.category === "food"));
  const firstUnplaced = food.findIndex((v) => !v.point);
  assert.ok(food.slice(firstUnplaced).every((v) => !v.point));
  const distances = food.slice(0, firstUnplaced).map((v) => vendorDistanceM(v, sub)!);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  assert.equal(vendorsByDistance(undefined).length, VENDORS.length);
});

test("phone numbers are accepted in the common Nigerian forms only", () => {
  assert.equal(normalizeNigerianPhone("0803 123 4567"), "+2348031234567");
  assert.equal(normalizeNigerianPhone("+234-803-123-4567"), "+2348031234567");
  assert.equal(normalizeNigerianPhone("2349031234567"), "+2349031234567");
  for (const bad of ["", "12345", "08031234", "0503 123 4567", "080312345678", "+1 415 555 0100", 8031234567]) assert.equal(normalizeNigerianPhone(bad), null, String(bad));
});

test("delivery places list halls first and cover every place", () => {
  assert.equal(DELIVERY_PLACES.length, PLACES.length);
  assert.equal(DELIVERY_PLACES[0].kind, "hostel");
  assert.equal(findDeliveryPlace("moremi-hall")?.name, "Moremi Hall");
  assert.equal(findDeliveryPlace("nowhere"), undefined);
  assert.equal(findDeliveryPlace(4), undefined);
});

test("order codes and naira amounts read cleanly", () => {
  assert.equal(orderCode("V1StGXR8_Z5jdHi6B-myT"), "6B-MYT");
  assert.equal(formatNaira(30_000), "₦300");
  assert.equal(formatNaira(255_050), "₦2,550.5");
});
