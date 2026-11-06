// lib/callsClient.js
// Browser side of the Calls app. The server decides everything (lib/callService.js); this file only asks, keeps the answer on screen and plays the story.
//
//  - callsLive: what /api/calls answers every few seconds: { active, last, serverNow }. The CallLayer polls it while the game tab is visible; that same poll is
//    how the other players know you are online. It is polled fast (1.5s) during a call and slowly (4s) the rest of the time.
//  - parentCall: calling home. The server settles the whole call in one request (and pays any gift); this store plays it as calling -> ringing -> answered /
//    declined / no answer -> ended, and shows the money in the top bar at the moment the parent hands it over.
//  - callsDo: one request to POST /api/calls with a fresh request id (a double tap is the same call, never two).
import { useSyncExternalStore } from "react";
import { call, naira } from "@/lib/client";
import { createStore } from "@/lib/optimistic";
import { syncServerClock } from "@/lib/serverClock";
import { game, cash } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { playSound } from "@/lib/sound";
import { voiceStatus, peekVoiceStatus, voiceSupported, prepareMic, stopMic, micMeter, newRecognition, askParent } from "@/lib/voice/client";
import { Speaker } from "@/lib/voice/speaker";
import * as playerVoice from "@/lib/voice/playerVoice";
import { ERROR_TEXT } from "@/lib/voice/client";
import { VoiceSession } from "@/lib/voice/session";

export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Ask the server for the top-bar balance after money moved outside the normal request flow (a gift, an approval). The no-op change tells the store that any read already travelling may predate it. */
export const syncGame = () => { game.pushDone((x) => x); return game.refresh(); };

/** The live call state. `active` is the call you are on (or ringing), `last` is one that just ended. */
export const callsLive = createStore(async () => {
  const sentAt = Date.now(), r = await call("/api/calls");
  if (!r.failed && r.serverNow) syncServerClock(r.serverNow, sentAt);
  return r;
});

/** One request to POST /api/calls. Resolves { ...answer, failed?, error? } and never throws. Refreshes the live state after, so the screen follows the server. */
export async function callsDo(body, { quiet = false } = {}) {
  const r = await call("/api/calls", { requestId: newId(), ...body });
  if (!quiet && (r.failed || r.ok === false) && (r.error || r.message)) toast.error(r.error || r.message);
  callsLive.pushDone((x) => x); // a change happened: a poll already travelling may predate it, so the store must ask again instead of trusting it
  callsLive.refresh();
  return r;
}

/** Poll while the tab is visible (that is also what says "I am online"). Returns a function that stops it. `isBusy()` says a call is on, to poll faster. */
export function startCallPolling(isBusy = () => false) {
  let stopped = false, timer = null;
  const tick = async () => {
    if (stopped) return;
    if (!document.hidden) await callsLive.refresh();
    if (!stopped) timer = setTimeout(tick, isBusy() ? 1500 : 4000);
  };
  const wake = () => { if (!document.hidden && !stopped) { clearTimeout(timer); tick(); } };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  tick();
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); };
}

// ---------- calling home ----------
// phases: dialing (waiting for the server) -> calling -> ringing -> answered | declined | noanswer -> talking -> ended
// With the live voice call set up (see docs/VOICE-CALLS.md) an answered call continues: answered -> voice (she speaks, the player speaks, for real) -> voice-ended.
// The microphone is asked for BEFORE the server rolls the call, so a refused microphone never costs the player a call (or a cooldown). Without voice set up,
// or if this browser cannot do it, the call is the original one-request story below.
let ui = null; const subs = new Set(); let timers = [];
let live = null; // the running voice call: { session, speaker, media, meter, wake, off }
const emit = () => subs.forEach((f) => f());
const set = (patch) => { ui = ui ? { ...ui, ...patch } : null; emit(); };
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const clear = () => { timers.forEach(clearTimeout); timers = []; };

/** Close the microphone, the audio system, the screen lock and the listeners of a voice call. Safe to call twice. */
function teardown() {
  const l = live; live = null; if (!l) return;
  try { l.off?.(); } catch { /* ignore */ }
  try { l.meter?.close(); } catch { /* ignore */ }
  try { l.speaker?.destroy(); } catch { /* ignore */ }
  try { stopMic(l.media?.stream); l.media?.ctx?.close?.(); } catch { /* ignore */ }
  try { l.wake?.release?.(); } catch { /* ignore */ }
}
function startVoice(r, speaker, media, before) {
  if (!ui) { stopMic(media.stream); speaker.destroy(); return; }
  speaker.callId = r.call.id; speaker.gender = r.call.peer === "Daddy" ? "m" : "f"; speaker.ctx = media.ctx;
  const meter = micMeter(media.ctx, media.stream);
  live = { speaker, media, meter, session: null, wake: null, off: null };
  const session = new VoiceSession({
    callId: r.call.id, speaker, ask: askParent, newRecognition,
    onState: (state, info) => set({ vstate: state, muted: !!info?.muted }),
    onError: (code) => set({ verror: code }),
    onEnd: (reason) => { // she hung up, the player did, or something failed: close everything, keep the screen to say so
      const at = Date.now(); teardown(); set({ phase: "voice-ended", vend: at, reason, levels: null }); playSound("close"); syncGame(); callsLive.refresh();
    },
  });
  live.session = session;
  speaker.onBlocked = () => set({ blocked: true });
  const down = () => set({ offline: true }), up = () => set({ offline: false });
  window.addEventListener("offline", down); window.addEventListener("online", up);
  live.off = () => { window.removeEventListener("offline", down); window.removeEventListener("online", up); };
  navigator.wakeLock?.request?.("screen").then((w) => { if (live) live.wake = w; else w.release?.(); }).catch(() => {}); // keep the screen on during the call
  set({ phase: "voice", vstate: "connected", muted: false, loud: true, blocked: false, offline: !navigator.onLine, vstart: Date.now(), vend: 0, verror: null, reason: null, levels: () => ({ you: live?.meter?.level() ?? 0, her: live?.speaker?.level() ?? 0 }) });
  const gift = BigInt(r.giftKobo ?? 0);
  if (gift > 0n && game.get()?.balanceKobo === before) game.pushDone(cash(r.giftKobo)); // the server already paid: show it in the top bar the moment she picks up
  if (gift > 0n) playSound("coin");
  session.connect();
}

export const parentCall = {
  get: () => ui,
  subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  /** Dial home. Resolves when the server has answered (the story then plays on its own). */
  async start() {
    if (ui) return null;
    // unlock sound inside this tap (browsers only allow audio that follows one), before anything is awaited
    const cached = peekVoiceStatus();
    let speaker = null;
    if (cached?.available && voiceSupported()) { speaker = new Speaker({ mode: cached.speech === "server" ? "server" : "browser" }); speaker.prime(); }
    ui = { phase: "dialing", name: "Home", result: null }; emit();
    const vs = cached ?? await voiceStatus();
    const voice = !!(vs?.available && voiceSupported());
    if (voice && !speaker) { speaker = new Speaker({ mode: vs.speech === "server" ? "server" : "browser" }); speaker.prime(); }
    let media = null;
    if (voice) {
      try { media = await prepareMic(); }
      catch (e) { speaker?.destroy(); if (!ui) return null; ui = { phase: "error", name: "Home", verror: e?.code ?? "no-mic" }; emit(); return { ok: false, failed: true }; } // nothing was dialled: no call, no cooldown
      if (!ui) { stopMic(media.stream); speaker.destroy(); return null; } // the player cancelled while the browser asked
      speaker.attachMeter(media.ctx);
    }
    const free = () => { if (media) stopMic(media.stream); try { media?.ctx?.close?.(); } catch { /* ignore */ } speaker?.destroy(); media = null; };
    const before = game.get()?.balanceKobo;
    const r = await call("/api/calls", { action: "parent", requestId: newId() });
    if (r.failed || r.ok === false) { free(); ui = null; emit(); toast.error(r.error || r.message || "The call did not go through."); return r; }
    if (!ui) { free(); syncGame(); if (BigInt(r.giftKobo ?? 0) > 0n) toast.success(`${r.call.peer} sent you ${naira(r.giftKobo)}.`, { sound: "coin" }); return r; } // hung up while it was dialling: the server has settled it (and paid any gift), the screen is already closed
    const o = r.call.outcome, answered = o === "REFUSED" || o === "LATER" || o === "GIVEN";
    ui = { phase: "calling", name: r.call.peer, result: r, voice: voice && answered }; emit(); playSound("send");
    later(1500, () => { set({ phase: "ringing" }); playSound("notify"); });
    later(1500 + 3200, () => {
      if (o === "NO_ANSWER") { set({ phase: "noanswer" }); playSound("error"); }
      else if (o === "CALL_DECLINED") { set({ phase: "declined" }); playSound("error"); }
      else { set({ phase: "answered" }); playSound("receive"); }
    });
    if (voice && answered) { // she picked up: from here it is a real conversation
      later(1500 + 3200 + 900, () => startVoice(r, speaker, media, before));
      return r;
    }
    free(); // nobody to talk to (or no voice here): release the microphone at once
    if (answered) later(1500 + 3200 + 1300, () => {
      set({ phase: "talking" });
      if (BigInt(r.giftKobo ?? 0) > 0n) {
        // the server has already paid. If nothing has refreshed the top bar yet, show the money now; if it already has, do not add it twice.
        if (game.get()?.balanceKobo === before) game.pushDone(cash(r.giftKobo));
        playSound("coin");
      }
    });
    later(1500 + 3200 + (answered ? 1300 + 3200 : 1800), () => { set({ phase: "ended" }); syncGame(); callsLive.refresh(); });
    return r;
  },
  /** Voice call controls. */
  setMuted(m) { live?.session?.setMuted(m); },
  setLoud(on) { live?.speaker?.setVolume(on ? 1 : 0.5); set({ loud: !!on }); },
  retrySound() { live?.speaker?.retry(); set({ blocked: false }); },
  /** End a live voice call (the screen stays to say "Call ended"). */
  hangUp() { if (live?.session) live.session.hangUp("hung-up"); else this.dismiss(); },
  /** Hang up / close. If the story is still playing, the money is shown right away (it has already been paid). */
  dismiss() {
    if (!ui) return;
    if (ui.result && BigInt(ui.result.giftKobo ?? 0) > 0n && !["talking", "ended", "voice", "voice-ended"].includes(ui.phase)) { syncGame(); toast.success(`${ui.name} sent you ${naira(ui.result.giftKobo)}.`, { sound: "coin" }); }
    clear(); const s = live?.session; teardown(); s?.hangUp?.("hung-up"); ui = null; emit(); syncGame();
  },
};
export const useParentCall = () => useSyncExternalStore(parentCall.subscribe, parentCall.get, () => null);

/**
 * Ring a player from anywhere (the Calls app, the chat). Asks for the microphone in the same tap, so the voice can start the moment they answer.
 * A refused microphone stops the call before it is made. If the live connection is not available the call is still made (the money question works without voice);
 * the call screen then says that voice is not available. Resolves like callsDo does.
 */
export async function dialPlayer(name) {
  const p = await playerVoice.prepare();
  if (!p.ok && p.code !== "offline") { toast.error(ERROR_TEXT[p.code] ?? ERROR_TEXT.service); return { ok: false, failed: true, error: ERROR_TEXT[p.code] }; }
  const r = await callsDo({ action: "dial", to: name }, { quiet: true });
  if (r.unavailable || r.failed || r.ok === false) playerVoice.discardPrepared();
  return r;
}
