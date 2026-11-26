// lib3d/campuslife/buildings/types.js
// Ported from campus/client/game/buildings/types.ts (commit c2b9477): the Campuslife campus look. Type annotations removed.
export const emptyBuffers = () => ({ pos: [], uv: [], col: [], idx: [] });
export function hash(id, salt) {
    let h = (Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const pick = (list, id, salt) => list[Math.floor(hash(id, salt) * list.length)];
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function rgb(hex) {
    return [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
}
export const parseHex = (css) => parseInt(css.replace("#", ""), 16);
export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
