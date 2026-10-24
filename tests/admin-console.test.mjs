// tests/admin-console.test.mjs
// Pure checks for the administrator console (no database): exact money, the account gate, presence, the CSV guard, same-origin, and the
// idempotent operation wrapper against a fake. The database behaviour (atomic money, Forbes, deletion) is covered by tests/pg/admin/ against real Postgres.
import assert from "node:assert/strict";
globalThis.db ??= {}; // lib/realtimeNotify.js opens the shared client when imported; these tests never touch a database
const { parseKobo, exactKobo, formatKobo, INT64_MAX, csv, runAdminOp, AdminError, reasonOf, jsonSafe, REQUEST_ID } = await import("../lib/adminCore.js");
const { gateOf } = await import("../lib/accountGate.js");
const { presenceOf } = await import("../lib/adminPresence.js");
const { sameOrigin, GET, POST, pick } = await import("../lib/adminRoutes.js");
const { requireAdmin } = await import("../lib/admin.js");
let n = 0;
const t = async (label, fn) => { try { await fn(); n++; console.log("OK  ", label); } catch (e) { console.log("FAIL", label, "->", e.message); process.exitCode = 1; } };
const throws = (fn, re) => assert.throws(fn, (e) => e instanceof AdminError && re.test(e.message));

await t("money is parsed exactly and has no cap of its own", () => {
  assert.equal(parseKobo("1,500,000"), 150_000_000n);
  assert.equal(parseKobo("₦ 2500.50"), 250_050n);
  assert.equal(parseKobo("90000000000000000"), 9_000_000_000_000_000_000n); // 90 quadrillion naira: far above the old ₦1,000,000 cap
  assert.equal(parseKobo("92233720368547758.07"), INT64_MAX);
});
await t("nothing is rounded or truncated, and the data type's limit is enforced", () => {
  throws(() => parseKobo("10.005"), /two decimal/);
  throws(() => parseKobo("92233720368547758.08"), /larger than the database/);
  throws(() => parseKobo("0"), /greater than zero/);
  throws(() => parseKobo("-5"), /number such as/);
  throws(() => parseKobo("1e9"), /number such as/);
  throws(() => parseKobo(2 ** 60), /as text/); // a JSON number that has already lost digits is refused, not guessed
  assert.equal(parseKobo("0", { allowZero: true }), 0n);
});
await t("exactKobo and formatKobo never lose a digit", () => {
  assert.equal(exactKobo("9223372036854775807"), INT64_MAX);
  throws(() => exactKobo("9223372036854775808"), /larger/);
  assert.equal(formatKobo(INT64_MAX), "₦92,233,720,368,547,758.07");
  assert.equal(formatKobo(-150n), "-₦1.50");
  assert.equal(JSON.stringify(jsonSafe({ a: INT64_MAX })), '{"a":"9223372036854775807"}');
});
await t("reasons must be written", () => { throws(() => reasonOf("ok"), /reason/); assert.equal(reasonOf("Refund for bug #12"), "Refund for bug #12"); });
await t("CSV cannot be turned into a spreadsheet formula", () => {
  const out = csv(["a", "b"], [["=HYPERLINK(\"x\")", "+1"], ['say "hi", ok', "-2"]]);
  assert.ok(out.includes("'=HYPERLINK") && out.includes("'+1") && out.includes("'-2") && out.includes('"say ""hi"", ok"'));
});
await t("account gate: active, suspended (timed and open ended), archived, expired", () => {
  const now = Date.now(), later = new Date(now + 3_600_000), past = new Date(now - 1);
  assert.equal(gateOf({ status: "ACTIVE" }, now).ok, true);
  assert.equal(gateOf({ status: "SUSPENDED", statusUntil: later }, now).code, "SUSPENDED");
  assert.equal(gateOf({ status: "SUSPENDED", statusUntil: null }, now).code, "SUSPENDED");
  assert.equal(gateOf({ status: "SUSPENDED", statusUntil: past }, now).ok, true); // a timed suspension lifts itself
  assert.equal(gateOf({ status: "DELETED" }, now).code, "DELETED");
  assert.equal(gateOf(null, now).ok, false);
});
await t("presence comes from evidence, not from 'recently active'", () => {
  const now = Date.now(), ago = (s) => new Date(now - s * 1000);
  assert.equal(presenceOf({ placeAt: ago(10) }, now).state, "ONLINE");
  assert.equal(presenceOf({ socket: true, lastActiveAt: ago(600) }, now).state, "IDLE");
  assert.equal(presenceOf({ socket: false, lastActiveAt: ago(300) }, now).state, "DISCONNECTED");
  assert.equal(presenceOf({ socket: false, lastActiveAt: ago(3600) }, now).state, "OFFLINE");
  assert.equal(presenceOf({}, now).state, "OFFLINE");
  assert.deepEqual(presenceOf({ socket: true, placeAt: ago(5) }, now).sources, ["socket", "heartbeat"]);
});
await t("same-origin guard", () => {
  assert.equal(sameOrigin("https://lifeinoau.com", "lifeinoau.com"), true);
  assert.equal(sameOrigin("https://evil.example", "lifeinoau.com"), false);
  assert.equal(sameOrigin(null, "lifeinoau.com"), false);
  assert.equal(sameOrigin("not a url", "lifeinoau.com"), false);
});
await t("route tables only answer what they list", () => {
  assert.equal(pick(GET, "overview") !== null, true);
  assert.equal(pick(GET, "__proto__"), null);
  assert.equal(pick(GET, "constructor"), null);
  assert.equal(pick(POST, "economy/money") !== null, true);
  assert.equal(pick(POST, "overview"), null); // reads cannot be called as writes
  assert.equal(pick(GET, "economy/money"), null); // and writes cannot be called as reads
});
await t("only administrators pass requireAdmin (everyone else sees a 404)", async () => {
  const db = { user: { findUnique: async ({ where }) => ({ u1: { id: "u1", role: "PLAYER" }, ad: { id: "ad", role: "ADMIN" } })[where.id] ?? null } };
  await assert.rejects(requireAdmin(db, "u1"), (e) => e.status === 404);
  await assert.rejects(requireAdmin(db, "zz"), (e) => e.status === 404);
  assert.equal((await requireAdmin(db, "ad")).role, "ADMIN");
});
await t("runAdminOp: change + audit together, a repeat is a duplicate, a failure is kept", async () => {
  const audit = [], applied = [];
  const mk = (failOn) => {
    const tx = { auditLog: { findFirst: async ({ where }) => audit.find((a) => a.requestId === where.requestId && a.status === "OK") ?? null, create: async ({ data }) => { audit.push(data); return data; } } };
    return { auditLog: tx.auditLog, $transaction: async (f) => { const snapshot = audit.length, ap = applied.length; try { return await f(tx); } catch (e) { audit.length = snapshot; applied.length = ap; throw e; } } };
  };
  const db = mk();
  const op = { action: "MONEY:credit", target: "c1", requestId: "req-0000001" };
  assert.deepEqual(await runAdminOp(db, "ad", op, async () => { applied.push(1); return { detail: { amount: "5" } }; }), { ok: true });
  assert.deepEqual(await runAdminOp(db, "ad", op, async () => { applied.push(2); }), { ok: true, duplicate: true });
  assert.equal(applied.length, 1);
  await assert.rejects(runAdminOp(db, "ad", { ...op, requestId: "req-0000002" }, async () => { applied.push(3); throw new AdminError("Player only has ₦5."); }), /only has/);
  assert.equal(applied.length, 1, "the failed change was rolled back");
  const failed = audit.find((a) => a.status === "FAILED");
  assert.ok(failed && /only has/.test(failed.error) && failed.requestId === "req-0000002", "the failure is recorded for investigation");
  await assert.rejects(runAdminOp(db, "ad", { ...op, requestId: "x" }, async () => {}), /requestId/);
  assert.ok(REQUEST_ID.test("req-0000001"));
});
console.log(`\n${n} checks passed`);
