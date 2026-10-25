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
let ui = null; const subs = new Set(); let timers = [];
const emit = () => subs.forEach((f) => f());
const set = (patch) => { ui = ui ? { ...ui, ...patch } : null; emit(); };
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const clear = () => { timers.forEach(clearTimeout); timers = []; };
export const parentCall = {
  get: () => ui,
  subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  /** Dial home. Resolves when the server has answered (the story then plays on its own). */
  async start() {
    if (ui) return null;
    const before = game.get()?.balanceKobo;
    ui = { phase: "dialing", name: "Home", result: null }; emit();
    const r = await call("/api/calls", { action: "parent", requestId: newId() });
    if (r.failed || r.ok === false) { ui = null; emit(); toast.error(r.error || r.message || "The call did not go through."); return r; }
    const o = r.call.outcome, answered = o === "REFUSED" || o === "LATER" || o === "GIVEN";
    ui = { phase: "calling", name: r.call.peer, result: r }; emit(); playSound("send");
    later(1500, () => { set({ phase: "ringing" }); playSound("notify"); });
    later(1500 + 3200, () => {
      if (o === "NO_ANSWER") { set({ phase: "noanswer" }); playSound("error"); }
      else if (o === "CALL_DECLINED") { set({ phase: "declined" }); playSound("error"); }
      else { set({ phase: "answered" }); playSound("receive"); }
    });
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
  /** Hang up / close. If the story is still playing, the money is shown right away (it has already been paid). */
  dismiss() {
    if (!ui) return;
    if (ui.result && BigInt(ui.result.giftKobo ?? 0) > 0n && !["talking", "ended"].includes(ui.phase)) { syncGame(); toast.success(`${ui.name} sent you ${naira(ui.result.giftKobo)}.`, { sound: "coin" }); }
    clear(); ui = null; emit(); syncGame();
  },
};
export const useParentCall = () => useSyncExternalStore(parentCall.subscribe, parentCall.get, () => null);
