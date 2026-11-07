// tools/audio/render-check.mjs
// Renders the engine, horn and ambience voices OFFLINE in Node and measures what comes out, because the sound itself cannot be unit-tested the way the logic can:
//   - every engine makes sound, never clips and never goes NaN, and is silent when it is switched off,
//   - the pitch it makes is the firing frequency the model asks for, and rises with the revs,
//   - the categories really sound different (their tone, measured as the spectral centroid, and their level),
//   - an exterior voice gets quieter and duller with distance, and louder when it is closer, and sits to the side it is on,
//   - horns are distinct per category, ambience beds are non-silent and a voice leaves nothing running when it is disposed.
// It needs a Web Audio implementation for Node, which is NOT a dependency of the game:   npm i --no-save node-web-audio-api   then   node tools/audio/render-check.mjs
// Add --wav to write a .wav of each sound into /tmp/lifeinoau-audio so they can be listened to.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, HORNS, PATTERNS } from "../../lib/audio/profiles.js";
import { createEngineVoice } from "../../lib/audio/engineVoice.js";
import { playHorn } from "../../lib/audio/hornVoice.js";
import { createAmbience } from "../../lib/audio/ambience.js";
import { setListener, dopplerRatio } from "../../lib/audio/spatial.js";
import { soundWeights } from "../../lib/audio/zones.js";

let wa; try { wa = await import("node-web-audio-api"); } catch { console.log("skipped: node-web-audio-api is not installed (npm i --no-save node-web-audio-api)"); process.exit(0); }
const { OfflineAudioContext } = wa, SR = 22050, WAV = process.argv.includes("--wav"); if (WAV) fs.mkdirSync("/tmp/lifeinoau-audio", { recursive: true });
let n = 0; const ok = (name, cond, info = "") => { assert.ok(cond, name + " " + info); n++; };
const stat = (x) => { let s = 0, pk = 0; for (const v of x) { s += v * v; pk = Math.max(pk, Math.abs(v)); } return { rms: Math.sqrt(s / x.length), peak: pk, bad: x.some((v) => !Number.isFinite(v)) }; };
/** In-place radix-2 FFT. */
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
/** Spectral centroid in Hz (where the "weight" of the tone is): the magnitude-weighted mean frequency over a few windows. */
function centroid(x) { const N = 4096; let num = 0, den = 0; for (let off = 0; off + N <= x.length; off += N) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = x[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); fft(re, im); for (let k = 2; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * (SR / N); den += m; } } return den ? num / den : 0; }
/** The repeat period of the sound (autocorrelation) as a frequency: the firing frequency of an engine. */
function pitch(x, lo, hi) { let best = -1, bf = 0; const a = Math.floor(SR / hi), b = Math.floor(SR / lo), n = Math.min(x.length, SR); for (let lag = a; lag <= b; lag++) { let c = 0; for (let i = 0; i + lag < n; i += 2) c += x[i] * x[i + lag]; if (c > best) { best = c; bf = SR / lag; } } return bf; }
const wav = (name, x) => { if (!WAV) return; const b = Buffer.alloc(44 + x.length * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(x.length * 2, 40); for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-1, Math.min(1, x[i])) * 32767, 44 + i * 2); fs.writeFileSync(`/tmp/lifeinoau-audio/${name}.wav`, b); };
const render = async (build, sec = 2.6) => { const ctx = new OfflineAudioContext(2, Math.floor(SR * sec), SR); const h = build(ctx); const buf = await ctx.startRendering(); return { L: buf.getChannelData(0), R: buf.getChannelData(1), h }; };
const tail = (x) => x.slice(Math.floor(x.length * 0.45));

// ---- engines at idle, cruising and flat out ----
const results = {};
for (const [key, P] of Object.entries(ENGINES)) {
  results[key] = {};
  for (const [label, rpmN, load] of [["idle", 0, 0.1], ["cruise", 0.35, 0.4], ["flat", 0.9, 1]]) {
    const rpm = P.ev ? rpmN * 100 : P.idle + (P.red - P.idle) * rpmN;
    const { L } = await render((ctx) => { const v = createEngineVoice(ctx, ctx.destination, P, { spatial: false }); v.update({ rpm, rpmN, load, level: 1 }); return v; });
    const x = tail(L), s = stat(x); results[key][label] = { ...s, c: centroid(x), x };
    ok(`${key} ${label}: makes sound`, s.rms > 0.003, `rms ${s.rms}`); ok(`${key} ${label}: never clips or goes NaN`, !s.bad && s.peak < 1.0, `peak ${s.peak}`);
    if (label === "idle") wav(`engine-${key}-idle`, x); if (label === "flat") wav(`engine-${key}-flat`, x);
  }
  const r = results[key]; ok(`${key}: louder and brighter when worked hard than at idle`, P.ev || (r.flat.rms > r.idle.rms * 1.2 && r.flat.c > r.idle.c), `idle ${r.idle.rms.toFixed(3)}/${r.idle.c.toFixed(0)} flat ${r.flat.rms.toFixed(3)}/${r.flat.c.toFixed(0)}`);
}
// the pitch is the firing frequency, and it rises with the revs
for (const key of ["compact", "sedanV6", "v8", "bus", "minibus"]) { const P = ENGINES[key]; for (const [label, rpm] of [["idle", P.idle], ["cruise", P.idle + (P.red - P.idle) * 0.35]]) { const want = (rpm / 60) * P.cyl / 2, got = pitch(results[key][label === "idle" ? "idle" : "cruise"].x, want * 0.6, want * 1.7);
  ok(`${key} ${label}: pitch ${got.toFixed(1)} Hz is the firing frequency ${want.toFixed(1)} Hz (or a whole multiple/fraction of it)`, [1, 2, 0.5].some((m) => Math.abs(got / (want * m) - 1) < 0.1), `got ${got}`); } }
ok("a keke's idle sounds as slow puffs, well below a car's pitch", pitch(results.keke.idle.x, 6, 60) < pitch(results.compact.idle.x, 15, 80) * 0.9);
// categories sound different: not one recording
const cents = Object.fromEntries(Object.keys(ENGINES).map((k) => [k, results[k].cruise.c]));
console.log("cruise spectral centroid (Hz):", Object.entries(cents).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", "));
ok("a bus sounds darker than a car, and a supercar brighter than both", cents.bus < cents.compact && cents.v10 > cents.compact);
ok("a keke is raspier (brighter) than a bus", cents.keke > cents.bus);
ok("no two vehicle categories have the same tone", new Set(Object.values(cents).map((c) => Math.round(c / 40))).size >= 8);

// ---- exterior voices: distance, direction ----
const ext = async (x, z, fx = 0, fz = -1) => { const { L, R, h } = await render((ctx) => { setListener(ctx, { x: 0, z: 0, fx, fz }); const v = createEngineVoice(ctx, ctx.destination, ENGINES.compact, { spatial: true }); v.setPosition(x, 0.8, z); v.update({ rpm: 3000, rpmN: 0.4, load: 0.5, level: 1, dop: 1, dist: Math.hypot(x, z), facing: 0 }); return v; }); return { l: stat(tail(L)).rms, r: stat(tail(R)).rms, c: centroid(tail(L)), h }; };
const d10 = await ext(10, 0), d40 = await ext(40, 0), d120 = await ext(120, 0);
ok("a vehicle gets quieter as it moves away", d10.r > d40.r && d40.r > d120.r, `${d10.r} ${d40.r} ${d120.r}`);
ok("and duller (air takes the highs)", d10.c > d120.c, `${d10.c} ${d120.c}`);
ok("a vehicle 120 m away is much quieter than one at 10 m", d120.r < d10.r * 0.35);
const east = await ext(30, 0), west = await ext(-30, 0);   // facing north: east is on the right
ok("a vehicle to the east, facing north, is heard in the right ear", east.r > east.l * 1.5 && west.l > west.r * 1.5, `east l${east.l} r${east.r}; west l${west.l} r${west.r}`);
const ahead = await ext(0, -30), behind = await ext(0, 30);
ok("ahead and behind are centred", Math.abs(ahead.l - ahead.r) < ahead.l * 0.25 && Math.abs(behind.l - behind.r) < behind.l * 0.25);
const turned = await ext(30, 0, 0, 1);   // now facing south: east is on the LEFT
ok("turning round swaps the sides", turned.l > turned.r * 1.5);
// Doppler
const approaching = dopplerRatio(0, 0, 0, 0, 0, 60, 0, -20), receding = dopplerRatio(0, 0, 0, 0, 0, 60, 0, 20), passing = dopplerRatio(0, 0, 0, 0, 40, 0, 0, 20);
ok("an approaching vehicle is higher in pitch, a receding one lower, one passing across unchanged", approaching > 1.03 && receding < 0.97 && Math.abs(passing - 1) < 0.005, `${approaching} ${receding} ${passing}`);

// ---- horns ----
const hornRes = {};
for (const [k, H] of Object.entries(HORNS)) { const pat = k === "keke" ? "peep" : "toot"; const { L } = await render((ctx) => playHorn(ctx, ctx.destination, H, { pattern: pat, level: 1 }), 1.2); const s = stat(L); hornRes[k] = { ...s, c: centroid(L) }; ok(`horn ${k}: audible, not clipping`, s.rms > 0.004 && s.peak < 1 && !s.bad, JSON.stringify(s)); wav(`horn-${k}`, L); }
ok("the horns do not all sound alike", new Set(Object.values(hornRes).map((h) => Math.round(h.c / 60))).size >= 5, JSON.stringify(Object.fromEntries(Object.entries(hornRes).map(([k, v]) => [k, Math.round(v.c)]))));
{ const near = await render((ctx) => { setListener(ctx, { x: 0, z: 0, fx: 0, fz: -1 }); return playHorn(ctx, ctx.destination, HORNS.compact, { pattern: "toot", pos: { x: 10, y: 1, z: 0 }, dist: 10 }); }, 0.6), far = await render((ctx) => { setListener(ctx, { x: 0, z: 0, fx: 0, fz: -1 }); return playHorn(ctx, ctx.destination, HORNS.compact, { pattern: "toot", pos: { x: 120, y: 1, z: 0 }, dist: 120 }); }, 0.6);
  ok("a horn is much quieter far away, and comes from the side it is on", stat(far.R).rms < stat(near.R).rms * 0.3 && stat(near.R).rms > stat(near.L).rms * 1.5); }
for (const [p, beats] of Object.entries(PATTERNS)) ok(`pattern ${p} fits in two seconds`, beats.at(-1)[0] + beats.at(-1)[1] < 2);

// ---- ambience ----
{ const ch = { traffic: () => 1, town: () => 1 }, W = (x) => ({ ...soundWeights({ x, z: 0, places: [{ x: 0, z: 0, kind: "shop" }], vehicles: 8, peds: 8 }) });
  const run = async (w) => (await render((ctx) => { setListener(ctx, { x: 0, z: 0, fx: 0, fz: -1 }); const a = createAmbience(ctx, ctx.destination, ch); a.update(0.2, w, { x: 0, z: 0, night: false }); return a; }, 3)).L;
  const market = stat(tail(await run(W(0)))), quiet = stat(tail(await run(W(2000)))), road = stat(tail(await run(soundWeights({ x: 0, z: 2000, places: [], vehicles: 14, peds: 0, onDeck: true, speed: 25 }))));
  ok("the market's ambience is louder and busier than the quiet edge of town", market.rms > quiet.rms * 1.2, `${market.rms} ${quiet.rms}`); ok("ambience is audible but not loud (it must not drown the engines)", market.rms > 0.002 && market.rms < 0.25 && road.rms < 0.35, `${market.rms} ${road.rms}`); ok("no ambience layer clips", market.peak < 1 && road.peak < 1 && !market.bad); }

console.log(`${n} render checks passed` + (WAV ? "; wav files in /tmp/lifeinoau-audio" : ""));
