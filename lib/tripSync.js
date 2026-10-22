// lib/tripSync.js
// Keeps the server (and so other players) up to date with a trip WITHOUT ever being on the path of the player's own movement.
//
// The player moves locally, every frame, from local input. This module only reports where they are in the background and reads where other travellers are:
//   - one request in flight per direction at a time, never a pile-up behind a slow connection;
//   - each report carries the LATEST pose at the moment it is sent (older unsent poses are simply dropped: they are coalesced, not queued);
//   - a player who has not moved sends only a slow heartbeat, a moving one at most every `posMs`;
//   - a failure backs off (doubling, with jitter, up to `maxBackoff`) and the very next success returns to the normal pace;
//   - going back online or returning to the tab sends straight away (`nudge`);
//   - a stale reply (from before `stop()`) is ignored, and `stop()` aborts what is in flight;
//   - the server's answer about OTHER travellers is applied as it arrives: it never touches the local player, so a slow or failed answer cannot move you.
// Pure JS: the transport, the timers and the clock are injected, so it runs the same in the browser and in the tests.

const DEFAULTS = { posMs: 2000, idleMs: 5000, roadMs: 2500, maxBackoff: 10000, still: 0.3, turn: 0.08, staleRoadMs: 20000 };

export function createTripSync(o) {
  const { getPose, send, fetchRoad, onTravellers, clear, now = () => Date.now(), setT = (f, ms) => setTimeout(f, ms), clearT = (t) => clearTimeout(t), isOnline = () => true, isHidden = () => false, rnd = Math.random } = o;
  const cfg = { ...DEFAULTS, ...o.config };
  const stats = { sent: 0, skipped: 0, failed: 0, polls: 0, pollsFailed: 0 };
  let alive = false, gen = 0, posT = null, roadT = null, posFails = 0, roadFails = 0, sent = null, sentAt = 0, lastRoadOk = 0, roadCleared = false, posBusy = false, roadBusy = false, acPos = null, acRoad = null, halted = false;
  const wait = (base, fails) => Math.round(Math.min(cfg.maxBackoff, base * 2 ** Math.min(fails, 4)) * (0.9 + rnd() * 0.2));
  const dead = (r) => r && r.failed && (r.status === 401 || r.status === 403); // the server will not take this player's reports (signed out, not allowed): stop asking

  const changed = (p) => !sent || p.mode !== sent.mode || Math.hypot(p.x - sent.x, p.z - sent.z) > cfg.still || Math.abs((p.h ?? 0) - (sent.h ?? 0)) > cfg.turn || now() - sentAt >= cfg.idleMs;

  async function tickPos() {
    posT = null; if (!alive || halted) return; const myGen = gen;
    if (!isHidden() && isOnline()) {
      const p = getPose();
      if (p && changed(p)) {
        const g = gen, ac = typeof AbortController === "function" ? new AbortController() : { signal: undefined, abort() {} }; acPos = ac; posBusy = true;
        try {
          const r = await send({ ...p }, { signal: ac.signal });
          if (g !== gen) return; // stopped while it was in flight: the answer means nothing now
          if (r?.aborted) { /* cancelled on purpose */ }
          else if (r?.failed) { posFails++; stats.failed++; if (dead(r)) { halted = true; return; } }
          else { posFails = 0; sent = p; sentAt = now(); stats.sent++; }
        } catch { if (g !== gen) return; posFails++; stats.failed++; }
        finally { if (g === gen) { posBusy = false; acPos = null; } }
      } else stats.skipped++;
    }
    if (alive && myGen === gen) posT = setT(tickPos, posFails ? wait(cfg.posMs, posFails) : cfg.posMs);
  }

  async function tickRoad() {
    roadT = null; if (!alive || halted) return; const myGen = gen;
    if (!isHidden() && isOnline()) {
      const g = gen, ac = typeof AbortController === "function" ? new AbortController() : { signal: undefined, abort() {} }; acRoad = ac; roadBusy = true; stats.polls++;
      try {
        const r = await fetchRoad({ signal: ac.signal });
        if (g !== gen) return;
        if (r?.aborted) { /* cancelled on purpose */ }
        else if (r?.failed) { roadFails++; stats.pollsFailed++; if (dead(r)) { halted = true; return; } }
        else { roadFails = 0; lastRoadOk = now(); roadCleared = false; onTravellers?.(Array.isArray(r?.travellers) ? r.travellers : []); }
      } catch { if (g !== gen) return; roadFails++; stats.pollsFailed++; }
      finally { if (g === gen) { roadBusy = false; acRoad = null; } }
      // a long outage: what we last heard about other travellers is out of date, so stop showing them rather than showing ghosts
      if (alive && myGen === gen && lastRoadOk && !roadCleared && now() - lastRoadOk > cfg.staleRoadMs) { roadCleared = true; onTravellers?.([]); }
    }
    if (alive && myGen === gen) roadT = setT(tickRoad, roadFails ? wait(cfg.roadMs, roadFails) : cfg.roadMs);
  }

  return {
    stats,
    get busy() { return posBusy || roadBusy; },
    start() { if (alive) return; alive = true; halted = false; gen++; posFails = roadFails = 0; sent = null; sentAt = 0; lastRoadOk = now(); roadCleared = false; tickPos(); tickRoad(); },
    /** Send / read now (back online, tab visible again), unless a request is already in flight. */
    nudge() { if (!alive || halted) return; if (posT && !posBusy) { clearT(posT); posT = null; tickPos(); } if (roadT && !roadBusy) { clearT(roadT); roadT = null; tickRoad(); } },
    stop({ clear: wipe = false } = {}) {
      const was = alive; alive = false; gen++; posBusy = roadBusy = false;
      if (posT) clearT(posT); if (roadT) clearT(roadT); posT = roadT = null;
      try { acPos?.abort(); acRoad?.abort(); } catch { /* nothing to abort */ } acPos = acRoad = null;
      if (was && wipe && sent) { try { clear?.(); } catch { /* best effort */ } }
    },
  };
}
