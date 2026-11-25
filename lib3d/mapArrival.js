// lib3d/mapArrival.js
// Everything the map needs to show the player's own compound the instant they arrive from the home screen, prepared from the moment they land on the home screen and again, urgently, when
// they press GO OUTSIDE / TO THE STREET. In order of what the arrival waits for:
//   1. the campus data and the road graph (network), then the services: road graph, collision world, walking planner (lib3d/roadPreload.js, which keeps its own single job)
//   2. the code of the map: the campus stage, the trip engine and the compound drawing (the route chunk itself is prefetched by the home screen with router.prefetch)
//   3. the player's lot, found on the real road network (lib3d/homeLot.js caches it per map, so the map's own call is a lookup) and the shared geometry of their plot
//   4. their room, items and vehicles (lib/homeOption.js keeps the answer for a few seconds), the same ones the map would otherwise fetch after it opened
// Safe to call any number of times: the same character and room share one run. It never throws and never touches the screen. `mapArrivalStats` says what finished when (also on globalThis.__oauArrival).
import { preloadMainRoad } from "./roadPreload.js";
import { loadCampusData } from "./campusData.js";
import { loadServices } from "./worldsvc.js";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
export const mapArrivalStats = { startedAt: 0, steps: {}, done: false, key: "" };
if (typeof globalThis !== "undefined") globalThis.__oauArrival = mapArrivalStats;
const runs = new Map();

/** `ch` = the character ({ id, hostel, activeCar }), `room` = the room if it is already known (else it is fetched with the home option). Resolves to true when everything is warm. */
export function preloadMapArrival(ch, { room = null, urgent = false } = {}) {
  if (!ch) return Promise.resolve(false);
  const key = `${ch.id ?? ""}|${ch.hostel ?? ""}|${room ? `${room.w}x${room.d}:${room.layout ?? ""}` : ""}`;
  const had = runs.get(key); if (had) { if (urgent) preloadMainRoad({ urgent: true }).catch(() => {}); return had; }
  const t0 = now(), mark = (n) => { mapArrivalStats.steps[n] = Math.round(now() - t0); };
  mapArrivalStats.startedAt = t0; mapArrivalStats.steps = {}; mapArrivalStats.done = false; mapArrivalStats.key = key;
  const job = (async () => {
    const roadP = preloadMainRoad({ urgent });
    const codeP = Promise.all([import("../components/CampusMap.js"), import("./travel.js"), import("./homeCompound.js"), import("./homeSite.js"), import("../lib/audio/tripAudio.js"), import("./avatar/loadAvatar.js")]).then(() => mark("code"));
    const homeP = import("../lib/homeOption.js").then((m) => m.primeHomeOption(ch, "", { fresh: urgent })) // pressed GO OUTSIDE: fetched anew, so the answer is at most a walk old when the map asks.then((h) => { mark("home"); return h; });
    const [data, svc, hm] = await Promise.all([loadCampusData(), roadP, homeP, codeP]); mark("services");
    const r = room ?? hm?.room; if (!r || !svc) return false;
    const [{ homeLot }, { resolvePlace }, { homePlace }, { warmPlot }] = await Promise.all([import("./homeLot.js"), import("./travel.js"), import("../lib/travel.js"), import("./plot3d.js")]);
    const place = resolvePlace(data, homePlace(ch.hostel)) ?? resolvePlace(data, "senate"); await loadServices(data);
    if (place) homeLot(svc, r, place, String(ch.id ?? ch.name ?? "")); mark("lot");
    try { warmPlot(r); } catch { /* best effort */ } mark("plot");
    mapArrivalStats.done = true; return true;
  })().catch(() => { runs.delete(key); return false; });
  runs.set(key, job); return job;
}
/** For tests. */
export function resetMapArrival() { runs.clear(); }
