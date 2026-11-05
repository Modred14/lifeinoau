// lib3d/worldPreload.js
// Decides WHAT to build ahead of time and in which order; lib3d/preload.js decides WHEN (idle moments only) and lib3d/modelCache.js keeps the result within a memory budget.
//
// Priorities (lower runs sooner; the queue also refuses everything above `essential` while the cache is nearly full):
//   0  what the player is about to use: the vehicle they just selected / are approaching
//   1  their own vehicles (the one they drive first) and their home's plot
//   2  what the map needs on arrival: the shared traffic shapes, the bus and the keke
// Other players' cars, and car models nobody here owns, are NOT preloaded: they build on first sight and then stay cached while the budget allows.
// Houses and buildings are drawn from code, not downloaded, so "preloading a house" means building the shared geometry its plot is made of (lib3d/plot3d.js).
import { createPreloader } from "./preload.js";
import { modelCache } from "./modelCache.js";
import { vehicleWarmSteps, carBodyGeometry, trafficWheelGeometry } from "./vehicles.js";
import { warmPlot } from "./plot3d.js";

const pressure = () => { const s = modelCache.stats(); return s.budget ? s.bytes / s.budget : 0; };
export const preloader = createPreloader({ pressure });

const enqueueSteps = (steps, priority) => steps.forEach((st) => preloader.enqueue({ key: st.key, run: st.run, priority }));

/** Queue a vehicle model (a car's lib/cars.js id, "bus" or "keke") in the paint it will be seen in. */
export function preloadVehicle(what, paint, priority = 1) { try { enqueueSteps(vehicleWarmSteps(what, paint), priority); } catch { /* preloading is best effort and must never reach the player */ } }

/** The player's garage: `vehicles` are { modelId, color } (the one they drive first, if any, is `activeId`). */
export function preloadOwnVehicles(vehicles = [], activeId = null) {
  vehicles.forEach((v) => preloadVehicle(v.modelId || "", v.color, String(v.modelId) === String(activeId) ? 0 : 1));
}
export function preloadHome(room) { if (room?.w && room?.d) preloader.enqueue({ key: `plot:${room.w}x${room.d}:${room.layout ?? ""}`, priority: 1, run: () => warmPlot(room) }); }
/** What the campus map needs the moment it opens. */
export function preloadMapBasics() {
  preloader.enqueue({ key: "traffic:shapes", priority: 2, run: () => { carBodyGeometry("#ffffff", false); carBodyGeometry("#ffffff", true); trafficWheelGeometry(); } });
  preloadVehicle("keke", undefined, 2); preloadVehicle("bus", undefined, 2);
}
/** Prepares the main road (data, collision world, drawing) in idle time while the world loads. Loaded on demand: it is the only part of the game that needs the road code. Safe to call any number of times. */
export function preloadRoad() { return import("./roadPreload.js").then((m) => m.preloadMainRoadWhenIdle()).catch(() => null); }
/** The player is heading for the road (picked a travel mode): whatever is still waiting for an idle moment runs now. */
export function preloadRoadNow() { return import("./roadPreload.js").then((m) => m.preloadMainRoad({ urgent: true })).catch(() => null); }
/** The player is heading for something (tapped a vehicle, picked a travel mode): build it first. */
export function preloadSoon(what, paint) { preloadVehicle(what, paint, 0); }