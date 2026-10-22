// lib/avatarDirectory.js
// The browser's memory of "what does player X look like": name -> { gender, look, key }. No imports, so it runs (and is tested) anywhere.
// Many avatars on one screen (an inbox, a leaderboard) ask in the same moment; their names are gathered into ONE request.
// An entry is used at once and refreshed quietly when it is older than `ttl`, so a player who changes their look shows up changed without anyone reloading.
//
// createDirectory({ fetchLooks(names) -> { [lowercase name]: entry }, now, ttl, wait }) -> { peek, request, seed, forget, subscribe }

const lc = (n) => String(n ?? "").trim().toLowerCase();

export function createDirectory({ fetchLooks, now = () => Date.now(), ttl = 5 * 60_000, missTtl = 60_000, wait = 25, chunk = 60 } = {}) {
  const have = new Map(); // lowercase name -> { entry, at }
  const none = new Map(); // lowercase name -> when the server said "no such player"
  const asking = new Map(); // lowercase name -> Promise (so the same name is never asked twice at once)
  const subs = new Set();
  let queue = new Set(), timer = null;
  const tell = (k) => subs.forEach((f) => { try { f(k); } catch { /* a listener must not break the others */ } });

  const fresh = (k) => { const h = have.get(k); return !!h && now() - h.at < ttl; };

  /** What is known right now (possibly a little old), or null. */
  const peek = (name) => have.get(lc(name))?.entry ?? null;

  /** Put a known look in at once (the player's own character right after saving it; a look that arrived with other data). A changed look tells everyone drawing that name. */
  function seed(name, gender, look, key) {
    const k = lc(name); if (!k) return;
    const prev = have.get(k)?.entry;
    have.set(k, { entry: { name, gender, look, key }, at: now() }); none.delete(k);
    if (!prev || prev.key !== key) tell(k);
  }

  /** Forget a name (it was renamed, or its look is known to have changed): the next request asks the server again. */
  function forget(name) { const k = lc(name); have.delete(k); none.delete(k); tell(k); }

  async function flush() {
    timer = null;
    const names = [...queue]; queue = new Set();
    for (let i = 0; i < names.length; i += chunk) {
      const part = names.slice(i, i + chunk);
      const p = (async () => {
        let got = null;
        try { got = await fetchLooks(part); } catch { got = null; }
        for (const k of part) {
          const e = got?.[k];
          if (e) { const prev = have.get(k)?.entry; have.set(k, { entry: e, at: now() }); none.delete(k); if (!prev || prev.key !== e.key) tell(k); }
          else if (got) none.set(k, now()); // a definite "no such player"
          // got === null: the request failed. Keep whatever is known and try again on the next ask.
        }
      })();
      part.forEach((k) => asking.set(k, p));
      await p; part.forEach((k) => asking.delete(k));
    }
  }

  /** Make sure `name` is known and not stale. Resolves to the entry (or null when there is no such player or the server cannot be reached and nothing is known). */
  function request(name) {
    const k = lc(name); if (!k) return Promise.resolve(null);
    if (fresh(k)) return Promise.resolve(peek(k));
    if (none.has(k) && now() - none.get(k) < missTtl) return Promise.resolve(null);
    if (asking.has(k)) return asking.get(k).then(() => peek(k));
    queue.add(k);
    const done = new Promise((res) => {
      const check = () => { if (!queue.has(k) && !asking.has(k)) res(peek(k)); else setTimeout(check, wait); };
      setTimeout(check, wait + 1);
    });
    if (!timer) timer = setTimeout(flush, wait);
    return done;
  }

  const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
  return { peek, request, seed, forget, subscribe, _size: () => have.size };
}
