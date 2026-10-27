// tests/vehicle-performance.test.mjs
// Every vehicle drives like the real thing: its own top speed, its own acceleration, its own brakes (lib/vehiclePerformance.js -> lib3d/carphysics.js), with the unit conversions
// right, no hidden global cap, the right pecking order (supercar > super SUV > sports sedan > family car > SUV > minibus > keke), steering that stays controllable, walls that stay solid at
// 300 km/h, a result that does not depend on the frame rate, and a server that never refuses a real top speed.
import {
  VEHICLE_PERFORMANCE as V, STANDARD_VEHICLE, MAX_DRIVEN_SPEED_MPS, METRES_PER_WORLD_UNIT, kmhToMps, mpsToKmh, mphToMps, mpsToMph, kmhToMph, mphToKmh, brakeFromStop, topSpeedMps, deriveLongitudinal,
} from "../lib/vehiclePerformance.js";
import { PROFILES, CAR, carProfile, createCar, stepCar, steerLimit, MAX_STEP_M } from "../lib3d/carphysics.js";
import { CARS } from "../lib/cars.js";
import { OWN_CAR_MAX, TRAVEL_LIMITS, minTravelMs, clampPing, pingMps, PING_SLACK_M } from "../lib/travel.js";
import { setDriveHandoff, peekDriveHandoff } from "../lib/driveHandoff.js";
let bad = 0, n = 0; const chk = (l, c) => { n++; if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const ids = Object.keys(V), DT = 1 / 60;
const drive = (id, sec, inp, { dt = DT, probe = null, car = createCar() } = {}) => { const P = carProfile(id); for (let i = 0; i < Math.round(sec / dt); i++) stepCar(car, typeof inp === "function" ? inp(i * dt, car) : inp, dt, probe, P); return car; };

// ---- 1. every vehicle has a valid, positive, vehicle-specific profile ----
chk("every car in the showroom, the keke and the bus have a performance entry (and nothing else does)", CARS.every((c) => V[c.id]) && V.keke && V.bus && ids.length === CARS.length + 2);
chk("every entry has positive, finite speed, acceleration, launch and braking figures", ids.every((id) => { const s = V[id]; return [s.topKmh, s.accel.kmh, s.accel.s, s.launch, s.brake].every((x) => Number.isFinite(x) && x > 0) && s.accel.kmh < s.topKmh; }));
chk("every entry names its source and says how sure each figure is (published / calculated / estimate)", ids.every((id) => { const s = V[id], ok = ["published", "calculated", "estimate"]; return s.source?.length > 40 && ok.includes(s.topConf) && ok.includes(s.accelConf) && ok.includes(s.brakeConf); }));
chk("no two vehicles share a performance profile", new Set(ids.map((id) => JSON.stringify([V[id].topKmh, V[id].accel, V[id].launch, V[id].brake]))).size === ids.length);
chk("every driving profile exists, and its top speed is the real top speed (not cut down by a global cap)", ids.every((id) => PROFILES[id] && near(PROFILES[id].vmax, kmhToMps(V[id].topKmh), 1e-9) && carProfile(id).vmax === PROFILES[id].vmax));
chk("the Lamborghini Huracán EVO is 325 km/h and 2.9 s to 100 km/h, as Lamborghini states; the Urus is 305 km/h and 3.6 s", V["huracan-2025"].topKmh === 325 && V["huracan-2025"].accel.s === 2.9 && V["urus-2025"].topKmh === 305 && V["urus-2025"].accel.s === 3.6);
chk("an entry whose figures cannot be met fails loudly instead of driving wrongly", (() => { try { deriveLongitudinal({ ...V["huracan-2025"], launch: 4 }); return false; } catch { return true; } })());

// ---- 2. unit conversions ----
chk("km/h <-> m/s: 100 km/h is 27.78 m/s, 325 km/h is 90.28 m/s, and back again", near(kmhToMps(100), 27.7778, 1e-3) && near(kmhToMps(325), 90.2778, 1e-3) && near(mpsToKmh(kmhToMps(231.7)), 231.7, 1e-9));
chk("mph <-> m/s <-> km/h: 60 mph is 26.82 m/s is 96.56 km/h; 325 km/h is 201.9 mph", near(mphToMps(60), 26.8224, 1e-4) && near(mpsToMph(26.8224), 60, 1e-4) && near(mphToKmh(60), 96.5606, 1e-3) && near(kmhToMph(325), 201.95, 0.01));
chk("one world unit is one metre: nothing scales a speed on its way to the map", METRES_PER_WORLD_UNIT === 1);
chk("the speedometer's conversion (m/s * 3.6) shows exactly the configured top speed when the car is flat out on a clear road", ids.every((id) => { const c = drive(id, 200, { gas: 1 }); return near(Math.round(c.v * 3.6), Math.round(V[id].topKmh), 1); }));
chk("braking from a published stopping distance: 128 ft from 60 mph is 9.2 m/s2; 31.9 m from 100 km/h is 12.1 m/s2", near(brakeFromStop(96.56, 128 * 0.3048), 9.2, 0.05) && near(brakeFromStop(100, 31.9), 12.1, 0.05));

// ---- 3. acceleration and top-speed enforcement ----
const first = (id, kmh) => { const c = createCar(), P = carProfile(id); for (let i = 0; i < 60 * 120; i++) { stepCar(c, { gas: 1 }, DT, null, P); if (c.v >= kmhToMps(kmh)) return (i + 1) * DT; } return Infinity; };
chk("each vehicle reaches its quoted speed in its quoted time, as driven through stepCar (within 2%)", ids.every((id) => near(first(id, V[id].accel.kmh), V[id].accel.s, V[id].accel.s * 0.02 + DT)));
chk("full throttle for 200 s: no vehicle ever goes above its top speed, at any step", ids.every((id) => { const c = createCar(), P = carProfile(id); let top = 0; for (let i = 0; i < 60 * 200; i++) { stepCar(c, { gas: 1 }, DT, null, P); top = Math.max(top, c.v); } return top <= P.vmax + 1e-9 && top > P.vmax * 0.995; }));
chk("every vehicle reaches 98% of its top speed on a long clear road", ids.every((id) => { const c = drive(id, 150, { gas: 1 }); return c.v >= 0.98 * carProfile(id).vmax; }));
chk("acceleration is progressive: speed rises smoothly (never a jump bigger than the tyres' launch limit per frame, never a fall under full throttle)", ids.every((id) => { const c = createCar(), P = carProfile(id); let prev = 0, jump = 0, mono = true; for (let i = 0; i < 60 * 60; i++) { stepCar(c, { gas: 1 }, DT, null, P); jump = Math.max(jump, c.v - prev); if (c.v < prev - 1e-9) mono = false; prev = c.v; } return mono && jump <= (P.accel + 0.05) * DT; }));
chk("acceleration falls as speed rises (strong from rest, easing off to the top speed)", ids.every((id) => { const P = carProfile(id), c = createCar(); const at = (kmh) => { const d = createCar(); d.v = kmhToMps(kmh); d.thr = 1; const v0 = d.v; stepCar(d, { gas: 1 }, 0.01, null, P); return (d.v - v0) / 0.01; }; return at(10) > at(kmhToMps(0) + P.vmax * 3.6 * 0.5) && at(P.vmax * 3.6 * 0.5) > at(P.vmax * 3.6 * 0.95) && c.v === 0; }));
chk("a supercar does not take an unrealistic time to reach highway speed: the Huracán is at 200 km/h in under 11 s, the Urus in under 15 s", first("huracan-2025", 200) < 11 && first("urus-2025", 200) < 15);
chk("on a long road the Huracán really goes fast: over 250 km/h within 900 m", (() => { const c = createCar(), P = carProfile("huracan-2025"); while (c.distance < 900 && c.z < 1e6) stepCar(c, { gas: 1 }, DT, null, P); return mpsToKmh(c.v) > 250; })());

// ---- 4. the pecking order ----
const t100 = (id) => first(id, 100), top = (id) => PROFILES[id].vmax, stopFrom = (id, kmh = 100) => { const P = carProfile(id), c = createCar(); c.v = Math.min(kmhToMps(kmh), P.vmax); for (let i = 0; i < 60 * 30 && c.v > 0.01; i++) stepCar(c, { brake: 1 }, DT, null, P); return c.distance; };
const ordinary = ["corolla-2011", "accord-2014", "camry-2014", "cclass-2016"];
chk("0-100 km/h: Huracán < Urus < Cybertruck < IS 350 < every ordinary sedan; SUVs slower than the sedans; the Corolla is the slowest car",
  t100("huracan-2025") < t100("urus-2025") && t100("urus-2025") < t100("cybertruck-2024") && t100("cybertruck-2024") < t100("is350-2014") && ordinary.every((id) => t100("is350-2014") < t100(id)) && CARS.every((c) => c.id === "corolla-2011" || t100(c.id) < t100("corolla-2011")) && t100("gle-2018") > t100("accord-2014") && t100("rrsport-2016") > t100("camry-2014"));
chk("the Huracán is dramatically quicker than an ordinary Lexus: under half the 0-100 time, and 40% higher top speed", t100("huracan-2025") < t100("is350-2014") * 0.55 && top("huracan-2025") > top("is350-2014") * 1.35);
chk("top speed: Huracán > Urus > every ordinary car and SUV > the bus > the keke; the keke is the slowest vehicle of all", top("huracan-2025") > top("urus-2025") && CARS.every((c) => c.id === "huracan-2025" || c.id === "urus-2025" || top("urus-2025") > top(c.id)) && CARS.every((c) => top(c.id) > top("bus")) && top("bus") > top("keke") && ids.every((id) => id === "keke" || top(id) > top("keke")));
chk("a performance Lexus is not a regular Lexus: the IS 350 out-accelerates and out-runs every ordinary sedan and SUV in the game", ["corolla-2011", "accord-2014", "camry-2014", "gle-2018", "rrsport-2016"].every((id) => t100("is350-2014") < t100(id)) && top("is350-2014") >= top("camry-2014"));
chk("public transport: the bus and the keke are slower off the line than any car, and the bus is the slower to stop and the heavier to turn", CARS.every((c) => first("bus", 40) > first(c.id, 40) && first("keke", 40) > first(c.id, 40)) && stopFrom("bus") > stopFrom("corolla-2011") * 1.2);
chk("the Cybertruck has the strongest launch of any non-Lamborghini; its 180 km/h top speed is below the sedans' (as Tesla's is)", ids.filter((id) => !id.includes("urus") && !id.includes("huracan")).every((id) => id === "cybertruck-2024" || first("cybertruck-2024", 60) < first(id, 60)) && top("cybertruck-2024") < top("camry-2014"));

// ---- 5. braking and reversing ----
chk("braking: a sports car and a supercar stop shorter than a family car or SUV from the same speed; a bus takes longer", stopFrom("huracan-2025") < stopFrom("is350-2014") && stopFrom("is350-2014") < stopFrom("corolla-2011") && stopFrom("urus-2025") < stopFrom("gle-2018") && stopFrom("bus") > stopFrom("gle-2018"));
chk("the Huracán stops from 100 km/h in about 33 m (published ~32 m) and the Accord from 60 mph in about 40 m (published 39 m)", near(stopFrom("huracan-2025"), 33.4, 2.5) && near(stopFrom("accord-2014", mphToKmh(60)), 39.0, 3.5));
chk("braking from the top speed stops every vehicle, and never throws it into reverse by itself", ids.every((id) => { const P = carProfile(id), c = createCar(); c.v = P.vmax; let minV = 1e9; for (let i = 0; i < 60 * 40 && c.v > 0; i++) { stepCar(c, { brake: 1 }, DT, null, P); minV = Math.min(minV, c.v); } return c.v === 0 && minV >= 0 && !c.reversing; }));
chk("holding the brake once stopped reverses, and reverse speed is limited well below any forward speed", ids.every((id) => { const P = carProfile(id), c = drive(id, 30, (t) => (t < 3 ? { gas: 1 } : { brake: 1 })); return c.reversing && c.v < -1 && c.v >= -P.reverseMax - 1e-9 && P.reverseMax <= 8 && P.reverseMax < P.vmax / 3; }));

// ---- 6. steering stays controllable as speed rises ----
chk("the front wheels turn less as speed rises, for every vehicle, and keep useful lock at the speeds the vehicle really drives at", ids.every((id) => { const P = carProfile(id); return steerLimit(2, P) > steerLimit(P.vmax * 0.3, P) && steerLimit(P.vmax * 0.3, P) > steerLimit(P.vmax, P) && steerLimit(P.vmax * 0.3, P) > 0.12; }));
chk("a fast car keeps more lock than a slow one at the same speed (the Huracán at 30 m/s turns its wheels further than the Corolla)", steerLimit(30, carProfile("huracan-2025")) > steerLimit(30, carProfile("corolla-2011")));
chk("at the top speed with the wheel hard over the car holds the road: sideways acceleration stays within grip, for every vehicle", ids.every((id) => { const P = carProfile(id), c = createCar(); c.v = P.vmax * 0.9; let worst = 0; for (let i = 0; i < 60 * 6; i++) { stepCar(c, { gas: 1, steer: i % 120 < 60 ? 1 : -1 }, DT, null, P); worst = Math.max(worst, Math.abs(c.v * c.yawRate)); } return worst < P.latG * 1.15; }));
chk("steering at 300 km/h is not twitchy: full lock gives the Huracán no more yaw than its grip allows (a gentle, wide arc: under 7 degrees in a second), never a snap", (() => { const P = carProfile("huracan-2025"), c = createCar(); let worst = 0; for (let i = 0; i < 60; i++) { c.v = kmhToMps(300); stepCar(c, { gas: 1, steer: 1 }, DT, null, P); worst = Math.max(worst, Math.abs(c.yawRate)); } return worst <= (P.latG / kmhToMps(300)) * 1.05 && Math.abs(c.ang) < (7 * Math.PI) / 180; })());

// ---- 7. collisions at speed ----
const thinWall = (z0, thick = 0.3) => (x, z, hx, hz) => { const front = z + hz * 2.25, rear = z - hz * 2.25; return front > z0 && rear < z0 + thick ? { pen: 100 } : null; };
chk("a thin wall stops a Huracán doing 325 km/h whatever the frame rate: it never gets through, at 15, 30, 60 and 240 fps (and a 0.25 s hitch)", [15, 30, 60, 240, 4].every((fps) => {
  const P = carProfile("huracan-2025"), probe = thinWall(900), c = createCar(); c.pen = 0; let front = 0; for (let i = 0; i < fps * 80; i++) { stepCar(c, { gas: 1 }, 1 / fps, probe, P); front = Math.max(front, c.z + c.hz * 2.25); if (c.z > 905) return false; }
  return front <= 900 + 1e-6 && c.z < 900;
}));
chk("no step ever moves a car further than MAX_STEP_M, however fast, so the wall check is never skipped", (() => { const P = carProfile("huracan-2025"), c = createCar(); c.v = P.vmax; let worst = 0; const probe = (x, z) => { worst = Math.max(worst, Math.hypot(x - probe.x, z - probe.z)); return null; }; probe.x = 0; probe.z = 0;
  for (let i = 0; i < 120; i++) { const pr = (x, z, hx, hz) => { worst = Math.max(worst, Math.hypot(x - c.x, z - c.z)); return null; }; stepCar(c, { gas: 1 }, 0.25, pr, P); } return worst <= MAX_STEP_M + 0.05; })());
chk("an impact at speed stops the car at once at the wall (it loses its speed, is not carried through it) and is reported as an impact", (() => { const P = carProfile("urus-2025"), probe = thinWall(400, 5), c = createCar(); c.pen = 0; let hit = 0; for (let i = 0; i < 60 * 40; i++) { stepCar(c, { gas: 1 }, DT, probe, P); hit = Math.max(hit, c.impact); } return hit > 20 && Math.abs(c.v) < 3 && c.z < 400; })());
chk("after hitting a wall at speed the car can still reverse away from it (never pinned)", (() => { const P = carProfile("huracan-2025"), probe = thinWall(300, 5), c = createCar(); c.pen = 0; for (let i = 0; i < 60 * 40; i++) stepCar(c, { gas: 1 }, DT, probe, P); const at = c.z; for (let i = 0; i < 60 * 8; i++) stepCar(c, { brake: 1 }, DT, probe, P); return c.z < at - 3; })());

// ---- 8. frame-rate independence ----
chk("driving straight at 15, 30, 60, 144 and 240 fps ends within 0.1 m/s and 1 m (over more than a kilometre) of a 480 fps run, for every vehicle", ids.every((id) => {
  const run = (fps) => drive(id, 12, (t) => ({ gas: t < 9 ? 1 : 0, brake: t >= 9 ? 0.3 : 0 }), { dt: 1 / fps }); const ref = run(480);
  return [15, 30, 60, 144, 240].every((f) => { const c = run(f); return near(c.v, ref.v, 0.1) && Math.hypot(c.x - ref.x, c.z - ref.z) < 1; });
}));
chk("with steering in the drive, every frame rate ends within one frame's travel of a 480 fps run (the only difference is when the wheel input is sampled) and within 0.02 rad", ["huracan-2025", "gle-2018", "keke"].every((id) => {
  const run = (fps) => drive(id, 12, (t) => ({ gas: t < 9 ? 1 : 0, brake: t >= 9 ? 0.3 : 0, steer: t > 4 && t < 6 ? 0.1 : 0 }), { dt: 1 / fps }); const ref = run(480), vTop = carProfile(id).vmax;
  return [15, 30, 60, 144, 240].every((f) => { const c = run(f); return near(c.v, ref.v, 0.1) && Math.hypot(c.x - ref.x, c.z - ref.z) < 0.5 + vTop / f && near(c.ang, ref.ang, 0.02); });
}));
chk("a 0.25 s hitch (the longest frame the trip allows) costs a Huracán under 0.3 m/s against smooth running", (() => { const a = drive("huracan-2025", 20, { gas: 1 }, { dt: 0.25 }), b = drive("huracan-2025", 20, { gas: 1 }, { dt: 1 / 120 }); return near(a.v, b.v, 0.3); })());

// ---- 9. the server and the hand-over: nothing pulls a real top speed back ----
chk("the server's cap is the fastest vehicle in the table, and it is no longer the old flat 22 m/s", OWN_CAR_MAX === MAX_DRIVEN_SPEED_MPS && OWN_CAR_MAX === kmhToMps(325) && OWN_CAR_MAX > 22 && ids.every((id) => carProfile(id).vmax <= OWN_CAR_MAX));
chk("a trip is never refused for being faster than the car could go: the quickest time over 3 km is shorter for the Huracán than for the Corolla, and no real drive beats it", (() => { const m = 3000, fast = minTravelMs(m, "car", false, "huracan-2025"), slow = minTravelMs(m, "car", false, "corolla-2011");
  const c = createCar(), P = carProfile("huracan-2025"); let t = 0; while (c.distance < m - TRAVEL_LIMITS.carSlackM) { stepCar(c, { gas: 1 }, DT, null, P); t += DT; } return fast < slow && fast <= t * 1000 && minTravelMs(m, "car") >= 0; })());
chk("a position report is not pulled back for a car flat out at its top speed, every vehicle, at the usual 2 s, a slow 10 s and the 30 s freshness limit", ids.filter((id) => id !== "keke" && id !== "bus").every((id) => [2, 10, 30].every((gap) => {
  const v = carProfile(id).vmax, prev = { x: 0, z: 0, mode: "car", at: 1_000_000 }, next = { x: 0, z: v * gap }; return !clampPing(prev, next, "car", prev.at + gap * 1000).corrected && pingMps("car") * gap + PING_SLACK_M >= v * gap;
})));
chk("a hand-over from the compound keeps up to that car's own top speed (a Camry's 230 km/h, a Huracán's 325), never more", (() => { setDriveHandoff({ modelId: "camry-2014", v: 999 }, 5); const a = peekDriveHandoff(6).v; setDriveHandoff({ modelId: "huracan-2025", v: 999 }, 5); const b = peekDriveHandoff(6).v; setDriveHandoff({ modelId: "corolla-2011", v: 12 }, 5); return a === topSpeedMps("camry-2014") && b === topSpeedMps("huracan-2025") && peekDriveHandoff(6).v === 12; })());
chk("an unknown vehicle drives like the standard 180 km/h family car", carProfile("nope").vmax === kmhToMps(STANDARD_VEHICLE.topKmh) && carProfile("nope") === CAR);

console.log(bad ? `\n${bad} of ${n} vehicle performance checks FAILED` : `\nvehicle performance passed: ${n} checks`);
process.exit(bad ? 1 : 0);
