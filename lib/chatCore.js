// lib/chatCore.js
// Everything the chat does to the database, in one place. The website's API routes and the realtime (Socket.IO) server both call
// these functions, so a message behaves the same whichever road it travelled. Every function takes `db` (a Prisma client or a
// transaction) as its first argument. Relative imports only: the realtime server runs this file outside Next.js.
//
// Why it stays small on the database (the point of the redesign):
//  - "read" and "delivered" are ONE number per side on the Chat row (a watermark), never a flag written onto every message.
//    Postgres rewrites a whole row on every update, so the old per-message `readAt` doubled the storage of every conversation.
//  - sending a message is ONE statement (block check + insert + Chat update), one round trip.
//  - only the newest CHAT.keepPerChat messages of a chat, and nothing older than CHAT.keepDays, are kept.
//  - who is online lives in the realtime server's memory. Nothing is written for it.
import { KIND, cleanBody, previewOf, moneyBody, pairOf } from "./chatShared.js";

export const CHAT = {
  page: 40, // messages loaded at a time
  keepPerChat: Number(process.env.CHAT_KEEP_PER_CHAT) || 150,
  keepDays: Number(process.env.CHAT_KEEP_DAYS) || 30,
  trimEvery: 25, // a chat is trimmed on roughly every 25th message (decided by the message id, so no counter is needed)
  burst: 12, // most messages a player can send at once ...
  perMinute: 30, // ... and how fast that allowance comes back
};

export class ChatError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ---------- small in-memory caches (names never change, and a pair of players always shares the same chat) ----------
function lru(max, ttlMs = 0) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k); if (!e) return undefined;
      if (ttlMs && Date.now() - e.t > ttlMs) { m.delete(k); return undefined; }
      m.delete(k); m.set(k, e); return e.v;
    },
    set(k, v) { m.set(k, { v, t: Date.now() }); if (m.size > max) m.delete(m.keys().next().value); return v; },
    delete: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
const userCache = lru(5000, 600_000); // User.id -> { id, name }
const nameCache = lru(5000, 600_000); // lower-case name -> { id, name }
const chatCache = lru(20_000); // "aId|bId" -> { id, aId, bId }  (a Chat row is never deleted or changed)
export const forgetCaches = () => { userCache.clear(); nameCache.clear(); chatCache.clear(); idNames.clear(); };


/** The signed-in player: { id, name }. */
export async function whoAmI(db, userId) {
  let c = userCache.get(userId);
  if (c) return c;
  const row = await db.character.findUnique({ where: { userId }, select: { id: true, name: true } });
  if (!row) throw new ChatError("Create a character first.", 404);
  return userCache.set(userId, row);
}

/** Another player, found by name (any letter case): { id, name } or null. */
export async function playerByName(db, name) {
  const s = String(name ?? "").trim().slice(0, 40);
  if (!s) return null;
  const k = s.toLowerCase();
  let c = nameCache.get(k);
  if (c) return c;
  const row = await db.character.findFirst({ where: { name: { equals: s, mode: "insensitive" } }, select: { id: true, name: true } });
  return row ? nameCache.set(k, row) : null;
}

const idNames = lru(5000, 600_000); // character id -> name
/** Names for some character ids (a Map). */
export async function namesOf(db, ids) {
  const out = new Map(), miss = [];
  for (const id of ids) { const n = idNames.get(id); n ? out.set(id, n) : miss.push(id); }
  if (miss.length) for (const r of await db.character.findMany({ where: { id: { in: miss } }, select: { id: true, name: true } })) out.set(r.id, idNames.set(r.id, r.name));
  return out;
}

export async function needPeer(db, me, name) {
  const p = await playerByName(db, name);
  if (!p) throw new ChatError("No player with that name.", 404);
  if (p.id === me.id) throw new ChatError("You cannot message yourself.");
  return p;
}

/** The chat between two players. `create` makes it on first use. `cache: false` inside a transaction (a rolled-back create must not be remembered). */
export async function chatFor(db, meId, peerId, { create = false, cache = true } = {}) {
  const [aId, bId] = pairOf(meId, peerId), k = aId + "|" + bId;
  let c = cache ? chatCache.get(k) : undefined;
  if (!c) {
    const sel = { id: true, aId: true, bId: true };
    c = await db.chat.findUnique({ where: { aId_bId: { aId, bId } }, select: sel });
    if (!c && create) {
      // ON CONFLICT DO NOTHING, not try/catch: a failed INSERT would abort the whole transaction when this runs inside a money transfer
      await db.$executeRaw`INSERT INTO "Chat" ("aId", "bId") VALUES (${aId}::text, ${bId}::text) ON CONFLICT ("aId", "bId") DO NOTHING`;
      c = await db.chat.findUnique({ where: { aId_bId: { aId, bId } }, select: sel });
    }
    if (c && cache) chatCache.set(k, c);
  }
  return c ? { ...c, meIsA: c.aId === meId } : null;
}

// ---------- sending ----------
const buckets = new Map(); // character id -> { n, t }
/** True if this player may send another message right now (a token bucket kept in memory: costs no database call). */
export function takeSendToken(meId, now = Date.now()) {
  const b = buckets.get(meId) ?? { n: CHAT.burst, t: now };
  b.n = Math.min(CHAT.burst, b.n + ((now - b.t) / 60_000) * CHAT.perMinute); b.t = now;
  if (buckets.size > 50_000) buckets.clear();
  buckets.set(meId, b);
  if (b.n < 1) return false;
  b.n -= 1;
  return true;
}

/**
 * Store one message and update the Chat row in a single statement.
 * Returns null when either player has blocked the other: nothing is stored or delivered, and the sender is not told
 * (they see one grey tick that never changes, so a block cannot be used to start a fight).
 * `recipientOnline` is what the realtime server knows; it marks the message delivered in the same statement.
 */
export async function insertMessage(db, chat, from, { kind = KIND.TEXT, body, recipientOnline = false, replyToId = null }) {
  const fromA = chat.aId === from.id, toId = fromA ? chat.bId : chat.aId, preview = previewOf(kind, body);
  const rows = await db.$queryRaw`
    WITH ok AS (
      SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM "Chat" WHERE "id" = ${chat.id}::int) AND NOT EXISTS (
        SELECT 1 FROM "Block" WHERE ("blockerId" = ${from.id}::text AND "blockedId" = ${toId}::text) OR ("blockerId" = ${toId}::text AND "blockedId" = ${from.id}::text))
    ), m AS (
      INSERT INTO "Message" ("chatId", "fromA", "kind", "body", "replyToId")
      SELECT ${chat.id}::int, ${fromA}::boolean, ${kind}::smallint, ${body}::text, ${replyToId}::bigint FROM ok
      RETURNING "id", "createdAt"
    ), u AS (
      UPDATE "Chat" c SET
        "lastId"    = GREATEST(c."lastId", m."id"),
        "lastAt"    = CASE WHEN m."id" > c."lastId" THEN m."createdAt" ELSE c."lastAt" END,
        "lastBody"  = CASE WHEN m."id" > c."lastId" THEN ${preview}::text ELSE c."lastBody" END,
        "lastKind"  = CASE WHEN m."id" > c."lastId" THEN ${kind}::smallint ELSE c."lastKind" END,
        "lastFromA" = CASE WHEN m."id" > c."lastId" THEN ${fromA}::boolean ELSE c."lastFromA" END,
        "aUnread"   = CASE WHEN ${fromA}::boolean THEN 0 ELSE c."aUnread" + 1 END,
        "bUnread"   = CASE WHEN ${fromA}::boolean THEN c."bUnread" + 1 ELSE 0 END,
        "aRead"     = CASE WHEN ${fromA}::boolean THEN GREATEST(c."aRead", m."id") ELSE c."aRead" END,
        "bRead"     = CASE WHEN ${fromA}::boolean THEN c."bRead" ELSE GREATEST(c."bRead", m."id") END,
        "aDel"      = CASE WHEN ${fromA}::boolean OR ${recipientOnline}::boolean THEN GREATEST(c."aDel", m."id") ELSE c."aDel" END,
        "bDel"      = CASE WHEN NOT ${fromA}::boolean OR ${recipientOnline}::boolean THEN GREATEST(c."bDel", m."id") ELSE c."bDel" END
      FROM m WHERE c."id" = ${chat.id}::int
      RETURNING 1
    )
    SELECT "id", "createdAt" FROM m`;
  if (!rows.length) return null;
  const id = Number(rows[0].id);
  if (id % CHAT.trimEvery === 0) trimChat(db, chat.id).catch(() => {}); // fire and forget
  if (id % 400 === 0) purgeOld(db).catch(() => {});
  return { id, at: rows[0].createdAt, chatId: chat.id, fromA, delivered: !!recipientOnline };
}

/** A player sends text to another player. Used by the realtime server and by the plain-HTTP fallback. */
export async function sendText(db, me, peerOrName, body, { recipientOnline = false, replyToId = null } = {}) {
  const peer = typeof peerOrName === "string" ? await needPeer(db, me, peerOrName) : peerOrName, text = cleanBody(body);
  if (!text) throw new ChatError("Write a message first.");
  if (!takeSendToken(me.id)) throw new ChatError("Slow down a little. You are sending messages too fast.", 429);
  let chat = await chatFor(db, me.id, peer.id, { create: true });
  let replyId = null, reply = null;
  if (replyToId != null) {
    if (!/^\d{1,20}$/.test(String(replyToId))) throw new ChatError("That message cannot be replied to.");
    replyId = BigInt(replyToId);
    const original = await db.message.findUnique({ where: { chatId_id: { chatId: chat.id, id: replyId } }, select: { id: true, fromA: true, kind: true, body: true, deletedAt: true, createdAt: true } });
    const hidden = original && await db.messageHide.findUnique({ where: { chatId_messageId_characterId: { chatId: chat.id, messageId: replyId, characterId: me.id } }, select: { messageId: true } });
    if (!original || original.deletedAt || hidden) throw new ChatError("That message is no longer available.");
    reply = {
      id: Number(original.id), mine: original.fromA === (chat.aId === me.id),
      from: (await namesOf(db, [original.fromA ? chat.aId : chat.bId])).get(original.fromA ? chat.aId : chat.bId),
      kind: original.kind, body: original.body, deleted: false, at: original.createdAt,
    };
  }
  let sent = await insertMessage(db, chat, me, { kind: KIND.TEXT, body: text, recipientOnline, replyToId: replyId });
  if (!sent && !(await db.chat.findUnique({ where: { id: chat.id }, select: { id: true } }))) { // not blocked: the remembered chat row is gone (cleaned up behind our back). Make it again, once.
    chatCache.delete(pairOf(me.id, peer.id).join("|"));
    chat = await chatFor(db, me.id, peer.id, { create: true });
    sent = await insertMessage(db, chat, me, { kind: KIND.TEXT, body: text, recipientOnline, replyToId: replyId });
  }
  if (!sent) return { peer, chat, dropped: true, at: new Date(), body: text };
  return { peer, chat, ...sent, body: text, replyToId: replyId == null ? null : Number(replyId), reply };
}

/** The money note that appears in the chat. Runs INSIDE the transfer's database transaction, so the note and the money succeed or fail together. */
export async function postMoney(tx, from, to, nairaAmount, note) {
  const chat = await chatFor(tx, from.id, to.id, { create: true, cache: false });
  const sent = await insertMessage(tx, chat, from, { kind: KIND.MONEY, body: moneyBody(nairaAmount, note) });
  return sent ? { id: sent.id, at: sent.at, chatId: chat.id } : null;
}

// ---------- reading ----------
const wire = (m, meIsA, reply) => ({
  id: Number(m.id), mine: m.fromA === meIsA, kind: m.kind,
  body: m.deletedAt ? "This message was deleted" : m.body,
  deleted: !!m.deletedAt, at: m.createdAt,
  replyToId: m.replyToId == null ? null : Number(m.replyToId),
  ...(m.replyToId != null ? { reply: reply ?? { id: Number(m.replyToId), unavailable: true } } : {}),
});
const side = (c, meIsA) => ({
  peerRead: Number(meIsA ? c.bRead : c.aRead), peerDel: Number(meIsA ? c.bDel : c.aDel),
  myRead: Number(meIsA ? c.aRead : c.bRead), unread: meIsA ? c.aUnread : c.bUnread, lastId: Number(c.lastId),
});

/** One conversation: the newest `limit` messages (or the page before `before`, or everything newer than `after`), plus who has read what. */
export async function getThread(db, me, peerName, { before, after, limit = CHAT.page } = {}) {
  const peer = await needPeer(db, me, peerName);
  const [chat, blk] = await Promise.all([chatFor(db, me.id, peer.id), db.block.findUnique({ where: { blockerId_blockedId: { blockerId: me.id, blockedId: peer.id } }, select: { id: true } })]);
  const base = { with: peer.name, blockedByMe: !!blk };
  if (!chat) return { ...base, messages: [], hasMore: false, peerRead: 0, peerDel: 0, myRead: 0, unread: 0, lastId: 0 };
  const lim = Math.min(Math.max(Number(limit) || CHAT.page, 1), 100);
  const [hiddenRows, row] = await Promise.all([
    db.messageHide.findMany({ where: { chatId: chat.id, characterId: me.id }, select: { messageId: true } }),
    db.chat.findUnique({ where: { id: chat.id } }),
  ]);
  if (!row) { chatCache.delete(pairOf(me.id, peer.id).join("|")); return { ...base, messages: [], hasMore: false, peerRead: 0, peerDel: 0, myRead: 0, unread: 0, lastId: 0 }; } // the chat was removed behind our back: forget it
  const visible = { chatId: chat.id, id: { notIn: hiddenRows.map((h) => h.messageId) } };
  const q = after
    ? db.message.findMany({ where: { ...visible, id: { ...visible.id, gt: BigInt(after) } }, orderBy: { id: "asc" }, take: 200 })
    : db.message.findMany({ where: { ...visible, ...(before ? { id: { ...visible.id, lt: BigInt(before) } } : {}) }, orderBy: { id: "desc" }, take: lim + 1 });
  const rows = await q;
  const hasMore = !after && rows.length > lim;
  const list = after ? rows : rows.slice(0, lim).reverse();
  const replies = list.filter((m) => m.replyToId != null);
  const originals = replies.length
    ? await db.message.findMany({ where: { chatId: chat.id, id: { in: replies.map((m) => m.replyToId) } }, select: { id: true, fromA: true, kind: true, body: true, deletedAt: true, createdAt: true } })
    : [];
  const originalById = new Map(originals.map((m) => [m.id.toString(), m]));
  const names = await namesOf(db, [chat.aId, chat.bId]);
  return {
    ...base,
    messages: list.map((m) => {
      const original = m.replyToId == null ? null : originalById.get(m.replyToId.toString());
      const quote = original ? {
        id: Number(original.id), mine: original.fromA === chat.meIsA,
        from: names.get(original.fromA ? chat.aId : chat.bId),
        kind: original.kind, body: original.deletedAt ? "This message was deleted" : original.body,
        deleted: !!original.deletedAt, at: original.createdAt,
      } : null;
      return wire(m, chat.meIsA, quote ?? undefined);
    }),
    hasMore, ...side(row, chat.meIsA),
  };
}

/** All of this player's conversations, newest first. */
export async function getInbox(db, me, { ids = false } = {}) { // ids: only the realtime server asks for them (to subscribe to online status); players never see character ids
  const rows = await db.chat.findMany({ where: { OR: [{ aId: me.id }, { bId: me.id }], lastId: { gt: 0 } }, orderBy: { lastAt: "desc" }, take: 100 });
  if (!rows.length) return { conversations: [] };
  const peers = rows.map((c) => (c.aId === me.id ? c.bId : c.aId));
  const [people, blocks] = await Promise.all([
    db.character.findMany({ where: { id: { in: peers } }, select: { id: true, name: true } }),
    db.block.findMany({ where: { blockerId: me.id, blockedId: { in: peers } }, select: { blockedId: true } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name])), blocked = new Set(blocks.map((b) => b.blockedId));
  const hidden = await db.messageHide.findMany({
    where: { characterId: me.id, chatId: { in: rows.map((c) => c.id) }, messageId: { in: rows.map((c) => c.lastId) } },
    select: { chatId: true, messageId: true },
  });
  const hiddenLast = new Set(hidden.map((x) => `${x.chatId}:${x.messageId}`));
  const conversations = [];
  for (const c of rows) {
    const meIsA = c.aId === me.id, peerId = meIsA ? c.bId : c.aId, nm = name.get(peerId);
    if (!nm) continue; // that player no longer exists
    const mine = c.lastFromA === meIsA, s = side(c, meIsA);
    conversations.push({ ...(ids && { peerId }), name: nm, last: hiddenLast.has(`${c.id}:${c.lastId}`) ? "Message deleted" : c.lastBody, kind: c.lastKind, mine, at: c.lastAt, unread: s.unread, id: s.lastId, peerRead: s.peerRead, peerDel: s.peerDel, myRead: s.myRead, blocked: blocked.has(peerId) });
  }
  return { conversations };
}

/** Total unread messages: the phone's badge. Adds up the counters, so it reads one row per conversation and never scans messages. */
export async function unreadTotal(db, me) {
  const [r] = await db.$queryRaw`SELECT COALESCE(SUM(CASE WHEN "aId" = ${me.id}::text THEN "aUnread" ELSE "bUnread" END), 0)::int AS n FROM "Chat" WHERE "aId" = ${me.id}::text OR "bId" = ${me.id}::text`;
  return Number(r?.n ?? 0);
}

/** I have read up to message `upTo` (default: everything). One small update; returns what the other player should be told, or null if nothing changed. */
export async function markRead(db, me, peerName, upTo) {
  const peer = await needPeer(db, me, peerName), chat = await chatFor(db, me.id, peer.id);
  if (!chat) return null;
  const up = upTo ? BigInt(upTo) : 9007199254740991n;
  const rows = chat.meIsA
    ? await db.$queryRaw`UPDATE "Chat" SET "aRead" = GREATEST("aRead", LEAST(${up}::bigint, "lastId")), "aDel" = GREATEST("aDel", LEAST(${up}::bigint, "lastId")), "aUnread" = CASE WHEN ${up}::bigint >= "lastId" THEN 0 ELSE "aUnread" END
        WHERE "id" = ${chat.id}::int AND ("aUnread" > 0 OR "aRead" < LEAST(${up}::bigint, "lastId")) RETURNING "aRead" AS "r"`
    : await db.$queryRaw`UPDATE "Chat" SET "bRead" = GREATEST("bRead", LEAST(${up}::bigint, "lastId")), "bDel" = GREATEST("bDel", LEAST(${up}::bigint, "lastId")), "bUnread" = CASE WHEN ${up}::bigint >= "lastId" THEN 0 ELSE "bUnread" END
        WHERE "id" = ${chat.id}::int AND ("bUnread" > 0 OR "bRead" < LEAST(${up}::bigint, "lastId")) RETURNING "bRead" AS "r"`;
  return rows.length ? { peer, upTo: Number(rows[0].r) } : null;
}

/** The player's device just connected: everything sent to them while they were away now counts as delivered. Returns who to tell. */
export async function markAllDelivered(db, me) {
  const [a, b] = await Promise.all([
    db.$queryRaw`UPDATE "Chat" SET "aDel" = "lastId" WHERE "aId" = ${me.id}::text AND "aDel" < "lastId" RETURNING "bId" AS "peer", "lastId" AS "upTo"`,
    db.$queryRaw`UPDATE "Chat" SET "bDel" = "lastId" WHERE "bId" = ${me.id}::text AND "bDel" < "lastId" RETURNING "aId" AS "peer", "lastId" AS "upTo"`,
  ]);
  return [...a, ...b].map((r) => ({ peerId: r.peer, upTo: Number(r.upTo) }));
}

/** One message just reached the recipient's device (used for money notes, which are created by the website, not by the realtime server). */
export async function markDelivered(db, chatId, recipientIsA, id) {
  if (recipientIsA) await db.$executeRaw`UPDATE "Chat" SET "aDel" = GREATEST("aDel", ${BigInt(id)}::bigint) WHERE "id" = ${chatId}::int`;
  else await db.$executeRaw`UPDATE "Chat" SET "bDel" = GREATEST("bDel", ${BigInt(id)}::bigint) WHERE "id" = ${chatId}::int`;
}

export async function messageById(db, chatId, id) {
  const [m, c] = await Promise.all([db.message.findUnique({ where: { chatId_id: { chatId, id: BigInt(id) } } }), db.chat.findUnique({ where: { id: chatId }, select: { id: true, aId: true, bId: true } })]);
  if (!m || !c) return null;
  let reply = null;
  if (m.replyToId != null) {
    const original = await db.message.findUnique({ where: { chatId_id: { chatId, id: m.replyToId } }, select: { id: true, fromA: true, kind: true, body: true, deletedAt: true, createdAt: true } });
    if (original) {
      const fromId = original.fromA ? c.aId : c.bId;
      reply = {
        id: Number(original.id), from: (await namesOf(db, [fromId])).get(fromId),
        mine: original.fromA === m.fromA, kind: original.kind,
        body: original.deletedAt ? "This message was deleted" : original.body,
        deleted: !!original.deletedAt, at: original.createdAt,
      };
    } else reply = { id: Number(m.replyToId), unavailable: true };
  }
  return { m, c, reply };
}

/** Delete a message for the caller or both participants; membership and sender ownership are checked on the server. */
export async function deleteMessage(db, me, rawId, mode) {
  if (!/^\d{1,20}$/.test(String(rawId)) || !["me", "everyone"].includes(mode)) throw new ChatError("That message cannot be deleted.");
  const id = BigInt(rawId);
  return db.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id }, select: { id: true, chatId: true, fromA: true, deletedAt: true } });
    if (!message) throw new ChatError("That message is no longer available.", 404);
    const chat = await tx.chat.findUnique({ where: { id: message.chatId }, select: { id: true, aId: true, bId: true, lastId: true } });
    if (!chat || (chat.aId !== me.id && chat.bId !== me.id)) throw new ChatError("You cannot delete that message.", 403);
    const mine = message.fromA === (chat.aId === me.id);
    if (mode === "everyone" && !mine) throw new ChatError("You can only delete your own message for everyone.", 403);
    if (mode === "everyone") {
      if (!message.deletedAt) {
        const changed = await tx.message.updateMany({ where: { chatId: chat.id, id, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: me.id } });
        if (changed.count) {
          await tx.chat.updateMany({
            where: { id: chat.id, lastId: id },
            data: { lastBody: "This message was deleted", lastKind: KIND.TEXT },
          });
          const recipientIsA = !message.fromA;
          if (recipientIsA) {
            await tx.$executeRaw`UPDATE "Chat" SET "aUnread" = GREATEST("aUnread" - 1, 0) WHERE "id" = ${chat.id}::int AND "aRead" < ${id}::bigint`;
          } else {
            await tx.$executeRaw`UPDATE "Chat" SET "bUnread" = GREATEST("bUnread" - 1, 0) WHERE "id" = ${chat.id}::int AND "bRead" < ${id}::bigint`;
          }
        }
      }
    } else {
      const hidden = await tx.messageHide.createMany({
        data: [{ chatId: chat.id, messageId: id, characterId: me.id }],
        skipDuplicates: true,
      });
      if (hidden.count && !mine) {
        if (chat.aId === me.id) {
          await tx.$executeRaw`UPDATE "Chat" SET "aUnread" = GREATEST("aUnread" - 1, 0) WHERE "id" = ${chat.id}::int AND "aRead" < ${id}::bigint`;
        } else {
          await tx.$executeRaw`UPDATE "Chat" SET "bUnread" = GREATEST("bUnread" - 1, 0) WHERE "id" = ${chat.id}::int AND "bRead" < ${id}::bigint`;
        }
      }
    }
    const peerId = chat.aId === me.id ? chat.bId : chat.aId;
    const peer = await tx.character.findUnique({ where: { id: peerId }, select: { name: true } });
    return {
      ok: true, mode, chatId: chat.id, id: Number(id), mine, peerId, peerName: peer?.name ?? "",
      notify: { type: "delete", chat: chat.id, id: Number(id), mode, actorId: me.id, actorName: me.name, peerId, peerName: peer?.name ?? "", actorMine: mine },
    };
  });
}

// ---------- blocks and reports ----------
/** Everyone this player has blocked or been blocked by: { byMe: Set, byThem: Set } of character ids. */
export async function blockSets(db, meId) {
  const rows = await db.block.findMany({ where: { OR: [{ blockerId: meId }, { blockedId: meId }] }, select: { blockerId: true, blockedId: true } });
  const byMe = new Set(), byThem = new Set();
  for (const r of rows) (r.blockerId === meId ? byMe.add(r.blockedId) : byThem.add(r.blockerId));
  return { byMe, byThem };
}

export async function setBlock(db, me, peerName, on) {
  const peer = await playerByName(db, peerName);
  if (!peer || peer.id === me.id) throw new ChatError("No such player.", 404);
  if (on) await db.block.upsert({ where: { blockerId_blockedId: { blockerId: me.id, blockedId: peer.id } }, update: {}, create: { blockerId: me.id, blockedId: peer.id } });
  else await db.block.deleteMany({ where: { blockerId: me.id, blockedId: peer.id } });
  return peer;
}

/** Report a player. The last 20 messages are copied into the report, so the evidence survives pruning and deleting. */
export async function reportPlayer(db, me, peerName, reason) {
  const peer = await playerByName(db, peerName);
  if (!peer || peer.id === me.id) throw new ChatError("No such player.", 404);
  const text = cleanBody(reason, 300).replace(/\n/g, " ");
  if (text.length < 5) throw new ChatError("Tell us what happened (a few words).");
  if (await db.report.count({ where: { reporterId: me.id, targetId: peer.id, status: "OPEN" } })) throw new ChatError("You already reported this player. Our team will look at it.", 409);
  const chat = await chatFor(db, me.id, peer.id);
  let evidence = null;
  if (chat) {
    const rows = await db.message.findMany({ where: { chatId: chat.id }, orderBy: { id: "desc" }, take: 20 });
    evidence = rows.reverse().map((m) => ({ fromReporter: m.fromA === chat.meIsA, body: m.body, kind: m.kind, at: m.createdAt.toISOString() }));
  }
  await db.report.create({ data: { reporterId: me.id, targetId: peer.id, reason: text, evidence } });
  return peer;
}

// ---------- presence ----------
export async function saveLastSeen(db, id, at = new Date()) {
  await db.$executeRaw`INSERT INTO "Presence" ("characterId", "lastSeen") VALUES (${id}::text, ${at}) ON CONFLICT ("characterId") DO UPDATE SET "lastSeen" = EXCLUDED."lastSeen"`;
}
export async function loadLastSeen(db, id) {
  const r = await db.presence.findUnique({ where: { characterId: id }, select: { lastSeen: true } });
  return r?.lastSeen ?? null;
}

// ---------- keeping it small ----------
/** Drop everything but the newest `keep` messages of one chat. */
export async function trimChat(db, chatId, keep = CHAT.keepPerChat) {
  return db.$executeRaw`
    WITH cutoff AS (
      SELECT "id" FROM "Message" WHERE "chatId" = ${chatId}::int ORDER BY "id" DESC OFFSET ${keep}::int LIMIT 1
    ), push AS (
      DELETE FROM "ChatPushDelivery" WHERE "chatId" = ${chatId}::int AND "messageId" <= (SELECT "id" FROM cutoff) RETURNING "messageId"
    ), hidden AS (
      DELETE FROM "MessageHide" WHERE "chatId" = ${chatId}::int AND "messageId" <= (SELECT "id" FROM cutoff) RETURNING "messageId"
    )
    DELETE FROM "Message" WHERE "chatId" = ${chatId}::int AND "id" <= (SELECT "id" FROM cutoff)`;
}
/** Drop every message older than `days`, a few thousand at a time so the database is never locked for long. */
export async function purgeOld(db, days = CHAT.keepDays) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  let total = 0;
  for (;;) {
    const n = await db.$executeRaw`DELETE FROM "Message" WHERE ("chatId", "id") IN (SELECT "chatId", "id" FROM "Message" WHERE "createdAt" < ${cutoff}::timestamp LIMIT 2000)`;
    total += n;
    if (n < 2000) break;
  }
  await Promise.all([
    db.chatPushDelivery.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    db.messageHide.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  return total;
}