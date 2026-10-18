// lib/travel.js
// Getting around the campus: what each way of travelling costs and how long it takes, who owns a car, and what a driver costs.
// Plain data and pure functions, shared by the server (which charges) and the browser (which shows the prices). Money is kobo, as everywhere else.

/** The four ways to go somewhere. `ride` trips are driven for you; with `trek` and `car` you steer yourself (unless a driver is hired). */
export const MODES = ["trek", "keke", "bus", "car"];
export const MODE_INFO = {
  trek: { name: "Trek", sub: "On foot", icon: "trek" },
  keke: { name: "Keke", sub: "8 seconds", icon: "keke" },
  bus: { name: "Bus", sub: "10 seconds", icon: "bus" },
  car: { name: "My car", sub: "You drive", icon: "ride" },
};

/** Fare per trip in naira. Trek is free; the car's fare is the fuel. */
export const FARE_NAIRA = { trek: 0, keke: 300, bus: 200, car: 500 };
export const fareKobo = (mode) => BigInt(FARE_NAIRA[mode] ?? 0) * 100n;
export const isMode = (m) => MODES.includes(m);
/** What the ledger shows for each fare (the same words every time, so totals by memo stay meaningful). */
export const FARE_MEMO = { keke: "Keke fare", bus: "Bus fare", car: "Car fuel" };

/** How long a driven trip takes, in real seconds. Walking and driving yourself take as long as you take. */
export const RIDE_SECONDS = { keke: 8, bus: 10, driver: 5 };
// ---- how fast can anyone really get somewhere? The server uses this to refuse a "teleport": a browser that says it has arrived far away straight after
// arriving here. The limits are the real top speeds of the 3D trip scene (running 8.5 m/s, a car 28 m/s on the road), with slack for the size of a
// building and for the door being a little way from the place's centre. A fixed-length ride (keke, bus, driver) cannot take less than its own time.
export const TRAVEL_LIMITS = { walkMps: 9.8, carMps: 30, walkSlackM: 60, carSlackM: 80, rideShare: 0.7 };
/** The soonest (ms) a trip of `metres` can be finished in, for this mode. 0 when it is too short to matter. */
export function minTravelMs(metres, mode, hasDriver = false) {
  const L = TRAVEL_LIMITS, secs = rideSeconds(mode, hasDriver);
  if (secs != null) return Math.floor(secs * L.rideShare * 1000);
  const slack = mode === "car" ? L.carSlackM : L.walkSlackM, speed = mode === "car" ? L.carMps : L.walkMps;
  return Math.floor((Math.max(0, metres - slack) / speed) * 1000);
}

/** Seconds the ride itself lasts for this choice, or null when the player steers (so it takes as long as it takes). */
export const rideSeconds = (mode, hasDriver) => (mode === "keke" ? RIDE_SECONDS.keke : mode === "bus" ? RIDE_SECONDS.bus : mode === "car" && hasDriver ? RIDE_SECONDS.driver : null);

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