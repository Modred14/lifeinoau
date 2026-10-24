// tests/market-feed.test.mjs: the browser side of the live market (lib/marketFeed.js), with a fake socket, a fake HTTP loader and a fake clock.
import assert from "node:assert/strict";
import { createMarketFeed, POLL_MS, STALE_MS, REFRESH_MS } from "../lib/marketFeed.js";
const ok = (m) => console.log("OK  ", m);
const flush = () => new Promise((r) => setImmediate(r));

function rig({ connected = false } = {}) {
  let now = 1_000_000, handlers = null, isUp = connected, timers = new Map(), nextId = 1, visible = true;
  const log = { loads: [], subs: 0, unsubs: 0 }, server = { t: 1_000_000, price: 10000, fail: false, subFail: false };
  const snap = (range = "5m") => ({ t: server.t, tickMs: 1000, prices: { INDEX: server.price, MEME: 500 }, changes: { INDEX: { m5: 0, h1: 0, d1: 0 }, MEME: { m5: 0, h1: 0, d1: 0 } }, mood: { regime: "STEADY", headline: "Quiet" }, range,
    series: { INDEX: { t0: server.t - 4000, step: 1000, values: [10000, 10000, 10000, 10000, server.price] }, MEME: { t0: server.t - 4000, step: 1000, values: [500, 500, 500, 500, 500] } } });
  const link = {
    connected: () => isUp, on: (h) => { handlers = h; return () => { handlers = null; }; },
    subscribe: async () => { log.subs++; if (!isUp || server.subFail) throw new Error("offline"); return { ok: true, ...snap() }; },
    unsubscribe: () => { log.unsubs++; },
  };
  const feed = createMarketFeed({ link, now: () => now, visible: () => visible,
    load: async (range) => { log.loads.push(range); return server.fail ? { failed: true } : snap(range); },
    setTimer: (fn) => { const id = nextId++; timers.set(id, fn); return id; }, clearTimer: (id) => timers.delete(id) });
  return { feed, log, server, link,
    advance: async (ms) => { now += ms; server.t += ms; for (const fn of [...timers.values()]) fn(); await flush(); },
    tick: (price, dt = 1000) => { now += dt; server.t += dt; handlers?.tick({ t: server.t, p: { INDEX: price, MEME: 500 }, mood: { regime: "BOOM", headline: "Up" } }); },
    up: async () => { isUp = true; handlers?.connect(); await flush(); }, down: async () => { isUp = false; handlers?.disconnect(); await flush(); },
    hide: (v) => { visible = !v; }, timers: () => timers.size, handlers: () => handlers };
}

{ // HTTP only (no realtime server): the first answer arrives, then it is polled
  const r = rig(); const stop = r.feed.acquire(); await flush();
  assert.equal(r.feed.getState().ready, true); assert.equal(r.feed.getState().prices.INDEX, 10000); assert.equal(r.feed.getState().link, "polling"); assert.deepEqual(r.log.loads, ["5m"]);
  r.server.price = 10500; await r.advance(POLL_MS + 1600); assert.equal(r.feed.getState().prices.INDEX, 10500); assert.ok(r.log.loads.length >= 2);
  ok("without the WebSocket the prices still arrive, by plain HTTP every ~2 seconds"); stop();
}
{ // WebSocket: pushed ticks, no polling while they keep coming
  const r = rig({ connected: true }); const stop = r.feed.acquire(); await flush(); await flush();
  assert.equal(r.feed.getState().link, "live"); assert.equal(r.log.subs >= 1, true); const loads = r.log.loads.length;
  for (let i = 0; i < 6; i++) { r.tick(10000 + (i + 1) * 100); await r.advance(0); }
  const s = r.feed.getState(); assert.equal(s.prices.INDEX, 10600); assert.equal(s.mood.regime, "BOOM"); assert.equal(s.changes.INDEX.m5, 6); assert.equal(s.series.INDEX.values.at(-1), 10600); assert.equal(s.series.INDEX.values.length, 11);
  for (let i = 0; i < 3; i++) { r.tick(10600 + i, 1000); await r.advance(0); } assert.equal(r.log.loads.length, loads, "no HTTP while the pushes keep coming");
  ok("with the WebSocket: one price a second pushed, % change and the 5-minute chart grow with each tick, and nothing is polled"); stop();
}
{ // ticks that arrive late or twice are ignored
  const r = rig({ connected: true }); const stop = r.feed.acquire(); await flush(); await flush();
  r.tick(11000); const t = r.feed.getState().t; r.handlers().tick({ t: t - 5000, p: { INDEX: 9999, MEME: 1 } }); r.handlers().tick({ t, p: { INDEX: 11000, MEME: 500 } });
  assert.equal(r.feed.getState().prices.INDEX, 11000); assert.equal(r.feed.getState().series.INDEX.values.filter((v) => v === 9999).length, 0);
  ok("an older tick (after a reconnect replays one) never overwrites a newer price"); stop();
}
{ // the socket drops: HTTP takes over at once; it comes back: the server is asked to push again
  const r = rig({ connected: true }); const stop = r.feed.acquire(); await flush(); await flush(); r.tick(10200);
  await r.down(); assert.equal(r.feed.getState().link === "polling" || r.feed.getState().link === "offline", true); const n = r.log.loads.length; r.server.price = 10900; await r.advance(POLL_MS + 1600);
  assert.ok(r.log.loads.length > n); assert.equal(r.feed.getState().prices.INDEX, 10900);
  const subs = r.log.subs; await r.up(); assert.equal(r.log.subs, subs + 1); assert.equal(r.feed.getState().link, "live"); r.tick(10950); assert.equal(r.feed.getState().prices.INDEX, 10950);
  ok("a dropped connection falls back to HTTP immediately, and a reconnect re-subscribes and resumes pushes"); stop();
}
{ // connected but silent (server restarted behind a load balancer): the watchdog notices
  const r = rig({ connected: true }); const stop = r.feed.acquire(); await flush(); await flush(); r.tick(10100); const n = r.log.loads.length, subs = r.log.subs;
  r.server.price = 10777; await r.advance(STALE_MS + POLL_MS); assert.ok(r.log.loads.length > n, "fell back to HTTP"); assert.equal(r.feed.getState().prices.INDEX, 10777);
  await r.advance(STALE_MS * 2); assert.ok(r.log.subs > subs, "asked the server to push again");
  ok("a connection that goes quiet is noticed within seconds: HTTP prices, and a fresh subscription"); stop();
}
{ // slow numbers (changes, mood) are refreshed now and then even while ticks flow
  const r = rig({ connected: true }); const stop = r.feed.acquire(); await flush(); await flush(); const n = r.log.loads.length;
  for (let i = 0; i < Math.ceil(REFRESH_MS / 1000) + 3; i++) { r.tick(10000 + i); await r.advance(0); if (i % 2 === 0) await r.advance(0); }
  await r.advance(POLL_MS); assert.ok(r.log.loads.length > n); ok("while ticks flow, the 5 min / 1 h / 24 h numbers are still refreshed every ~30 seconds"); stop();
}
{ // switching the chart range
  const r = rig({ connected: true }); const stop = r.feed.acquire(); await flush(); await flush(); r.feed.setRange("1h"); await flush();
  assert.equal(r.log.loads.at(-1), "1h"); assert.equal(r.feed.getState().range, "1h"); const before = r.feed.getState().series.INDEX.values.length; r.tick(12345);
  assert.equal(r.feed.getState().series.INDEX.values.length, before, "the hourly chart is not extended by the second-by-second ticks"); assert.equal(r.feed.getState().prices.INDEX, 12345);
  ok("choosing another chart range fetches it from the server, and live ticks only extend the 5-minute chart"); stop();
}
{ // the 5-minute chart is a ring of 300 points, and a missed second repeats the last price instead of leaving a hole
  const r = rig({ connected: true }); const stop = r.feed.acquire(); await flush(); await flush();
  for (let i = 0; i < 400; i++) r.tick(10000 + i, 1000); assert.equal(r.feed.getState().series.INDEX.values.length, 300);
  const n = r.feed.getState().series.INDEX.values.length; r.tick(20000, 3000); const v = r.feed.getState().series.INDEX.values; assert.equal(v.length, n); assert.equal(v.at(-1), 20000); assert.equal(v.at(-2), v.at(-3));
  ok("the 5-minute chart keeps 300 points; a missed tick is filled with the last price"); stop();
}
{ // failures: shown as reconnecting, then recovered
  const r = rig(); r.server.fail = true; const stop = r.feed.acquire(); await flush(); assert.equal(r.feed.getState().link, "offline"); assert.equal(r.feed.getState().ready, false);
  r.server.fail = false; await r.advance(POLL_MS + 1600); assert.equal(r.feed.getState().ready, true); assert.equal(r.feed.getState().link, "polling");
  ok("when the server cannot be reached the screen says it is reconnecting, then recovers by itself"); stop();
}
{ // a hidden page does not poll; the last user leaving stops everything
  const r = rig(); const a = r.feed.acquire(), b = r.feed.acquire(); await flush(); r.hide(true); const n = r.log.loads.length; await r.advance(POLL_MS * 5); assert.equal(r.log.loads.length, n); r.hide(false);
  a(); assert.ok(r.timers() > 0, "still running for the second screen"); b(); b(); assert.equal(r.timers(), 0); assert.equal(r.log.unsubs, 1); const m = r.log.loads.length; await r.advance(POLL_MS * 5); assert.equal(r.log.loads.length, m);
  ok("a hidden tab does not poll, and when the last screen closes the feed stops completely (no leaked timers)");
}
console.log("DONE");
