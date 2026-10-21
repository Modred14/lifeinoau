// lib/custodyCells.js
// The holding cells at Floor O, as the SERVER sees them. Pure functions (no database, no 3D library) so the same rules run in the server
// (lib/activityService.js, lib/travelService.js), in the 3D scene (the bars and the clamp) and in the tests.
//
// A player in custody is assigned one cell, always the same one for the same character (a hash of the id), and may only ever be reported
// inside it. A player who is NOT in custody can never be reported inside any cell: the cells are locked to everyone else. The cell rectangles
// are read from the compiled plan, so a change to the building moves the rules with it.

/** The cell rooms of a compiled custody interior, in a stable order: [{ id, name, x0, z0, x1, z1, cx, cz, floor }]. */
export function cellsOf(compiled) {
  return (compiled?.rooms ?? []).filter((r) => r.kind === "cell").map((r) => ({ id: r.id, name: r.name, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, floor: r.floor ?? 0 }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** A small stable hash of a string (FNV-1a), so a character keeps the same cell for the whole sentence. */
export function hashOf(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

/** The cell this character is held in (null when the building has no cells). */
export function cellFor(cells, characterId) { return cells.length ? cells[hashOf(characterId) % cells.length] : null; }

/** Is (x, z) inside the cell, with `pad` metres to spare on the inside (negative pad = grow it)? */
export const inCell = (cell, x, z, pad = 0) => !!cell && x >= cell.x0 + pad && x <= cell.x1 - pad && z >= cell.z0 + pad && z <= cell.z1 - pad;
/** The cell (if any) that contains the point. */
export const cellAt = (cells, x, z, pad = 0) => cells.find((c) => inCell(c, x, z, pad)) ?? null;

/** How far from the cell walls a detainee's centre must stay (the bars and walls have thickness, and the avatar a radius). */
export const CELL_MARGIN = 0.3;
/** Pull a point back inside the cell (the scene uses this every frame; the server uses it to place a detainee who has no fresh position). */
export function clampToCell(cell, x, z, margin = CELL_MARGIN) {
  return { x: Math.min(cell.x1 - margin, Math.max(cell.x0 + margin, x)), z: Math.min(cell.z1 - margin, Math.max(cell.z0 + margin, z)) };
}
/** Where a detainee stands when nothing better is known: just inside their bars, then the middle of the cell. */
export const cellSpot = (cell) => ({ x: cell.cx, z: cell.cz, floor: cell.floor });

/**
 * May this player be reported at (x, z) in the custody building?
 *   in custody      only inside their own cell
 *   everyone else   anywhere EXCEPT inside a cell
 * Returns null when fine, otherwise the reason (shown to the player).
 */
export function custodyPlacement(cells, { jailed, characterId, x, z }) {
  if (!cells.length) return null;
  if (jailed) return inCell(cellFor(cells, characterId), x, z, 0.05) ? null : "The cell door is locked. You cannot leave your cell.";
  return cellAt(cells, x, z, -0.05) ? "The cells are locked." : null;
}
