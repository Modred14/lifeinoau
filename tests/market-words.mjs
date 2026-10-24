// tests/market-words.mjs: helpers for the market tests (not a test itself). A fast keyed generator stands in for HMAC when a test needs millions
// of minutes, and an in-memory store stands in for the database.
export const fastWords = (seed) => {
  const ids = new Map();
  const id = (s) => { let v = ids.get(s); if (v === undefined) { v = 0; for (const c of s) v = Math.imul(v ^ c.charCodeAt(0), 16777619) >>> 0; ids.set(s, v); } return v; };
  const gen = (a, b, c) => {
    let h = (seed ^ Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b) ^ Math.imul(c + 7, 0xc2b2ae35)) >>> 0; const w = new Array(8);
    for (let i = 0; i < 8; i++) { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0; h ^= h >>> 15; w[i] = h >>> 0; }
    return w;
  };
  return { block: (chain, block) => gen(id(chain), block, 0), path: (chain, block, c) => gen(id(chain) ^ 0x5bd1e995, block, c + 1) };
};

/** The database the engine stores to, in memory. Several engines may share one (that is how a restart or a second server is simulated). */
export const memStore = () => {
  let genesis = null; const cps = new Map(); const calls = { loadCheckpoint: 0, saveCheckpoints: 0, insertGenesis: 0 };
  return {
    calls, cps, setGenesis: (g) => { genesis = g; },
    async loadGenesis() { return genesis ? JSON.parse(JSON.stringify(genesis)) : null; },
    async insertGenesis(r) { calls.insertGenesis++; genesis ??= JSON.parse(JSON.stringify(r)); }, // the first writer wins, like the unique key does
    async loadCheckpoint(max) { calls.loadCheckpoint++; let best = null; for (const [b, s] of cps) if (b <= max && (!best || b > best.block)) best = { block: b, state: JSON.parse(JSON.stringify(s)) }; return best; },
    async saveCheckpoints(rows) { calls.saveCheckpoints++; for (const r of rows) if (!cps.has(r.block)) cps.set(r.block, JSON.parse(JSON.stringify(r.state))); },
    async prune(before) { for (const b of [...cps.keys()]) if (b < before) cps.delete(b); },
  };
};
export const ANCHORS = { COOP: 12400, BILLS: 13200, INDEX: 14700, PLOTS: 15100, TECH: 9100, MEME: 2500 }; // kobo
