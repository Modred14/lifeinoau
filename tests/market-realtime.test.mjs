// tests/market-realtime.test.mjs: the live price push of the realtime server (realtime/server.js), with real Socket.IO sockets.
// The market engine is replaced by a stand-in whose price is a pure function of the clock (like the real one), so a "restarted" server shows the same prices.
import assert from "node:assert/strict";
import { io as connect } from "socket.io-client";
import { createRealtime } from "../realtime/server.js";
import { signChatPass } from "../lib/chatAuth.js";

const SECRET = "test-session-secret", ok = (m) => console.log("OK  ", m), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const price = (t) => 10000 + (Math.floor(t / 1000) % 97) * 10;
const stub = (over = {}) => { const m = { calls: 0, fail: false, keys: ["INDEX"], now: () => Date.now(),
  ready: async () => { if (m.fail) throw new Error("database down"); return m; },
  tick: (t = Date.now()) => { m.calls++; const tick = Math.floor(t / 1000) * 1000; return { t: tick, p: { INDEX: price(tick) } }; },
  mood: () => ({ regime: "STEADY", headline: "Quiet" }),
  snapshot: (t = Date.now()) => { const tick = Math.floor(t / 1000) * 1000; return { t: tick, tickMs: 1000, prices: { INDEX: price(tick) }, changes: { INDEX: { m5: 0, h1: 0, d1: 0 } }, mood: m.mood() }; }, ...over }; return m; };
const db = { $queryRaw: async () => [] }; // the account gate's one query; everything else the chat does is not touched here
const quiet = { error() {}, warn() {}, log() {} };
const boot = async (market) => { const rt = createRealtime({ db, secret: SECRET, market, log: quiet }); const port = await rt.listen(0, "127.0.0.1"); return { rt, url: `http://127.0.0.1:${port}` }; };
const client = async (url, name = "ada") => { const token = await signChatPass(SECRET, { id: "id-" + name, name }), s = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
  const ticks = []; s.on("market:tick", (d) => ticks.push({ ...d, at: Date.now() })); await new Promise((res, rej) => { s.on("connect", res); s.on("connect_error", rej); }); return { s, ticks }; };
const sub = (s) => new Promise((res) => s.timeout(5000).emit("market:sub", {}, (e, r) => res(e ? { ok: false, error: String(e) } : r)));

const market = stub(); let { rt, url } = await boot(market);
const A = await client(url, "ada"), B = await client(url, "bola");

await sleep(1300); assert.equal(A.ticks.length, 0); assert.equal(market.calls, 0); ok("nothing is pushed (and the market is not even computed) until a player opens the Invest app");

const first = await sub(A.s); assert.ok(first.ok && first.prices.INDEX > 0 && first.tickMs === 1000 && Number.isFinite(first.serverNow)); await sleep(3300);
assert.ok(A.ticks.length >= 3 && A.ticks.length <= 4, "about one a second: " + A.ticks.length);
for (let i = 1; i < A.ticks.length; i++) assert.equal(A.ticks[i].t - A.ticks[i - 1].t, 1000, "consecutive seconds, none skipped");
assert.ok(A.ticks.every((x) => x.p.INDEX === price(x.t) && x.mood.regime === "STEADY") && JSON.stringify(A.ticks[0]).length < 200, "a tick is a few dozen bytes");
assert.equal(B.ticks.length, 0); ok("after subscribing: one tiny message every second, in order, only to the subscriber");

// the connection drops and comes back (a mobile network): a new socket asks again and carries on; the server remembered nothing about it, and needs to
A.s.disconnect(); await sleep(1200); const A2 = await client(url, "ada"); assert.equal(A2.ticks.length, 0); const again = await sub(A2.s); assert.ok(again.ok); await sleep(2300);
assert.ok(A2.ticks.length >= 2); ok("a reconnecting client subscribes again and gets the live prices straight away");

// the unsubscribed player never gets anything, and unsubscribing stops the flow
assert.equal(B.ticks.length, 0); await new Promise((r) => A2.s.emit("market:unsub", {}, r)); const n = A2.ticks.length; await sleep(2300); assert.equal(A2.ticks.length, n); ok("closing the Invest app (unsubscribe) stops the messages");

// with nobody subscribed the ticker stops by itself: no idle work at all
await sleep(1500); const calls = market.calls; await sleep(2500); assert.equal(market.calls, calls); ok("with nobody watching, the server does no market work");

// a server restart: a brand new process, the clients reconnect to it and the prices simply continue (they are a function of the clock, not of server memory)
const C = await client(url, "chi"); await sub(C.s); await sleep(1200); const lastSeen = C.ticks.at(-1);
C.s.disconnect(); await rt.close(); ({ rt, url } = await boot(market)); const C2 = await client(url, "chi"); const back = await sub(C2.s); await sleep(1500);
assert.ok(back.ok && back.t >= lastSeen.t); assert.ok(C2.ticks.every((x) => x.p.INDEX === price(x.t)) && C2.ticks.length >= 1); ok("after the realtime server restarts, clients reconnect, resubscribe, and the prices continue unbroken");

// the market cannot be read (database down): the player is told, the socket stays up, nothing loops
market.fail = true; const D = await client(url, "dayo"); const bad = await sub(D.s); assert.equal(bad.ok, false); assert.equal(D.s.connected, true); await sleep(1500); assert.equal(D.ticks.length, 0);
market.fail = false; const good = await sub(D.s); assert.ok(good.ok); ok("if the market cannot be loaded the request fails cleanly (the chat connection survives) and works again once it can");

// no pass, no connection
const stranger = connect(url, { auth: { token: "forged" }, transports: ["websocket"], reconnection: false });
const err = await new Promise((res) => { stranger.on("connect_error", res); stranger.on("connect", () => res(null)); }); assert.equal(err?.message, "auth"); stranger.close(); ok("a client without a valid pass cannot connect or subscribe");

for (const c of [A, A2, B, C, C2, D]) c.s.close(); await rt.close();
console.log("DONE");
