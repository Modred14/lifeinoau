import assert from "node:assert/strict";
import { Client } from "@colyseus/sdk";
import { Msg, ServerMsg, findShopItem, findPhone, type ShopReceipt } from "@campuslife/shared";
import { joinAs } from "./smoke-account";

const url = process.env.GAME_SERVER_URL ?? "http://localhost:2567";
const client = new Client(url);
let room = await joinAs(client, url, "smoke_stores", { fresh: true });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const me = () => room.state.players.get(room.sessionId)!;
const buy = (id: string, requestId: string) => new Promise<ShopReceipt>((resolve, reject) => {
  const timer = setTimeout(() => { remove(); reject(new Error("store receipt timed out")); }, 4000);
  const remove = room.onMessage<ShopReceipt>(ServerMsg.Shop, (receipt) => {
    if (receipt.requestId !== requestId) return;
    clearTimeout(timer); remove(); resolve(receipt);
  });
  room.send(Msg.BuyItem, { id, requestId, price: 0 });
});
try {
  await pause(400);
  const before = { cash: me().cash, food: me().food, energy: me().energy };
  assert.equal((await buy("puff-puff", "1")).ok, true);
  await pause(400);
  assert.equal(me().cash, before.cash - findShopItem("puff-puff")!.price);
  assert.ok(me().food > before.food);
  const paid = me().cash;
  assert.equal((await buy("puff-puff", "1")).ok, true);
  await pause(250);
  assert.equal(me().cash, paid);
  assert.equal((await buy("no-such-item", "2")).ok, false);
  assert.equal((await buy("puff-puff", "1")).ok, false);
  await pause(250);
  assert.equal(me().cash, paid);
  console.log("PASS store purchases deduct the catalog price, restore food, refuse unknown items and prevent duplicate charges");
  const phoneBefore = me().phone;
  if (me().cash >= 11000) {
    room.send(Msg.BuyPhone, { id: "zuma-a1" });
    await pause(400);
    assert.equal(me().phone, "zuma-a1");
    const androidCash = me().cash;
    room.send(Msg.BuyPhone, { id: "iphone-12", price: 0 });
    await pause(400);
    assert.equal(me().phone, "iphone-12");
    assert.equal(me().cash, androidCash - findPhone("iphone-12")!.price);
    console.log("PASS Android changes to iPhone 12 at the server price");
  } else {
    room.send(Msg.BuyPhone, { id: "onyx-17-pro-max", price: 0 });
    await pause(400);
    assert.equal(me().phone, phoneBefore);
    assert.equal(me().cash, paid);
    console.log("PASS an unaffordable iPhone purchase leaves the wallet and phone unchanged");
  }
  const saved = { cash: me().cash, phone: me().phone };
  await pause(2500);
  await room.leave();
  await pause(2500);
  room = await joinAs(client, url, "smoke_stores", { fresh: false });
  await pause(400);
  assert.equal(me().cash, saved.cash);
  assert.equal(me().phone, saved.phone);
  console.log("PASS wallet and phone changes survive rejoining the game");
} finally {
  await room.leave();
}
