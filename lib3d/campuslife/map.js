// lib3d/campuslife/map.js
// What the ported Campuslife drawing code asks of its map module. The old campus worked in map pixels; here everything is already in metres, so one "pixel" is one metre.
export const PX_PER_METER = 1;
/** Wall colour per building kind (from campus/shared/src/map.ts at commit c2b9477). */
export const BUILDING_STYLE = {
  academic: { wall: 0xe9e7e1 }, hostel: { wall: 0xeee4cf }, residence: { wall: 0xf1e8dc }, worship: { wall: 0xf3f0ea },
  commercial: { wall: 0xeef0f0 }, sports: { wall: 0xdfe6e9 }, civic: { wall: 0xe6e1d6 }, other: { wall: 0xe6e2d8 },
};
/** Facade presets by name, filled from public/data/oau-campuslife.json before any building is drawn. */
export const BUILDING_PRESETS = { landmarks: {} };
export const setPresets = (presets) => { BUILDING_PRESETS.landmarks = presets ?? {}; };
