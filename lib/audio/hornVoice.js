// lib/audio/hornVoice.js
// Car horns, built from reeds (a pair of buzzing tones a third apart, like a real two-tone horn). Each vehicle category has its own (profiles.js: HORNS).
//   playHorn()   a honk or a pattern of honks ("toot", "double", "long", "peep"): positional when given a place in the world, then it frees itself
//   holdHorn()   the player's own horn: sounds for as long as the button is held (never shorter than a real horn's first blast), then lets go
// Horns are short-lived and capped by the caller (tripAudio keeps at most a few alive), so they cost nothing when nobody is honking.
import { makePanner, setPannerPos, airCutoff } from "./spatial.js";
import { PATTERNS } from "./profiles.js";

/** Builds the reeds of horn H into `dest` starting at time t0 (s), lasting `dur`. Returns { oscs, nodes, release(t) }. */
function reeds(ctx, dest, H, t0, dur, gain, sustain) {
  const oscs = [], nodes = [], env = ctx.createGain(); nodes.push(env);
  env.gain.setValueAtTime(0.0001, t0); env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012);
  if (!sustain) { env.gain.setValueAtTime(Math.max(0.0002, gain), Math.max(t0 + 0.012, t0 + dur - 0.06)); env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); }
  env.connect(dest);
  for (const T of H.tones) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = T.type; o.frequency.setValueAtTime(T.f, t0); g.gain.value = T.vol; oscs.push(o); nodes.push(g);
    let tail = o;
    if (T.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = T.lp; o.connect(f); tail = f; nodes.push(f); }
    if (T.buzz) { const l = ctx.createOscillator(), d = ctx.createGain(); l.frequency.value = 95; d.gain.value = T.buzz; l.connect(d); d.connect(o.frequency); oscs.push(l); nodes.push(d); }   // the reed's rasp
    tail.connect(g); g.connect(env);
  }
  for (const o of oscs) o.start(t0);
  return { oscs, nodes, env, stopAt(t) { for (const o of oscs) { try { o.stop(t); } catch { /* already stopped */ } } } };
}
const free = (nodes, ms) => setTimeout(() => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } }, ms);

/**
 * H: a horn from HORNS. opts: { pattern: "toot"|"double"|"long"|"peep"|"tap", level (0..1), pos: { x, y, z } | null, dist (m; for the muffling of a far horn) }.
 * Returns { stop() }.
 */
export function playHorn(ctx, dest, H, { pattern = "toot", level = 1, pos = null, dist = 0 } = {}) {
  const beats = PATTERNS[pattern] ?? PATTERNS.toot, t0 = ctx.currentTime + 0.01, nodes = [], stops = [];
  let sink = dest;
  if (pos) { const air = ctx.createBiquadFilter(); air.type = "lowpass"; air.frequency.value = airCutoff(dist); const p = makePanner(ctx, { ref: 8, rolloff: 1.1, max: 300 }); setPannerPos(p, pos.x, pos.y ?? 1, pos.z); air.connect(p); p.connect(dest); nodes.push(air, p); sink = air; }
  let end = t0;
  for (const [at, len] of beats) { const r = reeds(ctx, sink, H, t0 + at, len, 0.55 * level, false); nodes.push(...r.nodes); r.stopAt(t0 + at + len + 0.05); stops.push(r); end = Math.max(end, t0 + at + len); }
  const ms = (end - ctx.currentTime) * 1000 + 250; free(nodes, ms);
  return { stop() { for (const r of stops) { try { r.env.gain.cancelScheduledValues(ctx.currentTime); r.env.gain.setTargetAtTime(0, ctx.currentTime, 0.015); r.stopAt(ctx.currentTime + 0.1); } catch { /* done */ } } } };
}

/** The player's horn: starts now, sounds until release() (at least `min` seconds, as a real horn is never a click). */
export function holdHorn(ctx, dest, H, { level = 1, min = 0.16 } = {}) {
  const t0 = ctx.currentTime + 0.005, r = reeds(ctx, dest, H, t0, 0, 0.55 * level, true); let done = false;
  const stop = () => { if (done) return; done = true; const t = ctx.currentTime; r.env.gain.cancelScheduledValues(t); r.env.gain.setTargetAtTime(0.0001, t, 0.02); r.stopAt(t + 0.16); free(r.nodes, 400); };
  return { release() { const wait = Math.max(0, t0 + min - ctx.currentTime); if (wait > 0) setTimeout(stop, wait * 1000); else stop(); }, stop };
}
