// tests/trip-sync.test.mjs
// The background trip sync (lib/tripSync.js) with a fake clock and a fake network, and the camera maths (lib3d/tripcam.js).
import assert from "node:assert/strict";
import { createTripSync } from "../lib/tripSync.js";
import { CAM, clampZoom, zoomByPinch, zoomByWheel, frame, clearBack, followBack } from "../lib3d/tripcam.js";

// ---- a fake clock: timers run in order as time is advanced ----
const tick = () => new Promise((r) => setImmediate(r)); // lets every pending promise (the sync loop's awaits) settle before the clock moves on
function clock() {
  let t = 0, id = 0; const q = new Map();
  return { now: () => t, setT: (f, ms) => { q.set(++id, { f, at: t + ms }); return id; }, clearT: (i) => q.delete(i),
    async advance(ms) { const end = t + ms; for (;;) { let nx = null; for (const [i, e] of q) if (e.at <= end && (!nx || e.at < nx.e.at)) nx = { i, e }; if (!nx) break; q.delete(nx.i); t = Math.max(t, nx.e.at); nx.e.f(); await tick(); } t = end; await tick(); } };
}
const flush = tick;

// 1. a player standing still sends a slow heartbeat, a moving one sends the latest pose, and never two requests at once
{
  const c = clock(); let pose = { x: 0, z: 0, h: 0, mode: "trek" }, inflight = 0, maxInflight = 0; const got = [];
  const sync = createTripSync({ ...c, getPose: () => pose, send: async (p) => { inflight++; maxInflight = Math.max(maxInflight, inflight); await c.advance(0); got.push({ ...p }); inflight--; return { ok: true }; }, fetchRoad: async () => ({ travellers: [] }), onTravellers() {}, rnd: () => 0.5 });
  sync.start(); await c.advance(100); assert.equal(got.length, 1, "the first report goes at once");
  await c.advance(4000); assert.equal(got.length, 1, "standing still: nothing more for a while (no needless requests)");
  await c.advance(2000); assert.equal(got.length, 2, "...then a slow heartbeat so the server still knows you are on the road");
  pose = { x: 10, z: 0, h: 0, mode: "trek" }; await c.advance(2100); assert.equal(got.length, 3); assert.equal(got.at(-1).x, 10, "a moving player's latest position is sent");
  for (let i = 1; i <= 40; i++) { pose = { x: 10 + i, z: 0, h: 0, mode: "trek" }; await c.advance(100); } // 4 s of movement, polled by the player's frames
  assert.ok(got.length <= 6, "40 frames of movement became at most a couple of requests: " + got.length); assert.equal(maxInflight, 1);
  sync.stop(); const n = got.length; await c.advance(20000); assert.equal(got.length, n, "stopped means stopped");
}

// 2. a slow connection: requests never pile up, the newest pose wins; when it fails the pace backs off, and one success returns to normal
{
  const c = clock(); let pose = { x: 0, z: 0, h: 0, mode: "keke" }, mode = "slow", inflight = 0, maxInflight = 0, calls = 0; const got = []; let release = null;
  const sync = createTripSync({ ...c, getPose: () => pose, rnd: () => 0.5,
    send: (p) => { calls++; inflight++; maxInflight = Math.max(maxInflight, inflight);
      return new Promise((res) => { const done = () => { inflight--; if (mode === "fail") res({ failed: true, status: 503 }); else { got.push({ ...p }); res({ ok: true }); } }; if (mode === "slow") release = done; else done(); }); },
    fetchRoad: async () => ({ travellers: [] }), onTravellers() {} });
  sync.start(); await c.advance(30000); // 30 s with a request that never answers
  assert.equal(calls, 1, "one request in flight; no more are sent behind it"); assert.equal(maxInflight, 1);
  pose = { x: 99, z: 0, h: 0, mode: "keke" }; release(); await c.advance(2100); assert.equal(got.at(-1)?.x ?? 0, 0); await c.advance(100); // the old one lands; the next one carries the NEWEST pose
  assert.ok(got.length === 1 || got.at(-1).x === 99, "the next report is the newest pose, not a queued old one");
  mode = "fail"; pose = { x: 200, z: 0, h: 0, mode: "keke" }; const before = calls; await c.advance(60000); const tries = calls - before; assert.ok(tries >= 3 && tries < 20, `a failing server is retried with backing off, not hammered: ${tries} tries in 60 s`);
  mode = "ok"; await c.advance(15000); assert.equal(got.at(-1).x, 200, "once the connection is back the latest pose is delivered"); assert.ok(sync.stats.failed >= 3);
  sync.stop();
}

// 3. a reply that arrives after stop() is ignored, and stop() aborts what is in flight and (when asked) clears the road presence once
{
  const c = clock(); let aborted = false, cleared = 0, travellers = null, resolveRoad;
  const sync = createTripSync({ ...c, getPose: () => ({ x: 1, z: 1, h: 0, mode: "bus" }), rnd: () => 0.5, clear: () => { cleared++; },
    send: async () => ({ ok: true }), fetchRoad: ({ signal }) => new Promise((res) => { resolveRoad = res; signal?.addEventListener("abort", () => { aborted = true; res({ aborted: true }); }); }), onTravellers: (l) => { travellers = l; } });
  sync.start(); await c.advance(100); sync.stop({ clear: true }); await flush(); assert.ok(aborted, "the read in flight was cancelled"); assert.equal(cleared, 1, "road presence cleared once"); resolveRoad({ travellers: [{ id: "x" }] }); await flush(); assert.equal(travellers, null, "a late answer is never applied");
  const s2 = createTripSync({ ...c, getPose: () => ({ x: 1, z: 1, h: 0, mode: "bus" }), send: async () => ({ ok: true }), fetchRoad: async () => ({ travellers: [] }), onTravellers() {}, clear: () => { cleared++; } }); s2.stop({ clear: true }); assert.equal(cleared, 1, "nothing was ever reported: nothing to clear");
}

// 4. other players: applied as they arrive; after a long outage they are dropped rather than shown as ghosts; the server refusing you stops the reports
{
  const c = clock(); let up = true, list = null; const sync = createTripSync({ ...c, getPose: () => ({ x: 1, z: 1, h: 0, mode: "keke" }), send: async () => ({ ok: true }), rnd: () => 0.5,
    fetchRoad: async () => (up ? { travellers: [{ id: "a", x: 1, z: 2 }] } : { failed: true, status: 0 }), onTravellers: (l) => { list = l; }, config: { staleRoadMs: 15000 } });
  sync.start(); await c.advance(3000); assert.equal(list?.length, 1); up = false; await c.advance(60000); assert.deepEqual(list, [], "stale travellers are removed after a long outage"); up = true; await c.advance(15000); assert.equal(list.length, 1, "and come back with the connection");
  sync.stop();
  let sends = 0; const s3 = createTripSync({ ...c, getPose: () => ({ x: Math.random() * 100, z: 0, h: 0, mode: "keke" }), send: async () => { sends++; return { failed: true, status: 403 }; }, fetchRoad: async () => ({ travellers: [] }), onTravellers() {} });
  s3.start(); await c.advance(60000); assert.equal(sends, 1, "forbidden: stop asking"); s3.stop();
  let n = 0; const s4 = createTripSync({ ...c, getPose: () => ({ x: n++ * 5, z: 0, h: 0, mode: "keke" }), send: async () => { sends++; return { ok: true }; }, fetchRoad: async () => ({ travellers: [] }), onTravellers() {}, isOnline: () => false, isHidden: () => false });
  sends = 0; s4.start(); await c.advance(30000); assert.equal(sends, 0, "offline: nothing is sent (and nothing is queued to burst out later)"); s4.stop();
}

// ---- camera ----
{
  assert.ok(CAM.walk.back >= 7 && CAM.walk.back > 3.6 * 1.9, "the walking camera sits well back (it was 3.6 m)"); assert.ok(CAM.walk.height > 3);
  const near = frame({ inVeh: false, zoom: CAM.walk.min }), far = frame({ inVeh: false, zoom: CAM.walk.max }); assert.ok(near.back >= 4 && far.back <= 14.5 && far.back > near.back, `zoom limits ${near.back.toFixed(1)}..${far.back.toFixed(1)} m`);
  assert.equal(clampZoom(0.01, "walk"), CAM.walk.min); assert.equal(clampZoom(99, "walk"), CAM.walk.max);
  assert.ok(zoomByPinch(1, 2, "walk") < 1, "fingers apart: closer"); assert.ok(zoomByPinch(1, 0.5, "walk") > 1, "fingers together: further"); assert.ok(zoomByWheel(1, 100, "walk") > 1 && zoomByWheel(1, -100, "walk") < 1);
  assert.equal(zoomByPinch(1, 1e9, "walk"), zoomByPinch(1, 2, "walk"), "one wild gesture cannot jump the zoom");
  assert.ok(frame({ inVeh: true, speed: 25 }).back > frame({ inVeh: true, speed: 0 }).back, "faster, a little further back");
  // a wall 3 m behind the person: the camera stops short of it, using whichever of the three rays hits first
  const wall = { raycast: (ax, az, bx, bz) => { const t = (3 - az) / (bz - az); return t >= 0 && t <= 1 ? t : null; } };
  const allowed = clearBack(wall, 0, 0, 0, 1, 8); assert.ok(allowed < 3 && allowed >= 1.3, "never behind the wall: " + allowed.toFixed(2));
  assert.equal(clearBack({ raycast: () => null }, 0, 0, 0, 1, 8), 8, "nothing in the way: full distance");
  let cb = 8; for (let i = 0; i < 20; i++) cb = followBack(cb, 2, 1 / 60); assert.ok(cb < 5 && cb > 2, "pulls in quickly but not in one jump"); let out = 2; for (let i = 0; i < 20; i++) out = followBack(out, 8, 1 / 60); assert.ok(out < 6 && out > 2 && (8 - out) / 6 > (cb - 2) / 6 * 0.9, "eases out gradually, slower than it pulls in: " + out.toFixed(2));
}

// 5. ordering, stale answers, corrections and a refusal: reports carry a rising number; the player's own movement is never involved
{
  const c = clock(); let pose = { x: 0, z: 0, h: 0, mode: "trek" }, reply = () => ({ ok: true }); const got = [], corrections = []; let halted = null;
  const sync = createTripSync({ ...c, getPose: () => pose, rnd: () => 0.5, send: async (p) => { got.push({ ...p }); return reply(p); }, fetchRoad: async () => ({ travellers: [] }), onTravellers() {},
    onCorrection: (q) => corrections.push(q), onHalted: (r) => { halted = r; } });
  sync.start(); await c.advance(100);
  for (let i = 1; i <= 5; i++) { pose = { x: i * 10, z: 0, h: 0, mode: "trek" }; await c.advance(2100); }
  assert.ok(got.length >= 4 && got.every((g) => Number.isFinite(g.seq)), "every report is numbered");
  assert.ok(got.every((g, i) => i === 0 || g.seq > got[i - 1].seq), "...and the numbers only rise");
  // stale: the server already holds a far higher number (another tab, a clock that was ahead): the next report goes above it and carries the CURRENT pose
  reply = () => (reply.n++ === 0 ? { ok: true, stale: true, seq: 9e12 } : { ok: true }); reply.n = 0;
  pose = { x: 77, z: 0, h: 0, mode: "trek" }; await c.advance(2100); await c.advance(2100);
  assert.ok(sync.stats.stale === 1, "the stale answer was counted, not treated as a failure"); assert.equal(sync.stats.failed, 0);
  const after = got.at(-1); assert.ok(after.seq > 9e12 && after.x === 77, "carried on above the server's number, with the newest pose: " + JSON.stringify(after));
  // corrected: the server moved the spot part of the way; the caller is told, the very next tick sends again (until the server has caught up)
  reply = () => (reply.n++ < 2 ? { ok: true, corrected: true, pose: { x: 50, z: 0, h: 0 } } : { ok: true }); reply.n = 0; const n0 = got.length;
  pose = { x: 400, z: 0, h: 0, mode: "trek" }; await c.advance(8000);
  assert.equal(corrections.length, 2, "told twice"); assert.ok(got.length - n0 >= 3, "kept reporting until the server accepted it: " + (got.length - n0)); assert.equal(sync.stats.corrected, 2); assert.equal(sync.stats.failed, 0);
  // refused outright (custody, suspension): told once, and no more reports
  reply = () => ({ failed: true, status: 403, error: "You are held in Floor O." }); await c.advance(10000);
  assert.equal(halted?.status, 403, "the caller hears about the refusal once"); const n1 = got.length; await c.advance(60000); assert.equal(got.length, n1, "and the reports stop");
  sync.stop();
  // a 401 (signed out) stops the reports too, but it is the login flow's job to speak, not the trip's
  let h2 = 0; const s2 = createTripSync({ ...c, getPose: () => ({ x: Math.random() * 99, z: 0, h: 0, mode: "keke" }), send: async () => ({ failed: true, status: 401 }), fetchRoad: async () => ({ travellers: [] }), onTravellers() {}, onHalted: () => { h2++; } });
  s2.start(); await c.advance(20000); assert.equal(h2, 0); s2.stop();
}

// 6. the end of the trip is numbered above every report of the trip, so a late report cannot bring the player back onto the road
{
  const c = clock(); const seqs = []; let ended = null;
  const sync = createTripSync({ ...c, getPose: () => ({ x: Math.random() * 50, z: 0, h: 0, mode: "bus" }), send: async (p) => { seqs.push(p.seq); return { ok: true }; }, fetchRoad: async () => ({ travellers: [] }), onTravellers() {}, clear: (seq) => { ended = seq; } });
  sync.start(); await c.advance(100); for (let i = 0; i < 4; i++) await c.advance(2100); sync.stop({ clear: true });
  assert.ok(seqs.length >= 2 && ended > Math.max(...seqs), "the clear carries a number above all reports: " + ended + " vs " + Math.max(...seqs));
}
console.log("trip sync + camera passed");
