// lib/audio/ambience.js
// The sound of the town around the listener. Built live (no sound files), in two layers, and blended by the weights from zones.js so there are no hard borders:
//
//   BEDS: always running, each one turned up or down by the weight of what causes it, with slow random drift so none of them is a loop you can hear repeat:
//     traffic    the low wash of cars and keke on roads you cannot see (more on busy roads and the expressway)
//     crowd      a murmur of many people talking: noise through vowel-like formants, each drifting on its own
//     nature     leaves and a light breeze (quietest near roads and markets)
//     wind       the rush of speed on the expressway
//     generator  a petrol generator humming somewhere near a hostel: positioned at the hostel itself
//   EVENTS: single sounds that happen now and then, placed in the world around the listener (so you can tell where they came from), each limited by how many may be alive:
//     a distant horn or two, a burst of voices, a trader calling, birds in the day, crickets in short chirps at night in the quiet places, a speaker thumping bass from a hostel at night
// What a place gets is decided by its weights: the market has voices and traders, the hostels a hum and a faint bass, the expressway nothing but road and wind.
import { makePanner, setPannerPos, noiseSource, startNoise, clamp } from "./spatial.js";
import { HORNS } from "./profiles.js";
import { playHorn } from "./hornVoice.js";

const VOWELS = [[800, 1200], [520, 1800], [320, 2300], [500, 900], [350, 700]];   // first two formants of a, e, i, o, u
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (perMin, dt) => Math.random() < 1 - Math.exp((-perMin * dt) / 60);

/**
 * ctx, dest: the context and the node the ambience plays into. ch: { traffic(), town() } the current channel levels 0..1. low: a phone (fewer events, no second crowd layer).
 * Returns { update(dt, W, L), dispose() }. W: the weights from soundWeights(). L: { x, z, night }.
 */
export function createAmbience(ctx, dest, ch, { low = false } = {}) {
  const all = [], src = [], timers = new Set(); let alive = true, driftT = 0, evT = 0, live = 0;
  const maxLive = low ? 2 : 4;
  const node = (n) => (all.push(n), n);
  const bus = (name) => { const g = node(ctx.createGain()); g.gain.value = 0; g.connect(dest); g.name = name; return g; };
  const trafficBus = bus("traffic"), townBus = bus("town");
  const hp = (f) => { const x = node(ctx.createBiquadFilter()); x.type = "highpass"; x.frequency.value = f; return x; };
  const lpf = (f, q = 0.7) => { const x = node(ctx.createBiquadFilter()); x.type = "lowpass"; x.frequency.value = f; x.Q.value = q; return x; };
  const bpf = (f, q) => { const x = node(ctx.createBiquadFilter()); x.type = "bandpass"; x.frequency.value = f; x.Q.value = q; return x; };
  const gain = (v = 0) => { const g = node(ctx.createGain()); g.gain.value = v; return g; };
  const noise = (rate) => { const s = node(noiseSource(ctx, rate)); src.push(s); return s; };

  // ---- beds ----
  const trafficG = gain(0); { const s = noise(0.92), f = lpf(420); s.connect(f); f.connect(trafficG); const s2 = noise(1.05), f2 = lpf(900); s2.connect(f2); const g2 = gain(0.35); f2.connect(g2); g2.connect(trafficG); trafficG.connect(trafficBus); }   // the wash of traffic swells and fades as cars come and go (see update)
  const crowdG = gain(0), formants = []; {
    const layers = low ? 1 : 2;
    for (let l = 0; l < layers; l++) { const s = noise(0.9 + l * 0.17), pre = hp(180); s.connect(pre); for (const [f0, q] of [[480, 5], [1500, 6], [2700, 7]]) { const b = bpf(f0 * (0.9 + l * 0.2), q), g = gain(0.5); pre.connect(b); b.connect(g); g.connect(crowdG); formants.push(g); } }
    crowdG.connect(townBus);
  }
  const breezeG = gain(0); { const s = noise(0.8), f = bpf(1700, 0.45); s.connect(f); f.connect(breezeG); breezeG.connect(townBus); }
  const windG = gain(0); { const s = noise(1.2), f = bpf(700, 0.6), h = hp(120); s.connect(f); f.connect(h); h.connect(windG); windG.connect(trafficBus); }
  // a generator, positioned at the nearest hostel: a 50 Hz engine drone with its buzz
  const genP = node(makePanner(ctx, { ref: 5, rolloff: 1.5, max: 160 })), genG = gain(0); {
    const a = node(ctx.createOscillator()), b = node(ctx.createOscillator()), f = lpf(260, 1.2), n = noise(1), nf = lpf(520), ng = gain(0.18);
    a.type = "sawtooth"; a.frequency.value = 48.7; b.type = "square"; b.frequency.value = 97.8; const bg = gain(0.35); a.connect(f); b.connect(bg); bg.connect(f); n.connect(nf); nf.connect(ng); ng.connect(f); f.connect(genG); genG.connect(genP); genP.connect(townBus); src.push(a, b);
    const wob = node(ctx.createOscillator()), wd = gain(0.7); wob.frequency.value = 0.35; wob.connect(wd); wd.connect(a.frequency); src.push(wob);   // the engine hunts a little
  }
  for (const s of src) { try { if (s.buffer) startNoise(s); else s.start(); } catch { /* ok */ } }

  const drift = () => { for (const g of formants) g.gain.setTargetAtTime(rnd(0.12, 1), ctx.currentTime, rnd(0.25, 0.7)); };

  // ---- events ----
  const track = (nodes, ms) => { live++; const t = setTimeout(() => { timers.delete(t); live--; for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } }, ms); timers.add(t); };
  const placed = (distMin, distMax, y = 1.5) => { const a = Math.random() * Math.PI * 2, d = rnd(distMin, distMax); return { x: L0.x + Math.cos(a) * d, y, z: L0.z + Math.sin(a) * d, d }; };
  let L0 = { x: 0, z: 0 };
  /** One syllable-run of speech-like sound: voiced buzz through two vowel formants. calls: a trader's rising call; otherwise chatter. */
  function voice(p, kind) {
    const t0 = ctx.currentTime + 0.02, out = gain(kind === "call" ? 0.5 : 0.34), pan = makePanner(ctx, { ref: 3, rolloff: 1.5, max: 120 }); setPannerPos(pan, p.x, p.y, p.z);
    const nodes = [out, pan]; out.connect(pan); pan.connect(townBus);
    const syl = kind === "call" ? Math.floor(rnd(2, 5)) : Math.floor(rnd(4, 10)); let t = t0; const f0 = rnd(95, 240), vib = rnd(4.5, 6.5);
    for (let i = 0; i < syl; i++) {
      const dur = kind === "call" ? rnd(0.22, 0.5) : rnd(0.1, 0.24), [a, b] = pick(VOWELS), o = ctx.createOscillator(), e = ctx.createGain(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), v = ctx.createOscillator(), vd = ctx.createGain();
      o.type = "sawtooth"; const base = f0 * (kind === "call" ? 1.1 + i * 0.12 : 1 + rnd(-0.12, 0.12)); o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * (kind === "call" ? 1.18 : 1 + rnd(-0.08, 0.08)), t + dur);
      v.frequency.value = vib; vd.gain.value = base * 0.012; v.connect(vd); vd.connect(o.frequency);
      f1.type = f2.type = "bandpass"; f1.frequency.value = a; f2.frequency.value = b; f1.Q.value = 6; f2.Q.value = 8;
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(1, t + 0.03); e.gain.setValueAtTime(1, t + dur * 0.7); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f1); o.connect(f2); f1.connect(e); f2.connect(e); e.connect(out); o.start(t); v.start(t); o.stop(t + dur + 0.05); v.stop(t + dur + 0.05); nodes.push(o, e, f1, f2, v, vd);
      t += dur + (kind === "call" ? rnd(0.04, 0.12) : rnd(0.02, 0.16));
    }
    track(nodes, (t - ctx.currentTime) * 1000 + 400);
  }
  function chirp(p) {
    const t0 = ctx.currentTime + 0.02, out = gain(0.12), pan = makePanner(ctx, { ref: 4, rolloff: 1.6, max: 90 }); setPannerPos(pan, p.x, p.y, p.z); out.connect(pan); pan.connect(townBus); const nodes = [out, pan]; let t = t0;
    const base = rnd(2600, 4800), n = Math.floor(rnd(2, 6));
    for (let i = 0; i < n; i++) { const o = ctx.createOscillator(), e = ctx.createGain(), d = rnd(0.05, 0.12); o.frequency.setValueAtTime(base * rnd(0.9, 1.1), t); o.frequency.exponentialRampToValueAtTime(base * rnd(0.7, 1.4), t + d); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(1, t + 0.012); e.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(e); e.connect(out); o.start(t); o.stop(t + d + 0.02); nodes.push(o, e); t += d + rnd(0.04, 0.16); }
    track(nodes, (t - ctx.currentTime) * 1000 + 300);
  }
  /** A cricket: a short run of soft pulses (a chirp, two or three times over) and then silence, never a held tone. Each cricket has its own pitch and speed, so a few of them never line up into one steady beeping. */
  function cricket(p) {
    const t0 = ctx.currentTime + 0.02, out = gain(rnd(0.05, 0.085)), pan = makePanner(ctx, { ref: 3, rolloff: 1.7, max: 70 }); setPannerPos(pan, p.x, p.y, p.z); out.connect(pan); pan.connect(townBus); const nodes = [out, pan];
    const f = rnd(4100, 4900), pulses = Math.floor(rnd(3, 6)), gap = rnd(0.045, 0.075), groups = Math.floor(rnd(1, 4)); let t = t0;
    for (let g = 0; g < groups; g++) {
      for (let i = 0; i < pulses; i++) { const o = ctx.createOscillator(), e = ctx.createGain(), d = rnd(0.02, 0.03); o.frequency.setValueAtTime(f * (1 + i * 0.004), t); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(1, t + 0.006); e.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(e); e.connect(out); o.start(t); o.stop(t + d + 0.02); nodes.push(o, e); t += gap; }
      t += rnd(0.22, 0.5);   // the pause before it chirps again
    }
    track(nodes, (t - ctx.currentTime) * 1000 + 300);
  }
  function bass(p) {   // a hostel's speaker: a soft four-to-the-floor thump heard through walls, a few bars long
    const t0 = ctx.currentTime + 0.05, out = gain(0.55), f = lpf(210, 0.9), pan = makePanner(ctx, { ref: 6, rolloff: 1.4, max: 140 }); setPannerPos(pan, p.x, p.y, p.z); out.connect(f); f.connect(pan); pan.connect(townBus); const nodes = [out, f, pan], beat = 60 / rnd(98, 112), bars = Math.floor(rnd(6, 12));
    for (let i = 0; i < bars; i++) { const t = t0 + i * beat, o = ctx.createOscillator(), e = ctx.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.14); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(1, t + 0.008); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); o.connect(e); e.connect(out); o.start(t); o.stop(t + 0.25); nodes.push(o, e); }
    track(nodes, bars * beat * 1000 + 600);
  }
  function farHorn() {   // somewhere out of sight on the road: one or two toots, muffled by distance (the traffic channel)
    const p = placed(70, 160, 1), engine = pick(["compact", "compact", "saloon", "minibus", "keke", "deep"]), H = HORNS[engine] ?? HORNS.compact;
    live++; const h = playHorn(ctx, trafficBus, H, { pattern: pick(["toot", "toot", "double", engine === "keke" ? "peep" : "toot"]), level: 0.5, pos: p, dist: p.d }); const t = setTimeout(() => { timers.delete(t); live--; }, 1800); timers.add(t); void h;
  }

  let sinceBeds = 0;
  return {
    /** dt seconds. W: soundWeights(). L: { x, z, night, hostelAt }. */
    update(dt, W, L) {
      if (!alive) return; L0 = L; const t = ctx.currentTime, T = ch.traffic(), C = ch.town();
      trafficBus.gain.setTargetAtTime(T, t, 0.4); townBus.gain.setTargetAtTime(C, t, 0.4);
      const tc = 1.4;
      trafficG.gain.setTargetAtTime(0.5 * W.traffic, t, tc); windG.gain.setTargetAtTime(0.5 * W.wind, t, tc);
      crowdG.gain.setTargetAtTime(0.34 * W.crowd, t, tc); breezeG.gain.setTargetAtTime(0.05 + 0.09 * W.nature, t, tc);
      genG.gain.setTargetAtTime(0.55 * W.generator, t, tc);
      if (W.hostelAt) setPannerPos(genP, W.hostelAt.x, 1, W.hostelAt.z);
      if ((driftT -= dt) <= 0) { drift(); driftT = rnd(0.3, 0.8); trafficG.gain.setTargetAtTime(0.5 * W.traffic * rnd(0.75, 1.15), t, 1.2); }   // the wash of traffic swells and fades
      if (T < 0.02 && C < 0.02) return;   // everything is off: no events either
      evT += dt; if (evT < 0.4) return; const step = evT; evT = 0; if (live >= maxLive) return;
      const f = low ? 0.6 : 1;
      if (T > 0.02 && chance(W.traffic * 3.2 * f * (W.name === "highway" ? 0.5 : 1), step)) farHorn();
      if (C > 0.02 && chance(W.crowd * 7 * f, step)) voice(placed(5, 38), "chat");
      if (C > 0.02 && chance(W.market * 3.4 * f, step)) voice(placed(10, 45), "call");
      if (C > 0.02 && !L.night && chance(W.nature * 5 * f, step)) chirp(placed(8, 40, rnd(3, 9)));
      if (C > 0.02 && L.night && chance(W.nature * 16 * f, step)) cricket(placed(5, 30, 0.3));   // crickets: only at night, the quieter the place the more often (and in the day the birds)
      if (C > 0.02 && L.night && chance(W.hostel * 1.1 * f, step)) bass(W.hostelAt ? { x: W.hostelAt.x, y: 2, z: W.hostelAt.z, d: 40 } : placed(40, 90, 2));
    },
    dispose() { alive = false; for (const t of timers) clearTimeout(t); timers.clear(); for (const s of src) { try { s.stop(); } catch { /* stopped */ } } for (const n of all) { try { n.disconnect(); } catch { /* gone */ } } src.length = all.length = 0; },
  };
}
