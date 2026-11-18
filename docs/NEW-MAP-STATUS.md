# New OpenStreetMap campus map: status (branch `new-campus-map`, NOT merged)

Active data on this branch is still the OLD map. Nothing user-visible has changed yet. `main` is untouched; the safety tag is `pre-new-map`.

## Done and checked
- `tools/oau/dump-merged.mjs` was missing from the repo (and its history), so `npm run build:roads` could not run. It is recreated. Check: run on the old map, `roadgraph.py` reproduces the committed `tools/oau/roadgraph.raw.json` (all 213 nodes identical; 253 of 255 edges identical, 2 differ in the `clr` clearance value only).
- `tools/oau/import_campus.py` converts campus.json (+ building-heights.json) into the existing oau-campus.json schema. Output goes through `roadgraph.py` (377 nodes, 455 edges, 2 components) and the ground refine step (289 nodes, 381 edges). Report: `docs/new-map-import-report.json` (fit: 46 matched places, median 4.1 m).
- Old map kept as `public/data/oau-campus.legacy.json`; `tools/oau/mapfile.mjs` is the switch for the tools (`OAU_MAP=legacy`).
- `BUILDING_TRIMS` in mapExtras.js is keyed by old building ids; it now applies only to the legacy map.

## Blocked: the expressway (decision needed)
`tools/oau/search_expressway_routes.py` searches every straight line across the new frame, extended 480 m at each end, for 24 m clearance from buildings. Result: 4 lines qualify, the longest is 4.06 km (< 4.2 km), none crosses the lake. Straight + 24 m clearance + 4.2 km + over the lake cannot all hold on the new map.
`INTERCHANGES` (highway.js) and `TAILS` (highwaytails.js) hold old-map coordinates and must be re-laid against the new ground graph.

## Not started
Billboard re-placement (needs the expressway), Motion/Religious ground and church layout (GROUNDS in mapExtras.js), landmarks.js town-area coordinates, tests with hard-coded old coordinates, README/ROAD-SYSTEM docs, screenshots, merge.
