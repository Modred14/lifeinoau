// lib/travel.js
// Getting around the campus: what each way of travelling costs and how long it takes, who owns a car, and what a driver costs.
// Plain data and pure functions, shared by the server (which charges) and the browser (which shows the prices). Money is kobo, as everywhere else.
import { MAX_DRIVEN_SPEED_MPS, topSpeedMps } from "./vehiclePerformance.js";

/** The four ways to go somewhere. Keke and bus are driven for you; with `trek` and `car` you steer yourself (unless a driver is hired). */
export const MODES = ["trek", "keke", "bus", "car"];
export const MODE_INFO = {
  trek: { name: "Trek", sub: "On foot", icon: "trek" },
  keke: { name: "Keke", sub: "Driven for you", icon: "keke" },
  bus: { name: "Bus", sub: "Driven for you", icon: "bus" },
  car: { name: "My car", sub: "You drive", icon: "ride" },
};

/** Fare per trip in naira. Trek is free; the car's fare is the fuel. */
export const FARE_NAIRA = { trek: 0, keke: 300, bus: 200, car: 500 };
export const fareKobo = (mode) => BigInt(FARE_NAIRA[mode] ?? 0) * 100n;
export const isMode = (m) => MODES.includes(m);
/** What the ledger shows for each fare (the same words every time, so totals by memo stay meaningful). */
export const FARE_MEMO = { keke: "Keke fare", bus: "Bus fare", car: "Car fuel" };

// ---- how fast things move, and so how long a trip takes ----
// A trip has no fixed time. Its duration is the distance along the road divided by the speed of whatever carries you, with the vehicle speeding up,
// slowing for bends and braking to a stop the way it really does (see lib3d/tripplan.js, which integrates exactly the motion the vehicle makes).
// Speeds are metres per second. The cruise speed is the top speed on a straight road; bends, junctions and traffic slow a vehicle below it.
/** The player on foot: a brisk walk (about 9 km/h) and a run (about 20 km/h). */
export const WALK_SPEED = { walk: 2.6, run: 5.5 };
/** Driven vehicles: a keke is nimble but small, a bus is slow and heavy, a car with a driver is the quickest way across campus. */
export const VEHICLE = {
  keke: { cruise: 11, accel: 1.8, brake: 2.8, lat: 2.4 },    // about 40 km/h
  bus: { cruise: 9, accel: 1.2, brake: 2.4, lat: 2.0 },    // about 32 km/h
  driver: { cruise: 18, accel: 2.6, brake: 3.2, lat: 2.8 },  // about 65 km/h
};
// ---- how long a ride takes: it follows the distance, inside a fixed window for each vehicle ----
// A driven ride (keke, bus, car with a driver) lasts a set number of seconds that grows with the road distance between the two stops: the shortest hop takes the
// low end of the window, a trip across the whole campus the high end, and everything in between is spread evenly by distance. The vehicle still speeds up,
// slows for bends and brakes to a stop (lib3d/trafficsim.js rideProfile); the whole motion is simply played at the pace that fits the window.
/** [fastest, slowest] seconds for a ride, by vehicle: a driver's car is the quickest, then the bus, then the keke. */
export const RIDE_SECONDS = { driver: [6, 9], bus: [8, 10], keke: [10, 15] };
/** Road distances (metres) that map to the two ends of the window: at or below SHORT is the fastest, at or above LONG the slowest. */
export const RIDE_SHORT_METRES = 150, RIDE_LONG_METRES = 2400;
/** Walking to the vehicle never takes longer than this. A walk that would take longer is played at a faster pace so it still fits. */
export const APPROACH_MAX_SECONDS = 4.4, APPROACH_GLIDE_ABOVE = 4, APPROACH_MIN_SECONDS = 2.5;
/** Seconds a driven ride of `metres` road distance takes (kind: \"keke\" | \"bus\" | \"driver\"), or null for anything you steer yourself. */
export function rideSecondsFor(kind, metres) {
  const w = RIDE_SECONDS[kind]; if (!w) return null;
  const f = Math.max(0, Math.min(1, ((Number.isFinite(metres) ? metres : 0) - RIDE_SHORT_METRES) / (RIDE_LONG_METRES - RIDE_SHORT_METRES)));
  return w[0] + (w[1] - w[0]) * f;
}
/** How long the walk to the vehicle lasts: as long as walking takes, but never more than the cap (and the vehicle needs a moment to arrive). */
export const approachSeconds = (walkSecs) => Math.min(APPROACH_MAX_SECONDS, Math.max(APPROACH_MIN_SECONDS, walkSecs));

/** Your own car, driven by you: the pace the estimate assumes (you may go faster or slower). */
export const OWN_CAR = { cruise: 16, accel: 2.6, brake: 3.2, lat: 2.8 };
/** Fixed bits of animation at each end of a trip: the camera settling in, and opening the door and stepping through it. */
export const INTRO_SECONDS = 1.0, DOOR_SECONDS = 2.3;
/** Time spent stepping into and out of a vehicle (the walking to and from it is on top of this). */
export const BOARD_SECONDS = 2.2, ALIGHT_SECONDS = 1.8;
/** A car has real doors, so getting in is a sequence (turn to the door, open it, step in and sit, close it) and so is getting out (open, climb out, step clear). */
export const CAR_BOARD_SECONDS = 4.4, CAR_ALIGHT_SECONDS = 3.6;
export const boardSecondsFor = (mode) => (mode === "car" ? CAR_BOARD_SECONDS : BOARD_SECONDS);
export const alightSecondsFor = (mode) => (mode === "car" ? CAR_ALIGHT_SECONDS : ALIGHT_SECONDS);
/** Getting out of your own car: only below this speed (m/s); between this and EXIT_REFUSE_SPEED the car brakes itself to a stop first, above that the request is refused. */
export const EXIT_STOP_SPEED = 0.3, EXIT_REFUSE_SPEED = 14;
/** Which vehicle profile a choice uses ("keke", "bus", "driver"), or null when the player steers (trek, or driving their own car). */
export const rideKind = (mode, hasDriver) => (mode === "keke" ? "keke" : mode === "bus" ? "bus" : mode === "car" && hasDriver ? "driver" : null);
export const vehicleProfile = (mode, hasDriver) => VEHICLE[rideKind(mode, hasDriver)] ?? null;
/** Is this trip driven for you (so the vehicle, not the player, decides when it arrives)? */
export const isDriven = (mode, hasDriver) => rideKind(mode, hasDriver) != null;
/** "45 s", "2 min 05 s", "12 min": a duration for people to read. Rounds up to the next 5 seconds so an estimate is never early. */
export function fmtDuration(secs) {
  if (!Number.isFinite(secs) || secs < 0) return "";
  const t = Math.max(5, Math.ceil(secs / 5) * 5), m = Math.floor(t / 60), r = t % 60;
  return m === 0 ? `${t} s` : m >= 10 || r === 0 ? `${m + (r >= 30 && m >= 10 ? 1 : 0)} min` : `${m} min ${String(r).padStart(2, "0")} s`;
}

// ---- how fast can anyone really get somewhere? ----
// The server uses this to refuse a "teleport": a browser that says it has arrived far away straight after arriving here. The limits come from the same speeds the 3D
// trip scene uses (above), with slack, so a real trip is never refused: you cannot be faster than your own top speed over the distance.
//  - on foot: the running speed, plus 15% and the size of a building (the door is a little way from the place's centre);
//  - driving yourself: the fastest your car can go;
//  - a keke, bus or car with a driver: that vehicle's top speed over the straight distance (the road is never shorter than the straight line). Its journey is
//    reported when it stops at the kerb nearest the place, which for a place far from any road can be some way off, hence the larger slack.
/** The most any driven vehicle can do (m/s): the fastest vehicle in lib/vehiclePerformance.js, so a real top speed is never refused as a "teleport". (It used to be a flat 22 m/s = 79 km/h, which also capped every car in lib3d/carphysics.js.) */
export const OWN_CAR_MAX = MAX_DRIVEN_SPEED_MPS;
export const TRAVEL_LIMITS = { walkMps: WALK_SPEED.run * 1.15, carMps: OWN_CAR_MAX * 1.1, rideMargin: 1.1, walkSlackM: 60, carSlackM: 80, rideSlackM: 650 };
/** The soonest (ms) a trip of `metres` (straight line between the two places) can be finished in, for this mode. 0 when it is too short to matter. */
export function minTravelMs(metres, mode, hasDriver = false, carId = null) {
  const L = TRAVEL_LIMITS, kind = rideKind(mode, hasDriver);
  if (kind) return Math.floor(rideSecondsFor(kind, Math.max(0, metres - L.rideSlackM)) * 1000);   // a ride takes at least its window's fastest time, longer the further it goes
  const slack = mode === "car" ? L.carSlackM : L.walkSlackM, speed = mode === "car" ? (topSpeedMps(carId) ?? OWN_CAR_MAX) * 1.1 : L.walkMps;   // your own car: that car's real top speed (any car when it is not known)
  return Math.floor((Math.max(0, metres - slack) / speed) * 1000);
}


// ---- how far can a road report move between two reports? ----
// While travelling, the screen reports where the player is every couple of seconds (tripPing in lib/travelService.js). The player moves locally, so a report is only what OTHER
// players see. The server never refuses a report for being far from the last one (that would freeze the player's presence for everyone): it moves the stored spot towards the claim
// by no more than the mode could really have covered, and says it did. A walker or your own car is tightly bounded; a driven ride is played over a short fixed window whatever the
// distance (see RIDE_SECONDS), so its bound is the whole campus covered in the quickest window.
/** A report older than this starts a fresh spot instead of being compared with the last one. */
export const PING_FRESH_MS = 30_000;
/** Metres of leeway on every comparison (frame jitter, a report that sat in a queue). */
export const PING_SLACK_M = 8;
/** The fastest (m/s) anyone in this mode can honestly appear to move between two reports. */
export function pingMps(mode) {
  const L = TRAVEL_LIMITS, far = RIDE_LONG_METRES + L.rideSlackM;
  return mode === "trek" ? L.walkMps : mode === "keke" ? far / RIDE_SECONDS.keke[0] : mode === "bus" ? far / RIDE_SECONDS.bus[0] : mode === "car" ? Math.max(L.carMps, far / RIDE_SECONDS.driver[0]) : 0;
}
/**
 * prev: { x, z, mode, at (ms) } the last stored report, or null. next: { x, z } what the player now claims. Returns { x, z, corrected }: the claim itself when it is plausible
 * (or there is nothing fresh to compare it with), otherwise the point on the way to it that the mode could have reached, with corrected = true.
 */
export function clampPing(prev, next, mode, nowMs) {
  const fresh = prev && prev.mode === mode && [prev.x, prev.z, prev.at].every(Number.isFinite) && nowMs - prev.at <= PING_FRESH_MS && nowMs >= prev.at - 2000;
  if (!fresh) return { x: next.x, z: next.z, corrected: false };
  const secs = Math.max(0, nowMs - prev.at) / 1000, cap = pingMps(mode) * secs + PING_SLACK_M, d = Math.hypot(next.x - prev.x, next.z - prev.z);
  if (d <= cap) return { x: next.x, z: next.z, corrected: false };
  const k = cap / d; return { x: prev.x + (next.x - prev.x) * k, z: prev.z + (next.z - prev.z) * k, corrected: true };
}

/** A player has a car to drive when their family gave them one (Nepos start with "Daddy Benz", see startingTransport in rules.js) or they bought one
 *  at YK Autos (the Ride app sets activeCar, and only ever to a car they own). The one place that decides. */
export const ownsCar = (character) => character?.transport === "Daddy Benz" || !!character?.activeCar;

// ---- the driver (the Hire app on the phone) ----
/** Hire a driver for some weeks, paid up front. A week is 7 real days. */
export const DRIVER_PLANS = [{ weeks: 1, naira: 10_000 }, { weeks: 4, naira: 35_000 }, { weeks: 12, naira: 100_000 }];
export const driverPlan = (weeks) => DRIVER_PLANS.find((p) => p.weeks === weeks) ?? null;
export const DRIVER_NAMES = ["Musa", "Emeka", "Sule", "Tunde", "Chidi", "Bayo", "Ibrahim", "Kelechi"];
export const driverNameFor = (seed = "") => { let h = 2166136261; for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return DRIVER_NAMES[h % DRIVER_NAMES.length]; };
/** Is a driver on the payroll in this week? */
export const driverActive = (character, week) => !!character && (character.driverUntilWeek ?? 0) >= week && !!character.driverName;

// ---- where a player is ----
/** The map place each home sits at. Homes with no spot on the map yet (off campus, the flats) start at the Senate Building. */
export const HOME_PLACE = { Awo: "h_awo", Fajuyi: "h_fajuyi", Angola: "h_angola", ETF: "h_etf", Moremi: "h_moremi", Mozambique: "h_mozambique", Akintola: "h_akintola", Alumni: "h_alumni", Ojaja: "h_ojaja" };
export const FALLBACK_PLACE = "senate";
export const homePlace = (hostel) => HOME_PLACE[hostel] ?? FALLBACK_PLACE;
/** Where the player is now: the last place they travelled to, or home if they have not gone anywhere. */
export const placeOf = (character) => character?.placeId || homePlace(character?.hostel);

/** A place id is a map place ("oduduwa", "h_awo", "bb_3") or an unnamed building ("bld_214"). Only the shape is checked here; the server also checks it exists. */
export const PLACE_ID = /^(?:bld_\d{1,5}|[a-z][a-z0-9_]{0,39})$/;
export const isPlaceId = (s) => typeof s === "string" && PLACE_ID.test(s);

/** Other players count as "here" for this long after they were last seen at a place. */
export const PRESENCE_MINUTES = 4;
/** The most players listed at one place. */
export const PRESENCE_MAX = 30;