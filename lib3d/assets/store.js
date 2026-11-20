// lib3d/assets/store.js
// The persistent copy of downloaded assets: the browser's Cache Storage, keyed by VERSIONED url. Survives reloads and restarts (where the browser allows), is shared with the
// service worker (public/sw.js uses the same cache name), and is bounded: it can never grow without limit.
//
// RULES
//  - Nothing here may throw into the game. A missing Cache Storage (old browser, private mode, insecure page), a full disk or a corrupt entry only means "not cached": the loader
//    downloads the file instead. get() answers null, put() answers false.
//  - Over budget, the least valuable entries go first: lower tier (background before high before critical), then the oldest. Entries that are not in the current manifest go before all.
//  - Each entry records its tier, its size and when it was stored in response headers, so the budget can be enforced without a separate index that could drift out of step.
export const CACHE_NAME = "oau-assets-v1"; // keep in step with public/sw.js
const MB = 1048576, KEEP = { critical: 3, high: 2, background: 1 };

/** How much the assets may occupy: a slice of what the browser says it can give us, capped, smaller on phones. */
export async function defaultBudget(env = globalThis) {
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(String(env.navigator?.userAgent ?? ""));
  const cap = (phone ? 120 : 400) * MB;
  try { const e = await env.navigator?.storage?.estimate?.(); if (e?.quota) return Math.max(40 * MB, Math.min(cap, e.quota * 0.25)); } catch { /* no estimate */ }
  return cap;
}

export function createStore({ cacheStorage = globalThis.caches, name = CACHE_NAME, budget = defaultBudget, now = () => Date.now(), isCurrent = () => true, base = globalThis.location?.origin ?? "http://localhost" } = {}) {
  const key = (url) => new URL(url, base).href;
  let cachePromise = null, tally = null, limit = null;
  const open = () => (cachePromise ??= Promise.resolve().then(() => cacheStorage.open(name)).catch(() => null));
  const stats = { gets: 0, hits: 0, puts: 0, putFailures: 0, evictions: 0, pruned: 0 };

  const metaOf = async (req, cache) => {
    const res = await cache.match(req); if (!res) return null;
    let bytes = Number(res.headers.get("x-oau-bytes")) || Number(res.headers.get("content-length")) || 0;
    if (!bytes) { try { bytes = (await res.clone().arrayBuffer()).byteLength; } catch { bytes = 0; } }
    return { req, url: req.url, bytes, tier: res.headers.get("x-oau-tier") || "background", at: Number(res.headers.get("x-oau-at")) || 0 };
  };
  const scan = async (cache) => { const out = []; for (const req of await cache.keys()) { const m = await metaOf(req, cache).catch(() => null); if (m) out.push(m); } return out; };
  const ensureTally = async (cache) => { if (tally === null) tally = (await scan(cache)).reduce((s, m) => s + m.bytes, 0); return tally; };
  const getLimit = async () => (limit ??= Number(typeof budget === "function" ? await budget() : budget) || 200 * MB);

  /** Removes entries (worst first) until `need` more bytes fit in the budget. */
  async function makeRoom(cache, need) {
    const max = await getLimit(); let total = await ensureTally(cache);
    if (total + need <= max) return true;
    const rank = (m) => [isCurrent(m.url) ? 1 : 0, KEEP[m.tier] ?? 1, m.at];
    const all = (await scan(cache)).sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
    for (const m of all) { if (total + need <= max) break; if (await cache.delete(m.req).catch(() => false)) { total -= m.bytes; stats.evictions++; } }
    tally = total; return total + need <= max;
  }

  return {
    stats: () => ({ ...stats }),
    /** The bytes saved for this versioned URL, or null. */
    async get(url) {
      stats.gets++;
      try { const cache = await open(); if (!cache) return null; const res = await cache.match(key(url)); if (!res) return null; const buf = await res.arrayBuffer(); stats.hits++; return buf; } catch { return null; }
    },
    /** Saves bytes under a versioned URL. false = not saved (no storage, too big for the budget, quota). Never throws. */
    async put(url, buffer, { tier = "background", contentType = "application/octet-stream" } = {}) {
      stats.puts++;
      try {
        const cache = await open(); if (!cache) throw new Error("no cache");
        const size = buffer.byteLength, k = key(url);
        if (size > (await getLimit())) throw new Error("larger than the whole budget");
        const old = await metaOf(k, cache).catch(() => null);
        if (!(await makeRoom(cache, size - (old?.bytes ?? 0)))) throw new Error("no room");
        const headers = { "content-type": contentType, "content-length": String(size), "x-oau-bytes": String(size), "x-oau-tier": tier, "x-oau-at": String(now()) };
        try { await cache.put(k, new Response(buffer, { headers })); }
        catch (e) { // quota: free half of what we hold and try once more
          if (!/quota/i.test(String(e?.name ?? e))) throw e;
          limit = Math.max(MB, Math.floor((await ensureTally(cache)) / 2)); tally = null; await makeRoom(cache, size); await cache.put(k, new Response(buffer, { headers }));
        }
        tally = (await ensureTally(cache)) + size - (old?.bytes ?? 0); return true;
      } catch { stats.putFailures++; return false; }
    },
    async delete(url) { try { const cache = await open(); const ok = cache ? await cache.delete(key(url)) : false; tally = null; return ok; } catch { return false; } },
    /** Deletes every entry whose URL is not in `valid` (a Set of versioned URLs as the manifest spells them: "/models/x.glb?v=abc"). Returns how many went. */
    async prune(valid) {
      try {
        const cache = await open(); if (!cache) return 0; let n = 0;
        for (const req of await cache.keys()) {
          const u = new URL(req.url); if (valid.has(u.pathname + u.search)) continue;
          if (await cache.delete(req).catch(() => false)) n++;
        }
        stats.pruned += n; tally = null; return n;
      } catch { return 0; }
    },
    async usage() { try { const cache = await open(); if (!cache) return { entries: 0, bytes: 0, budget: await getLimit() }; const all = await scan(cache); return { entries: all.length, bytes: all.reduce((s, m) => s + m.bytes, 0), budget: await getLimit() }; } catch { return { entries: 0, bytes: 0, budget: 0 }; } },
    /** Forget the in-memory bookkeeping (tests, and after another tab changed the cache). */
    reset() { cachePromise = null; tally = null; limit = null; },
  };
}
