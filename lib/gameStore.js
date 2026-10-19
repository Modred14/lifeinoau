// lib/gameStore.js
// The player's game state, held once for the whole app (the top bar, the home screen and the phone all read the same copy),
// plus the helpers every screen uses to make a change appear instantly and be undone if the server refuses it.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, notifyError, loggedOut, say } from "@/lib/client";
import { toast } from "@/lib/toast";
import { createStore, useStore, act, begin, finish } from "@/lib/optimistic";
import { syncServerClock } from "@/lib/serverClock";
import { waitForRoomGate } from "@/lib/roomGate";

export { useStore, act, begin, finish };

/** /api/state: cash, stats, academics, notifications. */
export const game = createStore(async () => {
  const sentAt = Date.now(), r = await call("/api/state");
  if (!r.failed) syncServerClock(r.serverNow, sentAt); // every screen counts down against the server's clock, not the device's
  return r;
});
export const useGame = () => useStore(game);
/** /api/room: the furniture in the player's room. It waits for any request that is still creating the player's home (see lib/roomGate.js),
 *  so it can never run before the home and its furniture exist. */
export const roomStore = createStore(async () => {
  await waitForRoomGate();
  return call("/api/room");
});

// ---- changes to the game state (each returns a function that takes the state and returns the new state) ----
const big = (v) => BigInt(v ?? 0);
const clamp = (v) => Math.max(0, Math.min(100, v));
/** Add (or take away) cash. Amounts are kobo, as numbers or strings. */
export const cash = (deltaKobo) => (s) => ({
  ...s,
  balanceKobo: (big(s.balanceKobo) + big(deltaKobo)).toString(),
});
/** Add to the 0-100 stats: bump({ energy: -20, happiness: 3 }). */
export const bump = (d) => (s) => {
  const c = { ...s.character };
  for (const k in d) c[k] = clamp((c[k] ?? 0) + d[k]);
  return { ...s, character: c };
};
/** Several changes in one. */
export const chain =
  (...fns) =>
  (s) =>
    fns.reduce((v, f) => (f ? f(v) : v), s);
/** What a stat change from the game engine adds up to for this character, as deltas (so it can be added on top of newer changes). */
export const deltas = (c, stats) =>
  Object.fromEntries(
    Object.keys(stats)
      .filter(
        (k) =>
          typeof stats[k] === "number" &&
          typeof c[k] === "number" &&
          stats[k] !== c[k],
      )
      .map((k) => [k, stats[k] - c[k]]),
  );
/** Can the player afford this (kobo)? Uses what is on screen, which already includes their latest changes. */
export const canAfford = (kobo) => {
  const s = game.get();
  return !s || big(s.balanceKobo) >= big(kobo);
};

const busy = new Set();
const UNSURE = "We couldn't confirm that went through. Your balance will refresh: check it before trying again.";
/**
 * The one way screens make a change:
 *   ok        text for a green toast shown AT ONCE (taken back if the server refuses); sound: a sound name for it (for example "coin")
 *   okLate    text/outcome for a toast shown when the server answers (for results nobody can know in advance, like a random payout)
 *   then      runs after a success, with the server's answer
 *   key       while a request with this key is running, the same tap is ignored (stops double taps)
 *   effects   what changes on screen right now: [{ store, patch }]
 *   after     changes to add once the answer is known: (res) => [{ store, patch }]
 *   sensitive money, purchases and anything else the server must verify. The screen still changes at once (as a pending state that is
 *             undone if the server refuses), but the player sees a spinner message (`pending`) instead of "done", and `ok` (with its
 *             sound) only appears AFTER the server has confirmed. Never fakes a success it has not been told about.
 */
export async function run({
  key,
  ok,
  sound,
  okLate,
  then,
  dupe = "Already done.",
  router,
  request,
  effects,
  after,
  sensitive = false,
  pending,
}) {
  if (key) {
    if (busy.has(key)) return { failed: true, skipped: true };
    busy.add(key);
  }
  const tid = sensitive
    ? toast.pending(pending ?? "Working on it…")
    : ok
      ? toast.success(ok, sound ? { sound } : undefined)
      : null;
  let res;
  try {
    res = await act({ request, effects, after });
  } finally {
    if (key) busy.delete(key);
  }
  if (res.status === 401) {
    if (tid) toast.dismiss(tid);
    loggedOut(router);
  } else if (res.failed) {
    if (tid) toast.dismiss(tid);
    if (res.aborted) return res;
    if (sensitive && res.unknown) toast.error(UNSURE, { duration: 9000 }); // no answer at all: it may or may not have happened
    else notifyError(res);
  } else if (res.duplicate && !res.replayed) {
    if (tid) toast.dismiss(tid);
    toast.info(dupe);
  } else {
    if (sensitive) {
      // the server has now said yes: only now does the player hear "done"
      if (ok) toast.success(ok, { ...(tid ? { id: tid } : {}), ...(sound ? { sound } : {}) });
      else if (tid) toast.dismiss(tid);
    }
    if (res.replayed) {
      // an earlier try of this same request had already gone through (its answer was lost): the details are not repeated, the refresh brings them
      if (!ok) toast.info("That already went through. Refreshing your details.");
    } else {
      if (!ok && okLate) {
        const m = okLate(res);
        if (m) say(typeof m === "string" ? { text: m } : m);
      }
      then?.(res);
    }
  }
  return res;
}

// ---- screens that just show a server answer: kept between visits, so reopening one is instant and refreshes quietly ----
const resources = new Map();
export const resourceStore = (path) => {
  let s = resources.get(path);
  if (!s) {
    s = createStore(() => call(path));
    resources.set(path, s);
  }
  return s;
};
/** const { d, store, load, loadFailed } = useResource("/api/courses")  (d is null until the very first answer) */
export function useResource(path) {
  const router = useRouter(),
    store = resourceStore(path),
    d = useStore(store),
    [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const r = await store.refresh();
    if (r.status === 401) return loggedOut(router);
    if (r.failed) {
      if (!store.get()) {
        notifyError(r);
        setFailed(true);
      }
      return r;
    }
    setFailed(false);
    return r;
  }, [store, router]);
  useEffect(() => {
    setFailed(false); // a different path (another tab) starts clean: it must not inherit the previous one's error
    load();
  }, [load]);
  return { d, store, load, loadFailed: failed && !d, router };
}