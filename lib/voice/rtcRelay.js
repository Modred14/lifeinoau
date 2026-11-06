// lib/voice/rtcRelay.js  (server only, used by realtime/server.js)
// Carries the WebRTC set-up messages (offer / answer / ICE candidates / bye) of a voice call between two PLAYERS. The audio itself never touches the server:
// it goes straight from one phone to the other. The relay only passes small messages along, and only when the database says
//   - the call exists, is a player call, and is ANSWERED (not ringing, not over), and
//   - the sender is one of its two players, and the message goes to the other one.
// A malformed or oversized message, or a flood, is dropped.
const KINDS = new Set(["offer", "answer", "ice", "bye"]);
const MAX_BYTES = 8_000; // an SDP offer for one audio track is about 1.5 KB
export const RTC_PER_SECOND = 40;

/** Checks one message. Returns { to: <peer character id>, msg } or { error }. `loadCall(id)` -> the PhoneCall row or null. */
export async function routeRtc(me, msg, loadCall, now = Date.now()) {
  if (!msg || typeof msg !== "object" || !KINDS.has(msg.kind) || typeof msg.callId !== "string" || !/^[\w-]{8,40}$/.test(msg.callId)) return { error: "bad" };
  let size = 0; try { size = JSON.stringify(msg.data ?? null).length; } catch { return { error: "bad" }; }
  if (size > MAX_BYTES) return { error: "big" };
  const call = await loadCall(msg.callId);
  if (!call || call.kind !== "PLAYER") return { error: "no-call" };
  const mine = call.callerId === me.id, theirs = call.calleeId === me.id;
  if (!mine && !theirs) return { error: "no-call" }; // somebody else's call: the same answer as one that does not exist
  if (msg.kind !== "bye" && call.status !== "ANSWERED") return { error: "not-live" };
  return { to: mine ? call.calleeId : call.callerId, msg: { callId: call.id, kind: msg.kind, data: msg.data ?? null, from: me.name } };
}

/** A tiny per-socket limiter: at most RTC_PER_SECOND messages in any second. */
export function rtcLimiter(limit = RTC_PER_SECOND) {
  let at = 0, n = 0;
  return (now = Date.now()) => { const s = Math.floor(now / 1000); if (s !== at) { at = s; n = 0; } return ++n <= limit; };
}
