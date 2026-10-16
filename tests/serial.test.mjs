// tests/serial.test.mjs
// Two helpers that stop rapid taps and repeated screen changes from racing or flooding the server.
import assert from "node:assert/strict";
import { createSerial, createStore } from "../lib/optimistic.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. createSerial: tasks on the same thing run one after another, in order, even when an earlier one is slow
{
  const q = createSerial(), log = [];
  const t = (name, ms) => q.run(async () => { log.push("start " + name); await wait(ms); log.push("end " + name); return name; });
  const r = await Promise.all([t("block", 30), t("unblock", 1), t("block2", 1)]);
  assert.deepEqual(r, ["block", "unblock", "block2"]);
  assert.deepEqual(log, ["start block", "end block", "start unblock", "end unblock", "start block2", "end block2"]);
  console.log("OK   serial: quick taps reach the server in order");
}

// 2. a failing task does not stop the next one, and the failure still reaches its own caller
{
  const q = createSerial(), seen = [];
  const a = q.run(async () => { throw new Error("boom"); }).catch((e) => seen.push(e.message));
  const b = q.run(async () => { seen.push("second ran"); return 2; });
  assert.equal(await b, 2); await a;
  assert.deepEqual(seen, ["boom", "second ran"]);
  console.log("OK   serial: a failure does not block the queue");
}

// 3. pending counts waiting + running, and returns to zero
{
  const q = createSerial();
  const p1 = q.run(() => wait(10)), p2 = q.run(() => wait(1));
  assert.equal(q.pending, 2);
  await Promise.all([p1, p2]); await wait(0);
  assert.equal(q.pending, 0);
  console.log("OK   serial: pending count");
}

// 4. refreshIfStale: a fresh copy is reused (no request), a stale one is refetched, and nothing is reused while a change is pending
{
  let hits = 0;
  const s = createStore(async () => { hits++; await wait(2); return { failed: false, status: 200, n: hits }; }, { settleMs: 5 });
  await s.refresh(); assert.equal(hits, 1);
  const r = await s.refreshIfStale(10_000);
  assert.equal(hits, 1, "fresh: no request"); assert.equal(r.n, 1, "gives back the copy it holds");
  await wait(15);
  await s.refreshIfStale(10);
  assert.equal(hits, 2, "stale: asked again");
  console.log("OK   refreshIfStale: skips the request when the copy is fresh");
}

// 5. refreshIfStale joins a request already in flight instead of starting another
{
  let hits = 0;
  const s = createStore(async () => { hits++; await wait(20); return { failed: false, status: 200 }; }, { settleMs: 5 });
  await Promise.all([s.refreshIfStale(1000), s.refreshIfStale(1000), s.refresh()]);
  assert.equal(hits, 1);
  console.log("OK   refreshIfStale: shares an in-flight request");
}

// 6. after reset (sign out) nothing old is reused
{
  let hits = 0;
  const s = createStore(async () => { hits++; return { failed: false, status: 200 }; }, { settleMs: 5 });
  await s.refresh(); s.reset();
  await s.refreshIfStale(60_000);
  assert.equal(hits, 2);
  console.log("OK   refreshIfStale: never reuses data across a reset");
}
