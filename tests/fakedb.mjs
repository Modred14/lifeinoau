// tests/fakedb.mjs: a small in-memory stand-in for the Prisma client, just rich enough for the services' queries (where with
// OR / in / not / gt / lt, orderBy, take, increment, unique keys, include of account and faculty). A transaction that throws is rolled back.
const isObj = (v) => v && typeof v === "object" && !(v instanceof Date) && typeof v !== "bigint";
const eq = (a, b) => (typeof a === "bigint" || typeof b === "bigint" ? BigInt(a ?? 0) === BigInt(b ?? 0) : a instanceof Date && b instanceof Date ? +a === +b : a === b);
function cond(v, c) {
  if (!isObj(c)) return eq(v, c);
  return Object.entries(c).every(([k, x]) => {
    if (k === "in") return x.some((y) => eq(v, y));
    if (k === "not") return isObj(x) ? !cond(v, x) : !eq(v, x);
    if (k === "gt") return v != null && v > x; if (k === "gte") return v != null && v >= x;
    if (k === "lt") return v != null && v < x; if (k === "lte") return v != null && v <= x;
    if (k === "equals") return String(v).toLowerCase() === String(x).toLowerCase();
    if (k === "mode") return true; if (k === "startsWith") return String(v).toLowerCase().startsWith(String(x).toLowerCase());
    return false;
  });
}
function match(row, where = {}) {
  return Object.entries(where).every(([k, c]) => {
    if (k === "OR") return c.some((w) => match(row, w));
    if (k === "AND") return c.every((w) => match(row, w));
    if (k === "NOT") return !match(row, c);
    if (k.includes("_") && isObj(c) && !(k in row)) return match(row, c); // compound unique key
    return cond(row[k], c);
  });
}
const sortBy = (rows, ob) => { if (!ob) return rows; const [[k, d]] = Object.entries(Array.isArray(ob) ? ob[0] : ob); return [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (d === "desc" ? -1 : 1)); };

export function makeDb(models, { unique = {}, defaults = {}, join = {} } = {}) {
  let T = Object.fromEntries(models.map((m) => [m, []])), ids = Object.fromEntries(models.map((m) => [m, 1n]));
  const mk = (name) => {
    const rows = () => T[name], put = (r) => (join[name] ? join[name](r, T) : r);
    const apply = (r, data) => { for (const [k, v] of Object.entries(data)) { if (isObj(v) && ("increment" in v || "decrement" in v)) r[k] = r[k] + (v.increment ?? 0n) - (v.decrement ?? 0n); else r[k] = v; } return r; };
    return {
      findUnique: async ({ where }) => put(rows().find((r) => match(r, where)) ?? null) ?? null,
      findFirst: async ({ where, orderBy } = {}) => put(sortBy(rows().filter((r) => match(r, where)), orderBy)[0] ?? null) ?? null,
      findMany: async ({ where, orderBy, take } = {}) => sortBy(rows().filter((r) => match(r, where)), orderBy).slice(0, take ?? 1e9).map(put),
      groupBy: async ({ by, where, _sum, _count, _max } = {}) => { // distinct `by` keys (the chat code), plus Prisma's _sum / _count / _max per group (the club history)
        const g = new Map();
        for (const r of rows().filter((x) => match(x, where))) {
          const key = by.map((k) => r[k]).join("|"), o = g.get(key) ?? { ...Object.fromEntries(by.map((k) => [k, r[k]])), _sum: {}, _count: { _all: 0 }, _max: {} };
          o._count._all++; for (const f of Object.keys(_sum ?? {})) o._sum[f] = (o._sum[f] ?? 0n) + BigInt(r[f]); for (const f of Object.keys(_max ?? {})) if (o._max[f] == null || r[f] > o._max[f]) o._max[f] = r[f]; g.set(key, o);
        }
        return [...g.values()];
      },
      count: async ({ where } = {}) => rows().filter((r) => match(r, where)).length,
      create: async ({ data }) => {
        const u = unique[name]; if (u && rows().some((r) => u.every((k) => r[k] === data[k]))) { const e = new Error("Unique constraint"); e.code = "P2002"; throw e; }
        const r = { ...(defaults[name] ?? {}), ...data }; if (!("id" in r) && name !== "gameClock") r.id = ids[name]++; rows().push(r); return put(r);
      },
      update: async ({ where, data }) => { const r = rows().find((x) => match(x, where)); if (!r) throw new Error(`${name}: no row to update`); return put(apply(r, data)); },
      updateMany: async ({ where, data }) => { const m = rows().filter((r) => match(r, where)); m.forEach((r) => apply(r, data)); return { count: m.length }; },
      delete: async ({ where }) => { const i = rows().findIndex((r) => match(r, where)); if (i < 0) throw new Error("no row"); return rows().splice(i, 1)[0]; },
      deleteMany: async ({ where }) => { const keep = rows().filter((r) => !match(r, where)), n = rows().length - keep.length; rows().splice(0, rows().length, ...keep); return { count: n }; },
    };
  };
  const db = Object.fromEntries(models.map((m) => [m, mk(m)]));
  db.$queryRaw = async () => [];
  db.$transaction = async (fn) => { const snap = structuredClone({ T, ids }); try { return await fn(db); } catch (e) { for (const k of Object.keys(T)) T[k].splice(0, T[k].length, ...snap.T[k]); ids = snap.ids; throw e; } };
  db.T = () => T;
  // The chat tables (models "chat" and "message"), as lib/chatCore.js uses them: one Chat row per pair (aId < bId), and a Message only says which side sent it (fromA).
  // chatCore writes a message with ONE raw SQL statement and creates a chat with raw SQL too, so those two statements are understood here.
  if (T.chat && T.message) {
    db.$executeRaw = async (strings, aId, bId) => { if (strings.join("?").includes('INTO "Chat"') && !T.chat.some((c) => c.aId === aId && c.bId === bId)) T.chat.push({ id: ids.chat++, aId, bId, lastId: 0n }); return 1; };
    db.$queryRaw = async (strings, ...v) => {
      if (!strings.join("?").includes('INSERT INTO "Message"')) return [];
      const [chatId, , toId, , fromId, , fromA, kind, body] = v;   // the order of the values in insertMessage()
      const blocked = T.block?.some((b) => (b.blockerId === fromId && b.blockedId === toId) || (b.blockerId === toId && b.blockedId === fromId));
      if (blocked || !T.chat.some((c) => c.id === chatId)) return [];
      const row = { chatId, id: ids.message++, fromA, kind, body, createdAt: new Date() }; T.message.push(row); return [{ id: row.id, createdAt: row.createdAt }];
    };
    /** A text message from one player to another, as the chat stores it. */
    db.say = (from, to, body = "hi") => { const [aId, bId] = from < to ? [from, to] : [to, from]; let c = T.chat.find((x) => x.aId === aId && x.bId === bId); if (!c) { c = { id: ids.chat++, aId, bId, lastId: 0n }; T.chat.push(c); } T.message.push({ chatId: c.id, id: ids.message++, fromA: from === aId, kind: 0, body, createdAt: new Date() }); };
  }
  return db;
}
