// lib3d/campuslife/buildings/features.js
// Ported from campus/client/game/buildings/features.ts (commit c2b9477): the Campuslife campus look. Type annotations removed.
import { BAYS_PER_ROW, ROW, flatUv, rowUv } from "./atlas-layout.js";
import { at } from "./footprint.js";
import { dome, prism, ring, spire } from "./mesh.js";
import { hash, rgb, shade } from "./types.js";
const FLAT = flatUv(ROW.plain);
const TANK_COLORS = [rgb(0x1c1c1e), rgb(0x1c1c1e), rgb(0x2f5f9f)];
const STEEL = rgb(0x5b6066);
function strip(frame, side, from, to, near, far) {
    if (side === "front")
        return [at(frame, from, -near), at(frame, to, -near), at(frame, to, -far), at(frame, from, -far)];
    const d = frame.depth;
    return [at(frame, to, d + near), at(frame, from, d + near), at(frame, from, d + far), at(frame, to, d + far)];
}
export function ledge(buf, frame, side, from, to, y0, y1, depth, style, id) {
    const u0 = Math.floor(hash(id, 70 + (style.salt ?? 0)) * BAYS_PER_ROW) / BAYS_PER_ROW;
    prism(buf, strip(frame, side, from, to, 0, depth), y0, y1, {
        side: style.side,
        top: style.top,
        bottom: style.bottom,
        flat: FLAT,
        sideUv: (edge, length) => {
            if (edge === 0)
                return null;
            if (edge !== 2 || style.row === undefined)
                return FLAT;
            return rowUv(style.row, u0, u0 + Math.max(1, Math.round(length / (style.bay ?? 3.4))) / BAYS_PER_ROW);
        },
    });
}
export function balcony(buf, frame, side, from, to, y, depth, wall, trim, bay, id, salt) {
    ledge(buf, frame, side, from, to, y - 0.14, y, depth, { side: shade(wall, 0.9), top: shade(wall, 0.7), bottom: shade(wall, 0.42) }, id);
    const u0 = Math.floor(hash(id, 80 + salt) * BAYS_PER_ROW) / BAYS_PER_ROW;
    prism(buf, strip(frame, side, from, to, depth - 0.12, depth), y, y + 1, {
        side: trim,
        top: shade(trim, 1.08),
        bottom: null,
        flat: FLAT,
        sideUv: (edge, length) => (edge === 2 ? rowUv(ROW.hostelRail, u0, u0 + Math.max(1, Math.round(length / bay)) / BAYS_PER_ROW) : FLAT),
    });
}
export function towerCap(buf, frame, from, to, y0, y1, wall, roof, tank, id) {
    const d = frame.depth;
    prism(buf, [at(frame, from, 0), at(frame, to, 0), at(frame, to, d), at(frame, from, d)], y0, y1, { side: wall, top: roof, bottom: null, flat: FLAT });
    if (!tank)
        return;
    const c = at(frame, (from + to) / 2, d / 2);
    const radius = Math.min(0.95, (to - from) / 2 - 0.3, d / 2 - 0.3);
    if (radius < 0.4)
        return;
    prism(buf, ring(c[0], c[1], radius * 0.9, 4, Math.PI / 4), y1, y1 + 0.5, { side: STEEL, top: null, bottom: null, flat: FLAT });
    const color = TANK_COLORS[Math.floor(hash(id, 90) * TANK_COLORS.length)];
    prism(buf, ring(c[0], c[1], radius, 8), y1 + 0.5, y1 + 2, { side: color, top: shade(color, 1.4), bottom: null, flat: FLAT });
}
export function mosqueDome(buf, centre, y, radius, wall, color) {
    prism(buf, ring(centre[0], centre[1], radius * 1.05, 8), y, y + 0.9, { side: wall, top: null, bottom: null, flat: FLAT });
    dome(buf, centre[0], centre[1], y + 0.9, radius, color, FLAT);
}
const box = (frame, s0, s1, t0, t1) => [at(frame, s0, t0), at(frame, s1, t0), at(frame, s1, t1), at(frame, s0, t1)];
export function minaret(buf, frame, s, t, y0, y1, wall, color) {
    prism(buf, box(frame, s - 0.6, s + 0.6, t - 0.6, t + 0.6), y0, y1, { side: wall, top: null, bottom: null, flat: FLAT });
    prism(buf, box(frame, s - 0.85, s + 0.85, t - 0.85, t + 0.85), y1 - 1.6, y1 - 1.3, { side: color, top: color, bottom: shade(color, 0.5), flat: FLAT });
    const c = at(frame, s, t);
    spire(buf, box(frame, s - 0.7, s + 0.7, t - 0.7, t + 0.7), y1, [c[0], y1 + 2.2, c[1]], color, FLAT);
}
export function cross(buf, frame, y, color) {
    const half = frame.depth / 2;
    prism(buf, box(frame, 0.25, 0.47, half - 0.11, half + 0.11), y - 0.4, y + 2.4, { side: color, top: color, bottom: null, flat: FLAT });
    prism(buf, box(frame, 0.25, 0.47, half - 0.75, half + 0.75), y + 1.45, y + 1.67, { side: color, top: color, bottom: color, flat: FLAT });
}
