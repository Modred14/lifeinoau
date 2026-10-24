import assert from "node:assert/strict";
import { createChatStore } from "../lib/chatStore.js";
import { chatPushEnabled, saveChatPushSubscription, removeChatPushSubscription } from "../lib/chatPush.js";

const requests = [];
const http = async (event, payload) => {
  requests.push({ event, payload });
  if (event === "thread") return { ok: true, messages: [], hasMore: false, peerRead: 0, peerDel: 0, myRead: 0 };
  if (event === "inbox") return { ok: true, conversations: [{ name: "ben", id: 29, unread: 1, myRead: 27, at: new Date().toISOString(), mine: false, kind: 0, last: "new", peerRead: 0, peerDel: 0 }] };
  if (event === "send") return { ok: true, id: 25, at: new Date().toISOString(), delivered: false };
  return { ok: true };
};
const store = createChatStore({ http, storage: { load: () => null, save() {}, clear() {} }, uuid: () => "reply-cid" });
store.start("ann");
await store.openChat("ben");

store.onMsg({ id: 24, from: "ben", mine: false, kind: 1, body: "5000\nfood", at: new Date().toISOString() });
const original = store.getState().threads.ben.msgs[0];
store.send("ben", "Thanks!", {
  replyToId: original.id,
  reply: { id: original.id, mine: false, from: "ben", kind: original.kind, body: original.body },
});
await new Promise((resolve) => setTimeout(resolve, 0));
const send = requests.find((r) => r.event === "send");
assert.equal(send.payload.replyToId, 24, "the reply target is sent to the server");
const reply = store.getState().threads.ben.msgs.find((m) => m.id === 25);
assert.equal(reply.reply.id, 24, "reply previews retain the original supported message type");
assert.equal(reply.reply.kind, 1, "a money message can be quoted");

store.onDeleted({ id: 24, mode: "me", mine: false, with: "ben" });
assert.equal(store.getState().threads.ben.msgs.some((m) => m.id === 24), false, "delete for me removes the original from this player's view");
assert.equal(store.getState().threads.ben.msgs.find((m) => m.id === 25).reply.body, "5000\nfood", "a sent reply keeps its quoted preview");

store.onMsg({ id: 26, from: "ann", to: "ben", mine: true, kind: 0, body: "remove for both", at: new Date().toISOString() });
store.onDeleted({ id: 26, mode: "everyone", mine: true, with: "ben" });
const deleted = store.getState().threads.ben.msgs.find((m) => m.id === 26);
assert.equal(deleted.deleted, true, "delete for everyone marks the message deleted");
assert.equal(deleted.body, "This message was deleted", "delete for everyone shows the placeholder");
await store.loadInbox();
store.onDeleted({ id: 28, mode: "everyone", mine: false, with: "ben" });
assert.equal(store.getState().inbox[0].unread, 0, "deleting an unread incoming message updates the inbox badge");

console.log("OK   replies and participant-scoped message deletion");

{
  const previous = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
    secret: process.env.PUSH_SUBSCRIPTION_SECRET,
  };
  process.env.VAPID_PUBLIC_KEY = "public-test-key";
  process.env.VAPID_PRIVATE_KEY = "private-test-key";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.PUSH_SUBSCRIPTION_SECRET = "test-secret-with-at-least-32-characters";
  let stored = null;
  const db = {
    chatPushSubscription: {
      async upsert({ where, create, update }) { stored = { ...create, ...update, endpointHash: where.endpointHash }; },
      async findFirst({ where }) { return stored?.characterId === where.characterId && stored.endpointHash === where.endpointHash ? { id: "sub" } : null; },
      async count({ where }) { return stored?.characterId === where.characterId ? 1 : 0; },
      async deleteMany({ where }) { if (stored?.characterId === where.characterId && stored.endpointHash === where.endpointHash) stored = null; },
    },
  };
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    keys: {
      p256dh: Buffer.alloc(65, 7).toString("base64url"),
      auth: Buffer.alloc(16, 8).toString("base64url"),
    },
  };
  await saveChatPushSubscription(db, "ann-id", subscription);
  assert.equal(stored.encrypted.includes(subscription.endpoint), false, "push endpoint is encrypted at rest");
  assert.equal(stored.encrypted.includes(subscription.keys.p256dh), false, "push encryption keys are encrypted at rest");
  assert.equal(await chatPushEnabled(db, "ann-id", subscription.endpoint), true, "push preference is tracked per browser subscription");
  await removeChatPushSubscription(db, "ann-id", subscription);
  assert.equal(await chatPushEnabled(db, "ann-id", subscription.endpoint), false, "the player can remove their browser subscription");
  await assert.rejects(() => saveChatPushSubscription(db, "ann-id", { ...subscription, endpoint: "https://127.0.0.1/internal" }), /Invalid browser push subscription/);
  for (const [key, value] of Object.entries({
    VAPID_PUBLIC_KEY: previous.publicKey,
    VAPID_PRIVATE_KEY: previous.privateKey,
    VAPID_SUBJECT: previous.subject,
    PUSH_SUBSCRIPTION_SECRET: previous.secret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  console.log("OK   encrypted, device-specific browser push subscriptions");
}
