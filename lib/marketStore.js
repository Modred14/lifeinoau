// lib/marketStore.js
// Where the live market keeps its state (see lib/marketEngine.js): ONE genesis row and one checkpoint an hour. Nothing else is written, so the market
// costs the database about one small insert an hour, however many players are watching.
//
// BigInt block numbers cross the Prisma boundary as BigInt and come back as Number (a minute count is far below 2^53).

/** The store the engine talks to, on top of a Prisma client (or anything shaped like one). */
export function marketStore(db) {
  return {
    async loadGenesis() {
      const r = await db.marketGenesis.findUnique({ where: { id: 1 } });
      return r ? r.data : null;
    },
    /** The first writer wins. A second process that races us gets a unique-key error, which just means "someone else already did": read theirs. */
    async insertGenesis(data) {
      try { await db.marketGenesis.create({ data: { id: 1, data } }); }
      catch (e) { if (e?.code !== "P2002") throw e; }
    },
    /** The newest checkpoint at or before `maxBlock`. */
    async loadCheckpoint(maxBlock) {
      const r = await db.marketCheckpoint.findFirst({ where: { block: { lte: BigInt(maxBlock) } }, orderBy: { block: "desc" } });
      return r ? { block: Number(r.block), state: r.state } : null;
    },
    /** Saving the same block twice is harmless: every process computes the same state, so a duplicate is skipped. */
    async saveCheckpoints(rows) {
      if (!rows.length) return;
      await db.marketCheckpoint.createMany({ data: rows.map((r) => ({ block: BigInt(r.block), state: r.state })), skipDuplicates: true });
    },
    async prune(beforeBlock) {
      if (beforeBlock > 0) await db.marketCheckpoint.deleteMany({ where: { block: { lt: BigInt(beforeBlock) } } });
    },
  };
}
