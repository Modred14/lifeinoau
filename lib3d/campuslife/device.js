// lib3d/campuslife/device.js
/** A phone or tablet: fewer small plants, simpler distant shapes, shorter draw distances, no shadows from the planting and props, no light cones under the lamps. Never changes anything that is solid. */
export const isPhone = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
