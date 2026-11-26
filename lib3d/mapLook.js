// lib3d/mapLook.js
// How the main map is DRAWN. One word switches it, nothing else has to change:
//   "campuslife"  the Campuslife campus look of commit c2b9477: painted facades and roofs, grass, paving, footpaths, laterite verges, real tree positions (lib3d/campuslife/), buildings at their real height
//   "classic"     the plain extruded buildings drawn twice as tall, as before
// Either way the footprints, roads, places, collision and driving come from public/data/oau-campus.json and are identical. The Campuslife look is drawn only on the "new" map (its data is positioned on that
// map); on the legacy map, or if public/data/oau-campuslife.json cannot be loaded, the classic buildings are drawn.
export const MAP_LOOK = "campuslife";
/** Buildings are drawn this many times taller than they are (lib3d/campusReal.js EX, and the billboards' sight-line rules in lib3d/billboardSite.js). */
export const LOOK_EX = MAP_LOOK === "campuslife" ? 1 : 2;
