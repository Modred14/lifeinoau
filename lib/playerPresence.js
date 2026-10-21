// lib/playerPresence.js
// What other players are allowed to see of one another at a place: who is listed, where they stand inside a building and what they are doing.
// Pure functions (no database), so the rules are easy to test. lib/travelService.js loads the rows and calls these.
//
// Only REAL players are ever listed here: every row comes from the character table, so no NPC can appear in these lists, and the caller's own
// character is always left out. Anyone who has blocked you, or whom you have blocked, is left out too.
import { ACTIVITIES } from "./activities.js";
import { cellFor, cellAt, clampToCell, cellSpot, CELL_MARGIN } from "./custodyCells.js";

/** A position inside a building counts only while it is this fresh. The screen reports every 4 seconds, so a few missed reports and the player is gone. */
export const POSITION_FRESH_MS = 14_000;

/** The short id other players see (the same form the road list uses). The full character id never leaves the server. */
export const publicId = (id) => String(id).slice(-8);

/** Where a listed player stands inside `placeId`, or null when they have not reported a fresh position there (they are then listed but not drawn). */
export function positionOf(r, placeId, now) {
  if (!r || r.inPlace !== placeId || !r.inAt || r.inX == null || r.inZ == null) return null;
  const age = now - +new Date(r.inAt);
  if (!(age >= -2_000 && age <= POSITION_FRESH_MS)) return null;
  return { x: r.inX, z: r.inZ, floor: r.inFloor ?? 0 };
}

/** The avatar clips to try, in order, while this player is in the middle of an activity (sitting, talking, sleeping...). Null when they are not. */
export function animOf(run, now) {
  if (!run || run.status !== "RUNNING" || +new Date(run.endsAt) <= now) return null;
  const a = ACTIVITIES[run.activityId]?.anim;
  return Array.isArray(a) && a.length ? [...a] : null;
}

/**
 * rows: characters at the place (id, name, gender, level, look, faculty, inPlace, inX, inZ, inFloor, inAt).
 * blocks: { blockerId, blockedId } pairs that involve the caller. runs: running activities of those characters.
 * Returns at most `max` players, newest first as given, each as { id, name, gender, level, faculty, look, x?, z?, floor?, anim? }.
 */
export function shapePeople({ rows, blocks = [], runs = [], selfId, placeId, now, max = 30, cells = [] }) {
  const hidden = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
  const runOf = new Map(runs.map((r) => [r.characterId, r]));
  const out = [], seen = new Set();
  for (const r of rows) {
    if (r.id === selfId || hidden.has(r.id)) continue; // never yourself, never someone blocked either way
    const id = publicId(r.id); if (seen.has(id)) continue; seen.add(id);
    const e = { id, name: r.name, gender: r.gender, level: r.level, faculty: r.faculty?.name ?? "", look: r.look ?? null };
    let p = positionOf(r, placeId, now);
    if (cells.length) {
      // Custody: a prisoner is ALWAYS drawn inside their own cell (their reported spot, pulled inside; the cell's middle if none), and flagged as
      // detained. Anyone who is not a prisoner is never flagged, and is never drawn inside a cell (a stale position from a sentence that has ended).
      if (r.jailedUntil != null && +new Date(r.jailedUntil) > now) {
        const cell = cellFor(cells, r.id); e.detained = true;
        p = p ? { ...clampToCell(cell, p.x, p.z, CELL_MARGIN), floor: cell.floor } : cellSpot(cell);
      } else if (p && cellAt(cells, p.x, p.z)) p = null;
    }
    if (p) { Object.assign(e, p); const an = animOf(runOf.get(r.id), now); if (an) e.anim = an; }
    out.push(e); if (out.length >= max) break;
  }
  return out;
}