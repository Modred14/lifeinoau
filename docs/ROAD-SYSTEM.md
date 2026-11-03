# Road system

One graph drives everything: the roads are drawn, driven on, walked beside and routed over from the same geometry (`public/data/oau-roadgraph.json`).

## Pipeline (`npm run build:roads`, or `node tools/oau/refine-roads.mjs`)
1. `lib3d/roadrefine.js`: straighten (Douglas-Peucker + arcs), prune whiskers/loops/duplicates/fragments, classify (arterial / collector / local). Every change is refused if a building or place would lose road access.
2. `lib3d/roadalign.js` (new): hairpins become a straight link (or go), S-bending roads are re-laid as a few long straight runs, side roads are squared to meet a through road at a right angle. Nothing moves a building; each change must keep the road as clear of walls as before.
3. `lib3d/roadshape.js`: contract roundabouts/rings, merge split roads, carry dead ends on to another road or the map edge, put a junction wherever roads cross.
4. `lib3d/highway.js`: the elevated expressway and its ramps.

## At load time
- `lib3d/roadgraph.js`: cross-sections (collectors come in a few standard widths), lanes, connectors, routing, surface queries. Junctions get polygons from `lib3d/roadjunction.js`.
- `lib3d/roadjunction.js` (new): one polygon per junction and layer (asphalt, kerb, pavement) with rounded kerb returns. Each road's ribbon starts exactly where the polygon's mouth is, so surfaces meet with no gap or overlap. Roads that meet at a very sharp angle, or would need an arm cut back more than 18 m, are built as a round junction instead (still gapless).
- `lib3d/roadmesh.js`: the surfaces (textured asphalt and paving, kerb stone, shoulders, median with yellow-and-black kerb) and markings (white edge and lane lines, yellow centre lines, stop lines, zebra crossings, lane arrows).
- `lib3d/roadfurniture.js` (new): instanced street lights, pavement trees and stop signs, placed only on pavement/median, clear of walls, crossings and the expressway corridor.

## Tests
`tests/road-network.test.mjs` checks the network, the expressway, junction polygons and mouths, holes in the asphalt and pavement meshes, a car footprint swept along every turn and lane, routing over the whole network, marking clashes and furniture placement.
