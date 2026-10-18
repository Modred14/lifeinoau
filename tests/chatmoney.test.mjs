// tests/chatmoney.test.mjs
// A money card on screen is NOT a chat message to send. It is shown at once by the transfer flow and the SERVER creates the one real
// card inside the transfer's transaction. The chat's resend logic (flush / poll / reopening a chat) must never turn that card into an
// extra ordinary text message ("5000\nfor jollof").
import assert from "node:assert/strict";
import { createChatStore } from "../lib/chatStore.js";
import { KIND, moneyBody } from "../lib/chatShared.js";

const emptyThread = { ok: true, messages: [], hasMore: false, peerRead: 0, peerDel: 0, myRead: 0, unread: 0, lastId: 0 };
function mk(saved) {
  const calls = [];
  const http = async (event, payload) => { calls.push({ event, payload }); return event === "thread" ? emptyThread : { ok: true, id: calls.length + 100, at: new Date().toISOString() }; };
  const storage = { load: () => saved ?? null, save() {}, clear() {} };
  const store = createChatStore({ http, storage, uuid: () => "cid-" + calls.length });
  return { store, calls, sends: () => calls.filter((c) => c.event === "send") };
}

// 1. a money card waiting for the transfer must never be re-sent as text (the socket is down, so poll() runs flush())
for (const memo of ["for jollof", ""]) {
  const { store, sends } = mk();
  store.start("ann"); await store.openChat("ben");
  const cid = store.addMoney("ben", { naira: 5000, note: memo, cid: "pay-1" });
  await store.poll(); await store.poll(); await store.flush();
  assert.equal(sends().length, 0, `no text send for a pending money card (memo "${memo}")`);
  store.moneySent("ben", cid, { id: 7, at: new Date().toISOString() });
  await store.poll();
  assert.equal(sends().length, 0, "still none after the transfer is confirmed");
  const msgs = store.getState().threads.ben.msgs;
  assert.equal(msgs.length, 1); assert.equal(msgs[0].kind, KIND.MONEY); assert.equal(msgs[0].id, 7);
}
console.log("OK   a pending money card is never sent as a text message");

// 2. reloading while a card was unsent: the saved card is dropped, not sent as text (the server has the real one if the money moved)
{
  const saved = { me: "ann", inbox: null, unread: 0, threads: { ben: { name: "ben", loaded: true, msgs: [{ id: null, cid: "old", mine: true, kind: KIND.MONEY, body: moneyBody(5000, "for jollof"), at: new Date().toISOString(), st: "sending" }], peerRead: 0, peerDel: 0, myRead: 0 } } };
  const { store, sends } = mk(saved);
  store.start("ann"); await store.openChat("ben"); await store.flush();
  assert.equal(sends().length, 0, "a saved unsent money card is not re-sent as text");
  assert.equal(store.getState().threads.ben.msgs.filter((m) => m.kind === KIND.MONEY && m.id == null).length, 0, "and it is not left hanging on screen");
  console.log("OK   a reload does not resurrect an unsent money card");
}

// 3. real text messages still go out, and a failed transfer leaves no card
{
  const { store, sends } = mk();
  store.start("ann"); await store.openChat("ben");
  store.send("ben", "hello"); await store.flush();
  assert.equal(sends().length, 1); assert.equal(sends()[0].payload.body, "hello");
  const cid = store.addMoney("ben", { naira: 100, note: "x", cid: "pay-2" });
  store.moneyFailed("ben", cid);
  assert.equal(store.getState().threads.ben.msgs.some((m) => m.kind === KIND.MONEY), false, "failed transfer: no card");
  console.log("OK   text still sends; a failed transfer leaves no card");
}
