// lib/populationFeed.js
// The browser side of the header's campus population ("6,248", shown as the people who visited today). No imports and no globals touched at load time (the link, the loader and the timers
// are handed in), so it runs the same in the browser and in a Node test. lib/populationClient.js wires it to the real socket, the real HTTP call and React.
// The server side is lib/campusPopulationService.js; the rules are in docs/CAMPUS-POPULATION.md.
//
//   realtime server up   -> the server pushes the new total whenever a player's entry is counted (`pop`), and the number is fetched again after every reconnect
//   realtime server off  -> the same number is fetched over plain HTTP every POLL_MS while the page is visible
// The browser never works the number out: it shows what the server last said. Every answer carries the time the server made it, and an older answer never
// replaces a newer one (a slow request that finishes after a push cannot make the number go backwards). Until the first answer nothing is shown: no guess, no 0.

export const POLL_MS = 120_000;

export function createPopulationFeed({ link, load, visible = () => true, setTick = setInterval, clearTick = clearInterval }) {
  let state = { people: null, at: 0 };
  const subs = new Set();
  let users = 0, timer = null, off = null, loading = null;
  const set = (next) => { state = next; subs.forEach((f) => { try { f(); } catch { /* a screen's bug must never stop the feed */ } }); };

  /** One answer from the server (a push, a fetch, or the reply to an entry). */
  function apply(d) {
    if (!d || d.failed || !Number.isSafeInteger(d.people) || d.people < 0 || !Number.isFinite(d.at)) return false;
    if (d.at < state.at) return false; // an older answer that arrived late
    if (d.people === state.people && d.at === state.at) return false;
    set({ people: d.people, at: d.at });
    return true;
  }

  function refresh() {
    if (loading) return loading;
    loading = Promise.resolve().then(load).then(apply).catch(() => false).finally(() => { loading = null; });
    return loading;
  }

  return {
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    /** The people on campus now, or null before the server has said. */
    people: () => state.people,
    apply,
    refresh,
    /** A screen that shows the number is on the page: fetch it, listen for pushes, and keep it fresh. Call the returned function when it leaves. */
    acquire() {
      users++;
      if (users === 1) {
        off = link.on({ pop: apply, connect: refresh });
        timer = setTick(() => { if (visible()) refresh(); }, POLL_MS);
        refresh();
      }
      let done = false;
      return () => {
        if (done) return; done = true;
        if (--users > 0) return;
        off?.(); off = null; clearTick(timer); timer = null;
      };
    },
  };
}

/**
 * Reports "this player has entered the game" once per visit (a visit is one browser tab's session, so a refresh or moving between pages never reports again).
 * The SERVER still decides whether it counts (at most once per cool-down per player, whatever is sent), so this is only about not asking needlessly.
 * `post()` resolves the server's answer or { failed }; `store` is sessionStorage-like ({ get, set }). A failed attempt is not remembered, so the next page tries again.
 */
export function createEntryReporter({ post, store, onAnswer = () => {} }) {
  const inFlight = new Set(); // also stops a double call (React strict mode runs effects twice) from sending two requests
  return async function report(characterId) {
    if (!characterId) return "skip";
    const key = "oau.entry." + characterId;
    let seen = false; try { seen = !!store.get(key); } catch { /* storage blocked: the in-memory guard below still holds for this page */ }
    if (seen || inFlight.has(key)) return "skip";
    inFlight.add(key);
    try {
      const r = await post();
      if (!r || r.failed || r.ok !== true) return "retry";
      try { store.set(key, "1"); } catch { /* blocked storage: a reload may ask again, and the server refuses the extra one */ }
      onAnswer(r);
      return "sent";
    } catch { return "retry"; } finally { inFlight.delete(key); }
  };
}
