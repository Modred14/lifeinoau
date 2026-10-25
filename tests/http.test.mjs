// tests/http.test.mjs
// The browser's request layer: never hangs, can be cancelled, fails fast offline, and a repeated money request can never be charged twice.
import assert from "node:assert/strict";
import { createCaller, safeError, NO_NET, SLOW } from "../lib/http.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
// a fetch that answers from a script; an entry can be a function (to hang, throw or inspect the request)
const script = (...steps) => {
  const calls = [];
  const f = async (path, init) => {
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null, method: init.method });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return typeof step === "function" ? step(init) : step;
  };
  f.calls = calls;
  return f;
};
const hang = (init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
const mk = (fetchImpl, o = {}) => createCaller({ fetchImpl, sleep: () => wait(1), retryDelay: 1, getMs: 40, postMs: 40, ...o });

// 1. a normal answer comes back with status and failed flags
{
  const f = script(reply(200, { hello: "x" }));
  const r = await mk(f).call("/api/a");
  assert.deepEqual([r.hello, r.status, r.failed], ["x", 200, false]);
  assert.equal(f.calls[0].method, "GET");
  console.log("OK   a read returns the answer");
}

// 2. a server refusal keeps its safe message; a crash message is hidden
{
  assert.equal((await mk(script(reply(400, { error: "Not enough cash." }))).call("/x", { a: 1 })).error, "Not enough cash.");
  const r = await mk(script(reply(500, { error: "Invalid `prisma.user.findMany()` invocation" }))).call("/x", { a: 1 });
  assert.equal(r.error, "Something went wrong. Please try again.");
  assert.equal(safeError(200, undefined), undefined);
  console.log("OK   refusals show safe messages only");
}

// 3. a request that never answers times out instead of hanging for ever
{
  const t0 = Date.now();
  const r = await mk(script(hang)).call("/slow");
  assert.equal(r.failed, true); assert.equal(r.timedOut, true); assert.equal(r.error, SLOW);
  assert.ok(Date.now() - t0 < 500, "gave up quickly (test timeout 40ms)");
  console.log("OK   a hung request times out");
}

// 4. a caller can cancel: no error is reported, and a request cancelled before it starts never leaves
{
  const ac = new AbortController();
  const p = mk(script(hang), { getMs: 5000 }).call("/s", undefined, { signal: ac.signal });
  setTimeout(() => ac.abort(), 5);
  const r = await p;
  assert.equal(r.aborted, true); assert.equal(r.failed, true);
  const f = script(reply(200, {})), ac2 = new AbortController(); ac2.abort();
  assert.equal((await mk(f).call("/s", undefined, { signal: ac2.signal })).aborted, true);
  assert.equal(f.calls.length, 0, "never sent");
  console.log("OK   cancelling is silent and stops the request");
}

// 5. offline: fails at once, nothing is sent
{
  const f = script(reply(200, {}));
  const r = await mk(f, { online: () => false }).call("/api/x", { requestId: "r1" });
  assert.equal(r.offline, true); assert.equal(r.error, NO_NET); assert.equal(f.calls.length, 0);
  console.log("OK   offline fails fast without sending");
}

// 6. a lost answer on a request with a requestId is retried with the SAME id, and the user just sees success
{
  const f = script(() => { throw new Error("net"); }, reply(200, { ok: true, amount: 5 }));
  const r = await mk(f).call("/api/pay", { to: "a", requestId: "id-1" });
  assert.equal(r.failed, false); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.requestId, "id-1"); assert.equal(f.calls[1].body.requestId, "id-1");
  console.log("OK   a lost answer is retried with the same id");
}

// 7. ...and if the first try had actually gone through, the repeat comes back "duplicate": reported as replayed, never charged again
{
  const f = script(hang, reply(200, { ok: true, duplicate: true }));
  const r = await mk(f).call("/api/pay", { to: "a", requestId: "id-2" });
  assert.equal(r.duplicate, true); assert.equal(r.replayed, true);
  const plain = await mk(script(reply(200, { ok: true, duplicate: true }))).call("/api/pay", { to: "a", requestId: "id-9" });
  assert.equal(plain.replayed, undefined, "a duplicate on the first try is not a replay");
  console.log("OK   a retry that finds the first try done is flagged replayed");
}

// 8. requests WITHOUT a requestId are never retried (they could change something twice)
{
  const f = script(() => { throw new Error("net"); }, reply(200, { ok: true }));
  const r = await mk(f).call("/api/other", { thing: 1 });
  assert.equal(r.failed, true); assert.equal(f.calls.length, 1);
  console.log("OK   no retry without an idempotency id");
}

// 9. reads are not retried either (the screen retries them itself)
{
  const f = script(() => { throw new Error("net"); }, reply(200, {}));
  assert.equal((await mk(f).call("/api/r")).failed, true); assert.equal(f.calls.length, 1);
  console.log("OK   reads are not retried");
}

// 10. server error on a keyed request: retried once; a refusal (4xx) is never retried
{
  const f = script(reply(503, { error: "busy" }), reply(200, { ok: true }));
  assert.equal((await mk(f).call("/api/p", { requestId: "a" })).failed, false); assert.equal(f.calls.length, 2);
  const g = script(reply(400, { error: "no" }), reply(200, { ok: true }));
  assert.equal((await mk(g).call("/api/p", { requestId: "b" })).status, 400); assert.equal(g.calls.length, 1);
  console.log("OK   5xx retried once, 4xx never");
}

// 11. UNKNOWN outcome: no answer at all. The id is remembered, so tapping the same thing again cannot pay twice
{
  const down = () => { throw new Error("net"); };
  const f = script(down, down, reply(200, { ok: true, duplicate: true }));
  const c = mk(f);
  const first = await c.call("/api/pay", { to: "ada", amount: 500, requestId: "orig" });
  assert.equal(first.failed, true); assert.equal(first.unknown, true); assert.equal(f.calls.length, 2);
  // the player taps again: the screen made a brand new id, but the same request goes out under the old one
  const again = await c.call("/api/pay", { amount: 500, to: "ada", requestId: "brand-new" }); // key order differs on purpose
  assert.equal(f.calls[2].body.requestId, "orig", "the remembered id is reused");
  assert.equal(again.replayed, true, "and the server's 'already done' is understood as success");
  // a different request is NOT affected
  const g = script(reply(200, { ok: true }));
  const c2 = createCaller({ fetchImpl: async (p, i) => { g.calls; return g(p, i); }, sleep: () => wait(1), retryDelay: 1 });
  await c2.call("/api/pay", { to: "bola", amount: 500, requestId: "z" });
  assert.equal(g.calls[0].body.requestId, "z");
  console.log("OK   an unknown outcome is re-sent under the same id");
}

// 12. a real answer forgets the unknown id; the memory also expires
{
  const down = () => { throw new Error("net"); };
  let t = 0;
  const f = script(down, down, reply(200, { ok: true }), down, down, reply(200, { ok: true }));
  const c = mk(f, { now: () => t, memoryMs: 1000 });
  await c.call("/p", { x: 1, requestId: "A" });
  await c.call("/p", { x: 1, requestId: "B" }); // answered: forgotten
  assert.equal(c._unknown.size, 0);
  await c.call("/p", { y: 2, requestId: "C" }); // unknown again
  assert.equal(c._unknown.size, 1);
  t = 5000; // long after
  await c.call("/p", { y: 2, requestId: "D" });
  assert.equal(f.calls[5].body.requestId, "D", "an old unknown id is not reused");
  console.log("OK   unknown ids are forgotten after an answer or after two minutes");
}

// 13. login / signup / logout tell the app to forget cached screens
{
  let reset = 0;
  const c = mk(script(reply(200, { ok: true })), { onAuthChange: () => reset++ });
  await c.call("/api/login", { email: "a" }); await c.call("/api/other", { b: 1 });
  assert.equal(reset, 1);
  console.log("OK   signing in or out resets cached screens");
}

// 5. identical reads in flight share ONE request; each caller still gets its own copy
{
  let n = 0; const f = script(async () => { n++; await wait(10); return reply(200, { v: n }); });
  const c = mk(f);
  const [a, b, d] = await Promise.all([c.call("/api/state"), c.call("/api/state"), c.call("/api/other")]);
  assert.equal(f.calls.filter((x) => x.path === "/api/state").length, 1, "two identical reads = one request");
  assert.equal(f.calls.length, 2, "a different path is its own request");
  assert.notEqual(a, b); a.mutated = true; assert.equal(b.mutated, undefined, "callers do not share one object");
  assert.equal((await c.call("/api/state")).status, 200); assert.equal(f.calls.length, 3, "once finished, the next read asks again");
  console.log("OK   identical reads in flight share one request");
}

// 6. a read with its own signal/timeout is never shared, and a change starts a fresh generation of reads
{
  const f = script(async () => { await wait(10); return reply(200, { ok: 1 }); });
  const c = mk(f), ac = new AbortController();
  await Promise.all([c.call("/r", undefined, { signal: ac.signal }), c.call("/r", undefined, { signal: ac.signal })]);
  assert.equal(f.calls.length, 2, "cancellable reads are separate requests");
  const before = f.calls.length;
  const first = c.call("/s"); const write = c.call("/w", { x: 1 }); const second = c.call("/s");
  await Promise.all([first, write, second]);
  assert.equal(f.calls.length - before, 3, "a read asked after a change does not join the read from before it");
  console.log("OK   cancellable reads are not shared; reads after a write start fresh");
}
