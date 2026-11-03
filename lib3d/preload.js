// lib3d/preload.js
// Builds models BEFORE the player asks for them, a little at a time, while the browser is idle. Nothing here can make the game wait: a job runs only in an idle slot,
// one job per slot, and the queue is small and de-duplicated, so asking for the same thing ten times costs once.
//
//   const q = createPreloader({ pressure: () => cache.stats().bytes / cache.stats().budget });
//   q.enqueue({ key: "car:camry:body:#222", priority: 1, run: () => ... });   // lower number = sooner (0 = the thing they are about to use)
//
// Memory is protected two ways: the queue is capped (the oldest, least important jobs are dropped), and when the cache is nearly full only the most important jobs
// (priority <= `essential`) still run, so "load everything in the background" can never push the game towards the browser's memory limit.

/** Runs fn in the next idle moment (requestIdleCallback), or soon after when the browser has none (Safari). fn gets the idle budget in ms. */
export function idleSchedule(fn) {
  if (typeof requestIdleCallback === "function") { const id = requestIdleCallback((d) => fn(d.timeRemaining()), { timeout: 1500 }); return () => cancelIdleCallback(id); }
  const id = setTimeout(() => fn(12), 48); return () => clearTimeout(id);
}

export function createPreloader({ schedule = idleSchedule, pressure = () => 0, essential = 1, highPressure = 0.85, maxQueue = 48, minSlotMs = 6, onJob } = {}) {
  const queue = []; // { key, run, priority, seq }
  const done = new Set(); let seq = 0, cancel = null, running = false, paused = false, ran = 0, skipped = 0, dropped = 0, ema = 0, idleWaiters = [];

  const settle = () => { if (!queue.length && !running) { const w = idleWaiters; idleWaiters = []; w.forEach((f) => f()); } };
  const arm = () => { if (cancel || paused || running || !queue.length) return; cancel = schedule(slot); };

  function slot(budgetMs) {
    cancel = null; if (paused || !queue.length) return settle();
    // not enough idle time left for a job like the ones before it: wait for the next slot instead of dropping a frame
    if (budgetMs < Math.max(minSlotMs, ema * 0.8) && ran > 0 && queue[0].priority > 0) return arm();
    queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const job = queue.shift();
    if (job.priority > essential && pressure() >= highPressure) { skipped++; return arm(); } // cache nearly full: only essential work still runs
    running = true; const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    try { job.run(); done.add(job.key); ran++; } catch (e) { onJob?.({ key: job.key, error: e }); }
    const dt = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0; ema = ema ? ema * 0.7 + dt * 0.3 : dt; onJob?.({ key: job.key, ms: dt });
    running = false; if (queue.length) arm(); else settle();
  }

  return {
    /** Adds a job. The same key is only queued once (asking again can only make it sooner); a key that already ran is ignored until forget(key). */
    enqueue({ key, run, priority = 2 }) {
      if (done.has(key)) return false;
      const q = queue.find((j) => j.key === key);
      if (q) { if (priority < q.priority) q.priority = priority; return false; }
      queue.push({ key, run, priority, seq: seq++ });
      if (queue.length > maxQueue) { queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq); queue.length = maxQueue; dropped++; } // least important and newest go first
      arm(); return true;
    },
    /** Lets a key be queued again (for example after the cache evicted what it built). */
    forget(key) { done.delete(key); },
    cancel(key) { const i = queue.findIndex((j) => j.key === key); if (i >= 0) queue.splice(i, 1); },
    clear() { queue.length = 0; if (cancel) { cancel(); cancel = null; } settle(); },
    pause() { paused = true; if (cancel) { cancel(); cancel = null; } },
    resume() { paused = false; arm(); },
    /** Runs everything that is queued right now, without waiting for idle time (tests, and the moment a player is clearly about to need it). */
    flush() { while (queue.length) { queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq); const j = queue.shift(); try { j.run(); done.add(j.key); ran++; } catch (e) { onJob?.({ key: j.key, error: e }); } } if (cancel) { cancel(); cancel = null; } settle(); },
    idle() { return queue.length || running ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve(); },
    stats: () => ({ queued: queue.length, ran, skipped, dropped, avgJobMs: ema }),
  };
}
