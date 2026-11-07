// lib/audio/profiles.js
// What every kind of vehicle sounds like, as numbers (pure JS: used by the voices in engineVoice.js / hornVoice.js and by the tests).
// There are no recordings: each engine is built live from these numbers (a stack of harmonics at the engine's firing frequency, its own lumpiness, intake and exhaust noise),
// so a keke, a bus, a hatchback and a V10 sound like different machines, and the pitch follows the real RPM.
//
//   cyl, stroke   cylinders and 2 or 4 stroke: the engine fires cyl/2 times per turn (4-stroke), so the sound's pitch is rpm/60 * cyl/2
//   idle, red     idle and redline RPM
//   gears         the speed (m/s) at the top of each gear, near redline: this is what makes the revs rise and fall with every gear change
//   wave          the exhaust pulse's harmonics: { n harmonics, tilt (higher = rounder), even (how strong the even ones are) }
//   cut           the tone's low-pass cutoff [at idle, wide open] in Hz   |   sub: weight of the half-order lump   |   noise: intake and mechanical hiss
//   knock         diesel clatter: how strongly the sound pulses at the firing rate   |   jitter: cycle-to-cycle wander (keeps it from sounding like a machine)
//   gain          overall level   |   ev: an electric motor (a rising whine, no gears)
import { VEHICLE_PERFORMANCE } from "../vehiclePerformance.js";

export const ENGINES = {
  compact:  { name: "Small petrol 4-cylinder", cyl: 4, stroke: 4, idle: 800, red: 6400, gears: [9, 16, 24, 33, 44],            wave: { n: 22, tilt: 1.05, even: 0.75 }, cut: [650, 3400], sub: 0.35, noise: 0.10, knock: 0,    jitter: 0.004, gain: 0.55 },
  turbo4:   { name: "Turbo 4-cylinder",        cyl: 4, stroke: 4, idle: 780, red: 6500, gears: [11, 19, 28, 38, 49, 60],        wave: { n: 22, tilt: 1.15, even: 0.6 },  cut: [600, 3000], sub: 0.25, noise: 0.14, knock: 0,    jitter: 0.003, gain: 0.55 },
  sedanV6:  { name: "V6",                      cyl: 6, stroke: 4, idle: 700, red: 6500, gears: [12, 20, 29, 40, 52, 66],        wave: { n: 24, tilt: 1.2,  even: 0.8 },  cut: [520, 2700], sub: 0.30, noise: 0.10, knock: 0,    jitter: 0.003, gain: 0.58 },
  sportV6:  { name: "Sport V6",                cyl: 6, stroke: 4, idle: 750, red: 7200, gears: [13, 22, 32, 44, 57, 70],        wave: { n: 26, tilt: 0.95, even: 0.85 }, cut: [700, 4200], sub: 0.22, noise: 0.12, knock: 0,    jitter: 0.003, gain: 0.6 },
  suv:      { name: "SUV V6",                  cyl: 6, stroke: 4, idle: 650, red: 6000, gears: [11, 19, 27, 36, 48, 60],        wave: { n: 22, tilt: 1.35, even: 0.7 },  cut: [420, 2200], sub: 0.5,  noise: 0.12, knock: 0,    jitter: 0.004, gain: 0.64 },
  v8:       { name: "Twin-turbo V8",           cyl: 8, stroke: 4, idle: 700, red: 7000, gears: [14, 23, 33, 45, 58, 72, 90],    wave: { n: 24, tilt: 1.2,  even: 0.9 },  cut: [450, 2800], sub: 0.55, noise: 0.12, knock: 0,    jitter: 0.005, gain: 0.68 },
  v10:      { name: "V10 supercar",            cyl: 10, stroke: 4, idle: 950, red: 8500, gears: [15, 25, 36, 49, 63, 79, 98],   wave: { n: 30, tilt: 0.8,  even: 0.95 }, cut: [900, 6000], sub: 0.12, noise: 0.16, knock: 0,    jitter: 0.002, gain: 0.7 },
  ev:       { name: "Electric motor",          cyl: 4, stroke: 4, idle: 0,   red: 1,    gears: [], ev: true, fMin: 160, fMax: 2400, wave: { n: 6, tilt: 1.8, even: 0.2 }, cut: [900, 5200], sub: 0,    noise: 0.05, knock: 0,    jitter: 0.001, gain: 0.34 },
  keke:     { name: "Keke single-cylinder",    cyl: 1, stroke: 4, idle: 1500, red: 5600, gears: [4.2, 8, 12.5, 17],            wave: { n: 40, tilt: 0.62, even: 1 },    cut: [900, 3600], sub: 0.15, noise: 0.22, knock: 0.35, jitter: 0.02,  gain: 0.6 },
  minibus:  { name: "Minibus diesel",          cyl: 4, stroke: 4, idle: 720, red: 3900, gears: [5.5, 9.5, 14.5, 20, 27],        wave: { n: 22, tilt: 1.0,  even: 0.7 },  cut: [380, 1900], sub: 0.45, noise: 0.18, knock: 0.5,  jitter: 0.008, gain: 0.7 },
  bus:      { name: "Bus diesel",              cyl: 6, stroke: 4, idle: 620, red: 2700, gears: [4.2, 7, 10.5, 15, 21, 28],      wave: { n: 20, tilt: 1.1,  even: 0.65 }, cut: [320, 1500], sub: 0.6,  noise: 0.2,  knock: 0.55, jitter: 0.008, gain: 0.78 },
};

/** Which engine each purchasable car has (the real-world engine character of that model), and the hired vehicles. */
export const VEHICLE_ENGINE = {
  "corolla-2011": "compact", "accord-2014": "sedanV6", "camry-2014": "sedanV6", "is350-2014": "sportV6", "cclass-2016": "turbo4",
  "gle-2018": "suv", "rrsport-2016": "suv", "urus-2025": "v8", "huracan-2025": "v10", "cybertruck-2024": "ev",
  keke: "keke", bus: "bus", minibus: "minibus",
};
/** The mix of ordinary cars on the road (traffic cars have no model): mostly small cars, some saloons and SUVs, like a real Nigerian road. */
const TRAFFIC_CARS = ["compact", "compact", "compact", "sedanV6", "turbo4", "suv", "compact", "sedanV6"];

/** Which engine a thing on the road has: { kind: "car"|"keke"|"bus"|"minibus", carId?, tint? (0..1: which ordinary car) } -> a key of ENGINES. */
export function engineKeyFor({ kind = "car", carId = null, tint = 0 } = {}) {
  if (carId && VEHICLE_ENGINE[carId]) return VEHICLE_ENGINE[carId];
  if (kind === "keke" || kind === "bus" || kind === "minibus") return kind;
  return TRAFFIC_CARS[Math.floor(Math.max(0, Math.min(0.999, tint)) * TRAFFIC_CARS.length)];
}
export const engineProfile = (key) => ENGINES[key] ?? ENGINES.compact;

/** The horns. Each tone is one reed (Hz, wave, level, low-pass, buzz); beats: [start s, length s] per honk of a pattern. */
const two = (a, b, o = {}) => [{ f: a, type: "sawtooth", vol: 0.2, lp: 2300, buzz: 5, ...o }, { f: b, type: "sawtooth", vol: 0.17, lp: 2300, buzz: 6, ...o }, { f: b * 2, type: "square", vol: 0.035, lp: 2300 }];
export const HORNS = {
  compact: { name: "Compact horn", tones: two(420, 528) },
  saloon:  { name: "Saloon horn",  tones: two(370, 466, { lp: 2000 }) },
  deep:    { name: "Deep SUV horn", tones: [...two(330, 415, { lp: 1700, vol: 0.22 }), { f: 165, type: "sawtooth", vol: 0.12, lp: 600 }] },
  bright:  { name: "Bright sport horn", tones: two(494, 622, { lp: 3200 }) },
  truck:   { name: "Truck horn", tones: two(350, 440, { lp: 1800, vol: 0.24 }) },
  keke:    { name: "Keke bulb horn", tones: [{ f: 760, type: "square", vol: 0.12, lp: 2600, buzz: 14 }, { f: 1140, type: "square", vol: 0.05, lp: 3000 }] },
  minibus: { name: "Danfo horn", tones: two(440, 554, { lp: 2400, vol: 0.24, buzz: 9 }) },
  air:     { name: "Air horn", tones: [{ f: 311, type: "sawtooth", vol: 0.2, lp: 1700, buzz: 3 }, { f: 392, type: "sawtooth", vol: 0.19, lp: 1700, buzz: 3 }, { f: 466, type: "sawtooth", vol: 0.17, lp: 1700, buzz: 3 }, { f: 155, type: "sawtooth", vol: 0.12, lp: 500 }] },
};
export const PATTERNS = {
  toot:   [[0, 0.2]],
  double: [[0, 0.17], [0.27, 0.19]],
  long:   [[0, 0.75]],
  peep:   [[0, 0.1], [0.17, 0.1]],        // the keke's "pe-pe"
  tap:    [[0, 0.4]],                      // a single press with no hold
};
const HORN_OF_ENGINE = { compact: "compact", turbo4: "saloon", sedanV6: "saloon", sportV6: "bright", suv: "deep", v8: "deep", v10: "bright", ev: "truck", keke: "keke", minibus: "minibus", bus: "air" };
const STYLE_HORN = { standard: "compact", deep: "deep", bright: "bright", air: "air" };
/** The horn for a vehicle (its engine key), or the one the player chose in Settings ("auto" = the vehicle's own). */
export const hornFor = (engineKey, style = "auto") => HORNS[STYLE_HORN[style] ?? HORN_OF_ENGINE[engineKey] ?? "compact"];
/** The pattern a vehicle honks in by default. */
export const defaultPattern = (engineKey) => (engineKey === "keke" ? "peep" : engineKey === "bus" ? "long" : "toot");

/** The top speed (m/s) of a car model, for the gear sizes of a fast car (a Huracan's gears are longer than a Corolla's). */
export const topSpeedOf = (carId, fallback = 45) => (VEHICLE_PERFORMANCE[carId]?.topKmh ? VEHICLE_PERFORMANCE[carId].topKmh / 3.6 : fallback);
