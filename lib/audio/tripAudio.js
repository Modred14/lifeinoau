// lib/audio/tripAudio.js
// All the sound of a trip, in one place, driven by the same frame loop as the drawing (lib3d/travel.js calls update() once a frame and dispose() when the trip ends).
// It runs on the game's own AudioContext (lib/sound.js: getWorldAudio), so there is one audio engine, one autoplay unlock and one master volume.
//
//   your vehicle      one engine voice: cranks and idles when you get in, revs with the road speed through the gears, falls away when you get out. Tyre and wind noise rise with speed.
//   other vehicles    a small POOL of positional voices (12 on a computer, 6 on a phone) given to the nearest vehicles of the traffic simulation, by distance. A voice follows its
//                     vehicle's real position, speed and throttle, gets Doppler and distance muffling, and is released the moment its vehicle leaves the simulation (never left playing).
//                     Far voices update less often than near ones.
//   horns             yours (held for as long as the button is down) and computer-driven vehicles' (decided by hornBrain.js from what is in their way), positional, at most 3 at once
//   the town          ambience.js, blended by where you are (zones.js)
// Everything is stopped, disconnected and forgotten in dispose(), and when the tab is hidden nothing is updated.
import { getWorldAudio } from "../sound.js";
import { channel, getMix } from "./mixer.js";
import { engineKeyFor, engineProfile, hornFor, defaultPattern, topSpeedOf } from "./profiles.js";
import { createEngine, startEngine, stopEngine, stepEngine, isSilent } from "./engineModel.js";
import { createHornBrain } from "./hornBrain.js";
import { soundWeights } from "./zones.js";
import { createAmbience } from "./ambience.js";
import { createEngineVoice } from "./engineVoice.js";
import { holdHorn, playHorn } from "./hornVoice.js";
import { setListener, dopplerRatio, noiseSource, startNoise, clamp } from "./spatial.js";
import { isGameNight } from "../campus-clock.js";

const TICK = 1 / 24, PICK_EVERY = 0.25, AMB_EVERY = 0.2;
const HEAR = { car: 150, keke: 130, minibus: 170, bus: 190 };   // how far (m) each kind of vehicle is heard at all

/**
 * o: { places: [{ x, z, kind }], low: a phone, night(): boolean }.
 * Returns { update(dt, f), dispose() }. f (every frame): {
 *   phase, mode ("keke"|"bus"|"car"|"trek"), carId, ego (the sim vehicle or own car you are in, or null), own (your own driven car, or null),
 *   pos: { x, z, vx, vz }, fwd: { x, z } (where the view faces), horn (the horn button is held), onDeck, sim: the traffic's vehicles, peds: its walkers, remote: other players' vehicles (an array, or a function that returns it, called only when the pool is re-chosen) }
 */
export function createTripAudio({ places = [], low = false, night = isGameNight } = {}) {
  let rig = null, disposed = false, acc = 0, pickAcc = 0, ambAcc = 0, now = 0;
  const maxVoices = low ? 6 : 12;
  const brain = createHornBrain();

  function build() {
    const W = getWorldAudio(); if (!W) return null;
    const { ctx, out } = W, bus = () => { const g = ctx.createGain(); g.gain.value = 0; g.connect(out); return g; };
    const r = { ctx, out, engineBus: bus(), trafficBus: bus(), hornBus: bus(), voices: new Map(), ego: null, egoKey: null, hornHeld: null, hornsLive: 0, road: null, hornTimers: new Set(), prevEgoV: 0, egoThr: 0 };
    r.ambience = createAmbience(ctx, out, { traffic: () => channel("traffic"), town: () => channel("town") }, { low });
    // tyre and wind noise of your own vehicle: grows with speed
    const n1 = noiseSource(ctx, 0.9), bp = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = "bandpass"; bp.frequency.value = 420; bp.Q.value = 0.6; hi.type = "highpass"; hi.frequency.value = 90; g.gain.value = 0; n1.connect(bp); bp.connect(hi); hi.connect(g); g.connect(r.engineBus); startNoise(n1); r.road = { n1, bp, hi, g };
    return r;
  }

  const releaseVoice = (id, v, sec = 0.2) => { rig.voices.delete(id); brain.forget(id); v.voice.fadeOut(sec); };
  function stopEgo(immediate) { const e = rig.ego; if (!e) return; if (immediate || isSilent(e.model)) { e.voice.fadeOut(immediate ? 0.1 : 0.2); rig.ego = null; } }

  function egoFrame(dt, f) {
    const on = rig.egoOn, own = !!f.own;
    const key = engineKeyFor({ kind: f.mode === "keke" || f.mode === "bus" ? f.mode : "car", carId: own ? f.carId : null, tint: 0.3 });
    if (on && (!rig.ego || rig.egoKey !== key)) {   // getting in: a new engine (the key turns, or a hired vehicle is already running)
      if (rig.ego) stopEgo(true);
      const P = engineProfile(key), model = createEngine(P); startEngine(model); if (!own) { model.mode = "run"; model.rpm = P.idle; }
      rig.ego = { voice: createEngineVoice(rig.ctx, rig.engineBus, P, { spatial: false, lite: low }), model, P, own }; rig.egoKey = key; rig.prevEgoV = 0;
    }
    const e = rig.ego; if (!e) return;
    if (!on && e.model.mode !== "stopping" && e.model.mode !== "off") stopEngine(e.model);   // getting out: it is switched off and the revs fall away
    const v = on ? Math.abs(f.ego.v ?? 0) : 0;
    let thr = 0;
    if (on && own) thr = f.own.thr ?? 0;
    else if (on) { const a = (v - rig.prevEgoV) / Math.max(dt, 1e-3); rig.egoThr += (clamp(a / 2, 0, 1) - rig.egoThr) * Math.min(1, dt * 4); thr = rig.egoThr; }   // a hired vehicle: how hard it pushes, from how fast it is gaining speed
    rig.prevEgoV = v;
    stepEngine(e.model, { speed: v, throttle: thr, dt });
    e.voice.update({ rpm: e.model.rpm, rpmN: e.model.rpmN, load: e.model.load, level: own ? 1 : 0.72, dop: 1, facing: own ? 0.2 : -0.4 });
    if (!on && isSilent(e.model)) stopEgo(false);
    // tyre and wind noise
    const R = rig.road, rn = on ? clamp(v / 34, 0, 1) : 0; R.g.gain.setTargetAtTime(0.32 * Math.pow(rn, 1.5) * (own ? 1 : 0.6), rig.ctx.currentTime, 0.2); R.bp.frequency.setTargetAtTime(300 + 900 * rn, rig.ctx.currentTime, 0.2);
  }

  function playerHorn(f) {
    const want = !!f.horn && f.phase === "drive" && !!rig.ego;
    if (want && !rig.hornHeld) { const style = getMix().hornStyle, H = hornFor(rig.egoKey, style); rig.hornHeld = holdHorn(rig.ctx, rig.hornBus, H, { level: 1 }); }
    else if (!want && rig.hornHeld) { rig.hornHeld.release(); rig.hornHeld = null; }
  }

  function npcHorn(v, key, kind, d, pos) {
    if (rig.hornsLive >= 3) return;
    const lead = v.lead, r = brain.consider("v" + v.id, kind, { v: v.v, lead, waiting: v.stopLine != null, dist: d }, now); if (!r) return;
    rig.hornsLive++; const t = setTimeout(() => { rig.hornTimers.delete(t); rig.hornsLive--; }, 1600); rig.hornTimers.add(t);
    playHorn(rig.ctx, rig.hornBus, hornFor(key, "auto"), { pattern: r.pattern ?? defaultPattern(key), level: 0.9, pos: { x: pos.x, y: 1, z: pos.z }, dist: d });
  }

  function pick(f) {
    const L = f.pos, cand = [], present = new Set(); let near = 0;
    const consider = (id, v, kind, remote) => {
      present.add(id); const dx = v.x - L.x, dz = v.z - L.z, d2 = dx * dx + dz * dz, R = HEAR[kind] ?? 150;
      if (d2 < 6400) near++;
      if (d2 > R * R) return; cand.push({ id, v, kind, remote, d: Math.sqrt(d2), score: Math.sqrt(d2) - Math.min(30, Math.abs(v.v ?? 0) * 1.5) });   // a moving vehicle is heard a little further than a parked one
    };
    for (const v of f.sim ?? []) { if (v.done || (rig.egoOn && v === f.ego)) continue; consider("v" + v.id, v, v.kind, false); }
    for (const v of (typeof f.remote === "function" ? f.remote() : f.remote) ?? []) consider(v.id, v, v.kind, true);
    cand.sort((a, b) => a.score - b.score); const keep = new Set();
    for (let i = 0; i < cand.length && keep.size < maxVoices; i++) keep.add(cand[i].id);
    // voices whose vehicle has left the simulation stop at once; voices that are merely too far or out of the top few fade
    for (const [id, e] of rig.voices) { if (!present.has(id)) releaseVoice(id, e, 0.12); else if (!keep.has(id)) { e.out = (e.out ?? 0) + PICK_EVERY; if (e.out > 0.75) releaseVoice(id, e, 0.3); } else e.out = 0; }
    for (const c of cand) {
      if (!keep.has(c.id) || rig.voices.has(c.id)) continue;
      const key = engineKeyFor({ kind: c.kind, carId: c.v.car || null, tint: c.v.tint ?? 0.5 }), P = engineProfile(key), model = createEngine(P); startEngine(model); model.mode = "run"; model.rpm = P.idle;
      rig.voices.set(c.id, { voice: createEngineVoice(rig.ctx, rig.trafficBus, P, { spatial: true, lite: low }), model, P, key, kind: c.kind, last: now, nextAt: 0, prevV: c.v.v ?? 0, thr: 0, remote: c.remote });
    }
    brain.prune(present);
    return { cand, near };
  }

  return {
    update(dt, f) {
      if (disposed || typeof document === "undefined" || document.hidden) return;
      now += dt;
      if (!rig) { if (!(rig = build())) return; }
      const ctx = rig.ctx, t = ctx.currentTime;
      rig.egoOn = !!f.ego && (f.phase === "drive" || f.phase === "ride" || f.phase === "paying");   // only while you are in it is it YOUR engine; before that (it is driving up to you) it is just a vehicle on the road
      rig.engineBus.gain.setTargetAtTime(channel("engine"), t, 0.1); rig.trafficBus.gain.setTargetAtTime(channel("traffic"), t, 0.1); rig.hornBus.gain.setTargetAtTime(channel("horn"), t, 0.05);
      acc += dt; if (acc < TICK) return; const step = acc; acc = 0;
      const L = f.pos; setListener(ctx, { x: L.x, y: 1.6, z: L.z, fx: f.fwd.x, fz: f.fwd.z });
      egoFrame(step, f); playerHorn(f);
      pickAcc += step; let list = rig.last;
      if (pickAcc >= PICK_EVERY || !list) { pickAcc = 0; list = rig.last = pick(f); rig.hornPass = true; }
      // update each voice at the rate its distance deserves: near every tick, mid ~10 Hz, far ~4 Hz
      const byId = new Map(); for (const c of list.cand) byId.set(c.id, c);
      for (const [id, e] of rig.voices) {
        const c = byId.get(id); if (!c) continue; const v = c.v;
        if (now < e.nextAt) continue; e.nextAt = now + (c.d < 30 ? 0 : c.d < 70 ? 0.09 : 0.22);
        const dtv = clamp(now - e.last, 0.01, 0.5); e.last = now; const sp = Math.abs(v.v ?? 0);
        let thr; if (c.remote) { const a = (sp - e.prevV) / dtv; e.thr += (clamp(a / 2, 0, 1) - e.thr) * Math.min(1, dtv * 4); thr = e.thr; } else thr = clamp((v.acc ?? 0) / Math.max(0.5, v.aMax ?? 2), 0, 1);
        e.prevV = sp; stepEngine(e.model, { speed: sp, throttle: thr, dt: dtv });
        const hx = v.hx ?? Math.sin(v.h ?? 0), hz = v.hz ?? Math.cos(v.h ?? 0), dx = L.x - v.x, dz = L.z - v.z, d = Math.max(1, c.d), facing = (hx * dx + hz * dz) / d;
        const dop = dopplerRatio(L.x, L.z, L.vx ?? 0, L.vz ?? 0, v.x, v.z, hx * (v.v ?? 0), hz * (v.v ?? 0));
        e.voice.setPosition(v.x, 0.8, v.z); e.voice.update({ rpm: e.model.rpm, rpmN: e.model.rpmN, load: e.model.load, level: 1, dop, dist: d, facing });
        if (rig.hornPass && !c.remote && d < 140) npcHorn(v, e.key, c.kind, d, v);
      }
      // a vehicle with no voice (too many nearby) can still honk at someone, if it is close enough to be heard
      if (rig.hornPass) { for (const c of list.cand) if (!c.remote && !rig.voices.has(c.id) && c.d < 70) npcHorn(c.v, engineKeyFor({ kind: c.kind, tint: c.v.tint ?? 0.5 }), c.kind, c.d, c.v); rig.hornPass = false; }
      ambAcc += step; if (ambAcc >= AMB_EVERY) {
        const peds = f.peds ?? []; let np = 0; for (const p of peds) if ((p.x - L.x) ** 2 + (p.z - L.z) ** 2 < 1600) np++;
        const Wt = soundWeights({ x: L.x, z: L.z, places, vehicles: list.near, peds: np, onDeck: !!f.onDeck, speed: Math.hypot(L.vx ?? 0, L.vz ?? 0), night: night() });
        rig.ambience.update(ambAcc, Wt, { x: L.x, z: L.z, night: night(), hostelAt: Wt.hostelAt }); ambAcc = 0; rig.zone = Wt.name;
      }
    },
    /** For the tests and the debug overlay: what is playing right now. */
    stats() { return rig ? { voices: rig.voices.size, ego: !!rig.ego, hornsLive: rig.hornsLive, zone: rig.zone ?? "" } : { voices: 0, ego: false, hornsLive: 0, zone: "" }; },
    dispose() {
      if (disposed) return; disposed = true; if (!rig) return;
      try { rig.hornHeld?.stop(); } catch { /* done */ }
      for (const [id, e] of rig.voices) { try { e.voice.dispose(); } catch { /* gone */ } rig.voices.delete(id); }
      try { rig.ego?.voice.dispose(); } catch { /* gone */ } rig.ego = null;
      try { rig.ambience.dispose(); } catch { /* gone */ }
      try { rig.road.n1.stop(); rig.road.g.disconnect(); } catch { /* gone */ }
      for (const t of rig.hornTimers) clearTimeout(t); rig.hornTimers.clear();
      for (const b of [rig.engineBus, rig.trafficBus, rig.hornBus]) { try { b.disconnect(); } catch { /* gone */ } }
      brain.prune(new Set()); rig = null;
    },
  };
}
export { topSpeedOf };
