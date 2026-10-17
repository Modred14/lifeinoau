import assert from "node:assert/strict";
import { test } from "node:test";
import { PHONES, STARTING_PHONE, findPhone } from "@campuslife/shared";
import { buyPhone, decidePhonePurchase, initialPhone, parseBuyPhone, type PhoneOwner } from "../src/sim/Phones.ts";

const target = findPhone("zuma-note-pro")!;
const owner = (cash: number, phone = "zuma-a1"): PhoneOwner => ({ cash, phone });

test("malformed payloads are refused and change nothing", () => {
  for (const payload of [undefined, null, 7, "zuma-note-pro", [], {}, { id: 4 }, { id: "" }, { id: "x".repeat(500) }, { phone: target.id }]) {
    assert.equal(parseBuyPhone(payload), null);
    const student = owner(1_000_000);
    assert.deepEqual(decidePhonePurchase(student, payload), { ok: false, reason: "payload" });
    assert.equal(buyPhone(student, payload).bought, false);
    assert.deepEqual(student, owner(1_000_000));
  }
});

test("an unknown model is refused", () => {
  const student = owner(1_000_000);
  assert.deepEqual(decidePhonePurchase(student, { id: "iphone-99" }), { ok: false, reason: "unknown" });
  assert.equal(buyPhone(student, { id: "iphone-99" }).bought, false);
  assert.deepEqual(student, owner(1_000_000));
});

test("buying the phone you already use is refused", () => {
  const student = owner(1_000_000, target.id);
  const decision = decidePhonePurchase(student, { id: target.id });
  assert.equal(decision.ok, false);
  assert.equal(!decision.ok && decision.reason, "same");
  assert.equal(buyPhone(student, { id: target.id }).bought, false);
  assert.equal(student.cash, 1_000_000);
});

test("not enough cash is refused, down to one naira short", () => {
  for (const cash of [0, target.price - 1, target.price - 0.5, Number.NaN, -50]) {
    const student = owner(cash);
    const decision = decidePhonePurchase(student, { id: target.id });
    assert.equal(!decision.ok && decision.reason, "cash");
    const result = buyPhone(student, { id: target.id });
    assert.equal(result.bought, false);
    assert.equal(student.phone, "zuma-a1");
    assert.ok(Object.is(student.cash, cash));
  }
  assert.match(buyPhone(owner(target.price - 1), { id: target.id }).notice, /₦1 more/);
});

test("a purchase deducts exactly the catalog price and ignores any client price", () => {
  for (const phone of PHONES) {
    const start = phone.id === "zuma-a1" ? "zuma-note-12" : "zuma-a1";
    const student = owner(phone.price + 321.5, start);
    const result = buyPhone(student, { id: phone.id, price: 1, cash: 0 });
    assert.equal(result.bought, true);
    assert.equal(student.phone, phone.id);
    assert.equal(student.cash, 321.5);
    assert.ok(result.notice.includes(phone.name));
  }
  const exact = owner(target.price);
  assert.equal(buyPhone(exact, { id: target.id }).bought, true);
  assert.equal(exact.cash, 0);
});

test("saved phones load back and empty or stale saves get the starting phone", () => {
  assert.equal(initialPhone("onyx-13", "hustler"), "onyx-13");
  assert.equal(initialPhone(undefined, "nepo"), STARTING_PHONE.nepo);
  assert.equal(initialPhone(null, "regular"), STARTING_PHONE.regular);
  assert.equal(initialPhone("retired-model", "hustler"), STARTING_PHONE.hustler);
});
