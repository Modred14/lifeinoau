// lib/vehiclePerformance.js
// The ONE place that says how fast, how quickly and how hard every vehicle in the game can go, from its real-world figures. Pure JS (no three.js, no DOM, no imports):
// lib3d/carphysics.js turns each entry into its driving model, lib/travel.js takes the server's speed cap from it, and the tests read it.
//
// UNITS. The map is in metres (one world unit = one metre: the road graph in public/data/oau-roadgraph.json, the car models and the physics all use metres), so a speed in km/h
// is converted with m/s = km/h / 3.6 and mph with m/s = mph * 0.44704, and nothing else scales it. There is no hidden "game speed" factor: the speedometer (m/s * 3.6) shows the real figure.
//
// HOW AN ENTRY BECOMES MOTION. Each vehicle gives four numbers:
//   topKmh   the top speed. The driving model's drag is solved so that full throttle settles exactly here (and never above it);
//   accel    a reference acceleration { kmh, s }: the time from rest to that speed (0-100 km/h for a car; slower vehicles use a lower reference speed);
//   launch   the most acceleration (m/s2) the tyres and first gear can put down from a standstill (about 0.2 g for a keke to 1.3 g for an all-wheel-drive supercar; always above the average the quoted time implies, which deriveLongitudinal checks);
//   brake    the braking deceleration (m/s2), from a published stopping distance where there is one (see brakeFromStop).
// Above the launch limit the engine is power-limited (a = power / speed, as in a real car), so from `topKmh` and `accel` the model finds the one engine power that reproduces the
// quoted time (deriveLongitudinal). Acceleration is therefore strong from rest, then falls away smoothly, and drag brings it to zero at the top speed.
//
// SOURCES AND HOW SURE EACH NUMBER IS (`confidence`):
//   "published"  the manufacturer's own figure, or a standard published test of that model and year;
//   "calculated" a published calculator / listing figure (not a track test) from a reputable data site;
//   "estimate"   a defensible class estimate where no exact figure for that variant could be confirmed. These are marked, so nobody mistakes them for measurements.
// Figures were read on 27 Oct 2026. Where a model year or variant is not the one tested, `note` says so.

const KMH_PER_MPH = 1.609344;
export const kmhToMps = (kmh) => kmh / 3.6;
export const mpsToKmh = (mps) => mps * 3.6;
export const mphToMps = (mph) => mph * 0.44704;
export const mpsToMph = (mps) => mps / 0.44704;
export const kmhToMph = (kmh) => kmh / KMH_PER_MPH;
export const mphToKmh = (mph) => mph * KMH_PER_MPH;
/** One world unit is one metre (see above). */
export const METRES_PER_WORLD_UNIT = 1;
/** The deceleration (m/s2) that stops a car from `kmh` in `metres` (constant braking: v^2 / 2d). */
export const brakeFromStop = (kmh, metres) => kmhToMps(kmh) ** 2 / (2 * metres);
const feet = (f) => f * 0.3048;

/**
 * confidence: "published" | "calculated" | "estimate" for the top speed (`topConf`), the acceleration (`accelConf`) and the brakes (`brakeConf`) separately.
 */
export const VEHICLE_PERFORMANCE = {
  "corolla-2011": { name: "Toyota Corolla LE (2011)", class: "economy sedan", topKmh: 180, accel: { kmh: 100, s: 10.0 }, launch: 4.5, brake: 8.3,
    topConf: "estimate", accelConf: "published", brakeConf: "estimate",
    source: "0-60 mph 9.8 s: Motor Trend test of the 2011 Corolla LE 1.8 4-speed automatic (listed at 0-60specs.com/toyota/corolla-0-60-times); 0-100 km/h taken as 10.0 s (62.1 mph is a little further than 60). Top speed not confirmed from a source: ~180 km/h (112 mph) is the usual figure for a 132 hp 1.8 automatic. Braking: class estimate." },
  "accord-2014": { name: "Honda Accord EX-L V6 (2014)", class: "midsize sedan", topKmh: 220, accel: { kmh: 100, s: 6.3 }, launch: 6.6, brake: brakeFromStop(96.56, feet(128)),
    topConf: "estimate", accelConf: "published", brakeConf: "published",
    source: "0-60 mph 6.1 s and 60-0 mph in 128 ft: Edmunds' test of the 2014 Accord EX-L V6 (edmunds.com/honda/accord/2014/review); 0-100 km/h taken as 6.3 s. Top speed not confirmed: ~220 km/h (137 mph) estimated for 278 hp." },
  "camry-2014": { name: "Toyota Camry XLE V6 (2014)", class: "midsize sedan", topKmh: 230, accel: { kmh: 100, s: 6.6 }, launch: 6.3, brake: 8.8,
    topConf: "estimate", accelConf: "calculated", brakeConf: "estimate",
    source: "0-60 mph 6.4-6.7 s and 155 mph (249 km/h) are calculator figures for the 268 hp V6 on motormatchup.com; 155 mph is optimistic for a family sedan, so 230 km/h (143 mph) is used. 0-100 km/h taken as 6.6 s. Braking: class estimate." },
  "is350-2014": { name: "Lexus IS 350 (2014)", class: "sport sedan", topKmh: 230, accel: { kmh: 100, s: 5.7 }, launch: 7.3, brake: 9.8,
    topConf: "estimate", accelConf: "published", brakeConf: "estimate",
    source: "0-60 mph averages 5.56 s over seven published 2014 IS 350 tests (Motor Trend 5.3-5.5, Road & Track 5.4, Car and Driver 5.6; 0-60specs.com/lexus-is-350-0-60-times); 0-100 km/h taken as 5.7 s. Top speed not confirmed: ~230 km/h (143 mph) is the usual electronically limited figure. Braking: sport-sedan estimate (about 120 ft from 60 mph)." },
  "cclass-2016": { name: "Mercedes-Benz C300 4MATIC (2016)", class: "compact luxury sedan", topKmh: 210, accel: { kmh: 100, s: 6.0 }, launch: 7.0, brake: 9.4,
    topConf: "estimate", accelConf: "calculated", brakeConf: "estimate",
    source: "0-60 mph 5.8 s (calculator headline; 6.0 s in its detailed simulation) for the 241 hp 2.0 turbo on motormatchup.com, so 0-100 km/h is 6.0 s. The same page's 150 mph is an unrestricted calculation; US-market C300s are generally electronically limited near 130 mph, so 210 km/h is used. Braking: class estimate." },
  "gle-2018": { name: "Mercedes-Benz GLE 350 4MATIC (2018)", class: "midsize SUV", topKmh: 209, accel: { kmh: 100, s: 7.7 }, launch: 5.5, brake: 8.6,
    topConf: "calculated", accelConf: "calculated", brakeConf: "estimate",
    source: "Kelley Blue Book specs for the 2018 GLE 350 4MATIC: 302 hp, 0-60 mph 7.5 s, top speed 130 mph (209 km/h), 4,751 lb (kbb.com/mercedes-benz/gle/2018/specs). 0-100 km/h taken as 7.7 s. Braking: SUV estimate." },
  "rrsport-2016": { name: "Range Rover Sport HSE 3.0 SC (2016)", class: "large SUV", topKmh: 209, accel: { kmh: 100, s: 7.1 }, launch: 6.0, brake: 8.6,
    topConf: "calculated", accelConf: "calculated", brakeConf: "estimate",
    source: "Kelley Blue Book specs for the 2016 Range Rover Sport HSE 3.0 supercharged V6: 340 hp, 0-60 mph 6.9 s, top speed 130 mph (209 km/h), 4,661 lb (kbb.com/land-rover/range-rover-sport/2016/specs). 0-100 km/h taken as 7.1 s. Braking: SUV estimate." },
  "cybertruck-2024": { name: "Tesla Cybertruck Dual Motor AWD (2024)", class: "electric pickup", topKmh: 180, accel: { kmh: 100, s: 4.3 }, launch: 10.0, brake: 9.0,
    topConf: "published", accelConf: "published", brakeConf: "estimate",
    source: "Tesla's figures for the dual-motor AWD: about 600 hp, 0-60 mph 4.1 s, 0-62 mph 4.3 s, top speed 112 mph (180 km/h), 6,603 lb (ArenaEV spec page, arenaev.com/tesla_cybertruck_dual_motor_all_wheel_drive_2026-specs-916.php). 0-100 km/h taken as 4.3 s. Braking: heavy-vehicle estimate." },
  "urus-2025": { name: "Lamborghini Urus (2025)", class: "super SUV", topKmh: 305, accel: { kmh: 100, s: 3.6 }, launch: 11.0, brake: brakeFromStop(100, 33.7),
    topConf: "published", accelConf: "published", brakeConf: "estimate",
    source: "Lamborghini's Urus page (lamborghini.com/en-en/history/urus): 650 CV, top speed 305 km/h, 0-100 km/h 3.6 s. The 2025 Urus S/SE are quoted slightly quicker (about 3.4-3.5 s), so this is the conservative 650 CV figure that matches the car's listed specs. Braking: 100-0 km/h in about 33.7 m is the commonly quoted figure, not re-checked against a primary source this session." },
  "huracan-2025": { name: "Lamborghini Huracán EVO (2019-2025)", class: "supercar", topKmh: 325, accel: { kmh: 100, s: 2.9 }, launch: 12.5, brake: brakeFromStop(100, 31.9),
    topConf: "published", accelConf: "published", brakeConf: "estimate",
    source: "Lamborghini's Huracán EVO page (lamborghini.com/en-en/history/huracan-evo, as given in the task) and the EVO AWD spec sheet (autotijd.be/en/specs/lamborghini/huracan/evo-640-hp-awd-426): 640 PS (631 hp) 5.2 V10, top speed over 325 km/h, 0-100 km/h 2.9 s. The 2025 Tecnica/Sterrato/STO are different variants; the game's car (5.2 V10, 600+ hp, AWD, 7-speed dual-clutch) is the EVO. Braking: 100-0 km/h in about 31.9 m is the commonly quoted figure, not re-checked against a primary source this session." },
  keke: { name: "Bajaj RE keke napep", class: "auto-rickshaw", topKmh: 65, accel: { kmh: 40, s: 10.0 }, launch: 2.2, brake: 4.0,
    topConf: "published", accelConf: "estimate", brakeConf: "estimate",
    source: "Bajaj RE brochure: maximum speed 65 km/h, 198.88 cc, 6.55 kW, 398 kg kerb weight (bajajauto.com, RE CNG brochure). 0-40 km/h in about 10 s is an estimate for that power and a passenger load; drum brakes, so a low braking figure." },
  bus: { name: "OAU shuttle bus (Dongfeng-style minibus)", class: "minibus", topKmh: 100, accel: { kmh: 50, s: 10.0 }, launch: 2.4, brake: 5.8,
    topConf: "estimate", accelConf: "estimate", brakeConf: "estimate",
    source: "No exact model: the game's bus is a Dongfeng-style minibus. 100 km/h is the quoted top speed of the Dongfeng Rich range (Dongfeng Rich 6 EV 350: 100 km/h, per autodeal.com.ph and Wikipedia's Dongfeng Rich page); 0-50 km/h in about 10 s and the braking are estimates for a loaded minibus." },
};

/** What a vehicle with no entry (an unknown id) drives like: an ordinary 1.8 L family sedan. */
export const STANDARD_VEHICLE = { name: "standard car", class: "economy sedan", topKmh: 180, accel: { kmh: 100, s: 10.0 }, launch: 4.5, brake: 8.3, topConf: "estimate", accelConf: "estimate", brakeConf: "estimate", source: "Same as the Corolla." };

/** The fastest any vehicle in the game can go (m/s): the server's cap on what a driven vehicle may report is derived from it, so no vehicle is ever refused for its own top speed. */
export const MAX_DRIVEN_SPEED_MPS = Math.max(...Object.values(VEHICLE_PERFORMANCE).map((v) => kmhToMps(v.topKmh)));
/** A vehicle's top speed in m/s, or null for an unknown id. */
export const topSpeedMps = (id) => (VEHICLE_PERFORMANCE[id] ? kmhToMps(VEHICLE_PERFORMANCE[id].topKmh) : null);

export const ROLLING = 0.35;   // m/s2, always opposing motion (also in lib3d/carphysics.js)
export const PEDAL_UP = 6;     // 1/s, how fast the throttle pedal ramps in (also in lib3d/carphysics.js)

/** Seconds from rest to `vTarget` (m/s) at full throttle with this engine power and drag, as the driving model integrates it (pedal ramp, launch limit, power limit, drag). */
function timeTo(vTarget, launch, power, drag, rolling, pedalUp) {
  let v = 0, t = 0; const h = 0.004;
  while (t < 90) {
    const thr = 1 - Math.exp(-pedalUp * t), a = thr * Math.min(launch, power / Math.max(v, 0.1)) - drag * v * v - rolling;
    const vn = v + a * h; if (vn >= vTarget) return t + (h * (vTarget - v)) / Math.max(1e-9, vn - v);
    if (a <= 1e-6 && t > 1) return Infinity; v = vn; t += h;
  }
  return Infinity;
}

/**
 * From a vehicle's figures to the numbers the driving model uses: { vmax, accel (the launch limit), power, drag, rolling, brake }.
 * The engine power is found by bisection so the car reaches `accel.kmh` in exactly `accel.s` seconds; the drag so that full throttle holds exactly `topKmh`.
 * Throws if the figures cannot be met (a launch limit too low for the quoted time), so a bad entry fails loudly instead of driving wrongly.
 */
export function deriveLongitudinal(spec, { rolling = ROLLING, pedalUp = PEDAL_UP } = {}) {
  const vmax = kmhToMps(spec.topKmh), vRef = kmhToMps(spec.accel.kmh), target = spec.accel.s, launch = spec.launch;
  if (!(vmax > 0) || !(vRef > 0 && vRef < vmax) || !(target > 0) || !(launch > 0) || !(spec.brake > 0)) throw new Error(`bad vehicle performance entry: ${spec.name}`);
  const dragFor = (P) => Math.max(0, (P / vmax - rolling) / (vmax * vmax));
  let lo = rolling * vmax * 1.0001, hi = launch * vmax;   // more power than launch x vmax cannot help (the launch limit already holds all the way up), and the drag it implies would be absurd
  if (timeTo(vRef, launch, hi, dragFor(hi), rolling, pedalUp) > target) throw new Error(`${spec.name}: ${spec.accel.s} s to ${spec.accel.kmh} km/h cannot be reached with a launch limit of ${launch} m/s2`);
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (timeTo(vRef, launch, mid, dragFor(mid), rolling, pedalUp) > target) lo = mid; else hi = mid; }
  const power = hi;
  return { vmax, accel: launch, power, drag: dragFor(power), rolling, brake: spec.brake };
}
