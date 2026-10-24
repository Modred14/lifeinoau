// tests/trip-ping.test.mjs
// The server side of road reports (lib/travelService.js tripPing) and the limits behind it (lib/travel.js clampPing): reports are kept in order, an older report never
// overwrites a newer one, an impossible jump is moved only as far as the mode could have gone, and a refused player never lingers on the road. Pure Node, in-memory db.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import { clampPing, pingMps, PING_SLACK_M, PING_FRESH_MS } from "../lib/travel.js";
import { tripPing, onTheRoad } from "../lib/travelService.js";

// ---- the pure limits ----
{
  const at = 1_000_000, prev = { x: 0, z: 0, mode: "trek", at };
  assert.deepEqual(clampPing(null, { x: 900, z: 900 }, "trek", at), { x: 900, z: 900, corrected: false }, "the first report is taken as it is");
  assert.equal(clampPing(prev, { x: 10, z: 0 }, "trek", at + 2000).corrected, false, "a run for 2 s is fine");
  const j = clampPing(prev, { x: 500, z: 0 }, "trek", at + 2000), cap = pingMps("trek") * 2 + PING_SLACK_M;
  assert.ok(j.corrected && Math.abs(j.x - cap) < 1e-6 && j.z === 0, "a 500 m jump in 2 s on foot is cut to what a runner covers: " + j.x);
  const diag = clampPing(prev, { x: 300, z: 400 }, "trek", at + 1000); assert.ok(diag.corrected && Math.abs(diag.x / diag.z - 0.75) < 1e-9, "cut along the line towards the claim, not sideways");
  assert.equal(clampPing(prev, { x: 500, z: 0 }, "trek", at + PING_FRESH_MS + 1).corrected, false, "an old report is no basis for a comparison");
  assert.equal(clampPing(prev, { x: 500, z: 0 }, "keke", at + 2000).corrected, false, "another mode is a new trip");
  assert.equal(clampPing(prev, { x: 5, z: 0 }, "trek", at - 60_000).corrected, false, "a clock that went backwards does not freeze anyone");
  assert.ok(pingMps("car") > pingMps("trek") && pingMps("keke") > 0 && pingMps("nope") === 0);
  assert.equal(clampPing({ x: 0, z: 0, mode: "car", at }, { x: 40, z: 0 }, "car", at + 2000).corrected, false, "a car at 20 m/s covers 40 m in 2 s");
}

// ---- the service ----
const db = makeDb(["character", "block"]), T = db.T();
const row = (o = {}) => ({ id: "c_aaaaaaaa11111111", userId: "u1", name: "Ada", hostel: "Awo", transport: "", activeCar: "", placeId: "", placeAt: null, driverName: "", driverUntilWeek: 0, jailedUntil: null, suspendedUntil: null, expelled: false, expelledUntil: null, tripX: null, tripZ: null, tripH: null, tripMode: "", tripAt: null, tripSeq: null, gender: "F", look: null, ...o });
T.character.push(row(), row({ id: "c_bbbbbbbb22222222", userId: "u2", name: "Bayo" }));
const me = () => T.character.find((c) => c.userId === "u1");

assert.deepEqual(await tripPing(db, "u1", { x: 10, z: 20, h: 1, mode: "trek", seq: 100 }), { ok: true });
assert.deepEqual([me().tripX, me().tripZ, me().tripMode, me().tripSeq], [10, 20, "trek", 100], "stored");
// an older report that overtook on the way (or was sent twice) changes nothing
let r = await tripPing(db, "u1", { x: 999, z: 999, h: 0, mode: "trek", seq: 99 }); assert.equal(r.stale, true); assert.equal(r.seq, 100); assert.equal(me().tripX, 10, "the older report did not overwrite the newer");
r = await tripPing(db, "u1", { x: 12, z: 20, h: 1, mode: "trek", seq: 100 }); assert.equal(r.stale, true, "the same number twice is a duplicate, not a second report");
r = await tripPing(db, "u1", { x: 14, z: 20, h: 1, mode: "trek", seq: 101 }); assert.deepEqual(r, { ok: true }); assert.equal(me().tripX, 14);
// an impossible jump: stored as far as the mode could have got, and the answer says so
me().tripAt = new Date(Date.now() - 2000);
r = await tripPing(db, "u1", { x: 4000, z: 20, h: 0, mode: "trek", seq: 102 });
assert.ok(r.corrected && r.pose.x > 14 && r.pose.x < 60 && r.pose.z === 20, "moved only part of the way: " + JSON.stringify(r)); assert.equal(me().tripX, r.pose.x); assert.equal(me().tripSeq, 102);
// the end of the trip, then a late report from before it: the player must not be back on the road
me().tripAt = new Date();
assert.deepEqual(await tripPing(db, "u1", { mode: "", seq: 200 }), { ok: true }); assert.equal(me().tripAt, null); assert.equal(me().tripMode, "");
r = await tripPing(db, "u1", { x: 20, z: 20, h: 0, mode: "trek", seq: 150 }); assert.equal(r.stale, true); assert.equal(me().tripAt, null, "a report from before the end cannot bring the player back");
assert.equal((await onTheRoad(db, "u2")).travellers.length, 0, "and nobody sees them on the road");
// a new trip (a higher number) starts afresh, whatever the old position was
r = await tripPing(db, "u1", { x: -300, z: 300, h: 0, mode: "keke", seq: 201 }); assert.deepEqual(r, { ok: true }); assert.equal((await onTheRoad(db, "u2")).travellers.length, 1, "seen on the road again");
// an older screen with no number still works as before
assert.deepEqual(await tripPing(db, "u1", { x: -300, z: 301, h: 0, mode: "keke" }), { ok: true }); assert.equal(me().tripZ, 301);
// nonsense ends the trip instead of storing it
await tripPing(db, "u1", { x: NaN, z: 1, h: 0, mode: "keke", seq: 300 }); assert.equal(me().tripAt, null, "a bad spot is the end of the trip");
await tripPing(db, "u1", { x: 99999, z: 1, h: 0, mode: "keke", seq: 301 }); assert.equal(me().tripAt, null, "off the map is the end of the trip");
for (const seq of [NaN, -5, 0, 1e20, "7"]) { me().tripSeq = 5; const q = await tripPing(db, "u1", { x: 1, z: 1, h: 0, mode: "trek", seq }); assert.equal(q.stale, undefined, "a junk number is ignored, not trusted: " + seq); }
// custody / suspension: refused, and no old position left behind for others to see
Object.assign(me(), { tripX: 1, tripZ: 1, tripMode: "trek", tripAt: new Date(), tripSeq: 5 });
me().jailedUntil = new Date(Date.now() + 60_000);
await assert.rejects(() => tripPing(db, "u1", { x: 1, z: 1, h: 0, mode: "trek", seq: 999 }), (e) => e.status === 403);
assert.equal(me().tripAt, null, "a prisoner does not linger on the road");
console.log("trip ping passed");
