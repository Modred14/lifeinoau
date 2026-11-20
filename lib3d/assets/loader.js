// lib3d/assets/loader.js
// The game's ONE way to download an asset file. Everything else (3D models, textures, map data) is built on bytes(): ask for a path, get the file, from the cheapest place that has it.
//
//   1. a request already in flight for the same file is joined (two components asking for one model download it once),
//   2. the persistent store (Cache Storage: survives reloads and restarts) when it holds a valid copy of THIS version,
//   3. the network, in priority order with a limit on parallel downloads, with progress, then saved to the store for next time.
//
// Failure rules: nothing is remembered about a failure, so asking again really tries again. A bad cached copy (empty, truncated, a web page standing in for a file) is deleted and the file
// is downloaded instead. A store that cannot save only means the next visit downloads again. The game never waits on, or crashes from, the cache.
import { manifest as defaultManifest, tierPriority } from "./manifest.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** What each kind of file must look like to be accepted from the cache or the network. Unknown kinds are accepted as long as they are not empty. */
export function validateBytes(path, buf) {
  if (!buf || !buf.byteLength) return false;
  const p = String(path).toLowerCase(), head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (p.endsWith(".glb")) return head.length === 4 && head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46; // "glTF"
  if (p.endsWith(".json") || p.endsWith(".gltf")) { const s = new Uint8Array(buf, 0, Math.min(64, buf.byteLength)); for (const c of s) { if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xef || c === 0xbb || c === 0xbf) continue; return c === 0x7b || c === 0x5b; } return false; }
  if (p.endsWith(".png")) return head[0] === 0x89 && head[1] === 0x50;
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return head[0] === 0xff && head[1] === 0xd8;
  return true;
}

export function createAssetLoader({ manifest = defaultManifest, store = null, fetchImpl = (...a) => globalThis.fetch(...a), concurrency = 4, retryDelayMs = 300, validate = validateBytes } = {}) {
  const inflight = new Map(), queue = [], listeners = new Set();
  let running = 0, seq = 0;
  const st = { requests: 0, joined: 0, persistentHits: 0, networkFetches: 0, networkBytes: 0, invalidCached: 0, errors: 0, storeSaves: 0 };
  const prog = { active: 0, queued: 0, loadedBytes: 0, totalBytes: 0, completed: 0, failed: 0 };
  const emit = () => { for (const f of listeners) { try { f({ ...prog }); } catch { /* a listener must not break loading */ } } };

  function pump() {
    queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    while (queue.length && (running < concurrency || queue[0].priority === 0)) { const j = queue.shift(); running++; prog.queued = queue.length; run(j); }
    prog.queued = queue.length; prog.active = running;
  }
  const schedule = (job) => { queue.push(job); pump(); };

  async function download(url, path, job) {
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(url, job.signal ? { signal: job.signal } : undefined);
        if (!res.ok) { const e = new Error(`${path}: HTTP ${res.status}`); e.status = res.status; if (res.status < 500) throw Object.assign(e, { final: true }); throw e; }
        if (/text\/html/i.test(res.headers?.get?.("content-type") ?? "")) throw Object.assign(new Error(`${path}: got a web page instead of the file`), { status: 404, final: true });
        const total = Number(res.headers?.get?.("content-length")) || 0; if (total && !job.counted) { prog.totalBytes += total; job.counted = total; }
        let buf;
        if (res.body?.getReader) { // stream, so progress is real
          const reader = res.body.getReader(), parts = []; let got = 0;
          for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.byteLength; prog.loadedBytes += value.byteLength; job.loaded = (job.loaded ?? 0) + value.byteLength; emit(); }
          buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.byteLength; } buf = buf.buffer;
        } else { buf = await res.arrayBuffer(); prog.loadedBytes += buf.byteLength; job.loaded = (job.loaded ?? 0) + buf.byteLength; }
        if (!validate(path, buf)) throw Object.assign(new Error(`${path}: the downloaded file is not valid`), { final: true });
        st.networkFetches++; st.networkBytes += buf.byteLength; return buf;
      } catch (e) {
        last = e; if (e?.final || e?.name === "AbortError" || attempt === 1) break;
        if (job.loaded) { prog.loadedBytes -= job.loaded; job.loaded = 0; } await wait(retryDelayMs);
      }
    }
    throw last;
  }

  async function run(job) {
    try {
      const buf = await download(job.url, job.path, job);
      const info = manifest.info(job.path);
      if (store && manifest.has(job.path)) store.put(job.url, buf, { tier: info?.tier, contentType: "application/octet-stream" }).then((ok) => { if (ok) st.storeSaves++; }).catch(() => {});
      prog.completed++; job.resolve(buf);
    } catch (e) { st.errors++; prog.failed++; job.reject(e); }
    finally { running--; if (job.counted && !job.finished) { job.finished = true; } pump(); emit(); }
  }

  /**
   * The file at `path` (a manifest path such as "/models/avatars/base_male.glb") as an ArrayBuffer. Treat the buffer as read-only: joined callers share it.
   * opt.priority: 0 = needed now (skips the parallel-download limit), 1 = soon, 2 = normal (default), 3 = background. Asking again for a file in flight can only make it sooner.
   */
  function bytes(path, { priority = 2, signal } = {}) {
    st.requests++;
    const url = manifest.url(path), existing = inflight.get(url);
    if (existing) { st.joined++; const q = queue.find((j) => j.url === url); if (q && priority < q.priority) { q.priority = priority; pump(); } return existing.promise; }
    const entry = { promise: null };
    entry.promise = (async () => {
      if (store && manifest.has(path)) {
        const cached = await store.get(url);
        if (cached) { if (validate(path, cached)) { st.persistentHits++; return cached; } st.invalidCached++; store.delete(url); }
      }
      return new Promise((resolve, reject) => { prog.queued++; schedule({ url, path, priority, seq: seq++, signal, resolve, reject }); emit(); });
    })().finally(() => inflight.delete(url));
    inflight.set(url, entry);
    return entry.promise;
  }

  async function json(path, opt) { const buf = await bytes(path, opt); return JSON.parse(new TextDecoder().decode(buf)); }

  return {
    bytes, json,
    /** Downloads `paths` into the store without keeping them in memory (for preloading). Resolves with how many were fetched or already saved. Never rejects. */
    async warm(paths, opt = {}) { let n = 0; await Promise.all(paths.map((p) => bytes(p, { priority: 3, ...opt }).then(() => { n++; }, () => {}))); return n; },
    /** Forgets the saved copy of a file (used when a saved copy downloads fine but turns out not to be usable). */
    async dropCached(path) { if (store && manifest.has(path)) await store.delete(manifest.url(path)); },
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    progress: () => ({ ...prog }),
    stats() { const hit = st.persistentHits, miss = st.networkFetches; return { ...st, inflight: inflight.size, cacheHitRate: hit + miss ? hit / (hit + miss) : 0, store: store?.stats?.() ?? null }; },
    resetStats() { for (const k of Object.keys(st)) st[k] = 0; },
  };
}
