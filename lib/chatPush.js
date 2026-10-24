import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import webpush from "web-push";

const vapid = () => ({
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT,
});
const configured = () => {
  const v = vapid();
  return !!(v.publicKey && v.privateKey && v.subject && (process.env.PUSH_SUBSCRIPTION_SECRET?.length ?? 0) >= 32);
};
const encryptionKey = () => createHash("sha256").update(process.env.PUSH_SUBSCRIPTION_SECRET || "").digest();
const seal = (value) => {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
};
const open = (value) => {
  try {
    const [iv, tag, body] = value.split(".");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString());
  } catch {
    const error = new Error("Stored push subscription could not be decrypted.");
    error.code = "PUSH_SUBSCRIPTION_INVALID";
    throw error;
  }
};
const endpointHash = (endpoint) => createHash("sha256").update(endpoint).digest("hex");

function validSubscription(subscription) {
  try {
    if (typeof subscription?.endpoint !== "string" || typeof subscription?.keys?.p256dh !== "string" || typeof subscription?.keys?.auth !== "string") return false;
    const endpoint = new URL(subscription.endpoint);
    const allowed = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
    if (!/^[\w-]+$/.test(subscription.keys.p256dh) || !/^[\w-]+$/.test(subscription.keys.auth)) return false;
    if (Buffer.from(subscription.keys.p256dh, "base64url").length !== 65 || Buffer.from(subscription.keys.auth, "base64url").length !== 16) return false;
    return subscription.endpoint.length <= 2048 &&
      subscription.keys.p256dh.length <= 256 &&
      subscription.keys.auth.length <= 128 &&
      endpoint.protocol === "https:" &&
      !endpoint.username && !endpoint.password && !endpoint.port &&
      allowed.some((host) => endpoint.hostname === host || endpoint.hostname.endsWith("." + host));
  } catch {
    return false;
  }
}

export function chatPushConfiguration() {
  return { configured: configured(), publicKey: configured() ? vapid().publicKey : null };
}

export async function saveChatPushSubscription(db, characterId, subscription) {
  if (!configured()) throw new Error("Browser push notifications are not configured on this server.");
  if (!validSubscription(subscription)) throw new Error("Invalid browser push subscription.");
  const hash = endpointHash(subscription.endpoint);
  await db.chatPushSubscription.upsert({
    where: { endpointHash: hash },
    update: { characterId, encrypted: seal(subscription) },
    create: { characterId, endpointHash: hash, encrypted: seal(subscription) },
  });
  return { enabled: true };
}

export async function removeChatPushSubscription(db, characterId, subscription) {
  if (!subscription?.endpoint) return { enabled: false };
  await db.chatPushSubscription.deleteMany({ where: { characterId, endpointHash: endpointHash(subscription.endpoint) } });
  return { enabled: false };
}

export async function chatPushEnabled(db, characterId, endpoint) {
  if (endpoint) return !!(await db.chatPushSubscription.findFirst({ where: { characterId, endpointHash: endpointHash(endpoint) }, select: { id: true } }));
  return (await db.chatPushSubscription.count({ where: { characterId } })) > 0;
}

/** Send one deduplicated notification to each registered device for the recipient. */
export async function sendChatPush(db, chatId, messageId) {
  if (!configured()) return;
  const message = await db.message.findUnique({
    where: { chatId_id: { chatId, id: BigInt(messageId) } },
    select: { id: true, chatId: true, fromA: true, kind: true, body: true, deletedAt: true },
  });
  const chat = await db.chat.findUnique({ where: { id: chatId }, select: { aId: true, bId: true } });
  if (!message || !chat) return;
  const recipientId = message.fromA ? chat.bId : chat.aId;
  const [sender, recipient, subscriptions] = await Promise.all([
    db.character.findFirst({ where: { id: message.fromA ? chat.aId : chat.bId }, select: { name: true } }),
    db.character.findFirst({ where: { id: recipientId }, select: { name: true } }),
    db.chatPushSubscription.findMany({ where: { characterId: recipientId }, select: { endpointHash: true, encrypted: true } }),
  ]);
  if (!sender || !recipient || !subscriptions.length) return;
  const claimed = await db.chatPushDelivery.createMany({
    data: [{ chatId, messageId: message.id, recipientId }],
    skipDuplicates: true,
  });
  if (!claimed.count) return;
  const v = vapid();
  webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
  const text = message.deletedAt ? "This message was deleted" : message.kind === 1 ? "Sent you money" : message.body;
  const payload = JSON.stringify({
    title: sender.name,
    body: String(text).slice(0, 120),
    tag: `lifeinoau-message-${chatId}-${messageId}`,
    url: `/home?app=messages&with=${encodeURIComponent(sender.name)}`,
    conversation: recipient.name,
  });
  let delivered = false;
  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(open(row.encrypted), payload, { TTL: 86_400, urgency: "normal" });
      delivered = true;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410 || error?.code === "PUSH_SUBSCRIPTION_INVALID") {
        await db.chatPushSubscription.deleteMany({ where: { endpointHash: row.endpointHash } });
      } else {
        console.error("[chat push] delivery failed", error);
      }
    }
  }
  if (!delivered) await db.chatPushDelivery.deleteMany({ where: { chatId, messageId: message.id, recipientId } });
}
