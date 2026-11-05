// lib3d/roadPreload.js
// Makes the road ready BEFORE the player needs it. Started while the world loads (lib3d/worldPreload.js), it runs in stages and never blocks the first frame or the player's input:
//   1. network   the campus map and the road graph JSON, fetched in parallel (no CPU work; the browser keeps them across visits, see next.config.mjs and public/sw.js)
//   2. services  the road graph, the collision world (buildings, water and the expressway's pier posts), the walking planner and the routing grid: one idle slot, built from one graph
//   3. drawing   the road surface (textures and materials included), then the bridge and its ramps, then the street furniture: one idle slot each (lib3d/roadAssets.js)
// Priority is the order above: what a driver needs to be on the road comes first, decoration last. Every stage waits for an idle moment (requestIdleCallback) unless the player is already asking for the road
// (`urgent`), in which case the remaining stages run at once. Asking again while it runs, or after it finished, costs nothing: everyone gets the same promise.
//
// The collision world is built in stage 2 from the same data as the drawing in stage 3, and both are cached together, so the drawn road and the road people and cars collide with cannot disagree.
import { idleSchedule } from "./preload.js";
import { loadCampusData } from "./campusData.js";
import { fetchRoadGraphRaw, loadServices } from "./worldsvc.js";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
let job = null;
/** What happened, for measuring: how long after the start each stage finished (ms), and whether it all finished. Also on globalThis.__oauRoadPerf in the browser. */
export const roadPreloadStats = { startedAt: 0, steps: {}, done: false, urgent: false };
if (typeof globalThis !== "undefined") globalThis.__oauRoadPerf = roadPreloadStats;

const pause = (j) => new Promise((resolve) => { if (j.urgent) setTimeout(resolve, 0); else idleSchedule(() => resolve()); });

/** Starts (or joins) the preparation of the road. Resolves to the world services once they are built; the drawing continues in the background after that. Rejects if the data could not be fetched (a later call retries). */
export function preloadMainRoad({ urgent = false, schedule = null } = {}) {
  if (job) { if (urgent) { job.urgent = true; roadPreloadStats.urgent = true; } return job.ready; }
  const j = (job = { urgent, ready: null, done: null }); roadPreloadStats.startedAt = now(); roadPreloadStats.urgent = urgent; roadPreloadStats.steps = {}; roadPreloadStats.done = false;
  const mark = (name) => { roadPreloadStats.steps[name] = Math.round(now() - roadPreloadStats.startedAt); };
  const wait = schedule ? () => schedule(j) : () => pause(j);
  let svcReady; const ready = new Promise((r, x) => { svcReady = { r, x }; }); j.ready = ready;
  (async () => {
    const [data] = await Promise.all([loadCampusData(), fetchRoadGraphRaw()]); mark("fetch");
    await wait(); const svc = await loadServices(data); mark("services"); svcReady.r(svc);
    const { roadWarmSteps } = await import("./roadAssets.js");
    for (const step of roadWarmSteps(svc.graph)) { await wait(); step.run(); mark(step.kind); }
    roadPreloadStats.done = true;
  })().catch((e) => { if (job === j) job = null; svcReady.x(e); });
  ready.catch(() => {}); return ready;
}

/** Like preloadMainRoad, but for the automatic start while the world loads: skipped when the player asked the browser to save data. */
export function preloadMainRoadWhenIdle() {
  try { const c = globalThis.navigator?.connection; if (c?.saveData) return null; } catch { /* no connection info */ }
  return preloadMainRoad().catch(() => null);
}

/** For tests: forget the running job. */
export function resetRoadPreload() { job = null; }
