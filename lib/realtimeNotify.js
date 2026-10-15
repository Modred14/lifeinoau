// lib/realtimeNotify.js
// The website writes some things itself (a money note, a block, a message sent over plain HTTP). The realtime server is then told
// so it can push them to whoever is online. Routes call this inside Next's `after()`, so the player gets their answer first and
// this runs once it has been sent. If the realtime server is off or slow, nothing breaks: the other player simply sees the
// change the next time their chat loads.
import { signBody } from "./chatAuth.js";

export async function pingRealtime(payload) {
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