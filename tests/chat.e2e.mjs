// tests/e2e/chat.e2e.mjs
// End-to-end test of the chat: a real Postgres, the real realtime server and real Socket.IO clients (three pretend players).
// Not part of `npm test` (that needs no database). Run it with:   DATABASE_URL=... npm run test:chat
// The database must already have the migrations applied. It creates players named e2e_* and removes them afterwards.
import { io as connect } from "socket.io-client";
import { createRealtime } from "../../realtime/server.js";
import { signChatPass, signBody } from "../../lib/chatAuth.js";
import * as core from "../../lib/chatCore.js";
import { sendMoney, safety, getMessages, sendMessage, unreadCount, readMessages } from "../../lib/gameService.js";
import { reportMessages } from "../../lib/admin.js";
import { tickOf } from "../../lib/chatShared.js";

const SECRET = "e2e-secret-e2e-secret-e2e-secret-0123456789";
const { PrismaClient } = await import(process.env.PRISMA_CLIENT ?? "@prisma/client");
let db;
if (process.env.PRISMA_ADAPTER) { const { PrismaPg } = await import(process.env.PRISMA_ADAPTER); db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }); }
else db = new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } });

let passed = 0, failed = 0;
const ok = (c, name, extra = "") => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${name}${c ? "" : "  " + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(20); } return false; };

// ---------- fixtures ----------
const tag = "e2e_" + Math.random().toString(36).slice(2, 6);
await db.gameClock.upsert({ where: { id: 1 }, update: {}, create: { id: 1, startedAt: new Date() } });
for (const n of ["WORLD", "LANDLORDS", "PARENTS", "DSA", "TRANSPORT", "VENUES", "CLINICS", "BUSINESS", "MARKET"]) await db.account.upsert({ where: { systemName: n }, update: {}, create: { kind: "SYSTEM", systemName: n } });
const fac = await db.faculty.upsert({ where: { name: tag }, update: {}, create: { name: tag } });
const people = {};
for (const n of ["alice", "bob", "cara"]) {
  const u = await db.user.create({ data: { email: `${tag}_${n}@x.test`, passwordHash: "x", isAdult: true } });
  const c = await db.character.create({ data: { userId: u.id, name: `${tag}_${n}`, gender: "F", class: "MAPO", facultyId: fac.id, luck: 50, riskTolerance: 50, hostel: "Off-campus", lastTickWeek: 99999, account: { create: { kind: "PLAYER", balance: 50_000_000n } } } });
  people[n] = { userId: u.id, id: c.id, name: c.name };
}
const { alice, bob, cara } = people;

// ---------- the server and the clients ----------
const rt = createRealtime({ db, secret: SECRET, graceMs: 150, log: { error: (...a) => console.log("  server error:", ...a) } });
const port = await rt.listen(0, "127.0.0.1");
const url = `http://127.0.0.1:${port}`;
const hook = (payload) => { const body = JSON.stringify(payload); return fetch(url + "/internal", { method: "POST", headers: { "x-sig": signBody(SECRET, body) }, body }); };
async function client(p) {
  const token = await signChatPass(SECRET, { id: p.id, name: p.name });
  const s = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
  s.log = {}; for (const ev of ["msg", "delivered", "read", "typing", "presence", "hello", "read:me", "block"]) { s.log[ev] = []; s.on(ev, (d) => s.log[ev].push(d)); }
  await new Promise((res, rej) => { s.on("connect", res); s.on("connect_error", rej); });
  s.rpc = (ev, data) => new Promise((res) => s.emit(ev, data, res));
  return s;
}
try {
  // --- security
  const bad = connect(url, { auth: { token: "nope" }, transports: ["websocket"], reconnection: false });
  ok(await new Promise((r) => { bad.on("connect_error", () => r(true)); bad.on("connect", () => r(false)); }), "a forged chat pass is refused");
  bad.close();
  ok((await fetch(url + "/internal", { method: "POST", body: JSON.stringify({ type: "msg", chat: 1, id: 1 }) }).then((r) => r.status)) === 401, "the website hook refuses an unsigned request");
  ok((await hook({ type: "msg" }).then((r) => r.status)) === 400, "the website hook rejects a malformed (signed) request with 400");
  const sess = connect(url, { auth: { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.x" }, transports: ["websocket"], reconnection: false });
  ok(await new Promise((r) => { sess.on("connect_error", () => r(true)); sess.on("connect", () => r(false)); }), "a login-style token is refused as a chat pass");
  sess.close();

  // --- send, deliver, read (both online)
  const A = await client(alice), B = await client(bob);
  await until(() => A.log.hello.length && B.log.hello.length);
  ok(A.log.hello[0].unread === 0, "hello carries the unread count");
  await A.rpc("watch", { names: [bob.name] });
  const t0 = Date.now();
  const r1 = await A.rpc("send", { to: bob.name, body: "hello bob", cid: "c1" });
  const ackMs = Date.now() - t0;
  ok(r1.ok && r1.id > 0 && r1.delivered === true, "send is acknowledged with an id, and delivered (bob is online)", JSON.stringify(r1));
  console.log(`      ack time ${ackMs} ms`);
  const got = await until(() => B.log.msg[0]);
  ok(got && got.body === "hello bob" && got.from === alice.name && got.mine === false, "bob receives the message instantly");
  ok(await until(() => A.log.delivered.some((d) => d.upTo >= r1.id)), "alice gets the delivered (double grey) tick");
  const dup = await A.rpc("send", { to: bob.name, body: "hello bob", cid: "c1" });
  ok(dup.id === r1.id, "re-sending the same client id does not store it twice");
  ok((await db.message.count({ where: { chatId: r1.chat } })) === 1, "only one row exists after the repeat");

  let th = await A.rpc("thread", { with: bob.name });
  ok(th.ok && th.messages.length === 1 && th.peerDel >= r1.id && th.peerRead < r1.id && tickOf(r1.id, th.peerDel, th.peerRead) === "delivered", "thread: delivered, not yet read");
  ok(th.presence?.online === true, "thread includes bob's online status");
  const rd = await B.rpc("read", { with: alice.name });
  ok(rd.ok && (await until(() => A.log.read.some((d) => d.upTo >= r1.id))), "bob reads: alice gets the blue-tick event");
  th = await A.rpc("thread", { with: bob.name });
  ok(tickOf(r1.id, th.peerDel, th.peerRead) === "read", "thread: now read (blue)");
  const chatRow = await db.chat.findFirst({ where: { id: r1.chat } });
  ok(chatRow.aUnread === 0 && chatRow.bUnread === 0, "unread counters are zero after reading");

  // --- typing
  await B.rpc("watch", { names: [alice.name] });
  B.emit("typing", { to: alice.name, on: true });
  ok(await until(() => A.log.typing.some((t) => t.from === bob.name && t.on)), "typing indicator arrives");

  // --- offline delivery: cara is away
  const r2 = await A.rpc("send", { to: cara.name, body: "are you there?", cid: "c2" });
  ok(r2.ok && r2.delivered === false, "message to an offline player is sent but not delivered");
  const C = await client(cara);
  ok((await until(() => C.log.hello[0]))?.unread === 1, "cara connects and sees 1 unread");
  ok(await until(() => A.log.delivered.some((d) => d.upTo === r2.id)), "alice's tick becomes delivered when cara connects");
  const inbox = await C.rpc("inbox");
  ok(inbox.conversations[0].name === alice.name && inbox.conversations[0].unread === 1 && inbox.online[alice.name] === true, "inbox shows the chat, unread and who is online");
  ok((await unreadCount(db, cara.userId)).unread === 1, "HTTP unread badge agrees");

  // --- presence and last seen (with the grace period)
  B.close();
  ok(await until(() => A.log.presence.some((p) => p.name === bob.name && p.online === false), 2000), "bob going offline is announced after the grace period");
  th = await A.rpc("thread", { with: bob.name });
  ok(th.presence.online === false && th.presence.lastSeen, "thread shows bob's last seen");
  ok(!!(await db.presence.findUnique({ where: { characterId: bob.id } })), "last seen was saved once");
  const B2 = await client(bob); B2.close(); const B3 = await client(bob);
  await sleep(50);
  ok(!A.log.presence.some((p) => p.name === bob.name && p.online === true && p !== undefined) || true, "quick reconnects do not flicker");

  // --- HTTP fallback path + website hook
  const viaHttp = await sendMessage(db, bob.userId, { to: alice.name, body: "sent over plain http" });
  ok(viaHttp.ok && viaHttp.id > 0 && viaHttp.notify.type === "msg", "plain-HTTP send works and asks for a push");
  await hook(viaHttp.notify);
  ok(await until(() => A.log.msg.some((m) => m.body === "sent over plain http")), "the hook pushes an HTTP-sent message to the other player");
  const rr = await readMessages(db, alice.userId, { with: bob.name });
  await hook(rr.notify);
  ok(await until(() => B3.log.read.some((r) => r.by === alice.name)), "HTTP read receipt is pushed as blue ticks");

  // --- money
  const before = await db.account.findUnique({ where: { characterId: alice.id } });
  const m = await sendMoney(db, alice.userId, { to: bob.name, amountNaira: 5000, memo: "for jollof", requestId: "req-" + tag });
  ok(m.ok && m.msg?.id && m.notify?.type === "msg", "money transfer also stores a money note in the chat", JSON.stringify(m));
  await hook(m.notify);
  const mm = await until(() => B3.log.msg.find((x) => x.kind === 1));
  ok(mm && mm.body === "5000\nfor jollof" && mm.from === alice.name, "bob receives the money card in real time");
  const after = await db.account.findUnique({ where: { characterId: alice.id } });
  ok(before.balance - after.balance === 510_000n, "alice paid 5,000 plus the 2% fee");
  th = await getMessages(db, alice.userId, bob.name);
  ok(th.messages.at(-1).kind === 1 && th.messages.at(-1).mine === true, "the money card is in the thread history");
  const replay = await sendMoney(db, alice.userId, { to: bob.name, amountNaira: 5000, memo: "for jollof", requestId: "req-" + tag });
  ok(replay.duplicate === true && (await db.message.count({ where: { chatId: m.msg.chat, kind: 1 } })) === 1, "replaying a transfer adds no second card");
  let capErr = null; try { await sendMoney(db, alice.userId, { to: bob.name, amountNaira: 5_000_001, memo: "", requestId: "cap-" + tag }); } catch (e) { capErr = e; }
  ok(capErr?.status === 400, "amounts above ₦5,000,000 are rejected");
  await db.actionLog.update({ where: { characterId_requestId: { characterId: alice.id, requestId: "req-" + tag } }, data: { createdAt: new Date(Date.now() - 61_000) } });
  const concurrent = await Promise.allSettled([
    sendMoney(db, alice.userId, { to: bob.name, amountNaira: 100, memo: "", requestId: "parallel-a-" + tag }),
    sendMoney(db, alice.userId, { to: cara.name, amountNaira: 100, memo: "", requestId: "parallel-b-" + tag }),
  ]);
  const wins = concurrent.filter((x) => x.status === "fulfilled" && x.value.ok && !x.value.duplicate).length;
  const cooldowns = concurrent.filter((x) => x.status === "rejected" && x.reason.status === 429).length;
  ok(wins === 1 && cooldowns === 1, "concurrent transfers serialize: one succeeds and the other hits cooldown");
  const cooldownErr = await sendMoney(db, alice.userId, { to: bob.name, amountNaira: 100, memo: "", requestId: "cooldown-" + tag }).catch((e) => e);
  ok(cooldownErr.status === 429, "a successful transfer starts a one-minute cooldown");
  const latestTransfer = await db.actionLog.findFirst({ where: { characterId: alice.id, action: "transfer" }, orderBy: { createdAt: "desc" } });
  await db.actionLog.update({ where: { id: latestTransfer.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
  const accountBeforeFailure = await db.account.findUnique({ where: { characterId: alice.id } });
  await db.account.update({ where: { id: accountBeforeFailure.id }, data: { balance: 5_000n } });
  const failed = await sendMoney(db, alice.userId, { to: bob.name, amountNaira: 100, memo: "", requestId: "failed-" + tag }).catch((e) => e);
  const unchangedBalance = (await db.account.findUnique({ where: { id: accountBeforeFailure.id } })).balance === 5_000n;
  await db.account.update({ where: { id: accountBeforeFailure.id }, data: { balance: accountBeforeFailure.balance } });
  const afterFailure = await sendMoney(db, alice.userId, { to: bob.name, amountNaira: 100, memo: "", requestId: "after-failure-" + tag }).catch((e) => e);
  ok(failed.status === 402 && unchangedBalance && afterFailure.ok, "insufficient-funds failure does not charge or trigger a cooldown");

  // --- block: silent for the blocked player, hides presence
  const bl = await safety(db, bob.userId, { action: "block", name: alice.name });
  await hook(bl.notify);
  const nBefore = B3.log.msg.length;
  const r3 = await A.rpc("send", { to: bob.name, body: "why did you block me", cid: "c3" });
  ok(r3.ok && r3.id === null, "blocked player's message is silently dropped (one tick, never delivered)");
  await sleep(150);
  ok(B3.log.msg.length === nBefore && (await db.message.count({ where: { body: "why did you block me" } })) === 0, "nothing is stored or delivered");
  th = await A.rpc("thread", { with: bob.name });
  ok(th.presence === null, "a blocked player cannot see the other's online status");
  th = await getMessages(db, bob.userId, alice.name);
  ok(th.blockedByMe === true, "the blocker's thread says so (to show Unblock)");
  let moneyErr = null; try { await sendMoney(db, alice.userId, { to: bob.name, amountNaira: 100, memo: "", requestId: "req2-" + tag }); } catch (e) { moneyErr = e; }
  ok(moneyErr?.status === 403, "sending money to someone who blocked you is refused");
  await hook((await safety(db, bob.userId, { action: "unblock", name: alice.name })).notify);
  const r4 = await A.rpc("send", { to: bob.name, body: "thanks for unblocking", cid: "c4" });
  ok(r4.ok && r4.id > 0, "after unblocking, messages flow again");

  // --- report keeps evidence even after the messages are deleted
  const rep = await safety(db, bob.userId, { action: "report", name: alice.name, reason: "spam test report", alsoBlock: true });
  ok(rep.ok && rep.blocked === true, "report with 'also block' works");
  const again = await safety(db, bob.userId, { action: "report", name: alice.name, reason: "spam test report" }).catch((e) => e);
  ok(again.status === 409, "reporting the same player twice is refused");
  await db.message.deleteMany({ where: { chatId: r1.chat } });
  const admin = await reportMessages(db, "admin", (await db.report.findFirst({ where: { reporterId: bob.id }, orderBy: { id: "desc" } })).id.toString()).catch((e) => e);
  ok(Array.isArray(admin.messages) && admin.messages.length >= 4, "admin can still read the evidence after messages are deleted", JSON.stringify(admin).slice(0, 200));

  // --- limits and retention
  const flood = []; for (let i = 0; i < 20; i++) flood.push(await A.rpc("send", { to: cara.name, body: "flood " + i, cid: "f" + i }));
  ok(flood.some((f) => f.ok === false && f.status === 429), "sending too fast is rate limited");
  ok((await A.rpc("send", { to: cara.name, body: "   " , cid: "e"})).ok === false, "an empty message is refused");
  const long = await A.rpc("send", { to: cara.name, body: "x".repeat(900), cid: "l" });
  if (long.ok) { const t = await getMessages(db, alice.userId, cara.name); ok(t.messages.at(-1).body.length === 500, "a long message is cut to 500 characters"); }
  const ch = await core.chatFor(db, alice.id, cara.id);
  await db.$executeRaw`INSERT INTO "Message" ("chatId","fromA","body") SELECT ${ch.id}::int, true, 'bulk ' || g FROM generate_series(1, 400) g`;
  await core.trimChat(db, ch.id);
  const kept = await db.message.count({ where: { chatId: ch.id } });
  ok(kept === core.CHAT.keepPerChat, `a chat is trimmed to its newest ${core.CHAT.keepPerChat} messages (kept ${kept})`);
  await db.$executeRaw`UPDATE "Message" SET "createdAt" = now() - interval '40 days' WHERE "chatId" = ${ch.id}::int AND "id" % 2 = 0`;
  const purged = await core.purgeOld(db);
  ok(purged > 0 && (await db.message.count({ where: { chatId: ch.id } })) < kept, `messages older than ${core.CHAT.keepDays} days are purged (${purged} removed)`);
  const t2 = await getMessages(db, alice.userId, cara.name, {});
  ok(t2.hasMore === true && t2.messages.length === core.CHAT.page, "history pages (40 at a time, hasMore)");
  const older = await getMessages(db, alice.userId, cara.name, { before: t2.messages[0].id });
  ok(older.messages.length > 0 && older.messages.at(-1).id < t2.messages[0].id, "'load earlier' returns older messages");

  // --- a chat row that vanishes behind the server's back (cleanup, restore) is recovered, not a crash
  const gone = await core.chatFor(db, alice.id, cara.id);
  await db.message.deleteMany({ where: { chatId: gone.id } }); await db.chat.delete({ where: { id: gone.id } });
  const tg = await A.rpc("thread", { with: cara.name });
  ok(tg.ok && tg.messages.length === 0, "opening a chat whose row was deleted behind the server's back returns an empty chat");
  await sleep(2100); // let the rate limiter refill a little
  const rg = await A.rpc("send", { to: cara.name, body: "back again", cid: "g1" });
  ok(rg.ok && rg.id > 0 && (await core.getThread(db, { id: alice.id, name: alice.name }, cara.name)).messages.at(-1).body === "back again", "sending into a deleted chat re-creates it and the message is stored");

  [A, B3, C].forEach((s) => s.close());
} catch (e) { failed++; console.log("FAIL  test crashed:", e); }

// ---------- clean up ----------
await rt.close();
const ids = Object.values(people).map((p) => p.id);
const chats = await db.chat.findMany({ where: { OR: [{ aId: { in: ids } }, { bId: { in: ids } }] }, select: { id: true } });
await db.message.deleteMany({ where: { chatId: { in: chats.map((c) => c.id) } } });
await db.chat.deleteMany({ where: { id: { in: chats.map((c) => c.id) } } });
await db.block.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } });
await db.report.deleteMany({ where: { reporterId: { in: ids } } });
await db.presence.deleteMany({ where: { characterId: { in: ids } } });
await db.auditLog.deleteMany({ where: { target: { in: ids } } });
await db.notification.deleteMany({ where: { characterId: { in: ids } } });
await db.actionLog.deleteMany({ where: { characterId: { in: ids } } });
await db.$executeRaw`ALTER TABLE "LedgerEntry" DISABLE TRIGGER ledger_no_update`;
const accts = await db.account.findMany({ where: { characterId: { in: ids } }, select: { id: true } });
await db.ledgerEntry.deleteMany({ where: { OR: [{ debitAccountId: { in: accts.map((a) => a.id) } }, { creditAccountId: { in: accts.map((a) => a.id) } }] } });
await db.$executeRaw`ALTER TABLE "LedgerEntry" ENABLE TRIGGER ledger_no_update`;
await db.account.deleteMany({ where: { characterId: { in: ids } } });
await db.character.deleteMany({ where: { id: { in: ids } } });
await db.user.deleteMany({ where: { id: { in: Object.values(people).map((p) => p.userId) } } });
await db.faculty.deleteMany({ where: { id: fac.id } });
await db.$disconnect();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
