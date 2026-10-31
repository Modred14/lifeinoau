// lib3d/compoundUnits.js
// The one unit of the home compound: the plot is laid out in room cells (lib/plot.js) and the vehicles and people are measured in metres. Kept apart so that
// lib3d/compoundParking.js (where vehicles stand) and lib3d/compoundWalk.js (how a person gets to them) can both read it without importing each other.
export const CELL_M = 0.9; // a room cell is about 0.9 m (lib3d/room.js draws a 1.75 m person 1.95 cells tall)