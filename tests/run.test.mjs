// tests/run.test.mjs
// run(): the one way screens make a change. Instant for ordinary actions; for money it shows "pending" and only says "done" after the server has.
import assert from "node:assert/strict";
import { register } from "node:module";
register("./_alias-loader.mjs", import.meta.url);
// a stand-in browser, just enough for the toast list and sound engine to load
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
const store0 = new Map();
globalThis.localStorage = { getItem: (k) => store0.get(k) ?? null, setItem: (k, v) => store0.set(k, String(v)), removeItem: (k) => store0.delete(k) };
const { run, cash } = await import("../lib/gameStore.js");
const { toast, getSnapshot } = await import("../lib/toast.js");
const { createStore } = await import("../lib/optimistic.js");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shown = () => getSnapshot().filter((t) => t.state !== "out").map((t) => `${t.type}:${t.message}`);
const clear = () => getSnapshot().forEach((t) => toast.dismiss(t.id));
let server;
const wallet = () => createStore(async () => ({ failed: false, status: 200, ...server }), { settleMs: 5 });
const okRes = (o = {}) => ({ failed: false, status: 200, ok: true, ...o });

// 1. an ordinary action: the success message and the change are there immediately
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  const p = run({ key: "t1", ok: "Rested.", request: async () => { await wait(30); return okRes(); }, effects: [{ store: s, patch: cash(-100) }] });
  assert.deepEqual(shown(), ["success:Rested."], "message at once");
  assert.equal(s.get().balanceKobo, "900", "change at once");
  await p;
  console.log("OK   ordinary action: shown at once");
}

// 2. money: a spinner at once, the SAME toast becomes "done" only after the server says yes
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  const p = run({ key: "t2", sensitive: true, pending: "Paying…", ok: "Paid.", sound: "coin", request: async () => { await wait(30); return okRes(); }, effects: [{ store: s, patch: cash(-100) }] });
  assert.deepEqual(shown(), ["pending:Paying…"], "no 'Paid' before the server answers");
  assert.equal(s.get().balanceKobo, "900", "balance shows the pending change");
  await p;
  assert.deepEqual(shown(), ["success:Paid."], "replaced in place, not stacked");
  console.log("OK   money: pending first, success only after confirmation");
}

// 3. money refused: the spinner goes, the balance comes back, an error shows, and no 'done' message ever appeared
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  const seen = [];
  const un = (await import("../lib/toast.js")).subscribe(() => seen.push(...shown()));
  await run({ key: "t3", sensitive: true, pending: "Paying…", ok: "Paid.", request: async () => ({ failed: true, status: 400, error: "Not enough cash." }), effects: [{ store: s, patch: cash(-100) }] });
  un();
  assert.equal(s.get().balanceKobo, "1000", "rolled back");
  assert.deepEqual(shown(), ["error:Not enough cash."]);
  assert.ok(!seen.some((x) => x.includes("Paid.")), "success was never claimed");
  console.log("OK   money refused: rolled back, never claimed success");
}

// 4. money, no answer at all: rolled back, and the player is told it may still have happened
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  await run({ key: "t4", sensitive: true, pending: "Paying…", ok: "Paid.", request: async () => ({ failed: true, status: 0, unknown: true, timedOut: true }), effects: [{ store: s, patch: cash(-100) }] });
  assert.equal(s.get().balanceKobo, "1000");
  assert.ok(shown()[0].startsWith("error:We couldn't confirm"), shown()[0]);
  console.log("OK   money, no answer: rolled back with an honest message");
}

// 5. a retry that found the first try already done: success is shown, and the details callbacks (which need data a replay lacks) are skipped
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  let thenRan = false;
  await run({ key: "t5", sensitive: true, pending: "Paying…", ok: "Paid.", then: () => { thenRan = true; }, request: async () => okRes({ duplicate: true, replayed: true }), effects: [{ store: s, patch: cash(-100) }] });
  assert.deepEqual(shown(), ["success:Paid."]);
  assert.equal(thenRan, false);
  console.log("OK   replayed request counts as success");
}

// 6. a plain duplicate (already done earlier) is said so, and nothing claims a fresh success
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  await run({ key: "t6", sensitive: true, pending: "Paying…", ok: "Paid.", request: async () => okRes({ duplicate: true }), effects: [{ store: s, patch: cash(-100) }] });
  assert.deepEqual(shown(), ["info:Already done."]);
  console.log("OK   plain duplicate: 'Already done'");
}

// 7. rapid double tap with a key: the second is ignored, the first goes through once
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  let sent = 0;
  const go = () => run({ key: "t7", ok: "Done.", request: async () => { sent++; await wait(20); return okRes(); }, effects: [{ store: s, patch: cash(-100) }] });
  const [a, b] = await Promise.all([go(), go()]);
  assert.equal(sent, 1); assert.equal(b.skipped, true); assert.equal(a.failed, false);
  assert.equal(s.get().balanceKobo, "900", "charged once on screen");
  console.log("OK   double tap sends one request");
}

// 8. a cancelled request says nothing
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  await run({ key: "t8", ok: "Done.", request: async () => ({ failed: true, status: 0, aborted: true }), effects: [{ store: s, patch: cash(-100) }] });
  assert.equal(s.get().balanceKobo, "1000");
  assert.deepEqual(shown(), [], "the optimistic 'Done.' is taken back and no error is shown");
  console.log("OK   cancelled request is silent");
}

// 9. a timed-out ordinary action rolls back and says why
{
  server = { balanceKobo: "1000" }; clear();
  const s = wallet(); await s.refresh();
  await run({ key: "t9", ok: "Done.", request: async () => ({ failed: true, status: 0, timedOut: true, error: "This is taking too long. Check your connection and try again." }), effects: [{ store: s, patch: cash(-100) }] });
  assert.equal(s.get().balanceKobo, "1000");
  assert.deepEqual(shown(), ["error:This is taking too long. Check your connection and try again."]);
  console.log("OK   timeout: rolled back with a message");
}
process.exit(0);
