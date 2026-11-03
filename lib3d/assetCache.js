// lib3d/assetCache.js
// A small reference-counted cache for things that are expensive to build and never change afterwards: merged vehicle geometry, wheel geometry, parsed models.
// It knows nothing about three.js (the owner says how big a thing is and how to free it), so it runs, and is tested, in plain Node.
//
// THE RULES
//  - acquire() hands out a handle. While any handle is held the entry can never be evicted or freed: nobody's model disappears under them.
//  - release() is safe to call twice. When the last handle goes the entry stays warm (that is the whole point) but may now be evicted.
//  - Over budget, only entries nobody holds are evicted: lowest `priority` first (a HIGHER number is kept longer), then least recently used. Held entries are never touched, so the cache
//    may sit above its budget while a lot is in use. That is deliberate: game stability beats the memory target.
//  - What is cached is SHARED and must be treated as read-only. Anything that changes per object (position, doors, lamps, paint state) belongs to the
//    object that uses the cached value, never to the value itself.
//  - A build that throws caches nothing, so asking again really tries again. Concurrent async builds of one key share one build.

const MB = 1024 * 1024;

/** Cache budgets for CPU-side geometry: smaller on phones and low-memory devices, where the browser kills the tab long before a desktop would struggle. */
export function defaultBudgetBytes(env = globalThis) {
  const nav = env.navigator ?? {}, mem = Number(nav.deviceMemory) || 0;
  let coarse = false; try { coarse = !!env.matchMedia?.("(pointer: coarse)")?.matches; } catch { /* no matchMedia */ }
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(String(nav.userAgent ?? ""));
  return (mem && mem <= 4) || coarse || phone ? 12 * MB : 32 * MB;
}

/** Bytes held by a BufferGeometry (or anything shaped like one: { attributes: { a: { array } }, index?: { array } }). Used as the size of cached geometry. */
export function geometryBytes(g) {
  if (!g) return 0;
  let n = g.index?.array?.byteLength ?? 0;
  for (const k in g.attributes ?? {}) n += g.attributes[k]?.array?.byteLength ?? 0;
  return n;
}

export function createAssetCache({ budgetBytes = defaultBudgetBytes(), now = () => Date.now() } = {}) {
  const entries = new Map(), pending = new Map();
  let bytes = 0, budget = budgetBytes;
  const st = { hits: 0, misses: 0, evictions: 0, builds: 0, buildMs: 0, dedupedBuilds: 0 };
  const clock = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  const sizeOf = (value, opt) => { try { const b = typeof opt.bytes === "function" ? opt.bytes(value) : opt.bytes; return Number.isFinite(b) && b > 0 ? b : 0; } catch { return 0; } };
  const free = (e) => { try { e.dispose?.(e.value); } catch { /* freeing must never throw into the game */ } };

  function handleFor(e) {
    e.refs++; e.uses++; e.last = now(); let open = true;
    return { key: e.key, value: e.value, release() { if (!open) return; open = false; e.refs = Math.max(0, e.refs - 1); e.last = now(); if (e.refs === 0 && entries.get(e.key) === e) trim(); } };
  }
  function insert(key, value, opt) {
    const e = { key, value, bytes: sizeOf(value, opt), refs: 0, uses: 0, last: now(), priority: opt.priority ?? 0, dispose: opt.dispose };
    entries.set(key, e); bytes += e.bytes; return e;
  }

  /** Evicts unheld entries, lowest priority (kept-longest = highest number) then least recently used first, until the cache fits its budget (or only held entries are left). Returns how many went. */
  function trim() {
    if (bytes <= budget) return 0;
    const idle = [...entries.values()].filter((e) => e.refs === 0).sort((a, b) => a.priority - b.priority || a.last - b.last);
    let n = 0;
    for (const e of idle) { if (bytes <= budget) break; entries.delete(e.key); bytes -= e.bytes; st.evictions++; n++; free(e); }
    return n;
  }

  /** Synchronous: the cached value for `key`, built by build() the first time. opt: { bytes: number | (value) => number, dispose(value), priority } */
  function acquire(key, build, opt = {}) {
    let e = entries.get(key);
    if (e) { st.hits++; return handleFor(e); }
    st.misses++; const t0 = clock(), value = build(); st.builds++; st.buildMs += clock() - t0;
    e = insert(key, value, opt); const h = handleFor(e); trim(); return h;
  }

  /** Asynchronous: like acquire(), and two callers asking for one key at once share a single build. */
  async function acquireAsync(key, build, opt = {}) {
    const hit = entries.get(key); if (hit) { st.hits++; return handleFor(hit); }
    let p = pending.get(key);
    if (p) st.dedupedBuilds++;
    else {
      st.misses++; const t0 = clock();
      p = Promise.resolve().then(build).then((value) => { st.builds++; st.buildMs += clock() - t0; return entries.get(key) ?? insert(key, value, opt); }).finally(() => pending.delete(key));
      pending.set(key, p);
    }
    const e = await p; const h = handleFor(e); trim(); return h;
  }

  /** Builds `key` now if it is not cached and lets go at once: it stays warm and evictable. Returns true when it had to build. */
  function warm(key, build, opt = {}) { const had = entries.has(key), h = acquire(key, build, opt); h.release(); return !had; }

  return {
    acquire, acquireAsync, warm, trim,
    has: (key) => entries.has(key),
    refs: (key) => entries.get(key)?.refs ?? 0,
    keys: () => [...entries.keys()],
    /** Calls fn(value, key) for every cached entry (held or not). */
    each(fn) { for (const e of [...entries.values()]) { try { fn(e.value, e.key); } catch { /* one bad entry must not stop the rest */ } } },
    setBudget(b) { budget = Math.max(0, b); return trim(); },
    /** Frees every entry nobody holds (held ones stay). */
    clear() { for (const e of [...entries.values()]) if (e.refs === 0) { entries.delete(e.key); bytes -= e.bytes; st.evictions++; free(e); } },
    stats() { let held = 0; for (const e of entries.values()) if (e.refs > 0) held++; return { entries: entries.size, held, bytes, budget, ...st, hitRate: st.hits + st.misses ? st.hits / (st.hits + st.misses) : 0 }; },
  };
}
