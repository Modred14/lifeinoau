// tests/e2e/chatstore.e2e.mjs
// Drives the browser-side chat store (lib/chatStore.js) through a real Socket.IO connection to the real realtime server.
// Run with:   DATABASE_URL=... node tests/e2e/chatstore.e2e.mjs   (migrations must be applied; creates and removes players named es_*)
import { io as connect } from "socket.io-client";
import { createRealtime } from "../../realtime/server.js";
import { signChatPass, signBody } from "../../lib/chatAuth.js";
import { createChatStore } from "../../lib/chatStore.js";
import * as game from "../../lib/gameService.js";

const SECRET = "e2e-secret-e2e-secret-e2e-secret-0123456789";
const { PrismaClient } = await import(process.env.PRISMA_CLIENT ?? "@prisma/client");
let db;
if (process.env.PRISMA_ADAPTER) { const { PrismaPg } = await import(process.env.PRISMA_ADAPTER); db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }); }
else db = new PrismaClient();
let passed = 0, failed = 0;
const ok = (c, n, x = "") => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(15); } return false; };

const tag = "es_" + Math.random().toString(36).slice(2, 6);
for (const n of ["WORLD", "LANDLORDS", "PARENTS", "DSA", "TRANSPORT", "VENUES", "CLINICS", "BUSINESS", "MARKET"]) await db.account.upsert({ where: { systemName: n }, update: {}, create: { kind: "SYSTEM", systemName: n } });
await db.gameClock.upsert({ where: { id: 1 }, update: {}, create: { id: 1, startedAt: new Date() } });
const fac = await db.faculty.upsert({ where: { name: tag }, update: {}, create: { name: tag } });
const P = {};
for (const n of ["ann", "ben"]) {
  const u = await db.user.create({ data: { email: `${tag}_${n}@x.test`, passwordHash: "x", isAdult: true } });
  const c = await db.character.create({ data: { userId: u.id, name: `${tag}_${n}`, gender: "M", class: "MAPO", facultyId: fac.id, luck: 50, riskTolerance: 50, hostel: "Off-campus", lastTickWeek: 99999, account: { create: { kind: "PLAYER", balance: 9_000_000n } } } });
  P[n] = { userId: u.id, id: c.id, name: c.name };
}
let url;
const ping = (payload) => payload && fetch(url + "/internal", { method: "POST", body: JSON.stringify(payload), headers: { "x-sig": signBody(SECRET, JSON.stringify(payload)) } }); // what the API routes do in after()
const rt = createRealtime({ db, secret: SECRET, graceMs: 100, log: { error: () => {} } });
const port = await rt.listen(0, "127.0.0.1"); url = `http://127.0.0.1:${port}`;

// a browser: a store + a socket, wired the way lib/chat.js wires them
function browser(p) {
  let sock = null;
  const transport = { connected: () => !!sock?.connected, emit: (ev, d, ms = 8000) => new Promise((res, rej) => sock.timeout(ms).emit(ev, d, (e, r) => (e ? rej(e) : res(r)))) };
  const http = async (ev, d) => { // plain HTTP road, calling the same service functions the API routes call
    try {
      if (ev === "send") { const { notify, ...r } = await game.sendMessage(db, p.userId, d); await ping(notify); return r; }
      if (ev === "inbox") return await game.getMessages(db, p.userId);
      if (ev === "thread") return await game.getMessages(db, p.userId, d.with, d);
      if (ev === "read") { const { notify, ...r } = await game.readMessages(db, p.userId, d); await ping(notify); return r; }
      if (ev === "unread") return await game.unreadCount(db, p.userId);
    } catch (e) { return { failed: true, status: e.status ?? 500, error: e.message }; }
  };
  const store = createChatStore({ transport, http, sound: () => {}, onIncoming: (m) => store.incoming.push(m) });
  store.incoming = [];
  store.start(p.name);
  store.open_ = async () => {
    sock = connect(url, { auth: { token: await signChatPass(SECRET, p) }, transports: ["websocket"], reconnection: false });
    for (const ev of ["msg", "delivered", "read", "typing", "presence", "hello", "block"]) sock.on(ev, (d) => store["on" + ev[0].toUpperCase() + ev.slice(1)]?.(d));
    sock.on("read:me", (d) => store.onReadMe(d));
    sock.on("disconnect", () => store.onDisconnected());
    await new Promise((r) => sock.on("connect", r));
    store.onConnected();
  };
  store.drop = () => sock.close();
  return store;
}
try {
  const A = browser(P.ann), B = browser(P.ben);
  await A.open_(); await B.open_();
  await until(() => A.getState().inbox && B.getState().inbox);
  await A.openChat(P.ben.name); await B.watchInbox(true);

  // instant: the bubble is there the moment send() returns, before any network
  const m = A.send(P.ben.name, "hi ben");
  const th = () => A.getState().threads[P.ben.name.toLowerCase()];
  ok(th().msgs.at(-1).body === "hi ben" && th().msgs.at(-1).st === "sending" && m.id === null, "the bubble appears instantly, with a clock (sending)");
  ok(await until(() => th().msgs.at(-1).st === "sent" && th().msgs.at(-1).id > 0), "then gets an id (sent)");
  ok(await until(() => A.tickOf(th().msgs.at(-1), th()) === "delivered"), "then turns delivered (two ticks) because ben is online");
  const bt = () => B.getState().threads[P.ann.name.toLowerCase()];
  ok(await until(() => B.getState().inbox.find((c) => c.name === P.ann.name)?.unread === 1) && B.getState().unread === 1, "ben's inbox shows 1 unread and the badge total is 1");
  ok(B.incoming.length === 1 && B.incoming[0].body === "hi ben", "ben is notified of the new message");
  await B.openChat(P.ann.name);
  ok(await until(() => A.tickOf(th().msgs.at(-1), th()) === "read"), "ben opens the chat: ann's tick turns read (blue)");
  ok(B.getState().unread === 0, "ben's unread badge clears");

  // a reply arrives while the chat is open: read at once, no unread
  B.send(P.ann.name, "hey ann");
  ok(await until(() => th().msgs.at(-1).body === "hey ann" && !th().msgs.at(-1).mine), "ann receives the reply in her open chat");
  ok(await until(() => bt().peerRead >= 0 && B.tickOf(bt().msgs.at(-1), bt()) === "read"), "reply is read at once because ann has the chat open");
  ok(A.getState().inbox.find((c) => c.name === P.ben.name).unread === 0, "no unread for a chat that is open");

  // offline: the message waits, then is sent on reconnect (and not twice)
  A.drop(); await until(() => A.getState().link === "connecting");
  A.send(P.ben.name, "sent while offline");
  const off = th().msgs.at(-1);
  await sleep(100);
  ok(off.st === "sending" && off.id === null || off.st === "sent", "offline: message shows on screen immediately");
  await A.poll(); // the HTTP fallback road sends it
  ok(await until(() => off.st === "sent" && off.id > 0), "with the socket down, plain HTTP sends it");
  ok(await until(() => bt().msgs.some((x) => x.body === "sent while offline")), "ben still receives it live (the website tells the realtime server)" , JSON.stringify(bt().msgs.map(x=>x.body)));
  await A.open_();
  await sleep(150);
  ok(th().msgs.filter((x) => x.body === "sent while offline").length === 1, "after reconnecting there is exactly one copy");

  // money card: shown instantly, adopted when the server's copy arrives
  const cid = A.addMoney(P.ben.name, { naira: 2500, note: "lunch" });
  ok(th().msgs.at(-1).kind === 1 && th().msgs.at(-1).st === "sending", "money card appears instantly");
  const out = await game.sendMoney(db, P.ann.userId, { to: P.ben.name, amountNaira: 2500, memo: "lunch", requestId: cid });
  A.moneySent(P.ben.name, cid, out.msg);
  await ping(out.notify);
  ok(await until(() => bt().msgs.some((x) => x.kind === 1 && x.body === "2500\nlunch")), "ben gets the money card live");
  await sleep(100);
  ok(th().msgs.filter((x) => x.kind === 1).length === 1, "ann's screen has exactly one money card (no duplicate from the push)");

  // history reload keeps everything and adopts nothing twice
  const A2 = browser(P.ann); await A2.openChat(P.ben.name);
  const same = await until(() => A2.getState().threads[P.ben.name.toLowerCase()].msgs.length === th().msgs.length);
  ok(same, "a fresh browser loads the same conversation as the live screen shows");

  // read-only HTTP mode (no socket at all)
  const C = browser(P.ben);
  await C.openChat(P.ann.name);
  ok(C.getState().threads[P.ann.name.toLowerCase()].loaded && C.getState().threads[P.ann.name.toLowerCase()].msgs.length > 3, "works with no socket at all (HTTP only)");
  [A, B].forEach((b) => b.drop());
} catch (e) { failed++; console.log("FAIL  crashed:", e); }

await rt.close();
const ids = Object.values(P).map((p) => p.id);
const chats = await db.chat.findMany({ where: { OR: [{ aId: { in: ids } }, { bId: { in: ids } }] }, select: { id: true } });
await db.message.deleteMany({ where: { chatId: { in: chats.map((c) => c.id) } } });
await db.chat.deleteMany({ where: { id: { in: chats.map((c) => c.id) } } });
await db.presence.deleteMany({ where: { characterId: { in: ids } } });
await db.notification.deleteMany({ where: { characterId: { in: ids } } });
await db.actionLog.deleteMany({ where: { characterId: { in: ids } } });
await db.$executeRaw`ALTER TABLE "LedgerEntry" DISABLE TRIGGER ledger_no_update`;
const ac = await db.account.findMany({ where: { characterId: { in: ids } }, select: { id: true } });
await db.ledgerEntry.deleteMany({ where: { OR: [{ debitAccountId: { in: ac.map((a) => a.id) } }, { creditAccountId: { in: ac.map((a) => a.id) } }] } });
await db.$executeRaw`ALTER TABLE "LedgerEntry" ENABLE TRIGGER ledger_no_update`;
await db.account.deleteMany({ where: { characterId: { in: ids } } });
await db.character.deleteMany({ where: { id: { in: ids } } });
await db.user.deleteMany({ where: { id: { in: Object.values(P).map((p) => p.userId) } } });
await db.faculty.deleteMany({ where: { id: fac.id } });
await db.$disconnect();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
