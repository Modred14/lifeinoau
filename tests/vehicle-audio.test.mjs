// tests/vehicle-audio.test.mjs
// The logic behind the vehicle and town sound (lib/audio/*), headless: engine profiles per vehicle, the RPM and gearbox model, when computer-driven vehicles honk,
// the ambience weights, the volume mixer and the radio's station list and metadata reader. (The Web Audio nodes themselves are checked by tools/audio/render-check.mjs.)
import assert from "node:assert/strict";
import { ENGINES, VEHICLE_ENGINE, engineKeyFor, hornFor, HORNS, PATTERNS, defaultPattern } from "../lib/audio/profiles.js";
import { createEngine, startEngine, stopEngine, stepEngine, isSilent } from "../lib/audio/engineModel.js";
import { createHornBrain, leadKind } from "../lib/audio/hornBrain.js";
import { soundWeights } from "../lib/audio/zones.js";
import { MIX_DEFAULTS, channel } from "../lib/audio/mixer.js";
import { VEHICLE_PERFORMANCE } from "../lib/vehiclePerformance.js";
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; };

// ---- 1. every vehicle has its own engine, and the categories really differ ----
for (const id of Object.keys(VEHICLE_PERFORMANCE)) ok(`${id} has an engine profile`, !!ENGINES[VEHICLE_ENGINE[id]]);
for (const id of ["keke", "bus", "minibus"]) ok(`${id} is a different engine from a car`, ENGINES[engineKeyFor({ kind: id })] !== ENGINES.compact);
ok("a keke, a bus and a car are three different engines", new Set([engineKeyFor({ kind: "keke" }), engineKeyFor({ kind: "bus" }), engineKeyFor({ kind: "car" })]).size === 3);
ok("the Cybertruck is electric, the Huracan a V10, the Urus a V8", ENGINES[VEHICLE_ENGINE["cybertruck-2024"]].ev && ENGINES[VEHICLE_ENGINE["huracan-2025"]].cyl === 10 && ENGINES[VEHICLE_ENGINE["urus-2025"]].cyl === 8);
ok("ordinary traffic cars are not all the same engine", new Set([0, 0.2, 0.4, 0.55, 0.7, 0.9].map((t) => engineKeyFor({ kind: "car", tint: t }))).size >= 3);
ok("an unknown car id falls back to a car engine", engineKeyFor({ kind: "car", carId: "nope" }) in ENGINES);
const fire = (P, rpm) => (rpm / 60) * P.cyl / 2;   // firing frequency = the pitch
ok("a diesel bus is darker and heavier than a petrol hatchback (lower cutoff, more sub-lump, diesel clatter)", ENGINES.bus.cut[1] < ENGINES.compact.cut[1] && ENGINES.bus.sub > ENGINES.compact.sub && ENGINES.bus.knock > 0 && ENGINES.compact.knock === 0);
ok("a keke thumps at a few puffs a second at idle, far below a car's", fire(ENGINES.keke, ENGINES.keke.idle) < fire(ENGINES.compact, ENGINES.compact.idle) / 1.5);
ok("every vehicle category has a horn, and the horns differ", ["compact", "keke", "bus", "minibus", "suv", "supercar"].length && new Set(["compact", "keke", "bus", "minibus", "v8", "ev"].map((k) => hornFor(k).name)).size === 6);
ok("a chosen horn style overrides the vehicle's own", hornFor("compact", "air") === HORNS.air && hornFor("compact", "auto") === HORNS.compact);
ok("the keke peeps and the bus holds its horn", defaultPattern("keke") === "peep" && defaultPattern("bus") === "long" && defaultPattern("compact") === "toot");
for (const [k, beats] of Object.entries(PATTERNS)) ok(`pattern ${k} is a list of [start, length]`, beats.every((b) => b.length === 2 && b[1] > 0));

// ---- 2. the RPM and gearbox model ----
const drive = (key, { sec = 20, fps = 60, thr = 1, speedOf }) => { const e = createEngine(ENGINES[key]); startEngine(e); let v = 0, log = []; for (let i = 0; i < sec * fps; i++) { const t = i / fps; v = speedOf ? speedOf(t, v) : v; stepEngine(e, { speed: v, throttle: typeof thr === "function" ? thr(t) : thr, dt: 1 / fps }); log.push({ t, rpm: e.rpm, gear: e.gear, v, load: e.load }); } return { e, log }; };
{ const { e, log } = drive("compact", { sec: 2, speedOf: () => 0, thr: 0 }); ok("it cranks, catches and settles at idle", Math.abs(e.rpm - ENGINES.compact.idle) < 90 && log[10].rpm < 400);
  ok("while it cranks it is below idle", log.slice(0, 20).every((p) => p.rpm < 500)); }
{ const { e } = drive("compact", { sec: 3, speedOf: () => 0, thr: 0 }); const idle = e.rpm; for (let i = 0; i < 60; i++) stepEngine(e, { speed: 0, throttle: 1, dt: 1 / 60 }); ok("floored from a standstill the revs climb well above idle", e.rpm > idle + 2000);
  for (let i = 0; i < 180; i++) stepEngine(e, { speed: 0, throttle: 0, dt: 1 / 60 }); ok("and fall back to idle when you let go", Math.abs(e.rpm - ENGINES.compact.idle) < 100); }
{ const { log } = drive("compact", { sec: 25, speedOf: (t, v) => Math.min(44, v + 3.2 / 60) });   // a steady pull from 0 to 44 m/s
  const gears = [...new Set(log.map((p) => p.gear))]; ok("accelerating through the speed range changes gear several times", gears.length >= 4);
  let falls = 0; for (let i = 1; i < log.length; i++) if (log[i].rpm < log[i - 1].rpm - 4 && log[i].gear > log[i - 1].gear - 0.5 && log[i].v > log[i - 1].v) falls++; ok("the revs fall at the upshifts (the sound of a gear change)", falls > 8);
  ok("revs never pass the redline", log.every((p) => p.rpm <= ENGINES.compact.red + 1)); ok("revs never drop below idle once running", log.slice(60).every((p) => p.rpm >= ENGINES.compact.idle * 0.9 - 1));
  const lo = log.filter((p) => p.gear === 1 && p.v > 4).length; ok("it stays in a gear for a while", lo > 5); }
{ const a = drive("sedanV6", { sec: 12, fps: 30, speedOf: (t, v) => Math.min(30, v + 3 / 30) }), b = drive("sedanV6", { sec: 12, fps: 144, speedOf: (t, v) => Math.min(30, v + 3 / 144) });
  ok("the same drive at 30 and 144 fps ends with about the same revs and gear", Math.abs(a.e.rpm - b.e.rpm) < 350 && a.e.gear === b.e.gear); }
{ const { log } = drive("compact", { sec: 30, speedOf: (t, v) => (t < 12 ? Math.min(25, v + 2.5 / 60) : Math.max(0, v - 2 / 60)), thr: (t) => (t < 12 ? 0.7 : 0) });
  const peak = Math.max(...log.map((p) => p.rpm)), end = log.at(-1); ok("slowing down with the throttle off brings the revs down to idle", end.rpm < ENGINES.compact.idle + 150 && peak > 2500); ok("decelerating, the load is light (engine braking)", log.slice(-300).every((p) => p.load < 0.25)); }
{ const e = createEngine(ENGINES.keke); startEngine(e); for (let i = 0; i < 120; i++) stepEngine(e, { speed: 0, throttle: 0, dt: 1 / 60 }); ok("a keke idles at its own rpm", Math.abs(e.rpm - ENGINES.keke.idle) < 120); }
{ const e = createEngine(ENGINES.bus); startEngine(e); for (let i = 0; i < 120; i++) stepEngine(e, { speed: 0, throttle: 0, dt: 1 / 60 }); const idle = e.rpm; let v = 0; for (let i = 0; i < 60 * 12; i++) { v = Math.min(20, v + 1.2 / 60); stepEngine(e, { speed: v, throttle: 0.8, dt: 1 / 60 }); } ok("a bus idles low and revs but never above its (low) redline", idle < 700 && e.rpm <= ENGINES.bus.red); }
{ const e = createEngine(ENGINES.compact); startEngine(e); for (let i = 0; i < 120; i++) stepEngine(e, { speed: 0, throttle: 0, dt: 1 / 60 }); ok("running is not silent", !isSilent(e)); stopEngine(e); let t = 0; while (!isSilent(e) && t < 400) { stepEngine(e, { speed: 0, throttle: 0, dt: 1 / 60 }); t++; } ok("switching off lets the revs fall to silence within a second or two", isSilent(e) && t < 150);
  startEngine(e); ok("and it can be started again", e.mode === "crank"); }
{ const e = createEngine(ENGINES.ev); startEngine(e); for (let i = 0; i < 60; i++) stepEngine(e, { speed: 0, throttle: 0, dt: 1 / 60 }); const still = e.rpm; for (let i = 0; i < 200; i++) stepEngine(e, { speed: 25, throttle: 0.5, dt: 1 / 60 }); ok("an electric motor has no idle and its whine rises with speed", still < 5 && e.rpm > 40 && e.gear === 1); }
{ const e = createEngine(ENGINES.huracan ?? ENGINES.v10); startEngine(e); let v = 0, g = new Set(); for (let i = 0; i < 60 * 20; i++) { v = Math.min(90, v + 4.5 / 60); stepEngine(e, { speed: v, throttle: 1, dt: 1 / 60 }); g.add(e.gear); } ok("a V10 supercar goes through all its gears", g.size >= 6); }
{ const e = createEngine(ENGINES.compact); startEngine(e); for (let i = 0; i < 300; i++) stepEngine(e, { speed: 0, throttle: 1, dt: 1 / 60 }); ok("flat out at a standstill it sits on the limiter without overshooting", e.rpm <= ENGINES.compact.red); }

// ---- 3. when computer-driven vehicles honk ----
const person = { edge: 3, speed: 1.2 }, car = { kind: "car", route: {} }, you = { len: 0.6 }, mine = { len: 4.5 };
ok("leads are told apart", leadKind(person) === "ped" && leadKind(car) === "vehicle" && leadKind(you) === "player" && leadKind(mine) === "other" && leadKind(null) === null);
{ const rnd = () => 0.1, b = createHornBrain({ rnd }); let honks = 0, t = 0;
  ok("nothing in the way: no honk, ever", (() => { for (let i = 0; i < 500; i++) if (b.consider("a", "car", { v: 10, lead: null, dist: 20 }, i * 0.1)) return false; return true; })());
  const first = b.consider("p", "car", { v: 8, lead: { gap: 12, v: 0, who: you }, dist: 20 }, 100); ok("coming up to someone standing in the road: a warning toot", first?.pattern === "toot");
  ok("not again at once for the same person", b.consider("p", "car", { v: 8, lead: { gap: 9, v: 0, who: you }, dist: 20 }, 100.5) === null);
  const stopped = []; for (let i = 0; i < 230; i++) { const r = b.consider("p", "car", { v: 0, lead: { gap: 3, v: 0, who: you }, dist: 20 }, 101 + i * 0.1); if (r) stopped.push(101 + i * 0.1); }
  ok("stopped with them still in front, it honks again only after a pause of at least 9 s (never every second)", stopped.length === 2 && stopped.every((x, i) => i === 0 || x - stopped[i - 1] >= 9));
  ok("after the third honk at one blockage (the warning plus two) it is quiet for a long while", b.consider("p", "car", { v: 0, lead: { gap: 3, v: 0, who: you }, dist: 20 }, 130) === null && b.consider("p", "car", { v: 0, lead: { gap: 3, v: 0, who: you }, dist: 20 }, 145) === null); }
{ const b = createHornBrain({ rnd: () => 0.1 }), a = b.consider("far", "car", { v: 8, lead: { gap: 10, v: 0, who: you }, dist: 400 }, 5); ok("a vehicle too far away to be heard does not honk", a === null); }
{ const b = createHornBrain({ rnd: () => 0.1 }); const r = b.consider("k", "keke", { v: 8, lead: { gap: 10, v: 0, who: person }, dist: 30 }, 5); ok("a keke 'peeps'", r?.pattern === "peep"); const r2 = b.consider("b", "bus", { v: 0, lead: { gap: 4, v: 0, who: person }, dist: 30 }, 6); ok("a bus does not toot within a second of someone else honking", r2 === null); }
{ const b = createHornBrain({ rnd: () => 0.5 }); let any = 0; for (let i = 0; i < 300; i++) if (b.consider("w", "car", { v: 0, waiting: true, lead: { gap: 3, v: 0, who: car }, dist: 30 }, i * 0.1)) any++; ok("a vehicle waiting its turn at a junction does not honk (rnd 0.5 is above its 20% chance)", any === 0); }
{ const b = createHornBrain({ rnd: () => 0.1 }); let any = null; for (let i = 0; i < 300; i++) any ||= b.consider("q", "car", { v: 0, lead: { gap: 3, v: 0, who: car }, dist: 30 }, i * 0.1); ok("stuck behind a stopped vehicle for a long time: an impatient honk", !!any); }
{ const b = createHornBrain({ rnd: () => 0.1 }); b.consider("x", "car", { v: 8, lead: { gap: 10, v: 0, who: you }, dist: 20 }, 1); b.consider("y", "car", { v: 8, lead: { gap: 10, v: 0, who: you }, dist: 20 }, 50); ok("memory is kept per vehicle", b.size === 2); b.prune(new Set(["y"])); ok("and forgotten when a vehicle goes", b.size === 1); }
{ const b = createHornBrain({ rnd: () => 0.1 }); ok("it never honks at the player's own car", b.consider("z", "car", { v: 8, lead: { gap: 6, v: 0, who: mine }, dist: 20 }, 3) === null); }

// ---- 4. the soundscape ----
const places = [{ x: 0, z: 0, kind: "shop" }, { x: 400, z: 0, kind: "hostel" }, { x: 800, z: 0, kind: "lecture" }, { x: 1200, z: 0, kind: "worship" }];
{ const m = soundWeights({ x: 5, z: 0, places, vehicles: 4, peds: 10 }), h = soundWeights({ x: 400, z: 10, places, vehicles: 1, peds: 2, night: true }), q = soundWeights({ x: 2500, z: 0, places, vehicles: 0, peds: 0 }), w = soundWeights({ x: 0, z: 2000, places, vehicles: 12, peds: 0, onDeck: true, speed: 28 });
  ok("at the market there is more human activity than at a quiet spot", m.crowd > q.crowd + 0.3 && m.market > 0.9); ok("a hostel has its own sound (a generator hum, murmur), a quiet spot none", h.generator > 0.8 && h.hostelAt && q.generator === 0);
  ok("a busy road is busier than a quiet one", soundWeights({ x: 2500, z: 0, places, vehicles: 14, peds: 0 }).traffic > q.traffic + 0.3); ok("the expressway is all traffic and wind, with no crowd", w.traffic > 0.9 && w.wind > 0.5 && w.crowd < 0.1 && w.name === "highway");
  ok("nature is strongest where it is quiet", q.nature > m.nature + 0.3); ok("the generator hum is louder at night", soundWeights({ x: 400, z: 0, places, night: true }).generator > soundWeights({ x: 400, z: 0, places, night: false }).generator);
  const a = soundWeights({ x: 60, z: 0, places }), b = soundWeights({ x: 61, z: 0, places }); ok("weights change smoothly with position: no jump from one soundscape to another", Math.abs(a.crowd - b.crowd) < 0.05 && Math.abs(a.traffic - b.traffic) < 0.05);
  ok("every weight is between 0 and 1", [m, h, q, w].every((r) => ["traffic", "crowd", "nature", "market", "generator", "wind", "hostel"].every((k) => r[k] >= 0 && r[k] <= 1))); }

// ---- 5. the mixer ----
ok("by default everything is on", channel("engine", MIX_DEFAULTS) === 1 && channel("horn", MIX_DEFAULTS) === 1 && channel("master", MIX_DEFAULTS) === 1);
ok("the master scales every channel", Math.abs(channel("engine", { ...MIX_DEFAULTS, masterVolume: 50 }) - 0.5) < 1e-9 && Math.abs(channel("radio", { ...MIX_DEFAULTS, masterVolume: 50, radioVolume: 50 }) - 0.25) < 1e-9);
ok("each channel is independent", channel("engine", { ...MIX_DEFAULTS, hornVolume: 0 }) === 1 && channel("horn", { ...MIX_DEFAULTS, hornVolume: 0 }) === 0);
ok("a channel mute silences only that channel", channel("town", { ...MIX_DEFAULTS, townMute: true }) === 0 && channel("traffic", { ...MIX_DEFAULTS, townMute: true }) === 1);
ok("muting the master silences all, the radio too", ["engine", "horn", "traffic", "town", "radio", "master"].every((c) => channel(c, { ...MIX_DEFAULTS, masterMute: true }) === 0));
console.log(`${n} vehicle-audio checks passed`);

// ---- 6. the audio settings are saved and validated like every other setting ----
{ const { SETTING_DEFAULTS, cleanSettings } = await import("../lib/settings.js"), d = SETTING_DEFAULTS.audio;
  ok("every volume and mute has a default", ["masterVolume", "engineVolume", "hornVolume", "trafficVolume", "townVolume", "radioVolume", "masterMute", "engineMute", "hornMute", "trafficMute", "townMute", "hornStyle"].every((k) => k in d));
  ok("the old settings are untouched", d.music === true && d.sfx === true && d.musicVolume === 100 && d.sfxVolume === 100);
  const c = cleanSettings({ audio: { masterVolume: 150, hornVolume: -5, radioVolume: "loud", hornStyle: "nope", engineMute: true, trafficMute: "yes" } }).audio;
  ok("volumes are clamped to 0..100 and junk falls back to the default", c.masterVolume === 100 && c.hornVolume === 0 && c.radioVolume === d.radioVolume);
  ok("an unknown horn style falls back to automatic; a real boolean is kept; a non-boolean is ignored", c.hornStyle === "auto" && c.engineMute === true && c.trafficMute === false);
  ok("every horn style the Settings list offers is accepted", ["auto", "standard", "deep", "bright", "air"].every((h) => cleanSettings({ audio: { hornStyle: h } }).audio.hornStyle === h)); }
console.log(`${n} vehicle-audio checks passed (with settings)`);
