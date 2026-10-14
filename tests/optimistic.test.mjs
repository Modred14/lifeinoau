// tests/optimistic.test.mjs
// The instant-feedback store: show first, undo only that change if the server refuses, never let a stale answer win.
import assert from "node:assert/strict";
import { createStore, act, resetAll } from "../lib/optimistic.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (o) => ({ failed: false, status: 200, ...o });
const add = (n) => (s) => ({ ...s, n: s.n + n });
let server = { n: 10 };
const mk = (delay = 5) => createStore(async () => { const snap = { ...server }; await wait(delay); return ok(snap); }, { settleMs: 5 });

// 1. a change shows at once and a refusal takes it back
{
  server = { n: 10 };
  const s = mk(); await s.refresh();
  const p = act({ request: async () => { await wait(20); return { failed: true, status: 400, error: "no" }; }, effects: [{ store: s, patch: add(5) }] });
  assert.equal(s.get().n, 15, "shown before the server answered");
  await p;
  assert.equal(s.get().n, 10, "taken back after the refusal");
  console.log("OK   shows instantly, rolls back on refusal");
}

// 2. two changes in flight: the first fails, the second must survive
{
  server = { n: 10 };
  const s = mk(); await s.refresh();
  const a = act({ request: async () => { await wait(30); return { failed: true, status: 409 }; }, effects: [{ store: s, patch: add(100) }] });
  const b = act({ request: async () => { await wait(10); server = { n: 12 }; return ok({}); }, effects: [{ store: s, patch: add(2) }] });
  assert.equal(s.get().n, 112);
  await Promise.all([a, b]);
  assert.equal(s.get().n, 12, "only the failed change was undone");
  console.log("OK   a failed change does not undo a newer one");
}

// 3. a success stays on screen, then the server's truth replaces it (no double counting)
{
  server = { n: 10 };
  const s = mk(); await s.refresh();
  await act({ request: async () => { server = { n: 15 }; return ok({}); }, effects: [{ store: s, patch: add(5) }] });
  assert.equal(s.get().n, 15, "confirmed change stays visible until the truth arrives");
  await wait(150); // scheduled refresh runs
  assert.equal(s.get().n, 15, "after the refresh it is still 15, not 20");
  console.log("OK   confirmed change is not counted twice");
}

// 4. a refresh that travelled while a change was in flight must not overwrite it
{
  server = { n: 10 };
  const s = mk(30); await s.refresh();
  const p = act({ request: async () => { await wait(60); server = { n: 20 }; return ok({}); }, effects: [{ store: s, patch: add(10) }] });
  const r = s.refresh(); // starts now, while the change is pending, and would carry the OLD value
  await r;
  assert.equal(s.get().n, 20, "stale answer was ignored; the screen still shows the change");
  await p; await wait(200);
  assert.equal(s.get().n, 20);
  console.log("OK   stale server answers never undo a pending change");
}

// 5. settle: the server's answer is the whole truth
{
  const s = mk(); await s.refresh();
  await act({ request: async () => ok({ items: 3 }), effects: [{ store: s, patch: add(1), settle: () => ok({ n: 99 }) }] });
  assert.equal(s.get().n, 99);
  console.log("OK   settle takes the server's answer directly");
}

// 6. logging out / in as someone else forgets everything, even an answer still travelling
{
  server = { n: 1 };
  const s = mk(40); const p = s.refresh(); resetAll(); await p;
  assert.equal(s.get(), null, "a late answer for the previous player is dropped");
  console.log("OK   reset drops cached and in-flight data");
}

// 7. 401 clears the store
{
  const s = createStore(async () => ({ failed: true, status: 401 })); await s.refresh();
  assert.equal(s.get(), null);
  console.log("OK   401 clears the store");
}
