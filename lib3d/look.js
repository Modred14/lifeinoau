// lib3d/look.js
// The look choices live in ONE place, lib/look.js, which the server validates against and every 3D screen draws from.
// This file used to hold a second, different copy (other hair lists, fabric and accent fields the game never read), which could only disagree with the saved look. It now just re-exports the real one.
export * from "../lib/look.js";
