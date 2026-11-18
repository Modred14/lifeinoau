# New OpenStreetMap campus map: status (branch `new-campus-map`, NOT merged)

The ACTIVE map is still the old one, so the app behaves exactly as on `main`. The converted map is stored beside it as `public/data/oau-campus.osm.json`
(regenerate with `sh tools/oau/import-campus.sh`; needs numpy and shapely). Tag `pre-new-map` marks the original `main` tip (7f617fc).

## Done
- `tools/oau/dump-merged.mjs` was missing from the repo and its history, so `npm run build:roads` could not run. Recreated; run on the old map it reproduces the committed raw graph (213/213 nodes, 253/255 edges identical; 2 differ in the `clr` value only).
- `tools/oau/import_campus.py` converts campus.json + building-heights.json into the game's schema. Heights credit: Google Open Buildings 2.5D Temporal 2023 (CC BY 4.0), added to `meta.attribution` next to OpenStreetMap (ODbL).
  Result: 1,824 buildings, 98 places (46 matched to real buildings, 52 game placements, all 16 faculties kept), fit median error 4.1 m. Report: `docs/new-map-import-report.json`.
- Grounds and churches: `groundsFor()` in `lib3d/mapExtras.js` shifts the Motion Ground, Religious Ground and four churches by `meta.groundOffsets`. On the new map both grounds clear every building, road, lake and car park by 3 m or more including their apron (checked by script).
- `landmarks.js`: nothing to convert. Its x/z are schematic units used only by the old schematic scene (lib3d/campus.js), and the town areas are meant to have no coordinates (tests/campus-real.test.mjs enforces it).
- `BUILDING_TRIMS` (keyed by OLD building ids) applies only to the legacy map.
- Billboards: the script was misfiled as `tests/place-billboards.mjs` (its imports only resolve from `tools/oau/`); moved to `tools/oau/place-billboards.mjs`. It now takes `--data=`, `--graph=`, `--json=` and picks one board per intent (Senate Plaza, Library Road, Law Corner, Student Union Strip, Moremi Junction, Alumni Road, Halls Row, Fajuyi Crossing, Ede Road Banks, Nightlife Strip).
  PROVISIONAL result on the new GROUND road graph: `docs/billboard-sites-provisional.json` (10 boards, all pass the rule checker, closest pair 289 m). Boards sit 106 to 595 m from their anchor places. These must be re-run once the expressway exists (24 m from deck, 14 m from pier, 90 m from ramps).
- Old-data checks after these edits: campus-real, billboards, billboard-sites, landmarks, osm, interiors all pass.

## Blocked: the expressway (decision needed)
`tools/oau/search_expressway_routes.py`: straight + 24 m clearance + 4.2 km + over the lake cannot all hold on the new map. 4 straight lines clear 24 m; longest 4.06 km; none crosses the lake.
Options: (1) best straight line with ~600 m extensions (about 4.3 km, no lake); (2) a 3-leg route like the old one; (3) less than 24 m clearance. `INTERCHANGES` (highway.js) and `TAILS` (highwaytails.js) hold old-map coordinates and must be re-laid.

## Tests that encode OLD-map facts (they fail with the new data and must be rewritten for it, not loosened silently)
With `oau-campus.osm.json` swapped in: campus-real (scale, 450-700 buildings, extent, Senate 24 m), billboards ("original data untouched"), features, building-panel, destination-doors (h_moremi has a building outline), club-features. interiors, landmarks, osm pass.
Not yet investigated: why destination-doors cannot find the h_moremi outline (the converter matches the name "Moremi Hall" to a real new building, so the link from place to building may need `place`/`bid` checked).

## Not started
Expressway re-lay, final road graph, final billboard sites in mapExtras.js, swapping the active data, README/ROAD-SYSTEM docs, screenshots, merge. The clean `main` baseline of the test suite was never obtained (background runs died).
