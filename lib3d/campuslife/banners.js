// lib3d/campuslife/banners.js
// The kinds of banner of the Campuslife look (commit c2b9477, campus/shared/src/banners/types.ts). Pure JS: lib3d/campuslife/decor.js (what is solid) and the drawing (props/) share it.
export const BANNER_SIZES = {
  flex: { width: 3.2, height: 1.4, lift: 1.1, pole: 2.8, slots: 1, cols: 1, shape: "wide" },
  cross: { width: 8, height: 1.125, lift: 4.4, pole: 5.9, slots: 1, cols: 1, shape: "strip" },
  board: { width: 2.4, height: 1.3, lift: 0.9, pole: 2.5, slots: 8, cols: 4, shape: "poster" },
  aframe: { width: 0.75, height: 0.8, lift: 0.15, pole: 1, slots: 1, cols: 1, shape: "poster" },
  billboard: { width: 8, height: 4, lift: 3.4, pole: 7.6, slots: 1, cols: 1, shape: "big" },
  flags: { width: 9.6, height: 0.75, lift: 5.6, pole: 7, slots: 0, cols: 5, shape: null },
};
export const FLAG_COLORS = [0x1f7a4d, 0xf4f1e6, 0x1d4f91, 0xf2c230, 0x1f7a4d];
