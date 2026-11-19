// lib3d/mapLayout.js
// EVERYTHING THAT DIFFERS BETWEEN THE TWO CAMPUS MAPS, in one place, so switching map is one command (node tools/oau/use-map.mjs osm | legacy) and nothing is hand-edited:
//   the expressway's waypoints, how far it runs past the map edge, its two interchanges and its two tails (lib3d/highway.js, lib3d/highwaytails.js), and where the ten billboards stand (lib3d/mapExtras.js).
//   legacy  the original traced map (public/data/oau-campus.legacy.json), positions as the game shipped them
//   osm     the OpenStreetMap map (public/data/oau-campus.osm.json, converted by tools/oau/import_campus.py): its expressway was laid out again on that map (the old one cannot be transformed: it would cut through
//           the denser new buildings), and its billboard sites are written by tools/oau/place-billboards.mjs --write
// LAYOUT is rewritten by tools/oau/use-map.mjs. Do not change it by hand.
export const LAYOUT = "osm";   // MAP-LAYOUT-SWITCH

export const LAYOUTS = {
  legacy: {
    extend: 480,
    waypoints: [[-1760, 380], [-460, 690], [560, 870], [1440, 560]],
    interchanges: [
      { id: "west", name: "West interchange", sides: ["S"], south: { at: [-493, 759], tol: 8 } },
      { id: "campus", name: "Campus interchange", sides: ["N", "S"], north: { at: [63, 730], tol: 8 }, south: { road: [98, 782], dist: 110 } },
    ],
    tails: {
      west: { side: 1, R: 130, ret: { q: [0, 0], h: [1, 0] }, touch: [-1620, 0], ground: [-1575, 0], target: [-1290.5, 104.5], via: [[-1400, 0]], bend: 120 },
      east: { side: -1, R: 250, ret: { q: [1427.5, -121.5], h: [-1, 0] }, touch: [1527.5, -121.5], ground: [1482.5, -121.5], target: [1427.5, -121.5], via: [], bend: 120 },
    },
    billboardSites: [
      ["Agriculture Road", 1225.1, -325.7, -2.484],
      ["Technology Road", 860, -449.2, -2.562],
      ["Arts Road", 372.7, -390.1, -2.495],
      ["Senate Building Road", 329.7, 132.5, -0.961],
      ["Architecture Road", -375.6, -320.7, 0.354],
      ["Mozambique Hall Road", -959.4, -344.8, -2.577],
      ["ETF Hall Road", -1025.5, 154.9, -0.886],
      ["Postgraduate Hall Road", -604.2, 41.3, 2.65],
      ["Postgraduate College Road", 968.6, 197.4, 2.843],
      ["Pharmacy Road", 390.3, 602.1, 0.671],
    ],
  },
  osm: {
    // One straight leg from the west edge (0, 1260) to the south edge (2340, 3239.8), found by tools/oau/search_expressway_routes.py: 55 m from the nearest building (rule: 24 m), 3.07 km inside the map,
    // 4.27 km with 600 m of causeway at each end. (Straight + 24 m + 4.2 km with the old 480 m ends cannot all hold on this map; see docs/NEW-MAP-STATUS.md.) It does not cross the lake.
    extend: 600,
    waypoints: [[0, 1260], [2340, 3239.8]],
    interchanges: [
      // a half diamond on the local road that crosses under the deck at s = 950 m; its ramps meet the road on the south-west side, 110 m from the crossing
      { id: "west", name: "West interchange", sides: ["S"], south: { road: [725, 1873], dist: 110 } },
      // a full diamond where two collectors cross under the deck at s = 2200 m: the big junction (6 roads) on the south-west side, and a new junction 110 m up the collector on the north-east side
      { id: "campus", name: "Campus interchange", sides: ["N", "S"], north: { road: [1682, 2683], dist: 110 }, south: { at: [1583, 2834], tol: 8 } },
    ],
    // Each tail turns the deck round outside the map on to a return line that ends at a road that leaves the map's rim: (0, 73.1) on the west rim, and (1849.5, 3236.5) on the south rim.
    // R and side are the smallest total length found for the 330 m descent (tools/oau/design-expressway-tails.mjs).
    tails: {
      west: { side: 1, R: 340, ret: { q: [0, 73.1], h: [1, 0] }, touch: [-100, 73.1], ground: [-55, 73.1], target: [0, 73.1], via: [], bend: 120 },
      east: { side: 1, R: 600, ret: { q: [1849.5, 3236.5], h: [0, -1] }, touch: [1849.5, 3336.5], ground: [1849.5, 3291.5], target: [1849.5, 3236.5], via: [], bend: 120 },
    },
    billboardSites: [
      ["Senate Plaza", 1764, 562, -0.913],
      ["Library Road", 1553.1, 341.9, -0.922],
      ["Law Corner", 1108.4, 338.7, 0.372],
      ["Student Union Strip", 1851.6, 1111.9, 2.203],
      ["Moremi Junction", 792, 695.4, -0.119],
      ["Alumni Road", 575.3, 315.2, -2.56],
      ["Halls Row", 169.3, 543, -0.355],
      ["Fajuyi Crossing", 608.1, 918.1, 2.934],
      ["Ede Road Banks", 1538.8, 1290.5, -1.877],
      ["Nightlife Strip", 1337.5, 1564.8, 0.375],
    ],   // BILLBOARD-SITES-OSM
  },
};
export const ACTIVE = LAYOUTS[LAYOUT];
