// lib/realtimeNotify.js
// The website writes some things itself (a money note, a block, a message sent over plain HTTP). The realtime server is then told
// so it can push them to whoever is online. Routes call this inside Next's `after()`, so the player gets their answer first and
// this runs once it has been sent. If the realtime server is off or slow, nothing breaks: the other player simply sees the
// change the next time their chat loads.
import { signBody } from "./chatAuth.js";
import { sendChatPush } from "./chatPush.js";
import { PrismaClient } from "@prisma/client";

const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));

export async function pingRealtime(payload) {
  if (payload?.type === "msg") {
    try { await sendChatPush(db, payload.chat, payload.id); }
    catch (error) { console.error("[chat push] delivery failed", error); }
  }
  const url = process.env.REALTIME_URL, secret = process.env.SESSION_SECRET;
  if (!url || !secret || !payload) return false;
  try {
    const body = JSON.stringify(payload);
    const r = await fetch(url.replace(/\/+$/, "") + "/internal", {
      method: "POST", headers: { "content-type": "application/json", "x-sig": signBody(secret, body) }, body, signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch { return false; }
}

/** Ask the realtime server a question and read its answer (the same signed channel). Null when it is not configured, not running or answers badly. */
export async function askRealtime(payload) {
  const url = process.env.REALTIME_URL, secret = process.env.SESSION_SECRET;
  if (!url || !secret || !payload) return null;
  try {
    const body = JSON.stringify(payload);
    const r = await fetch(url.replace(/\/+$/, "") + "/internal", {
      method: "POST", headers: { "content-type": "application/json", "x-sig": signBody(secret, body) }, body, signal: AbortSignal.timeout(3000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
