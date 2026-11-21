// lib/homeStyle.js
// How a home LOOKS from the outside, decided only by the accommodation the player lives in (room.hostel, the same string the rest of the game stores in Character.hostel).
// Pure data, no browser APIs: lib3d/houseShell.js draws the roof, upper storey and facade from it, lib3d/plot3d.js tints the compound's wall and garage with it, and
// tests/home-style.test.mjs checks that the types really differ. Sizes (width, depth) are NOT here: they come from the floor plan (lib/layouts.js / lib/room.js), so the
// building always matches its interior exactly. This only adds what the interior does not say: storeys, roof shape, materials and details.
import { PRIVATE_HOMES, occupancyKey } from "./rules.js";

/** storeys: extra floors ABOVE the ground floor (0 = single level); roof: "gable" | "hip" | "flat"; balcony/porch: extra façade details. */
const STYLES = Object.freeze({
  school:       { kind: "hall",    label: "Hall of residence",  storeys: 0, roof: "flat",  wall: "#d9cdb4", trim: "#f3eedf", roofColor: "#7d8588", fence: "#cfc6b0", garage: "#cfc8b8", plinth: "#a8a293", porch: false, balcony: false, windowRows: 1 },
  bigSchool:    { kind: "hall",    label: "Large hall",         storeys: 1, roof: "flat",  wall: "#d6c7a8", trim: "#f3eedf", roofColor: "#6f7a7e", fence: "#c9bfa6", garage: "#cfc8b8", plinth: "#a39d8e", porch: false, balcony: false, windowRows: 2 },
  Ojaja:        { kind: "suite",   label: "Ojaja suite",        storeys: 0, roof: "hip",   wall: "#c9d3e0", trim: "#f2f5fa", roofColor: "#3f4f6b", fence: "#d6dde8", garage: "#d3d9e2", plinth: "#8e98a8", porch: true,  balcony: false, windowRows: 1 },
  "Off-campus": { kind: "bungalow", label: "Bungalow",          storeys: 0, roof: "gable", wall: "#e4d3b4", trim: "#fbf6ea", roofColor: "#8a4b3a", fence: "#e0d4bb", garage: "#dccfb5", plinth: "#a39578", porch: true,  balcony: false, windowRows: 1 },
  "1-Bedroom Flat": { kind: "flat", label: "1-bedroom flat",   storeys: 0, roof: "flat",  wall: "#e7e0cf", trim: "#faf7ef", roofColor: "#6c7478", fence: "#dad4c3", garage: "#d8d2c2", plinth: "#9b9686", porch: false, balcony: true,  windowRows: 1 },
  "2-Bedroom Flat": { kind: "flat", label: "2-bedroom flat",   storeys: 1, roof: "flat",  wall: "#e9dfc9", trim: "#faf7ef", roofColor: "#646c70", fence: "#d9d1bc", garage: "#d6cfbd", plinth: "#948f7f", porch: false, balcony: true,  windowRows: 2 },
  "3-Bedroom House": { kind: "house", label: "3-bedroom house", storeys: 1, roof: "hip",  wall: "#efe6d4", trim: "#fffdf7", roofColor: "#7a4a3a", fence: "#eae1cf", garage: "#e2d9c6", plinth: "#a89d84", porch: true,  balcony: false, windowRows: 1 },
  "4-Bedroom House": { kind: "villa", label: "4-bedroom house", storeys: 1, roof: "gable", wall: "#f0e8d8", trim: "#ffffff", roofColor: "#5b3a32", fence: "#efe7d6", garage: "#e8dfcc", plinth: "#b0a58b", porch: true,  balcony: true,  windowRows: 2 },
});

/** The style of the home this room belongs to. Unknown accommodation falls back to the plain hall style (never throws). */
export function homeStyle(room) {
  const h = room?.hostel, key = h && PRIVATE_HOMES.includes(h) ? h : occupancyKey(h ?? "");
  return { ...(STYLES[key] ?? STYLES.school), key };
}

/** Every style key, for tests. */
export const STYLE_KEYS = Object.freeze(Object.keys(STYLES));

/** Height of one upper storey, in scene units (the ground floor's walls are WALL_H = 3.4 in lib3d/room.js). */
export const UPPER_H = 2.9;
/** How far the roof overhangs the walls. */
export const EAVE = 0.55;
/** The peak height of a pitched roof above its eaves, by the roof's shorter span. */
export const ridgeRise = (span, roof) => (roof === "flat" ? 0.35 : Math.max(1.1, Math.min(2.6, span * (roof === "gable" ? 0.26 : 0.22))));
