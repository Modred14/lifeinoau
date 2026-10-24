// lib/marketFeed.js
// The browser side of the live market, with no imports and no globals touched at load time (the socket link, the HTTP loader, the clock and the
// timers are handed in), so it runs the same in the browser and in a Node test. lib/marketClient.js wires it to the real ones.
//
//   WebSocket connected  -> the server pushes one small message a second (market:tick); nothing is polled
//   WebSocket down       -> the same prices are fetched over plain HTTP every couple of seconds (/api/invest/live), and the socket is
//                           asked for again whenever it comes back (the server then resumes pushing; a restart or a dropped link loses nothing,
//                           because every price is a function of the clock, not something the browser has to have seen)
// The browser never computes or invents a price: it only shows what the server said, newest tick wins, older ticks are ignored.

const RING = 300; // points kept for the 5 minute chart (one a second)
export const POLL_MS = 2000, STALE_MS = 3500, REFRESH_MS = 30_000;

export function createMarketFeed({ link, load, now = Date.now, setTimer = setInterval, clearTimer = clearInterval, visible = () => true }) {
  let state = { link: "connecting", t: 0, prices: {}, changes: {}, mood: null, range: "5m", series: {}, ready: false, tickMs: 1000 };
  const subs = new Set(); let users = 0, timers = [], lastTick = 0, lastLoad = 0, refs = {}, offLink = null, loading = null, gen = 0;
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };

  const pct = (p, ref) => (ref > 0 ? Math.round((p / ref - 1) * 10000) / 100 : 0);
  const rememberRefs = (prices, changes) => {
    refs = {};
    for (const k of Object.keys(prices)) { const c = changes?.[k] ?? {}; refs[k] = { m5: prices[k] / (1 + (c.m5 ?? 0) / 100), h1: prices[k] / (1 + (c.h1 ?? 0) / 100), d1: prices[k] / (1 + (c.d1 ?? 0) / 100) }; }
  };
  const changesFor = (prices) => Object.fromEntries(Object.keys(prices).map((k) => [k, { m5: pct(prices[k], refs[k]?.m5), h1: pct(prices[k], refs[k]?.h1), d1: pct(prices[k], refs[k]?.d1) }]));

  /** A full answer from the server (the first one, a poll, a refresh). */
  function apply(r, fromHttp) {
    if (!r || r.failed || !r.prices || !Number.isFinite(r.t)) return false;
    if (r.t < state.t - 1000 && state.ready) return false; // an older answer that arrived late
    rememberRefs(r.prices, r.changes);
    const patch = { t: Math.max(r.t, state.t), prices: r.prices, changes: r.changes, mood: r.mood, ready: true, tickMs: r.tickMs ?? 1000 };
    if (r.series && r.range === state.range) patch.series = Object.fromEntries(Object.entries(r.series).map(([k, v]) => [k, { t0: v.t0, step: v.step, values: v.values.slice() }]));
    if (fromHttp) lastTick = now();
    set(patch); return true;
  }

  /** One push from the socket. */
  function tick(d) {
    if (!d?.p || !Number.isFinite(d.t) || d.t < state.t) return; // out of order (a reconnect can replay an older second): ignore
    lastTick = now();
    const series = state.series;
    if (state.range === "5m") for (const k of Object.keys(d.p)) { // the 5 minute chart grows by one point a second, from the pushes themselves
      const s = series[k]; if (!s || d.t <= s.t0 + (s.values.length - 1) * s.step) continue;
      const gap = Math.min(RING, Math.round((d.t - (s.t0 + (s.values.length - 1) * s.step)) / s.step)), last = s.values[s.values.length - 1];
      for (let i = 1; i < gap; i++) s.values.push(last); // a skipped second repeats the last price rather than leaving a hole
      s.values.push(d.p[k]); if (s.values.length > RING) { const cut = s.values.length - RING; s.values.splice(0, cut); s.t0 += cut * s.step; }
    }
    set({ t: d.t, prices: { ...state.prices, ...d.p }, changes: changesFor({ ...state.prices, ...d.p }), mood: d.mood ?? state.mood, link: "live", series: { ...series } });
  }

  async function fetchNow(range = state.range) {
    if (loading) return loading;
    const g = gen, p = (async () => {
      const r = await load(range).catch(() => ({ failed: true }));
      if (g !== gen) return false;
      lastLoad = now();
      if (r?.failed) { if (!state.ready) set({ link: "offline" }); else if (!link.connected()) set({ link: "offline" }); return false; }
      const ok = apply(r, true);
      if (ok && !link.connected()) set({ link: "polling" });
      return ok;
    })().finally(() => { loading = null; });
    loading = p; return p;
  }

  async function resubscribe() { // every (re)connect: ask the server to start pushing, and take its snapshot as the starting point
    try { const snap = await link.subscribe(); apply(snap, false); lastTick = now(); set({ link: "live" }); }
    catch { if (!link.connected()) set({ link: "polling" }); }
  }

  function begin() {
    gen++; set({ link: link.connected() ? "live" : "connecting" });
    offLink = link.on({ connect: resubscribe, disconnect: () => { set({ link: "polling" }); fetchNow(); }, tick });
    fetchNow().then(() => { if (link.connected()) resubscribe(); });
    timers = [setTimer(() => { // the watchdog: no push for a few seconds (socket down, or a quiet server) -> use HTTP, and keep the slow numbers fresh
      if (!visible()) return;
      const t = now(), pushing = link.connected() && t - lastTick < STALE_MS;
      if (!pushing && t - lastTick >= STALE_MS) fetchNow();
      else if (pushing && t - lastLoad > REFRESH_MS) fetchNow();
      if (link.connected() && t - lastTick >= STALE_MS * 2) resubscribe(); // connected but silent: ask again
    }, POLL_MS)];
  }
  function end() { gen++; loading = null; timers.forEach(clearTimer); timers = []; offLink?.(); offLink = null; link.unsubscribe?.(); }

  return {
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    /** A screen that needs prices calls this (and the function it returns when it goes away). The first user starts the feed, the last one stops it. */
    acquire() { if (users++ === 0) begin(); let done = false; return () => { if (done) return; done = true; if (--users === 0) end(); }; },
    setRange(range) { if (range === state.range) return; set({ range, series: {} }); fetchNow(range); },
    refresh: () => fetchNow(),
    _tick: tick, _apply: (r) => apply(r, true),
  };
}
