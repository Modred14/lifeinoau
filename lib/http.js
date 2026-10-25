// lib/http.js
// The browser's one way to talk to the API. No imports and no globals are touched at load time (fetch, the clock and the
// online check are handed in), so it runs the same in the browser and in a Node test. lib/client.js wires it to the real ones.
//
// What it guarantees:
//  - A request never hangs forever: every call has a timeout, and a caller can cancel one with an AbortSignal.
//  - If the browser is offline the call fails at once instead of waiting for a timeout.
//  - A request that carries a `requestId` is safe to send again (the server answers a repeat with { duplicate: true } and
//    changes nothing), so a lost answer is retried automatically with the SAME id. If the retry comes back "duplicate",
//    the first try had gone through: that is reported as `replayed: true`.
//  - If even the retry gets no answer, the outcome is UNKNOWN (the server may have done it). The id is remembered for a
//    couple of minutes: when the player taps the same thing again, the same id is sent, so it can never be charged twice.

const GENERIC = "Something went wrong. Please try again.";
export const NO_NET = "No connection. Check your network and try again.";
export const SLOW = "This is taking too long. Check your connection and try again.";
// Anything that smells like a stack trace, ORM message or driver error never reaches a toast.
const LEAKY = /prisma|sqlstate|\bP\d{4}\b|invalid `|ECONN|ENOTFOUND|node_modules|\.m?js:\d+|\bat\s+\S+\s+\(.*:\d+:\d+\)/i;

export function safeError(status, error) {
  if (typeof error !== "string" || !error.trim()) return status >= 500 ? GENERIC : undefined;
  return status >= 500 || error.length > 200 || LEAKY.test(error) ? GENERIC : error;
}

// the same request body always gives the same text, whatever order its keys were written in
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export function createCaller({
  fetchImpl = (...a) => fetch(...a),
  online = () => typeof navigator === "undefined" || navigator.onLine !== false,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onAuthChange = () => {},
  getMs = 15_000, // a read
  postMs = 20_000, // a change
  retryDelay = 600,
  memoryMs = 120_000, // how long an "unknown outcome" request id is remembered
} = {}) {
  const unknown = new Map(); // what was asked -> { id, at }
  const reading = new Map(); // path -> Promise of a plain read that is on its way right now (shared by every caller that asks the same thing)

  async function once(path, init, ms, outer) {
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, ms);
    const onAbort = () => ac.abort();
    if (outer) outer.aborted ? ac.abort() : outer.addEventListener("abort", onAbort, { once: true });
    try {
      const r = await fetchImpl(path, { ...init, signal: ac.signal });
      const j = await r.json().catch(() => ({})); // the abort also covers a body that stalls half way
      return { r, j };
    } catch {
      return { err: outer?.aborted ? "aborted" : timedOut ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener?.("abort", onAbort);
    }
  }

  /** call(path) reads, call(path, body) changes. opts: { signal, timeout, retries }. Never throws.
   *  Two identical reads at the same moment (two screens opening at once, a poll and a focus refresh) share ONE request. A read that carries
   *  its own AbortSignal or a custom timeout is never shared, so cancelling it can not cancel somebody else's. Every caller still gets its own copy of the answer. */
  function call(path, body, opts = {}) {
    // A change starts a new generation of reads: a read asked AFTER it must never join one that left BEFORE it (that answer may not show the change).
    if (body) reading.clear();
    if (body || opts.signal || opts.timeout != null || opts.retries != null || opts.fresh) return send(path, body, opts);
    let p = reading.get(path);
    if (!p) { p = send(path, body, opts).finally(() => { if (reading.get(path) === p) reading.delete(path); }); reading.set(path, p); }
    return p.then((r) => ({ ...r }));
  }

  async function send(path, body, opts = {}) {
    const rid = typeof body?.requestId === "string" && body.requestId.length > 0;
    const intent = rid ? path + "|" + stable({ ...body, requestId: undefined }) : null;
    let sent = body, reused = false;
    if (rid) {
      const u = unknown.get(intent);
      if (u && now() - u.at < memoryMs) { sent = { ...body, requestId: u.id }; reused = u.id !== body.requestId; }
      else unknown.delete(intent);
    }
    if (opts.signal?.aborted) return { failed: true, status: 0, aborted: true };
    if (!online()) return { failed: true, status: 0, offline: true, error: NO_NET }; // never left the device, so nothing is "unknown"

    const init = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(sent) : undefined };
    const ms = opts.timeout ?? (body ? postMs : getMs);
    const attempts = 1 + (rid ? (opts.retries ?? 1) : 0);
    let last = null;
    for (let i = 0; i < attempts; i++) {
      const a = await once(path, init, ms, opts.signal);
      if (a.err === "aborted") return { failed: true, status: 0, aborted: true };
      if (!a.err && !(rid && a.r.status >= 500 && i + 1 < attempts)) {
        const { r, j } = a;
        if (rid) unknown.delete(intent); // a real answer: nothing is unknown any more
        if (r.ok && /^\/api\/(login|signup|logout)$/.test(path)) onAuthChange(); // someone else may be signed in now: forget cached screens
        return {
          ...j,
          status: r.status,
          failed: !r.ok,
          ...(r.ok ? {} : { error: safeError(r.status, j.error) }),
          ...(j.duplicate && (i > 0 || reused) ? { replayed: true } : {}),
        };
      }
      last = a.err ?? "server";
      if (i + 1 < attempts) {
        await sleep(retryDelay * (i + 1));
        if (opts.signal?.aborted) return { failed: true, status: 0, aborted: true };
        if (!online()) break;
      }
    }
    if (rid) unknown.set(intent, { id: sent.requestId, at: now() }); // the server may have done it: reuse this id next time
    return { failed: true, status: 0, timedOut: last === "timeout", unknown: rid, error: last === "timeout" ? SLOW : NO_NET };
  }

  return { call, _unknown: unknown };
}