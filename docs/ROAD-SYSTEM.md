# Road system

One graph drives everything: the roads are drawn, driven on, walked beside and routed over from the same geometry (`public/data/oau-roadgraph.json`).

## Pipeline (`npm run build:roads`, or `node tools/oau/refine-roads.mjs`)
1. `lib3d/roadrefine.js`: straighten (Douglas-Peucker + arcs), prune whiskers/loops/duplicates/fragments, classify (arterial / collector / local). Every change is refused if a building or place would lose road access.
2. `lib3d/roadalign.js` (new): hairpins become a straight link (or go), S-bending roads are re-laid as a few long straight runs, side roads are squared to meet a through road at a right angle. Nothing moves a building; each change must keep the road as clear of walls as before.
3. `lib3d/roadshape.js`: contract roundabouts/rings, merge split roads, carry dead ends on to another road or the map edge, put a junction wherever roads cross.
4. `lib3d/highway.js`: the elevated expressway and its ramps.
5. `node tools/oau/attach-tails.mjs` (idempotent; edits the committed `oau-roadgraph.json` in place and leaves every ground road id alone): `attachTails()` joins the expressway to the road network, and `relocatePiers()` moves any pier that stands in a road. The ground graph cannot be re-baked from `refine-roads.mjs` without renumbering most roads, which is why this is a patch step.

## How the expressway joins the roads (`lib3d/highwaytails.js`)
The deck does not end in a barrier. Each end is a **tail**: the straight deck runs on past the map rim, one tangent arc (west R 130 m, east R 250 m, solved exactly) turns it back on to a return line aimed at a campus road, the last 330 m of that line are a **descent** (3 % average grade, the same smoothed profile as every ramp, `roadgraph.climbFrac`), and at the foot (the **touchdown**) the carriageway carries straight on as ground road: **C1** (the deck's own cross-section, so there is no step), a **taper** node (`taper: true`: the junction polygon narrows the road over the longest gentlest slope), then **C2**, a standard arterial that ends in a junction with the campus road (west: node 51, east: node 28). Both tails can be driven in both directions (`tests/road-network.test.mjs`, 3b). The parapet, median barrier and girder taper to nothing as the deck meets the ground (`highwaymesh.taperK`); nothing stands above the road at the touchdown. Piers are omitted where the deck is below 3.6 m: the foot of a descent is solid fill.

## What is solid (`lib3d/worldsvc.js`, `structuresolid.js`, `furnitureplan.js`, `woodland.js`)
- **Street furniture**: every street light, tree and stop sign is a solid post, from the same plan (`furnitureplan.js`) the meshes use. Each keeps 0.3 m (plus its own radius) off any carriageway or turn patch. They are *soft* for the walking planner only (a `soft` tag shortens the clearance the planner demands), so people are routed along the pavement, but they are as solid as a wall to everything that moves.
- **Woodland trees** (`woodland.js`): the drawn trees and the solid trunks are the same list; a tree hidden because a road runs there is not an obstacle.
- **Ramps and descents**: where the deck is under walking-under height (2.4 m) it is solid fill, so there are walls along both sides and across the low mouth. They are `foot` walls: they stop people only, a car drives along the top and is never stopped by them.
- **Cars** are confined to carriageway and probed against every static solid every 0.5 m however fast they go (`carphysics.MAX_STEP_M`).
- The walking planner's grid extent ignores street furniture and the tails (`outer`), so adding them cannot shift the grid and change borderline routes.

## At load time
- `lib3d/roadgraph.js`: cross-sections (collectors come in a few standard widths), lanes, connectors, routing, surface queries. Junctions get polygons from `lib3d/roadjunction.js`.
- `lib3d/roadjunction.js` (new): one polygon per junction and layer (asphalt, kerb, pavement) with rounded kerb returns. Each road's ribbon starts exactly where the polygon's mouth is, so surfaces meet with no gap or overlap. Roads that meet at a very sharp angle, or would need an arm cut back more than 18 m, are built as a round junction instead (still gapless).
- `lib3d/roadmesh.js`: the surfaces (textured asphalt and paving, kerb stone, shoulders, median with yellow-and-black kerb) and markings (white edge and lane lines, yellow centre lines, stop lines, zebra crossings, lane arrows).
- `lib3d/roadfurniture.js` (new): instanced street lights, pavement trees and stop signs, placed only on pavement/median, clear of walls, crossings and the expressway corridor.

## Tests
`tests/world-obstructions.test.mjs` checks that nothing solid stands on a road, that a car can drive every lane without touching a solid, that people are stopped by posts, trees and the solid parts of ramps while cars are not, and that nothing can be driven through at speed.
`tests/road-network.test.mjs` checks the network, the expressway, junction polygons and mouths, holes in the asphalt and pavement meshes, a car footprint swept along every turn and lane, routing over the whole network, marking clashes and furniture placement.
