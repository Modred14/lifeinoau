// lib/voice/playerVoice.js  (browser only)
// Real voice between two PLAYERS on an answered call. The audio travels straight from one phone to the other (WebRTC); the realtime server only passes the
// small set-up messages (lib/voice/rtcRelay.js). It rides on the existing call (lib/callService.js decides who is on a call and when it ends): this file never
// decides anything about the call, it only carries sound while the call is ANSWERED and stops the moment it is not.
//
//   prepare()      in the tap that dials or answers: asks for the microphone and unlocks sound (browsers only allow both after a tap)
//   sync(call)     called with the live call every poll: starts the audio when the call is answered, stops it when it is over
//   setMuted(m), setLoud(on), stop()
//
// Free by default: Google's public STUN server finds the way between the two phones. Some networks (strict mobile carriers, corporate wifi) need a TURN relay as
// well; set NEXT_PUBLIC_RTC_ICE_SERVERS to a JSON list to add one (see docs/VOICE-CALLS.md).
import { useSyncExternalStore } from "react";
import { prepareMic, stopMic, micMeter, VoiceFail } from "./client.js";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const CONNECT_MS = 15_000;
export const iceServers = (raw = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_RTC_ICE_SERVERS : "") => {
  try { const j = JSON.parse(raw || "null"); if (Array.isArray(j) && j.length) return j; } catch { /* a bad value falls back to the free default */ }
  return [{ urls: "stun:stun.l.google.com:19302" }];
};

let link = null; // the signalling road: { connected(), send(msg), on(handler) } (lib/chat.js rtcLink), given by wire()
let off = null;
let pre = null; // { media, audio } prepared in a tap, waiting for its call
let cur = null; // { callId, caller, pc, queue, media, audio, meters, timer, restarted }
let state = { phase: "idle", muted: false, loud: true, error: null, callId: null };
const subs = new Set();
const emit = () => subs.forEach((f) => f());
const set = (p) => { state = { ...state, ...p }; emit(); };

/** Connect this module to the signalling socket (called once by the call layer). Returns an unsubscribe. */
export function wire(l) {
  link = l; off?.(); off = l.on(onSignal);
  return () => { off?.(); off = null; link = null; };
}

/** In the tap: microphone + unlocked audio element. Resolves { ok } or { ok: false, code }. Safe to call again (reuses what is ready). */
export async function prepare() {
  if (cur || pre) return { ok: true };
  if (!link?.connected()) return { ok: false, code: "offline" };
  const audio = new Audio(); audio.autoplay = true; audio.src = SILENT_WAV; audio.play?.().catch(() => {});
  try { pre = { media: await prepareMic(), audio, at: Date.now() }; return { ok: true }; }
  catch (e) { return { ok: false, code: e instanceof VoiceFail ? e.code : "no-mic" }; }
}
const release = (p) => { if (!p) return; try { stopMic(p.media?.stream); p.media?.ctx?.close?.(); } catch { /* ignore */ } try { p.audio?.pause(); p.audio.srcObject = null; } catch { /* ignore */ } };
export const discardPrepared = () => { release(pre); pre = null; };

const send = (kind, data) => cur && link?.send({ callId: cur.callId, kind, data }).catch(() => {});

function open(callId, caller) {
  if (cur?.callId === callId) return cur;
  if (!pre) { set({ phase: "no-mic", callId, error: "mic" }); return null; }
  const { media, audio } = pre; pre = null;
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  cur = { callId, caller, pc, queue: [], media, audio, meters: {}, timer: null, restarted: false };
  media.stream.getTracks().forEach((t) => pc.addTrack(t, media.stream));
  cur.meters.me = micMeter(media.ctx, media.stream);
  pc.onicecandidate = (e) => { if (e.candidate) send("ice", e.candidate.toJSON()); };
  pc.ontrack = (e) => {
    const [s] = e.streams; audio.srcObject = s; audio.volume = state.loud ? 1 : 0.5;
    audio.play().then(() => set({ blocked: false })).catch(() => set({ blocked: true }));
    cur.meters.them = micMeter(media.ctx, s);
  };
  pc.onconnectionstatechange = () => {
    if (cur?.pc !== pc) return;
    const c = pc.connectionState;
    if (c === "connected") { clearTimeout(cur.timer); set({ phase: "live", error: null }); }
    else if (c === "disconnected") { set({ phase: "reconnecting" }); if (caller && !cur.restarted) { cur.restarted = true; offer(true); } }
    else if (c === "failed") { if (caller && !cur.restarted) { cur.restarted = true; set({ phase: "reconnecting" }); offer(true); } else fail("connection"); }
  };
  cur.timer = setTimeout(() => { if (cur?.pc === pc && pc.connectionState !== "connected") fail("connection"); }, CONNECT_MS);
  set({ phase: "connecting", callId, error: null, muted: false });
  return cur;
}
async function offer(restart = false) {
  const c = cur; if (!c) return;
  try { const o = await c.pc.createOffer(restart ? { iceRestart: true } : {}); await c.pc.setLocalDescription(o); send("offer", c.pc.localDescription.toJSON()); }
  catch { fail("connection"); }
}
async function onSignal(m) {
  if (!m || typeof m !== "object") return;
  if (m.kind === "bye") { if (cur?.callId === m.callId) stop(); return; }
  let c = cur;
  if (!c || c.callId !== m.callId) { if (m.kind !== "offer") return; c = open(m.callId, false); if (!c) return; } // the offer came before our own poll saw "answered"
  try {
    if (m.kind === "offer") {
      await c.pc.setRemoteDescription(m.data);
      for (const x of c.queue.splice(0)) await c.pc.addIceCandidate(x).catch(() => {});
      const a = await c.pc.createAnswer(); await c.pc.setLocalDescription(a); send("answer", c.pc.localDescription.toJSON());
    } else if (m.kind === "answer") await c.pc.setRemoteDescription(m.data);
    else if (m.kind === "ice") { if (c.pc.remoteDescription) await c.pc.addIceCandidate(m.data).catch(() => {}); else c.queue.push(m.data); }
  } catch { fail("connection"); }
}
function fail(error) { if (!cur) return; const id = cur.callId; teardown(); set({ phase: "failed", error, callId: id }); }
function teardown() {
  const c = cur; cur = null; if (!c) return;
  clearTimeout(c.timer);
  try { c.meters.me?.close(); c.meters.them?.close(); } catch { /* ignore */ }
  try { c.pc.onconnectionstatechange = c.pc.ontrack = c.pc.onicecandidate = null; c.pc.close(); } catch { /* ignore */ }
  release(c);
}
/** End the audio (the call itself is ended by the call layer). */
export function stop(notify = false) { if (notify) send("bye", null); teardown(); discardPrepared(); set({ phase: "idle", error: null, callId: null, blocked: false }); }

/** The call layer calls this with the live call (or null) after every poll. */
export function sync(call) {
  const live = call && call.kind === "PLAYER" && (call.status === "RINGING" || call.status === "ANSWERED");
  if (!live) { // over (or never was): everything stops. A microphone prepared a moment ago for a call that has not shown up in a poll yet is kept for a while.
    if (cur || state.phase !== "idle") stop(false);
    else if (pre && Date.now() - pre.at > 40_000) discardPrepared();
    return;
  }
  if (call.status !== "ANSWERED") return; // still ringing: nothing to carry yet
  if (cur?.callId === call.id || state.phase === "failed" || state.phase === "no-mic") return;
  if (!link?.connected()) { if (state.phase !== "offline") set({ phase: "offline", callId: call.id }); return; }
  const c = open(call.id, call.role === "caller");
  if (c && call.role === "caller") offer(); // the caller starts it; the other side answers
}
export const setMuted = (m) => { cur?.media.stream.getAudioTracks().forEach((t) => (t.enabled = !m)); set({ muted: !!m }); };
export const setLoud = (on) => { if (cur?.audio) cur.audio.volume = on ? 1 : 0.5; set({ loud: !!on }); };
export const retrySound = () => { cur?.audio?.play().then(() => set({ blocked: false })).catch(() => {}); };
export const levels = () => ({ you: state.muted ? 0 : cur?.meters.me?.level() ?? 0, her: cur?.meters.them?.level() ?? 0 });

export const getVoice = () => state;
export const subscribeVoice = (f) => { subs.add(f); return () => subs.delete(f); };
export const usePlayerVoice = () => useSyncExternalStore(subscribeVoice, getVoice, () => state);
