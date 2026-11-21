// tests/occupancy-realtime.test.mjs: building head counts and the header population push, through the real realtime server (realtime/server.js) with real
// Socket.IO sockets and the real browser-side feeds (lib/occupancyFeed.js, lib/populationFeed.js). The database is a stand-in that answers the two queries used.
import assert from "node:assert/strict";
import { io as connect } from "socket.io-client";
import { createRealtime } from "../realtime/server.js";
import { createOccupancy } from "../lib/occupancy.js";
import { createOccupancyFeed } from "../lib/occupancyFeed.js";
import { createPopulationFeed } from "../lib/populationFeed.js";
import { signChatPass, signBody } from "../lib/chatAuth.js";

const SECRET = "test-session-secret", ok = (m) => console.log("OK  ", m), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { error() {}, warn() {}, log() {} };
const where = {}; // character id -> { placeId, hostel, jailedUntil }: where the GAME has each player standing
const db = { $queryRaw: async (strings, ...v) => (strings.join("?").includes('"hostel"') ? (where[v[0]] ? [where[v[0]]] : []) : []) };
let clock = Date.now(); const occ = createOccupancy({ ttlMs: 60_000, now: () => clock });
const rt = createRealtime({ db, secret: SECRET, log: quiet, graceMs: 150, occupancy: occ, occSweepMs: 200 });
const port = await rt.listen(0, "127.0.0.1"), url = `http://127.0.0.1:${port}`;

// a browser: a socket plus the real feeds on a link shaped like lib/chat.js's occLink / popLink
const browser = async (name, at = { placeId: "" }, target = () => url) => {
  where["id-" + name] = { hostel: "", jailedUntil: null, ...at };
  const token = await signChatPass(SECRET, { id: "id-" + name, name }), oh = new Set(), ph = new Set(), tell = (set, n, d) => set.forEach((h) => h[n]?.(d));
  let s; const open = async (u) => { s = connect(u, { auth: { token }, transports: ["websocket"], reconnection: false }); s.on("occ:d", (d) => tell(oh, "diff", d)); s.on("pop", (d) => tell(ph, "pop", d));
    await new Promise((res, rej) => { s.on("connect", res); s.on("connect_error", rej); }); };
  await open(target());
  const ask = (e, d) => new Promise((res, no) => s.timeout(4000).emit(e, d, (err, r) => (err ? no(err) : res(r))));
  const link = { on: (h) => { oh.add(h); return () => oh.delete(h); }, connected: () => s.connected, subscribe: () => ask("occ:sub", {}), unsubscribe: () => s.emit("occ:unsub", {}), enter: (p) => ask("occ:in", { place: p }), leave: () => ask("occ:out", {}), beat: () => ask("occ:beat", {}) };
  const feed = createOccupancyFeed({ link }), shown = []; feed.subscribe(() => shown.push({ ...feed.all() }));
  const pops = createPopulationFeed({ link: { on: (h) => { ph.add(h); return () => ph.delete(h); } }, load: async () => null });
  // what lib/chat.js does when the connection drops and comes back (here: to a freshly started server)
  const rejoin = async (u) => { s.close(); tell(oh, "disconnect"); await open(u); tell(oh, "connect"); };
  return { get s() { return s; }, ask, feed, shown, pops, name, rejoin };
};
const settle = () => sleep(350); // the server merges changes for 100 ms before sending

const A = await browser("ada", { placeId: "oduduwa" }), B = await browser("bola", { placeId: "oduduwa" }), C = await browser("chi", { placeId: "oduduwa" }), W = await browser("watcher");
const release = W.feed.acquire(); await settle(); assert.deepEqual(W.feed.all(), {}); assert.equal(W.feed.count("oduduwa"), 0);
ok("a map opened with nobody inside anywhere shows nothing (count 0, no entries)");

// 4, 5. enter; three enter
A.feed.setInside("oduduwa"); await settle(); assert.equal(W.feed.count("oduduwa"), 1);
B.feed.setInside("oduduwa"); C.feed.setInside("oduduwa"); await settle(); assert.equal(W.feed.count("oduduwa"), 3); ok("one player inside -> 1 on every map; three inside -> 3");

// 6, 7. leave one; everybody leaves
B.feed.setInside(null); await settle(); assert.equal(W.feed.count("oduduwa"), 2);
A.feed.setInside(null); C.feed.setInside(null); await settle(); assert.equal(W.feed.count("oduduwa"), 0); assert.deepEqual(W.feed.all(), {}); ok("one leaves -> 2; everybody leaves -> the entry is gone (nothing to draw, never a 0)");
assert.ok(W.shown.every((m) => Object.values(m).every((n) => n > 0)), "the browser never held a count of 0 or below");

// 9. direct move between buildings
where["id-ada"].placeId = "sub"; B.feed.setInside("oduduwa"); await settle(); A.feed.setInside("oduduwa"); await settle(); // ada is "at" oduduwa for this claim
where["id-ada"].placeId = "sub"; A.feed.setInside("sub"); await settle();
assert.equal(W.feed.count("oduduwa"), 1); assert.equal(W.feed.count("sub"), 1); ok("moving straight from one building to another updates both buildings");

// the server decides: a claim for a building the game does not have you at is refused; custody is never counted; bad ids are refused
const liar = await browser("liar", { placeId: "senate" });
assert.deepEqual(await liar.ask("occ:in", { place: "sub" }), { ok: false, error: "not_here" });
assert.deepEqual(await liar.ask("occ:in", { place: "../etc" }), { ok: false, error: "no such place" });
where["id-liar"] = { hostel: "", placeId: "floor0", jailedUntil: new Date(Date.now() + 60_000) };
assert.equal((await liar.ask("occ:in", { place: "floor0" })).ok, false);
where["id-liar"] = { hostel: "", placeId: "senate", jailedUntil: new Date(Date.now() + 60_000) };
assert.equal((await liar.ask("occ:in", { place: "senate" })).ok, false);
where["id-liar"] = { hostel: "", placeId: "", jailedUntil: null }; // not travelled anywhere: they are at home, and only home
assert.equal((await liar.ask("occ:in", { place: "sub" })).ok, false);
await settle(); assert.equal(W.feed.count("senate"), 0); assert.equal(W.feed.count("floor0"), 0); assert.equal(occ.count("sub"), 1);
ok("a browser cannot claim a building it is not standing at, custody (even by place id), or a malformed id: counts are untouched");

// 3 simultaneous entries: everybody counted exactly
const crowd = []; for (let i = 0; i < 25; i++) crowd.push(await browser("p" + i, { placeId: "bld_7" }));
await Promise.all(crowd.map((b) => b.ask("occ:in", { place: "bld_7" }))); await settle(); assert.equal(W.feed.count("bld_7"), 25);
await Promise.all(crowd.map((b) => b.ask("occ:out", {}))); await settle(); assert.equal(W.feed.count("bld_7"), 0); ok("25 players entering at the same moment are all counted; all leaving brings it back to nothing");

// the same player in two tabs is counted once
const A2 = await browser("ada", { placeId: "sub" }); where["id-ada"].placeId = "sub"; A2.feed.setInside("sub"); await settle(); assert.equal(W.feed.count("sub"), 1);
A2.s.disconnect(); await sleep(500); assert.equal(W.feed.count("sub"), 1); ok("a second tab of the same player does not add one, and closing it does not remove her while her first tab is still inside");

// 8. unexpected disconnect: cleared after the grace period; a page reload inside the grace period does not flicker
const R = await browser("riya", { placeId: "oduduwa" }); R.feed.setInside("oduduwa"); await settle(); assert.equal(W.feed.count("oduduwa"), 2);
const seen = W.shown.length; R.s.disconnect(); await sleep(60); const R2 = await browser("riya", { placeId: "oduduwa" }); R2.feed.setInside("oduduwa"); await sleep(600);
assert.equal(W.feed.count("oduduwa"), 2); assert.ok(W.shown.slice(seen).every((m) => m.oduduwa === 2), "a reload within the grace period never showed a different number");
R2.s.disconnect(); await sleep(700); assert.equal(W.feed.count("oduduwa"), 1); ok("a closed tab / lost connection is cleared; a reload that comes straight back does not flicker the count");

// a connection that is alive but silent (hung page) is swept; one that reports is kept
const H = await browser("hana", { placeId: "bld_9" }); await H.ask("occ:in", { place: "bld_9" }); await settle(); assert.equal(W.feed.count("bld_9"), 1);
clock += 30_000; assert.equal((await H.ask("occ:beat", {})).ok, true); clock += 45_000; await sleep(500); assert.equal(W.feed.count("bld_9"), 1, "a beat 45 s ago keeps her");
clock += 70_000; await sleep(500); assert.equal(W.feed.count("bld_9"), 0); assert.equal((await H.ask("occ:beat", {})).ok, false); ok("a silent connection is swept after the time limit and told so; one that keeps reporting is kept");

// a new map opened later gets the true picture at once, and unsubscribing stops the flow
const late = await browser("late"); const rel = late.feed.acquire(); await settle(); assert.deepEqual(late.feed.all(), W.feed.all()); const n = late.shown.length;
rel(); await sleep(50); assert.deepEqual(late.feed.all(), {}); const m = late.shown.length;
where["id-ada"].placeId = "sub"; A.feed.setInside("bld_5"); where["id-ada"].placeId = "bld_5"; A.feed.setInside("bld_5"); await settle();
assert.equal(late.shown.length, m, "a closed map receives nothing more"); assert.deepEqual(late.feed.all(), {}); ok("a map opened later starts from the true counts; closing it drops them and stops the messages");

// population push: only a signed request, never backwards, coalesced
const post = (body, sig) => fetch(url + "/internal", { method: "POST", headers: { "content-type": "application/json", "x-sig": sig ?? signBody(SECRET, body) }, body });
const got = []; const off = W.pops.acquire(); W.s.on("pop", (d) => got.push(d));
const bad = await post(JSON.stringify({ type: "population", people: 6000, at: 1 }), "forged"); assert.equal(bad.status, 401);
for (let i = 1; i <= 5; i++) await post(JSON.stringify({ type: "population", people: 6000 + i * 15, at: 1000 + i }));
await sleep(1300); assert.equal(W.pops.people(), 6075); assert.ok(got.length <= 3, "a burst of 5 entries is pushed as at most a few messages: " + got.length);
await post(JSON.stringify({ type: "population", people: 5000, at: 500 })); await sleep(1300); assert.equal(W.pops.people(), 6075, "an older total never replaces a newer one");
assert.equal((await post(JSON.stringify({ type: "population", people: -4, at: 5 }))).status, 400); ok("the header total: forged pushes refused, a burst is coalesced, older never beats newer, junk refused");

release(); off(); for (const b of [A, B, C, W, liar, A2, late, H, R, R2, ...crowd]) { b.feed.reset(); b.s.close(); }
// the realtime server RESTARTS: it forgets everybody; the browsers reconnect and say where they are again, and a map that was open is told the truth again
const keep = await browser("keeper", { placeId: "bld_3" }), viewer = await browser("viewer"); keep.feed.setInside("bld_3"); const relv = viewer.feed.acquire(); await settle(); assert.equal(viewer.feed.count("bld_3"), 1);
keep.s.close(); viewer.s.close(); await rt.close(); occ.sweep();
const occ2 = createOccupancy(), rt2 = createRealtime({ db, secret: SECRET, log: quiet, graceMs: 150, occupancy: occ2, occSweepMs: 200 }), port2 = await rt2.listen(0, "127.0.0.1"), url2 = `http://127.0.0.1:${port2}`;
assert.equal(occ2.count("bld_3"), 0, "the new server starts knowing nobody");
await keep.rejoin(url2); await viewer.rejoin(url2); await sleep(700);
assert.equal(occ2.count("bld_3"), 1, "the browser re-claimed after reconnecting"); assert.equal(viewer.feed.count("bld_3"), 1); assert.equal(occ2.inside, 1);
ok("after the realtime server restarts, the browsers reconnect, say where they are again, and every map shows the true count (nothing is lost, nothing doubled)");
keep.feed.reset(); viewer.feed.reset(); keep.s.close(); viewer.s.close(); relv(); await rt2.close();
console.log("DONE");
