// lib/sugRoles.js
// Who holds a political office RIGHT NOW. Small and import-light on purpose (the profile code in lib/gameService.js reads it).
//
// A political office is not a permission to do anything outside the student government: it is a row in SugAppointment, and it counts only while its
// term's window contains the current time. The window is compared with the clock on every call, so a government whose term has ended loses its powers
// at that instant, whether or not any housekeeping has run. Nothing here reads or writes User.role, so no office can ever grant application admin access.
import { titleOf } from "./sugRules.js";

/** The active offices of these characters: Map(characterId -> [{ position, title, seat, termId, kind }]). */
export async function activeOffices(db, characterIds, now = Date.now()) {
  const ids = [...new Set(characterIds)].filter(Boolean), out = new Map();
  if (!ids.length) return out;
  const at = new Date(now);
  const rows = await db.sugAppointment.findMany({
    where: { characterId: { in: ids }, status: "ACTIVE", term: { startsAt: { lte: at }, endsAt: { gt: at } } },
    select: { characterId: true, position: true, seat: true, termId: true, kind: true },
  });
  for (const r of rows) {
    const l = out.get(r.characterId) ?? []; l.push({ position: r.position, title: titleOf(r.position), seat: r.seat, termId: r.termId, kind: r.kind }); out.set(r.characterId, l);
  }
  return out;
}

/** One player's active offices (usually zero or one: a person holds one office per term). */
export async function officesOf(db, characterId, now = Date.now()) { return (await activeOffices(db, [characterId], now)).get(characterId) ?? []; }

/** The title to show beside a name ("SUG President"), or null. */
export async function titleFor(db, characterId, now = Date.now()) { return (await officesOf(db, characterId, now))[0]?.title ?? null; }

/** The term in office right now, or null. */
export const currentTerm = (db, now = Date.now()) => db.sugTerm.findFirst({ where: { startsAt: { lte: new Date(now) }, endsAt: { gt: new Date(now) } }, orderBy: { startsAt: "desc" } });