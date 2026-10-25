// tests/optimistic-delete.test.mjs
// A message delete shows at once and is taken back exactly if the server refuses, without touching messages that arrived meanwhile.
import assert from "node:assert/strict";
import { createChatStore } from "../lib/chatStore.js";

const http = async (event) => {
  if (event === "thread") return { ok: true, messages: [], hasMore: false, peerRead: 0, peerDel: 0, myRead: 0 };
  if (event === "inbox") return { ok: true, conversations: [{ name: "ben", id: 31, unread: 1, myRead: 27, at: new Date().toISOString(), mine: false, kind: 0, last: "hi", peerRead: 0, peerDel: 0 }] };
  return { ok: true };
};
const store = createChatStore({ http, storage: { load: () => null, save() {}, clear() {} }, uuid: () => "cid" });
store.start("ann");
await store.openChat("ben");
await store.loadInbox();
const now = () => new Date().toISOString();
store.onMsg({ id: 30, from: "ben", mine: false, kind: 0, body: "first", at: now() });
store.onMsg({ id: 31, from: "ben", mine: false, kind: 0, body: "second", at: now() });
const msgs = () => store.getState().threads.ben.msgs;

// delete for me: gone at once, back in the same place on refusal, even after a newer message arrived
let undo = store.beginDelete({ id: 30, mode: "me", with: "ben" });
assert.equal(msgs().some((m) => m.id === 30), false, "delete for me shows at once");
store.onMsg({ id: 32, from: "ben", mine: false, kind: 0, body: "newer", at: now() });
undo();
assert.deepEqual(msgs().map((m) => m.id), [30, 31, 32], "a refused delete puts the message back where it was and keeps newer messages");
undo(); assert.equal(msgs().length, 3, "undo twice does nothing extra");

// delete for everyone: placeholder at once, original text and the inbox line restored on refusal
const unreadBefore = store.getState().inbox[0].unread;
undo = store.beginDelete({ id: 31, mode: "everyone", with: "ben" });
assert.equal(msgs().find((m) => m.id === 31).body, "This message was deleted", "delete for everyone shows the placeholder at once");
undo();
const back = msgs().find((m) => m.id === 31);
assert.equal(back.body, "second", "the text comes back");
assert.equal(back.deleted, false, "no longer marked deleted");
assert.equal(store.getState().inbox[0].unread >= unreadBefore, true, "the unread badge is not left lower than it was");

// a delete that succeeds just stays
store.beginDelete({ id: 30, mode: "me", with: "ben" });
assert.equal(msgs().some((m) => m.id === 30), false, "a confirmed delete stays");

// a message that is not on screen: nothing to show first
assert.equal(store.beginDelete({ id: 999, mode: "me", with: "ben" }), null, "unknown message: no local change, no undo");

console.log("OK   optimistic message delete and rollback");
