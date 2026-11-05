// lib3d/roadsurface.js
// The numbers that say WHERE the road surface is, in one place, so what is drawn, what the car drives on and where its tyres sit can never drift apart. Pure JS (no three.js, no DOM).
//
// HEIGHTS. The ground road is drawn flat at ROAD_LAYER_Y (scene units) and lowered to TRIP_LOWER of that while you are on a trip (lib3d/campusReal.js tripMode); a scene unit is
// 1 / SCENE_S metres. So on a trip the asphalt top is at ROAD_TOP metres, not at 0. The expressway deck and its ramps are drawn at their own height ABOVE that surface (lib3d/highwaymesh.js
// lifts them by ROAD_TOP), so a ramp starts exactly on the asphalt and the deck is at ROAD_TOP + HW.H. A vehicle model has its tyres' lowest point at y = 0 (lib3d/vehicleKit.js mountWheel),
// so a vehicle stands on the road when its root is at ROAD_TOP + the road's height.
export const SCENE_S = 0.1;          // metres -> scene units (lib3d/campusReal.js S)
export const ROAD_LAYER_Y = 0.08;    // where the road meshes are drawn in the map view (scene units)
export const TRIP_LOWER = 0.12;      // on a trip every flat layer is lowered to this fraction of its height
/** The asphalt top on a trip, in metres above the ground. */
export const ROAD_TOP = (ROAD_LAYER_Y * TRIP_LOWER) / SCENE_S;

// THE DECK'S EDGES. Where the drivable surface stops, measured from what is built.
export const DECK = {
  parapet: 0.55,       // the concrete parapet along the deck: nobody drives through it, so the drivable half-width is this much less than the carriageway's
  rampParapet: 0.45,   // the same on a ramp
  endStop: 0.6,        // the end barrier across each end of the deck is this thick; the drivable surface stops at its face
};
