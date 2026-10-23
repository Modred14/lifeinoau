// lib/clubDj.js
// The club DJ. One continuous mix for the club you are standing in, made with the Web Audio API, on its own volume and mute that never touch the game's sound effects.
//
//   startClubMusic("club_quantum")   begin the mix (call it when the player is inside; it waits politely for a tap if the browser demands one)
//   stopClubMusic()                  fade out and give the speakers back to the background song
//   const dj = useClubDj()           { status, now, next, mixing, volume, muted, error } for the player screen
//   setClubVolume(0-100), setClubMuted(bool), pauseClubMusic(), resumeClubMusic(), skipClubTrack(), tapToStart()
//
// What it plays comes from lib/clubMusic.js: the in-house grooves it generates itself (always available) plus any licensed or authorised audio listed in
// public/audio/club/manifest.json. Two decks overlap for every change: an equal-power crossfade, a filter sweep, and, when both tempos are known and close,
// one tempo that glides from the outgoing track to the incoming one so the beats stay locked. About four changes in ten add a one-off effect (riser, air horn,
// scratch, rewind), all synthesised here. A file that will not load is skipped and the mix carries on.
// Browser rules handled here: no sound before a tap (status "needs-tap"), a suspended or interrupted AudioContext (phone calls, locked screens), the tab going to
// the background (the mix pauses and resumes), and iOS needing each media element to be started by a tap (a small pool of elements is primed on the tap).
import { useSyncExternalStore } from "react";
import { getSoundSettings, duckMusic } from "./sound.js";
import { STORAGE_KEY, normalizeManifest, buildSet, planTransition, describeTrack, nextBarTime, rng, hashSeed, tempoGap, crossfadeGains } from "./clubMusic.js";

const LOOKAHEAD = 0.3, TICK_MS = 50, SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
const clampPct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 80);
const mtof = (n) => 440 * 2 ** ((n - 69) / 12), lerp = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k));
const loudness = (volume, muted) => (muted ? 0 : (volume / 100) ** 2 * 0.9);

// ------------------------------------------------------------------------------------------------ state the screen reads
const IDLE = Object.freeze({ club: null, status: "idle", volume: 80, muted: false, now: null, next: null, mixing: false, error: null });
let state = IDLE;
const listeners = new Set(), subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const put = (patch) => { state = Object.freeze({ ...state, ...patch }); for (const l of listeners) l(); };
/** { club, status: idle | starting | needs-tap | playing | paused | off | unsupported, volume, muted, now, next, mixing, error } */
export const useClubDj = () => useSyncExternalStore(subscribe, () => state, () => IDLE);
export const getClubDj = () => state;
function readPrefs() { try { const j = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"); return { volume: clampPct(j?.volume), muted: j?.muted === true }; } catch { return { volume: 80, muted: false }; } }
function savePrefs() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: state.volume, muted: state.muted })); } catch { /* private mode: not remembered */ } }

// ------------------------------------------------------------------------------------------------ the audio graph
let ctx = null, master = null, analyser = null, noise = null, pool = [], poolAt = 0, timer = null, token = 0, gestureOff = null;
let decks = null, set = [], idx = 0, round = 0, mix = null, files = [], bad = new Set(), rnd = Math.random, lastEffect = null, userPaused = false, autoPaused = false, forced = null;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: "playback" });
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    analyser = ctx.createAnalyser(); analyser.fftSize = 256;
    master.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ctx.onstatechange = () => { if (state.status === "playing" && !autoPaused && !userPaused && ctx && ctx.state !== "running") ctx.resume().catch(() => needTap()); };
  } catch { ctx = null; }
  return ctx;
}
/** Two media elements, created and started inside a tap so iOS lets them play later without another tap. Each is wired into the graph once. */
function primePool() {
  if (pool.length || !ctx) return;
  for (let i = 0; i < 2; i++) {
    const el = new Audio(); el.preload = "auto"; el.src = SILENT; el.muted = true; el.play?.().then(() => { el.pause(); el.muted = false; }).catch(() => { el.muted = false; });
    let node = null; try { node = ctx.createMediaElementSource(el); } catch { /* not supported */ }
    pool.push({ el, node });
  }
}
const takeSlot = () => pool[poolAt++ % pool.length];
function unlock() { try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch { /* fine */ } }
const setLoudness = () => { if (ctx && master) master.gain.setTargetAtTime(state.status === "playing" || state.status === "starting" ? loudness(state.volume, state.muted) : 0, ctx.currentTime, 0.06); };

// ------------------------------------------------------------------------------------------------ voices (all synthesised here)
const env = (g, t, peak, dec) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dec); };
function osc(dest, type, t, f0, f1, ramp, peak, dec) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + ramp); env(g, t, peak, dec); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dec + 0.05); }
function hiss(dest, t, kind, freq, q, peak, dec) { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; f.type = kind; f.frequency.value = freq; f.Q.value = q; env(g, t, peak, dec); s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.8); s.stop(t + dec + 0.05); }
const V = {
  kick: (d, t, v) => osc(d, "sine", t, 150, 42, 0.12, 0.95 * v, 0.34),
  clap: (d, t, v) => { hiss(d, t, "bandpass", 1500, 0.9, 0.5 * v, 0.2); hiss(d, t + 0.012, "bandpass", 2100, 0.9, 0.3 * v, 0.12); },
  hat: (d, t, v, open) => hiss(d, t, "highpass", 7500, 0.7, v, open ? 0.2 : 0.045),
  shaker: (d, t, v) => hiss(d, t, "bandpass", 5200, 0.8, v, 0.08),
  tom: (d, t, f, v) => osc(d, "sine", t, f * 1.5, f, 0.08, v, 0.22),
  log: (d, t, f, v) => osc(d, "sine", t, f * 1.9, f, 0.05, v, 0.3),
  sub: (d, t, f, v) => { osc(d, "sine", t, f * 1.2, f, 0.03, v, 0.5); osc(d, "triangle", t, f * 2, f * 2, 0.01, v * 0.2, 0.3); },
  stab: (d, t, f, minor, v) => { const lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = "lowpass"; lp.frequency.value = 1700; env(g, t, v, 0.4); lp.connect(g); g.connect(d);
    for (const [semi, det] of [[0, -6], [minor ? 3 : 4, 5], [7, -3]]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f * 2 ** (semi / 12); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + 0.45); } },
};
const R16 = [...Array(16).keys()], EV = [0, 2, 4, 6, 8, 10, 12, 14], OFF = [2, 6, 10, 14];
const PAT = {
  afrobeats: { kick: [0, 7, 10], clap: [4, 12], tom: [3, 6, 11, 14], hat: EV, oh: [15], shk: R16, stab: [3, 6, 11], low: [0, 7, 10], log: false, swing: 0.05 },
  amapiano: { kick: [0, 4, 8, 12], clap: [12], tom: [], hat: OFF, oh: [], shk: [0, 3, 4, 7, 8, 11, 12, 15], stab: [2, 6, 10, 14], low: [0, 3, 6, 10, 12, 14], log: true, swing: 0.03 },
  streetpop: { kick: [0, 3, 6, 10, 13], clap: [4, 12], tom: [], hat: [0, 2, 4, 6, 8, 10, 12, 13, 14, 15], oh: [7], shk: [], stab: [0, 6, 8], low: [0, 3, 10], log: false, swing: 0.02 },
  lounge: { kick: [0, 10], clap: [4, 12], tom: [2, 6, 13], hat: OFF, oh: [], shk: [0, 4, 8, 12], stab: [0, 6, 10], low: [0, 6, 10], log: false, swing: 0.06 },
};

// ------------------------------------------------------------------------------------------------ decks
class Deck {
  constructor(track) { this.track = track; this.out = ctx.createGain(); this.filter = ctx.createBiquadFilter(); this.filter.type = "highpass"; this.filter.frequency.value = 10; this.filter.connect(this.out); this.out.connect(master); this.bpm = track.bpm; this.failed = false; }
  dispose() { try { this.out.disconnect(); this.filter.disconnect(); } catch { /* already gone */ } }
}
class SynthDeck extends Deck {
  constructor(track, startT, bpm) { super(track); this.kind = "synth"; this.bpm = bpm ?? track.bpm; this.step = 0; this.nextT = startT; this.beats = []; this.pat = PAT[track.genre] ?? PAT.afrobeats; }
  get stepDur() { return 60 / this.bpm / 4; }
  schedule(until) { while (this.nextT < until) { this.play(this.step, this.nextT); this.nextT += this.stepDur * (this.step % 2 ? 1 - this.pat.swing : 1 + this.pat.swing); this.step++; } }
  play(step, t) {
    const p = this.pat, k = this.track, s = step % 16, bar = Math.floor(step / 16) % k.bars, root = k.root + k.prog[bar % 4], d = this.filter, acc = s % 4 === 0 ? 1 : 0.7;
    if (s % 4 === 0) { this.beats.push(t); if (this.beats.length > 8) this.beats.shift(); }
    if (p.shk.includes(s)) V.shaker(d, t, 0.1 * acc);
    if (p.hat.includes(s)) V.hat(d, t, 0.09 * acc, false);
    if (p.oh.includes(s)) V.hat(d, t, 0.09, true);
    if (bar >= 1 && p.stab.includes(s)) V.stab(d, t, mtof(root + 24), k.minor, 0.05 + k.energy * 0.008);
    if (bar >= 2) { if (p.kick.includes(s)) V.kick(d, t, 1); if (p.clap.includes(s)) V.clap(d, t, 0.8); if (bar % 2 && p.tom.includes(s)) V.tom(d, t, 190 + ((s * 37) % 5) * 35, 0.35); }
    if (bar >= 4 && p.low.includes(s)) { const i = p.low.indexOf(s); if (p.log) V.log(d, t, mtof(root + [0, 0, 12, 7, 0, 3][i % 6]), 0.85); else V.sub(d, t, mtof(root), 0.75); }
  }
  /** Seconds (context time) of the next bar line, and of the next beat. */
  nextBar() { const left = (16 - (this.step % 16)) % 16; return this.nextT + left * this.stepDur; }
  nextBeat() { const left = (4 - (this.step % 4)) % 4; return this.nextT + left * this.stepDur; }
  barsLeft() { return this.track.bars - this.step / 16; }
  phase(now) { const b = [...this.beats].reverse().find((x) => x <= now); return b == null ? 0 : ((now - b) / (60 / this.bpm)) % 1; }
  pause() {} resume() {}
}
class FileDeck extends Deck {
  constructor(track) {
    super(track); this.kind = "file"; this.slot = takeSlot(); this.el = this.slot.el; this.t0 = performance.now(); this.started = false;
    const el = this.el; el.onerror = () => { this.failed = true; }; el.onended = () => { this.ended = true; };
    el.muted = false; el.loop = false; el.src = track.src; el.preload = "auto"; try { el.preservesPitch = true; } catch { /* old browser */ }
    if (this.slot.node) { this.slot.node.disconnect(); this.slot.node.connect(this.filter); } else this.failed = true; // no media-element routing: this browser cannot mix files
  }
  start(atT, rate = 1) {
    const el = this.el, go = () => { try { el.currentTime = this.track.start; } catch { /* set on metadata */ } el.playbackRate = rate; this.started = true; el.play().catch((e) => { if (e?.name === "NotAllowedError") needTap(); else this.failed = true; }); };
    this.timer = setTimeout(go, Math.max(0, (atT - ctx.currentTime) * 1000 - 20));
  }
  get rate() { return this.el.playbackRate || 1; }
  setTempo(bpm) { if (this.track.bpm) this.el.playbackRate = Math.min(1.15, Math.max(0.85, bpm / this.track.bpm)); }
  ctxAt(pos) { return ctx.currentTime + (pos - this.el.currentTime) / this.rate; }
  remaining() { const end = this.track.end ?? (Number.isFinite(this.el.duration) ? this.el.duration : Infinity); return (end - this.el.currentTime) / this.rate; }
  nextBar() { return this.track.bpm ? this.ctxAt(nextBarTime(this.el.currentTime + 0.15 * this.rate, this.track.firstBeat, this.track.bpm)) : ctx.currentTime + 0.15; }
  nextBeat() { return this.track.bpm ? this.ctxAt(nextBarTime(this.el.currentTime + 0.1 * this.rate, this.track.firstBeat, this.track.bpm, 1)) : ctx.currentTime + 0.1; }
  schedule() { if (this.started && !this.failed && performance.now() - this.t0 > 9000 && this.el.readyState < 2) this.failed = true; } // never loaded
  phase() { return this.track.bpm ? (((this.el.currentTime - this.track.firstBeat) / (60 / this.track.bpm)) % 1 + 1) % 1 : 0; }
  pause() { try { this.el.pause(); } catch { /* ignore */ } } resume() { if (this.started && !this.ended) this.el.play().catch(() => needTap()); }
  dispose() { clearTimeout(this.timer); try { this.el.pause(); this.el.onerror = this.el.onended = null; this.el.removeAttribute("src"); this.el.load(); this.slot.node?.disconnect(); } catch { /* ignore */ } super.dispose(); }
}
const makeDeck = (item, startT, bpm) => (item.kind === "file" ? new FileDeck(item) : new SynthDeck(item, startT, bpm));

// ------------------------------------------------------------------------------------------------ the mix
const upcoming = (n = 1) => { while (set.length <= idx + n) { round++; const more = buildSet(state.club, `${seedOf()}:${round}`, files.filter((f) => !bad.has(f.id))); if (set.length && more[0]?.id === set[set.length - 1].id) more.shift(); set.push(...more); } return set[idx + n]; };
const seedOf = () => Math.floor(Date.now() / 3600e3);
const show = (item) => describeTrack(item, state.club);
const decksNow = () => [decks?.cur, mix?.inc].filter(Boolean);

function launch(item, fadeIn = 1.6) {
  const t = ctx.currentTime + 0.12, d = makeDeck(item, t);
  d.out.gain.setValueAtTime(0.0001, t); d.out.gain.linearRampToValueAtTime(1, t + fadeIn);
  if (d.kind === "file") d.start(t, 1);
  decks = { cur: d }; put({ now: show(item), next: show(upcoming()), mixing: false });
}

function planNext(seconds) {
  const out = decks.cur.track, inn = upcoming(), plan = planTransition(out, inn, rnd, lastEffect);
  if (plan.type === "beatmatch" && Math.abs(out.bpm / inn.bpm - 1) > 0.12) { plan.type = "fade"; plan.bars = 0; plan.seconds = 6 + rnd() * 3; } // glide only between plain neighbours, never octave-matched ones
  if (seconds) plan.seconds = Math.min(plan.seconds, seconds);
  return { plan, inn };
}
function beginMix(startAt, plan, inn) {
  const cur = decks.cur; let inc = makeDeck(inn, startAt, plan.type === "beatmatch" ? cur.bpm : undefined);
  const end = startAt + plan.seconds, N = 64, c = Array.from({ length: N }, (_, i) => crossfadeGains(i / (N - 1)));
  cur.out.gain.cancelScheduledValues(startAt); cur.out.gain.setValueAtTime(1, startAt); cur.out.gain.setValueCurveAtTime(Float32Array.from(c, (g) => g.out), startAt, plan.seconds);
  inc.out.gain.setValueAtTime(0.0001, 0); inc.out.gain.setValueAtTime(0.0001, startAt); inc.out.gain.setValueCurveAtTime(Float32Array.from(c, (g) => Math.max(0.0001, g.in)), startAt, plan.seconds);
  cur.filter.frequency.setValueAtTime(10, startAt); cur.filter.frequency.exponentialRampToValueAtTime(1400, startAt + plan.seconds * 0.9); // the outgoing track loses its lows
  inc.filter.frequency.setValueAtTime(700, startAt); inc.filter.frequency.exponentialRampToValueAtTime(10, startAt + plan.seconds * 0.6); // and the incoming one brings them in
  if (inc.kind === "file") inc.start(startAt, plan.type === "beatmatch" && inc.track.bpm ? cur.bpm / inc.track.bpm : 1);
  mix = { startAt, end, plan, inc, from: cur.bpm, to: inn.bpm, flipped: false }; lastEffect = plan.effect ?? lastEffect; effect(plan.effect, startAt, plan.seconds);
  put({ mixing: true, next: show(inn) });
}
function endMix() {
  const { inc } = mix, out = decks.cur; out.dispose(); inc.out.gain.cancelScheduledValues(0); inc.out.gain.setValueAtTime(1, ctx.currentTime); inc.filter.frequency.setValueAtTime(10, ctx.currentTime);
  if (inc.kind === "synth") inc.bpm = inc.track.bpm; else inc.el.playbackRate = 1;
  decks = { cur: inc }; mix = null; idx++; put({ now: show(inc.track), next: show(upcoming()), mixing: false, error: state.error });
}
function abortMix(why) { const { inc } = mix; inc.dispose(); decks.cur.out.gain.cancelScheduledValues(0); decks.cur.out.gain.setTargetAtTime(1, ctx.currentTime, 0.2); decks.cur.filter.frequency.setTargetAtTime(10, ctx.currentTime, 0.2); mix = null; skipBad(upcoming(), why); }
function skipBad(item, why) { if (!item) return; bad.add(item.id); set.splice(idx + 1, 1); put({ error: `${item.title} would not load, so the DJ moved on.`, next: show(upcoming()) }); void why; }

function effect(name, t0, secs) {
  if (!name) return; const end = t0 + secs, d = master;
  if (name === "riser") { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; s.loop = true; f.type = "bandpass"; f.Q.value = 2; f.frequency.setValueAtTime(400, t0 + secs * 0.4); f.frequency.exponentialRampToValueAtTime(6500, end);
    g.gain.setValueAtTime(0.0001, t0 + secs * 0.4); g.gain.exponentialRampToValueAtTime(0.28, end - 0.05); g.gain.linearRampToValueAtTime(0.0001, end + 0.05); s.connect(f); f.connect(g); g.connect(d); s.start(t0 + secs * 0.4); s.stop(end + 0.1); }
  else if (name === "airhorn") for (const at of [t0 + 0.05, t0 + 0.55]) for (const f of [466, 587, 740]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(f, at); o.frequency.linearRampToValueAtTime(f * 1.03, at + 0.35); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.09, at + 0.02); g.gain.setValueAtTime(0.09, at + 0.3); g.gain.linearRampToValueAtTime(0.0001, at + 0.4); o.connect(g); g.connect(d); o.start(at); o.stop(at + 0.45); }
  else if (name === "scratch") for (let i = 0; i < 4; i++) { const at = t0 + secs * 0.5 + i * 0.13, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; f.type = "bandpass"; f.Q.value = 5; f.frequency.setValueAtTime(i % 2 ? 3200 : 900, at); f.frequency.exponentialRampToValueAtTime(i % 2 ? 700 : 3600, at + 0.1); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.22, at + 0.02); g.gain.linearRampToValueAtTime(0.0001, at + 0.11); s.connect(f); f.connect(g); g.connect(d); s.start(at, Math.random()); s.stop(at + 0.12); }
  else if (name === "rewind") { const at = end - 0.75; osc(d, "sawtooth", at, 1700, 70, 0.7, 0.16, 0.75); hiss(d, at, "bandpass", 2500, 1, 0.12, 0.6); }
}

function tick() {
  if (!ctx || !decks || ctx.state !== "running" || userPaused || autoPaused) return;
  const now = ctx.currentTime;
  for (const d of decksNow()) { d.schedule?.(now + LOOKAHEAD); if (d.kind === "file" && d.ended && d === decks.cur && !mix) d.failed = d.failed || d.remaining() > 2; }
  const cur = decks.cur;
  if (cur.failed) { // the track in the speakers is broken: say so, leave it and start the next one with a short fade
    const bro = cur.track; if (mix) { mix.inc.dispose(); mix = null; } cur.dispose(); bad.add(bro.id); set.splice(idx, 1);
    put({ error: `${bro.title} would not play, so the DJ moved on.` }); launch(upcoming(0), 1.2); return;
  }
  if (mix) {
    if (mix.inc.failed) return abortMix("incoming");
    if (mix.plan.type === "beatmatch") { const bpm = lerp(mix.from, mix.to, (now - mix.startAt) / mix.plan.seconds); for (const d of [cur, mix.inc]) d.kind === "synth" ? (d.bpm = bpm) : d.setTempo(bpm); }
    if (!mix.flipped && now >= mix.startAt + mix.plan.seconds * 0.5) { mix.flipped = true; put({ now: show(mix.inc.track), next: show(upcoming(2)) }); }
    if (now >= mix.end + 0.05) endMix();
    return;
  }
  const left = cur.kind === "synth" ? (cur.barsLeft() * 240) / cur.bpm : cur.remaining();
  if (forced) { const p = planNext(forced); forced = null; return beginMix(Math.max(cur.nextBeat(), now + 0.1), p.plan, p.inn); }
  if (left > 30) return;
  decks.planned ??= planNext();
  if (left <= decks.planned.plan.seconds + 1) { const { plan, inn } = decks.planned; beginMix(Math.max(cur.nextBar(), now + 0.1), plan, inn); }
}

// ------------------------------------------------------------------------------------------------ starting, stopping, tapping
const needTap = () => { if (state.status === "idle") return; if (state.status !== "needs-tap") put({ status: "needs-tap" }); setLoudness(); if (!gestureOff) watchForTap(); };
function watchForTap() {
  const go = () => tapToStart(), types = ["pointerdown", "touchend", "keydown", "click"];
  for (const t of types) document.addEventListener(t, go, { capture: true, once: true });
  gestureOff = () => { for (const t of types) document.removeEventListener(t, go, { capture: true }); gestureOff = null; };
}
let manifestPromise = null;
const loadFiles = () => (manifestPromise ??= fetch("/audio/club/manifest.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((m) => normalizeManifest(m).tracks).catch(() => []));

export async function startClubMusic(clubId) {
  if (typeof window === "undefined") return;
  if (state.club === clubId && state.status !== "idle" && state.status !== "off") return;
  teardown(true);
  const mine = ++token, prefs = readPrefs();
  put({ ...IDLE, club: clubId, status: "starting", volume: prefs.volume, muted: prefs.muted });
  if (!getSoundSettings().music) return put({ status: "off" });
  if (!ensureCtx()) return put({ status: "unsupported", error: "This browser cannot play the club mix." });
  duckMusic(true); primePool(); rnd = rng(hashSeed(`${clubId}:${Date.now()}`)); bad = new Set(); round = 0; idx = 0; lastEffect = null; userPaused = autoPaused = false;
  files = await loadFiles(); if (mine !== token) return;
  set = buildSet(clubId, seedOf(), files);
  try { await ctx.resume(); } catch { /* handled below */ }
  if (mine !== token) return;
  if (ctx.state !== "running") return needTap();
  begin();
}
function begin() { if (!ctx || !state.club) return; unlock(); put({ status: "playing", error: null }); setLoudness(); if (!decks) launch(set[idx], 1.2); clearInterval(timer); timer = setInterval(tick, TICK_MS); }
/** The player taps (or the page sees any tap while the status is needs-tap): start or restart the sound. */
export function tapToStart() {
  gestureOff?.(); if (!ctx || !state.club) return;
  primePool(); ctx.resume().catch(() => {}); unlock();
  if (userPaused) return;
  if (state.status === "needs-tap" || state.status === "starting") { if (decks) { put({ status: "playing" }); setLoudness(); for (const d of decksNow()) d.resume?.(); } else begin(); }
}
function teardown(now) {
  clearInterval(timer); timer = null; gestureOff?.();
  const c = ctx, g = master, ds = decksNow(), p = pool; decks = null; mix = null; ctx = master = analyser = noise = null; pool = []; poolAt = 0; forced = null;
  if (!c) return;
  const kill = () => { for (const d of ds) d.dispose(); for (const x of p) { try { x.el.pause(); x.node?.disconnect(); } catch { /* ignore */ } } c.close().catch(() => {}); };
  if (now) kill(); else { try { g.gain.setTargetAtTime(0, c.currentTime, 0.15); } catch { /* ignore */ } setTimeout(kill, 700); }
}
/** Leave the club: fade out and hand the speakers back to the background song. */
export function stopClubMusic(status = "idle") { token++; const club = state.club; teardown(false); duckMusic(false); put(status === "off" ? { ...IDLE, club, status: "off", volume: state.volume, muted: state.muted } : { ...IDLE, volume: state.volume, muted: state.muted }); }

export function setClubVolume(v) { put({ volume: clampPct(v) }); savePrefs(); setLoudness(); }
export function setClubMuted(m) { put({ muted: !!m }); savePrefs(); setLoudness(); }
export function pauseClubMusic() { if (state.status !== "playing") return; userPaused = true; put({ status: "paused" }); for (const d of decksNow()) d.pause?.(); if (ctx) { master.gain.setTargetAtTime(0, ctx.currentTime, 0.04); setTimeout(() => userPaused && ctx?.suspend().catch(() => {}), 200); } }
export function resumeClubMusic() { if (state.status !== "paused" || !ctx) return; userPaused = false; ctx.resume().then(() => { put({ status: "playing" }); setLoudness(); for (const d of decksNow()) d.resume?.(); }).catch(() => needTap()); }
/** Ask for the next track now: a short beat-aligned blend, not a hard cut. Ignored while a change is already happening. */
export function skipClubTrack() { if (state.status === "playing" && decks && !mix && !forced) forced = 3.5; }

/** { phase 0..1 within the beat, level 0..1 loudness } for lights and meters. Cheap: call it from an animation frame while the player is on screen. */
const buf = typeof Uint8Array !== "undefined" ? new Uint8Array(128) : null;
export function visual() {
  if (!ctx || !decks || state.status !== "playing") return { phase: 0, level: 0 };
  analyser.getByteTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
  const lead = mix?.flipped ? mix.inc : decks.cur;
  return { phase: lead.phase ? lead.phase(ctx.currentTime) : 0, level: Math.min(1, Math.sqrt(sum / buf.length) * 3.2) };
}

// ------------------------------------------------------------------------------------------------ the tab goes away and comes back
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!ctx || state.status === "idle") return;
    if (document.hidden) { if (state.status === "playing") { autoPaused = true; for (const d of decksNow()) d.pause?.(); ctx.suspend().catch(() => {}); } }
    else if (autoPaused) { autoPaused = false; ctx.resume().then(() => { for (const d of decksNow()) d.resume?.(); }).catch(() => needTap()); }
  });
}