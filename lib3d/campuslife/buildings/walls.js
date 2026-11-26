// lib3d/campuslife/buildings/walls.js
// Ported from campus/client/game/buildings/walls.ts (commit c2b9477): the Campuslife campus look. Type annotations removed.
import { BAYS_PER_ROW, ROW, flatUv, rowUv } from "./atlas-layout.js";
import { wall } from "./mesh.js";
import { hash, mix, rgb, shade } from "./types.js";
export const PLINTH_HEIGHT = 0.45;
export const PARAPET_HEIGHT = 0.6;
const NARROW_WALL = 2.4;
const PLAIN_SPAN = 27;
const LATERITE = rgb(0x8a5a40);
export function wallRun(buf, run, spec, id, top, topColor) {
    const length = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
    if (length < 0.02)
        return;
    const narrow = length < NARROW_WALL;
    const bays = Math.max(1, Math.round(length / spec.bay));
    const u0 = Math.floor(hash(id, 50 + run.salt) * BAYS_PER_ROW) / BAYS_PER_ROW;
    const u1 = u0 + bays / BAYS_PER_ROW;
    const plinth = mix(shade(spec.wall, 0.55), LATERITE, 0.3);
    const lift = Math.min(PLINTH_HEIGHT, spec.storey * 0.3);
    wall(buf, run.a, run.b, 0, lift, flatUv(ROW.plain), plinth, plinth, run.normal);
    for (let k = 0; k < spec.floors; k++) {
        const row = narrow ? ROW.plain : k === 0 ? run.groundRow : run.row;
        const y0 = k === 0 ? lift : k * spec.storey;
        const uv = rowUv(row, u0, u1, k === 0 ? lift / spec.storey : 0, 1);
        wall(buf, run.a, run.b, y0, (k + 1) * spec.storey, uv, k === 0 ? shade(spec.wall, 0.8) : spec.wall, spec.wall, run.normal);
    }
    const wallTop = spec.floors * spec.storey;
    if (top > wallTop + 0.01)
        wall(buf, run.a, run.b, wallTop, top, rowUv(ROW.plain, u0, u0 + length / PLAIN_SPAN, 0.72, 1), topColor, topColor, run.normal);
}
