// lib/audio/engineVoice.js
// One engine, as sound. A voice is a small Web Audio graph built from an engine profile (profiles.js) and driven every few frames by the engine model (engineModel.js):
//
//   exhaust pulse: two oscillators playing the profile's harmonic stack at the firing frequency (the second a few cents off, so the pair slowly beats, like a real engine)
//   + a half-order lump (triangle at half the firing rate) + a diesel clatter (the sound pulsing at the firing rate)   ->  a low-pass that opens with throttle and revs
//   + intake / mechanical noise (band-passed noise that rises with revs)
//   all of it with a slow random wander in pitch, so no two revolutions are exactly alike: it never sounds like a loop, and there are no samples to repeat.
//
// An "exterior" voice (another vehicle) also passes through an air filter (far = muffled) and a panner (placed in the world); your own vehicle's voice goes straight out.
// A voice is cheap to run (about a dozen nodes; the light version about eight), is created once, and is disposed completely when its vehicle goes.
import { makePanner, setPannerPos, noiseSource, startNoise, airCutoff, clamp } from "./spatial.js";

const waves = new WeakMap();
/** The exhaust pulse of a profile: harmonic n with weight n^-tilt (even ones scaled by `even`). Built once per profile per context. */
function pulseWave(ctx, P) {
  let m = waves.get(ctx); if (!m) waves.set(ctx, (m = new Map()));
  let w = m.get(P); if (w) return w;
  const n = (P.wave?.n ?? 20) + 1, re = new Float32Array(n), im = new Float32Array(n);
  for (let h = 1; h < n; h++) im[h] = Math.pow(h, -(P.wave?.tilt ?? 1)) * (h % 2 === 0 ? P.wave?.even ?? 0.8 : 1);
  w = ctx.createPeriodicWave(re, im, { disableNormalization: false }); m.set(P, w); return w;
}

/**
 * ctx, dest: where to play. P: an engine profile. opts: { spatial (exterior: panned and filtered by distance), lite (fewer nodes, for phones) }.
 * Returns { update(s), setPosition(x, y, z), fadeOut(sec), dispose(), alive }.
 */
export function createEngineVoice(ctx, dest, P, { spatial = false, lite = false } = {}) {
  const t0 = ctx.currentTime, all = [], src = [];
  const node = (n) => (all.push(n), n);
  const out = node(ctx.createGain()); out.gain.value = 0;
  let air = null, panner = null;
  if (spatial) { air = node(ctx.createBiquadFilter()); air.type = "lowpass"; air.frequency.value = 12000; panner = node(makePanner(ctx)); out.connect(air); air.connect(panner); panner.connect(dest); } else out.connect(dest);

  const lp = node(ctx.createBiquadFilter()); lp.type = "lowpass"; lp.Q.value = P.ev ? 2.2 : 0.8; lp.frequency.value = P.cut[0];
  const am = node(ctx.createGain()); am.gain.value = 1 - (P.knock ?? 0) * 0.5; lp.connect(am); am.connect(out);
  const wave = pulseWave(ctx, P), f0 = P.ev ? P.fMin : Math.max(8, (P.idle / 60) * P.cyl / 2);
  const osc = (type, detune = 0) => { const o = node(ctx.createOscillator()); if (type) o.type = type; else o.setPeriodicWave(wave); o.frequency.value = f0; o.detune.value = detune; src.push(o); return o; };
  const mainOsc = osc(null), g1 = node(ctx.createGain()); g1.gain.value = 0.55; mainOsc.connect(g1); g1.connect(lp);
  let osc2 = null; if (!lite) { osc2 = osc(null, 7 + Math.random() * 6); const g2 = node(ctx.createGain()); g2.gain.value = 0.38; osc2.connect(g2); g2.connect(lp); }
  let sub = null; if (P.sub > 0) { sub = osc("triangle"); const gs = node(ctx.createGain()); gs.gain.value = P.sub * 0.55; sub.connect(gs); gs.connect(lp); }
  let knock = null; if ((P.knock ?? 0) > 0 && !lite) { knock = osc("sine"); const kd = node(ctx.createGain()); kd.gain.value = P.knock * 0.5; knock.connect(kd); kd.connect(am.gain); }
  // intake and mechanical noise, past the tone filter so it keeps its hiss
  const ns = node(noiseSource(ctx, 0.9 + Math.random() * 0.2)), bp = node(ctx.createBiquadFilter()), gn = node(ctx.createGain()); bp.type = "bandpass"; bp.Q.value = 0.7; bp.frequency.value = 400; gn.gain.value = 0; ns.connect(bp); bp.connect(gn); gn.connect(out); src.push(ns);
  for (const s of src) { if (s === ns) startNoise(s); else s.start(t0 + Math.random() * 0.05); }

  let wander = 0, alive = true, last = t0;
  const api = {
    get alive() { return alive; },
    /** s: { rpm, rpmN (0..1), load (0..1), level (0..1: the channel volume and any ducking), dop (pitch ratio), dist (m, exterior only), facing (-1 receding .. 1 approaching) } */
    update(s) {
      if (!alive) return; const t = ctx.currentTime, dt = clamp(t - last, 0.005, 0.25); last = t;
      wander += (Math.random() - 0.5) * (P.jitter ?? 0.004) * 6 - wander * dt * 3; wander = clamp(wander, -(P.jitter ?? 0.004) * 3, (P.jitter ?? 0.004) * 3);   // a slow random drift that pulls back to nothing
      const rpmN = clamp(s.rpmN ?? 0, 0, 1), load = clamp(s.load ?? 0, 0, 1), dop = s.dop ?? 1;
      const f = (P.ev ? P.fMin + (P.fMax - P.fMin) * rpmN : (s.rpm / 60) * P.cyl / (P.stroke === 2 ? 1 : 2)) * dop * (1 + wander), tc = 0.035;
      mainOsc.frequency.setTargetAtTime(f, t, tc); osc2?.frequency.setTargetAtTime(f, t, tc); sub?.frequency.setTargetAtTime(f / 2, t, tc); knock?.frequency.setTargetAtTime(f, t, tc);
      const open = P.ev ? 0.4 + 0.6 * rpmN : 0.2 + 0.4 * rpmN + 0.4 * load, face = 0.85 + 0.15 * (s.facing ?? 0);
      lp.frequency.setTargetAtTime((P.cut[0] + (P.cut[1] - P.cut[0]) * open) * face, t, 0.06);
      const idleG = P.ev ? 0 : 0.34, body = P.ev ? 0.15 + 0.85 * rpmN : idleG + (1 - idleG) * (0.3 * rpmN + 0.7 * load);
      out.gain.setTargetAtTime((P.gain ?? 0.6) * body * (s.level ?? 1) * (s.rpm < 40 && !P.ev ? 0 : 1), t, 0.05);
      bp.frequency.setTargetAtTime(350 + 2600 * rpmN, t, 0.08); gn.gain.setTargetAtTime((P.noise ?? 0.1) * (0.25 + 0.75 * load) * (0.4 + 0.6 * rpmN), t, 0.08);
      if (air) air.frequency.setTargetAtTime(airCutoff(s.dist ?? 0) * (0.8 + 0.2 * (s.facing ?? 0)), t, 0.1);
    },
    setPosition(x, y, z) { if (panner) setPannerPos(panner, x, y, z); },
    /** Let the sound fall away over `sec` seconds, then free everything. */
    fadeOut(sec = 0.25) { if (!alive) return; alive = false; const t = ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, sec / 4); setTimeout(() => api.dispose(true), sec * 1000 + 80); },
    dispose(already) { if (!already) alive = false; for (const s of src) { try { s.stop(); } catch { /* already stopped */ } } for (const n of all) { try { n.disconnect(); } catch { /* already gone */ } } src.length = all.length = 0; },
  };
  return api;
}
