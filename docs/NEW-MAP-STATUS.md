# New campus map: what changed and what to know (branch `new-campus-map`)

Switch maps with `node tools/oau/use-map.mjs new|legacy` (see the README, "The campus map"). `pre-new-map` is the tag on the `main` commit this work started from.

## What the new map is
1,803 buildings (2.4 x 3.2 km), 98 places, one road network of about 46 km, a re-laid expressway and ten billboards. It is produced by `tools/oau/import_campus.py` from the campus-archive branch's `campus.json` and `building-heights.json`; nothing in it is edited by hand. The old map is kept untouched in `tools/oau/maps/legacy/`.

## Decisions taken (change them in one place each)
- **Expressway:** straight, not over the lake. On the new map a straight line, 24 m clear of every building, 4.2 km long and over the lake cannot all hold (`tools/oau/search_expressway_routes.py`: 4 straight lines clear 24 m, the longest 4.06 km, none crosses the lake). The layout is the best straight line, (0, 1260) to (2340, 3240), 55 m from the nearest building, with 600 m ends: 4,265 m of deck, 9,018 m with its tails. Waypoints, interchanges and tails are in `lib3d/mapLayout.js`.
- **Places:** all 16 faculties are kept. Only Pit Theatre, Biological Gardens and the University Zoo are dropped. Places with no building on the new map are placed where the old position lands, clear of buildings, roads, water, car parks and pitches (`docs/new-map-import-report.json` lists each one and how far it moved). Akintola Hall is inside the frame. The Motion and Religious Grounds and the four churches moved furthest (about 260 m and 180 m).
- **Billboards:** ids bb_1..bb_10, prices and slot counts are unchanged; only positions differ. Their names are Senate Plaza, Library Road, Law Corner, Student Union Strip, Moremi Junction, Alumni Road, Halls Row, Fajuyi Crossing, Ede Road Banks and Nightlife Strip. Ede Road Banks and Nightlife Strip are anchored in the large settlement in the south, so every quarter of the map has a board; the others are within 550 m of the place they are named after.
- **Houses:** player homes are not stored in the map or the database; `lib3d/homeLot.js` finds each lot from the map's roads and collision world, so a home stands on whatever lot that map gives it.

## Changes outside the map data
- `lib3d/roadrefine.js` (new map only): tight bends are re-fitted, loops become stubs, rim forks are cut off, dead-end streets are joined to a neighbouring road when a clear link of 140 m or less exists.
- `lib3d/highway.js`: ramps are longer (`minLen` 365 m) so every ramp climbs under 4 %.
- `lib3d/roadgraph.js`: `route()` may use the expressway when a ground road ends on its tail and has no other way on.
- `lib3d/furnitureplan.js`: no lamps or signs on expressway ramps.
- `lib3d/roadnet.js`: a place may carry an `entrance` hint that the door chooser follows (46 places do).
- `lib3d/walker.js`, `lib3d/collide.js`: the walking planner can aim at a point next to a post; its clearance cache is dropped when the world's solids change (a home going up or down).
- `lib3d/tripflow.js`: the first walking leg after leaving a vehicle is planned past that vehicle.
- `lib3d/homeLot.js`: a lot is refused if a lamp, sign or tree stands in the driveway corridor in front of its gate.
- `tools/oau/dump-merged.mjs` was missing from the repository and was recreated (run on the old map it reproduces the committed raw road graph).

## Tests
Tests that encoded the old map's size, counts or positions now work on either map (`campus-real`, `billboards`, `billboard-sites`, `world-obstructions`, `car-doors`, `vehicle-ground`, `vehicle-controls`, `traffic-persistence`, `building-roundtrip`, `home-journey`); each change is explained in a comment next to it. Eleven test files fail identically on `main` and are not caused by this work: admin-console, building-panel, club-features, developer-app, features, hub-actions, invest-screen, room-size, sug-schedule, traffic-persistence (a traffic jam at the campus interchange).
`node tools/oau/verify-map.mjs` checks the expressway, the billboards and the building/place/road clearances by script.

## Not verified
A full `npm run build` (needs the Prisma engine and Google Fonts downloads) and a look at every screen in a browser.
