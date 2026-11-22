// Source-level guards for "no map redirect, no loading screen, no fade when leaving a building": the page wiring that the engine test (building-roundtrip) cannot see.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const rd = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const page = rd("src/app/map/page.js"), map = rd("components/CampusMap.js"), inside = rd("components/BuildingInside.js"), travel = rd("lib3d/travel.js"), hud = rd("components/TripHud.js");

// leaving: the room's exit goes through leaveBuilding (the portal walk), never straight to "no building" while a world is alive
assert.ok(/onLeave=\{leaveBuilding\}/.test(page), "BuildingInside onLeave must be leaveBuilding");
assert.ok(!/onLeave=\{\(\) => \{ setInside\(null\)/.test(page), "the room must not be closed by a bare setInside(null)");
assert.ok(/exitRef\.current\?\.\(\)/.test(page), "leaveBuilding must ask the live world to walk the player out");
assert.ok(/roam: true/.test(page), "with no live world a doorstep trip is started instead of showing the map");
// entering: the trip and world stay alive, and there is no fade for a building
const entered = page.slice(page.indexOf("function entered()"), page.indexOf("const roomReady"));
assert.ok(/setInside\(t\.to\); return;/.test(entered), "entering a building opens the room and returns before any fade or trip teardown");
assert.ok(/holdEnter/.test(page) && /tripHoldEnter=\{holdEnter\}/.test(page), "the page holds the doorway until the room is ready");
assert.ok(/standby=\{!insidePlace\}/.test(page), "the room is built in standby before the player arrives");
// the engine side
assert.ok(/exitBuilding\(\)/.test(travel) && /portalFor/.test(travel) && /holdEnter/.test(travel) && /roam: o\.roam/.test(travel), "travel.js exposes exitBuilding / holdEnter / roam");
assert.ok(/tripExit/.test(map) && /tripHoldEnter/.test(map) && /onTripReady/.test(map), "CampusMap passes the hooks through");
assert.ok(/sync\.stop\(\{ clear: true \}\)/.test(map) && /wasIn/.test(map), "road position reports stop while inside (the player is counted in the building, not on the road)");
assert.ok(/standby/.test(inside) && /if \(standby\) return undefined;/.test(inside), "a standby room tells the server nothing");
assert.ok(/leave: "Stepping out/.test(hud) && /roam:/.test(hud), "HUD knows the leave and roam phases");
assert.ok(!/isOpenSpace/.test(page), "open spaces and billboards have no interior: the page must not open a room for them");
console.log("seamless-wiring: ok");
