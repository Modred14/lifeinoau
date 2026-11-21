// lib/occupancyFeed.js
// The browser side of the building head counts ("3 people inside" on the map). No imports and no globals touched at load time (the socket link and the timers
// are handed in), so it runs the same in the browser and in a Node test. lib/occupancyClient.js wires it to the real socket and to React.
// The server side is lib/occupancy.js + realtime/server.js; the rules are in docs/BUILDING-OCCUPANCY.md.
//
// Two jobs:
//   READ   while the map is on screen (acquire): ask the realtime server for the counts, then keep only what it pushes. count(id) is 0 for any building the server
//          has not said somebody is inside, so a building with nobody in it has nothing to draw. After a lost connection the numbers are dropped once it has been
//          down for STALE_MS (a short blip changes nothing on screen): the map never keeps showing a count it can no longer vouch for.
//   REPORT while this player is inside a building (setInside): tell the server which one, say again every BEAT_MS that this connection is alive, and say it again
//          after every reconnect. The server checks the claim against the database and forgets it when the connection goes, so nothing here can leave anyone
//          counted. The browser never sets a count: it only says where THIS player is.

export const BEAT_MS = 20_000; // the server forgets a connection that has been silent for 75 seconds
export const STALE_MS = 6_000;
export const RETRY_MS = 1_500; // "not here yet": the trip's arrival has not reached the database; ask again shortly
const MAX_RETRIES = 3;

export function createOccupancyFeed({ link, setTimer = setTimeout, clearTimer = clearTimeout, setTick = setInterval, clearTick = clearInterval }) {
  let counts = {};
  const subs = new Set();
  let refs = 0, mine = null, off = null, beatTimer = null, staleTimer = null, retryTimer = null, wasUp = false, gen = 0;
  const emit = () => subs.forEach((f) => { try { f(); } catch { /* a screen's bug must never stop the feed */ } });
  const set = (next) => { counts = next; emit(); };
  const clean = (o) => { const out = {}; for (const [k, v] of Object.entries(o ?? {})) if (Number.isInteger(v) && v > 0) out[k] = v; return out; }; // only whole counts above zero are ever kept

  function apply(diff) { // absolute numbers for the places that changed; 0 means nobody is left inside
    let next = null;
    for (const [id, n] of Object.entries(diff ?? {})) {
      if (!Number.isInteger(n) || n < 0) continue;
      if ((counts[id] ?? 0) === n) continue;
      next ??= { ...counts };
      if (n > 0) next[id] = n; else delete next[id];
    }
    if (next) set(next);
  }

  function ask(g = gen) {
    if (!refs || !link.connected()) return;
    link.subscribe().then((r) => { if (g === gen && refs && r?.ok) set(clean(r.counts)); }).catch(() => { if (g === gen && refs) { clearTimer(retryTimer); retryTimer = setTimer(() => ask(g), 3000); } });
  }

  async function enter(place, attempt = 0) {
    if (!link.connected() || mine !== place) return; // offline: the claim is made as soon as the connection is back
    try {
      const r = await link.enter(place);
      if (!r?.ok && r?.error === "not_here" && attempt < MAX_RETRIES && mine === place) { clearTimer(retryTimer); retryTimer = setTimer(() => enter(place, attempt + 1), RETRY_MS); }
    } catch { /* no answer: the next beat or the next reconnect says it again */ }
  }

  function beat() {
    if (!mine || !link.connected()) return;
    const place = mine;
    link.beat().then((r) => { if (mine === place && r && !r.ok) enter(place); }).catch(() => {}); // the server does not know this connection (it restarted, or let it expire): say where we are again
  }

  const handlers = {
    connect() {
      clearTimer(staleTimer); staleTimer = null; wasUp = true;
      ask();
      if (mine) enter(mine);
    },
    disconnect() {
      wasUp = false; clearTimer(staleTimer);
      staleTimer = setTimer(() => { staleTimer = null; if (!wasUp && Object.keys(counts).length) set({}); }, STALE_MS);
    },
    diff: apply,
  };

  const hook = () => { if (!off) { off = link.on(handlers); wasUp = link.connected(); } };
  const unhook = () => { if (off && !refs && !mine) { off(); off = null; clearTimer(staleTimer); staleTimer = null; } };

  return {
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    /** How many real players are inside this building right now: 0 when nobody is (then nothing is drawn). */
    count: (id) => counts[id] ?? 0,
    /** All the buildings that have somebody inside: { id: n }, every n above zero. */
    all: () => counts,
    /** The map is on screen: get the counts and keep them up to date. Call the returned function when it leaves. */
    acquire() {
      refs++; hook();
      if (refs === 1) { gen++; ask(); }
      let done = false;
      return () => {
        if (done) return; done = true;
        if (--refs > 0) return;
        gen++; clearTimer(retryTimer);
        try { if (link.connected()) link.unsubscribe(); } catch { /* the connection is going away anyway */ }
        counts = {}; emit(); unhook();
      };
    },
    /** This player is inside `place` (a building id), or null when they are not. Calling it again with the same id does nothing. Moving straight to another building is just another call. */
    setInside(place) {
      place = place || null;
      if (place === mine) return;
      const prev = mine; mine = place;
      clearTick(beatTimer); beatTimer = null; clearTimer(retryTimer);
      if (!place) { if (prev && link.connected()) link.leave().catch(() => {}); unhook(); return; }
      hook(); enter(place);
      beatTimer = setTick(beat, BEAT_MS);
    },
    /** The page came back to the front: report that this connection is alive now (a hidden tab's timers can be slow). */
    poke: beat,
    /** The player signed out: forget everything (the connection is closed by the chat). */
    reset() {
      gen++; clearTick(beatTimer); beatTimer = null; clearTimer(retryTimer); clearTimer(staleTimer); staleTimer = null;
      mine = null; refs = 0; if (off) { off(); off = null; }
      if (Object.keys(counts).length) set({});
    },
  };
}
