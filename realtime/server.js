// realtime/server.js
// The chat's realtime server (Socket.IO). It is a small, separate Node program because the website runs on serverless hosting
// (Vercel), which cannot keep a connection open. Run it on any Node host: Render, Railway, Fly.io, or a VPS (see realtime/README.md).
//
// What it does: carries messages, ticks, typing and online status between players over WebSockets, and writes to Postgres
// through lib/chatCore.js (the same code the website's plain-HTTP fallback uses).
// What it deliberately does NOT do: store anything for "online" (that lives in memory) or poll the database.
//
//   node realtime/server.js           needs DATABASE_URL, SESSION_SECRET (same values as the website), APP_ORIGIN, PORT
import http from "node:http";
import { pathToFileURL } from "node:url";
import { Server } from "socket.io";
import { verifyChatPass, bodyIsSigned } from "../lib/chatAuth.js";
import * as core from "../lib/chatCore.js";
import { gateOf } from "../lib/accountGate.js";
import { sendChatPush } from "../lib/chatPush.js";
import { marketFor, snapshot as marketSnapshot, refreshHoldingValues } from "../lib/marketLive.js";

const GRACE_MS = 4000; // a reload or a network blip reconnects within this time, so nobody flickers to "offline"
const SEEN_WRITE_MS = 60_000; // "last seen" is written to the database at most once a minute per player
const MARKET_ROOM = "market"; // sockets that have the Invest app open: they get one small price message a second
const MARKET_VALUE_EVERY_MS = 300_000; // stored holding values (net worth, Forbes) are re-priced every 5 minutes, in one statement

export function createRealtime({ db, secret, origins = [], log = console, graceMs = GRACE_MS, market = null }) {
  if (!secret) throw new Error("SESSION_SECRET is required");
  const getMarket = () => (market ??= marketFor(db)); // created on first use: a chat-only deployment never touches the market tables
  const allow = (origin) => !origins.length || !origin || origins.includes(origin);

  // ---------- who is online (memory only) ----------
  const live = new Map(); // character id -> number of open sockets (a player may have the game open on two devices)
  const lastSeen = new Map(); // character id -> Date of their last disconnect
  const lastSeenWritten = new Map();
  const offlineTimers = new Map();
  const blocks = new Map(); // character id -> Promise<{ byMe, byThem }> while that player is connected
  const isOnline = (id) => (live.get(id) ?? 0) > 0;
  const blocksOf = (id) => { let p = blocks.get(id); if (!p) { p = core.blockSets(db, id); blocks.set(id, p); p.catch(() => blocks.delete(id)); } return p; };
  const hidden = (b, id) => b.byMe.has(id) || b.byThem.has(id);

  // messages from one player are handled one after another, so they are stored (and numbered) in the order they were sent
  const chains = new Map();
  const serial = (id, fn) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(fn, fn).finally(() => { if (chains.get(id) === next) chains.delete(id); });
    chains.set(id, next);
    return next;
  };
  // a message that is sent again after a bad connection (same client id) is answered, not stored twice
  const recent = new Map();
  const sweep = setInterval(() => { const old = Date.now() - 600_000; for (const [k, v] of recent) if (v.t < old) recent.delete(k); }, 60_000);
  sweep.unref();

  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && (path === "/health" || path === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, online: live.size }));
    }
    if (req.method === "POST" && path === "/internal") return internal(req, res);
    res.writeHead(404); res.end();
  });

  const io = new Server(server, {
    serveClient: false,
    maxHttpBufferSize: 20_000, // a message is at most 500 characters
    pingInterval: 20_000,
    pingTimeout: 20_000,
    cors: { origin: origins.length ? origins : true },
    allowRequest: (req, cb) => cb(null, allow(req.headers.origin)),
  });

  // A chat pass lasts two hours, so a suspended or closed account is also refused here (one small query per connection, not per message).
  // If that query itself fails the player is let in: the website's own routes still refuse them.
  async function accountBlocked(characterId) {
    try {
      const rows = await db.$queryRaw`SELECT u."status", u."statusUntil" FROM "Character" c JOIN "User" u ON u."id" = c."userId" WHERE c."id" = ${characterId}`;
      return rows?.[0] ? !gateOf(rows[0]).ok : false;
    } catch { return false; }
  }
  io.use(async (socket, next) => {
    try { socket.data.me = await verifyChatPass(secret, socket.handshake.auth?.token); } catch { return next(new Error("auth")); }
    next(await accountBlocked(socket.data.me.id) ? new Error("auth") : undefined);
  });

  const room = (id) => "u:" + id; // everything addressed to one player (all their devices)
  const watchers = (id) => "p:" + id; // everyone who wants to see this player's online status

  io.on("connection", (socket) => {
    const me = socket.data.me;
    socket.data.watching = new Set();
    const typingAt = new Map();
    const fail = (ack, e) => {
      if (!(e instanceof core.ChatError)) log.error?.("[realtime]", e);
      ack?.({ ok: false, error: e instanceof core.ChatError ? e.message : "Something went wrong. Please try again.", status: e?.status ?? 500 });
    };
    // Ask the database for what a screen needs, and let the player see (and watch) this other player's online status.
    const presenceOf = async (peer) => {
      const b = await blocksOf(me.id);
      if (hidden(b, peer.id)) return null;
      socket.join(watchers(peer.id)); socket.data.watching.add(peer.id);
      const online = isOnline(peer.id);
      const at = online ? null : lastSeen.get(peer.id) ?? (await core.loadLastSeen(db, peer.id).catch(() => null));
      return { online, lastSeen: at };
    };

    socket.on("send", (msg, ack) => serial(me.id, async () => {
      try {
        const { to, body, cid, replyToId } = msg ?? {}, key = typeof cid === "string" && cid.length <= 64 ? me.id + ":" + cid : null;
        if (key && recent.has(key)) return ack?.(await recent.get(key).p);
        const task = (async () => {
          const peer = await core.needPeer(db, me, to);
          const r = await core.sendText(db, me, peer, body, { recipientOnline: isOnline(peer.id), replyToId });
          if (!r.dropped) {
            const m = { chat: r.chatId, id: r.id, from: me.name, to: peer.name, body: r.body, kind: 0, at: r.at, replyToId: r.replyToId };
            io.to(room(peer.id)).emit("msg", { ...m, mine: false, reply: r.reply && { ...r.reply, mine: r.reply.from === peer.name } });
            socket.to(room(me.id)).emit("msg", { ...m, mine: true, cid, reply: r.reply && { ...r.reply, mine: r.reply.from === me.name } }); // my other devices
            if (r.delivered) io.to(room(me.id)).emit("delivered", { by: peer.name, upTo: r.id });
            sendChatPush(db, r.chatId, r.id).catch((error) => log.error?.("[chat push]", error));
          }
          return { ok: true, id: r.dropped ? null : r.id, at: r.at, chat: r.chatId, delivered: !!r.delivered };
        })();
        if (key) recent.set(key, { p: task, t: Date.now() });
        try { ack?.(await task); } catch (e) { if (key) recent.delete(key); throw e; }
      } catch (e) { fail(ack, e); }
    }));

    socket.on("read", async (msg, ack) => {
      try {
        const r = await core.markRead(db, me, msg?.with, msg?.upTo);
        if (r) {
          io.to(room(r.peer.id)).emit("read", { by: me.name, upTo: r.upTo });
          socket.to(room(me.id)).emit("read:me", { with: r.peer.name });
        }
        ack?.({ ok: true });
      } catch (e) { fail(ack, e); }
    });

    socket.on("typing", async (msg) => {
      try {
        const peer = await core.playerByName(db, msg?.to);
        if (!peer || peer.id === me.id || !socket.data.watching.has(peer.id)) return; // only people whose chat this player has open
        const now = Date.now();
        if (msg.on && now - (typingAt.get(peer.id) ?? 0) < 1500) return;
        typingAt.set(peer.id, now);
        if (hidden(await blocksOf(me.id), peer.id)) return;
        io.to(room(peer.id)).emit("typing", { from: me.name, on: !!msg.on });
      } catch { /* typing is a nicety: never worth an error */ }
    });

    socket.on("thread", async (msg, ack) => {
      try {
        const t = await core.getThread(db, me, msg?.with, { before: msg?.before, after: msg?.after });
        const peer = await core.playerByName(db, t.with);
        ack?.({ ok: true, ...t, presence: msg?.before ? undefined : await presenceOf(peer) }); // not for "load earlier", but yes after a reconnect
      } catch (e) { fail(ack, e); }
    });

    socket.on("inbox", async (_msg, ack) => {
      try {
        const { conversations } = await core.getInbox(db, me, { ids: true }), b = await blocksOf(me.id), online = {};
        for (const c of conversations) {
          if (!hidden(b, c.peerId)) { socket.join(watchers(c.peerId)); socket.data.watching.add(c.peerId); if (isOnline(c.peerId)) online[c.name] = true; }
          delete c.peerId;
        }
        ack?.({ ok: true, conversations, online });
      } catch (e) { fail(ack, e); }
    });

    socket.on("watch", async (msg, ack) => {
      try {
        const out = {};
        for (const name of (Array.isArray(msg?.names) ? msg.names : []).slice(0, 20)) {
          const p = await core.playerByName(db, name);
          if (p && p.id !== me.id) out[p.name] = await presenceOf(p);
        }
        ack?.({ ok: true, presence: out });
      } catch (e) { fail(ack, e); }
    });

    // ---- live prices: the browser asks once (and again after every reconnect); the server then pushes. Prices are public and identical for everyone. ----
    socket.on("market:sub", async (_msg, ack) => {
      try {
        const m = await getMarket().ready();
        socket.join(MARKET_ROOM); startTicker();
        ack?.({ ok: true, serverNow: Date.now(), ...marketSnapshot(m) });
      } catch (e) { fail(ack, e); }
    });
    socket.on("market:unsub", (_msg, ack) => { socket.leave(MARKET_ROOM); ack?.({ ok: true }); });

    socket.on("disconnect", () => {
      const n = (live.get(me.id) ?? 1) - 1;
      if (n > 0) return live.set(me.id, n);
      live.delete(me.id);
      const t = setTimeout(() => {
        offlineTimers.delete(me.id);
        if (isOnline(me.id)) return;
        const at = new Date();
        lastSeen.set(me.id, at); blocks.delete(me.id);
        io.to(watchers(me.id)).emit("presence", { name: me.name, online: false, lastSeen: at });
        if (Date.now() - (lastSeenWritten.get(me.id) ?? 0) > SEEN_WRITE_MS) { lastSeenWritten.set(me.id, Date.now()); core.saveLastSeen(db, me.id, at).catch(() => {}); }
        if (lastSeen.size > 20_000) lastSeen.clear();
      }, graceMs);
      t.unref?.();
      offlineTimers.set(me.id, t);
    });

    // ---- join: handlers are in place above, so nothing the browser sends right away is missed ----
    socket.join(room(me.id));
    live.set(me.id, (live.get(me.id) ?? 0) + 1);
    if (offlineTimers.has(me.id)) { clearTimeout(offlineTimers.get(me.id)); offlineTimers.delete(me.id); } // back within the grace period: never announced as offline
    else if (live.get(me.id) === 1) io.to(watchers(me.id)).emit("presence", { name: me.name, online: true });
    (async () => {
      try {
        // everything sent to this player while they were away now counts as delivered: their friends' ticks turn double
        for (const d of await core.markAllDelivered(db, me)) io.to(room(d.peerId)).emit("delivered", { by: me.name, upTo: d.upTo });
        socket.emit("hello", { unread: await core.unreadTotal(db, me), at: Date.now() });
      } catch (e) { log.error?.("[realtime] hello", e); socket.emit("hello", { unread: null, at: Date.now() }); }
    })();
  });

  // ---------- the market clock: one message a second to whoever is watching, nothing at all when nobody is ----------
  let ticker = null;
  const watching = () => io.sockets.adapter.rooms.get(MARKET_ROOM)?.size ?? 0;
  function startTicker() {
    if (ticker) return;
    const loop = () => {
      ticker = null;
      if (!watching()) return; // the last viewer left: stop until someone subscribes again
      try {
        const m = getMarket();
        io.to(MARKET_ROOM).emit("market:tick", { ...m.tick(), mood: m.mood() });
        m.ready().catch((e) => log.error?.("[realtime] market", e)); // moves the chain on and saves the hourly checkpoint
      } catch (e) { log.error?.("[realtime] market tick", e); }
      ticker = setTimeout(loop, 1000 - (Date.now() % 1000) + 5); // land just after each second, so every client shows the same tick
      ticker.unref?.();
    };
    ticker = setTimeout(loop, 1000 - (Date.now() % 1000) + 5); ticker.unref?.();
  }
  const revalue = () => refreshHoldingValues(db, { minGapMs: 0, market: getMarket() }).catch((e) => log.error?.("[realtime] revalue", e));
  const revalueFirst = setTimeout(revalue, 60_000), revalueEvery = setInterval(revalue, MARKET_VALUE_EVERY_MS);
  revalueFirst.unref(); revalueEvery.unref();

  // ---------- told by the website (money notes, plain-HTTP messages, blocks) ----------
  async function internal(req, res) {
    const done = (code, obj = {}) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    let raw = "";
    for await (const part of req) { raw += part; if (raw.length > 10_000) return done(413); }
    if (!bodyIsSigned(secret, raw, req.headers["x-sig"])) return done(401, { error: "bad signature" });
    let e; try { e = JSON.parse(raw); } catch { return done(400); }
    try {
      const num = (v) => Number.isSafeInteger(v) && v > 0;
      if (e?.type === "msg") {
        if (!num(e.chat) || !num(e.id)) return done(400, { error: "bad event" });
        const f = await core.messageById(db, e.chat, e.id);
        if (f) {
          const { m, c } = f, fromId = m.fromA ? c.aId : c.bId, toId = m.fromA ? c.bId : c.aId, nm = await core.namesOf(db, [fromId, toId]);
          const delivered = isOnline(toId);
          if (delivered) await core.markDelivered(db, c.id, toId === c.aId, m.id);
          const p = { chat: c.id, id: Number(m.id), from: nm.get(fromId), to: nm.get(toId), body: m.deletedAt ? "This message was deleted" : m.body, kind: m.deletedAt ? 0 : m.kind, at: m.createdAt, deleted: !!m.deletedAt, replyToId: m.replyToId == null ? null : Number(m.replyToId) };
          io.to(room(toId)).emit("msg", { ...p, mine: false, reply: f.reply && { ...f.reply, mine: f.reply.from === nm.get(toId) } });
          io.to(room(fromId)).emit("msg", { ...p, mine: true, reply: f.reply && { ...f.reply, mine: f.reply.from === nm.get(fromId) } });
          if (delivered) io.to(room(fromId)).emit("delivered", { by: nm.get(toId), upTo: Number(m.id) });
          sendChatPush(db, c.id, Number(m.id)).catch((error) => log.error?.("[chat push]", error));
        }
      } else if (e?.type === "delete") {
        if (!num(e.chat) || !num(e.id) || !["me", "everyone"].includes(e.mode) || typeof e.actorId !== "string" || typeof e.peerId !== "string") return done(400, { error: "bad event" });
        const event = { chat: e.chat, id: e.id, mode: e.mode };
        io.to(room(e.actorId)).emit("deleted", { ...event, mine: !!e.actorMine, with: e.peerName });
        if (e.mode === "everyone") io.to(room(e.peerId)).emit("deleted", { ...event, mine: false, with: e.actorName });
      } else if (e?.type === "read") {
        if (typeof e.peerId !== "string" || typeof e.byId !== "string") return done(400, { error: "bad event" });
        io.to(room(e.peerId)).emit("read", { by: e.by, upTo: e.upTo });
        io.to(room(e.byId)).emit("read:me", { with: e.peerName });
      } else if (e?.type === "block" || e?.type === "unblock") {
        if (typeof e.blockerId !== "string" || typeof e.blockedId !== "string") return done(400, { error: "bad event" });
        const on = e.type === "block";
        for (const [id, other] of [[e.blockerId, e.blockedId], [e.blockedId, e.blockerId]]) {
          const p = blocks.get(id);
          if (p) p.then((b) => { (id === e.blockerId ? b.byMe : b.byThem)[on ? "add" : "delete"](other); }).catch(() => {});
        }
        if (on) { // they can no longer see each other's status
          io.in(room(e.blockedId)).socketsLeave(watchers(e.blockerId));
          io.in(room(e.blockerId)).socketsLeave(watchers(e.blockedId));
        }
        const nm = await core.namesOf(db, [e.blockedId]);
        io.to(room(e.blockerId)).emit("block", { name: nm.get(e.blockedId), on }); // the blocker's other devices
      } else if (e?.type === "online") { // the admin dashboard asks who has an open socket right now (exact: a player with no socket is not in `live`)
        return done(200, { ok: true, ids: [...live.keys()] });
      } else if (e?.type === "kick") { // an administrator suspended or closed this account: drop every connection it has
        if (typeof e.characterId !== "string") return done(400, { error: "bad event" });
        io.in(room(e.characterId)).disconnectSockets(true);
      } else return done(400, { error: "unknown event" });
      done(200, { ok: true });
    } catch (err) { log.error?.("[realtime] internal", err); done(500); }
  }

  // ---------- housekeeping: old messages are removed so the table stops growing ----------
  const purge = () => core.purgeOld(db).catch((e) => log.error?.("[realtime] purge", e));
  const first = setTimeout(purge, 30_000), every = setInterval(purge, 6 * 3_600_000);
  first.unref(); every.unref();

  return {
    server, io,
    listen: (port, host = "0.0.0.0") => new Promise((ok) => server.listen(port, host, () => ok(server.address().port))),
    close: async () => {
      clearInterval(sweep); clearInterval(every); clearTimeout(first); clearTimeout(ticker); clearTimeout(revalueFirst); clearInterval(revalueEvery);
      for (const t of offlineTimers.values()) clearTimeout(t);
      await io.close();
    },
  };
}

// ---- run it ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const origins = (process.env.APP_ORIGIN ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (process.env.NODE_ENV === "production" && !origins.length) console.warn("[realtime] APP_ORIGIN is not set: any website may connect (a chat pass is still required).");
  const rt = createRealtime({ db, secret: process.env.SESSION_SECRET, origins });
  const port = await rt.listen(Number(process.env.REALTIME_PORT) || Number(process.env.PORT) || 4000);
  console.log(`[realtime] listening on :${port}`);
  const stop = async () => { await rt.close(); await db.$disconnect(); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}