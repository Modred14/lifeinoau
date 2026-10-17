import assert from "node:assert/strict";
import { test } from "node:test";
import { SHOP_ITEMS, walkingFactor } from "@campuslife/shared";
import { ShoppingDesk, parseItemPurchase } from "../src/sim/Shopping.ts";

const customer = () => ({ cash: 2000, food: 10, energy: 10, fun: 10 });

test("malformed and forged purchases cannot change cash or needs", () => {
  const desk = new ShoppingDesk();
  for (const payload of [null, [], {}, "jollof", { id: "jollof" }, { id: 1, requestId: "1" }, { id: "jollof", requestId: "-1" }, { id: "jollof", requestId: "9007199254740992" }]) {
    const player = customer();
    assert.equal(parseItemPurchase(payload), null);
    assert.equal(desk.buy(player, payload), null);
    assert.deepEqual(player, customer());
  }
  const player = customer();
  assert.equal(desk.buy(player, { id: "no-such-item", requestId: "1", price: 0 })!.ok, false);
  assert.deepEqual(player, customer());
});

test("each product uses the server price and caps restored needs", () => {
  for (const item of SHOP_ITEMS) {
    assert.ok(Number.isInteger(item.price) && item.price > 0);
    const player = { cash: item.price, food: 95, energy: 95, fun: 99 };
    const receipt = new ShoppingDesk().buy(player, { id: item.id, requestId: "1", price: 0, food: 1000 });
    assert.equal(receipt!.ok, true);
    assert.equal(player.cash, 0);
    assert.equal(player.food, Math.min(100, 95 + item.food));
    assert.equal(player.energy, Math.min(100, 95 + item.energy));
    assert.equal(player.fun, Math.min(100, 99 + item.fun));
  }
});

test("insufficient funds, full needs and corrupt balances are refused", () => {
  for (const patch of [{ cash: 899 }, { cash: NaN }, { cash: Infinity }, { cash: -1 }, { food: 100 }, { food: NaN }]) {
    const player = { ...customer(), ...patch };
    const before = { ...player };
    assert.equal(new ShoppingDesk().buy(player, { id: "jollof", requestId: "1" })!.ok, false);
    assert.deepEqual(player, before);
  }
});

test("repeated and stale checkout requests never charge twice", () => {
  const desk = new ShoppingDesk();
  const player = customer();
  const request = { id: "puff-puff", requestId: "1" };
  const receipt = desk.buy(player, request);
  const paid = { ...player };
  assert.equal(desk.buy(player, request), receipt);
  assert.equal(desk.buy(player, { id: "jollof", requestId: "1" }), receipt);
  assert.deepEqual(player, paid);
  assert.equal(desk.buy(player, { id: "water", requestId: "2" })!.ok, true);
  const after = { ...player };
  assert.equal(desk.buy(player, request)!.ok, false);
  assert.deepEqual(player, after);
  const other = customer();
  assert.equal(desk.buy(other, request)!.ok, true);
});

test("buying a meal restores a hungry player's normal walking speed", () => {
  const player = { ...customer(), energy: 70 };
  assert.ok(walkingFactor(player) < 1);
  assert.equal(new ShoppingDesk().buy(player, { id: "jollof", requestId: "1" })!.ok, true);
  assert.equal(walkingFactor(player), 1);
});
