// lib/lectureService.js
// Confronting a lecturer IN their lecture room. The server decides everything: where each lecturer is, whether this player may confront them now, and
// (in lib/fightService.js, which uses claimEncounter below) what the fight costs and what N-QRS does about it.
//
// The conditions, all checked here from stored data and the server's clock, never from anything the browser claims:
//   - it is one of the player's own courses, and the player is not in custody, suspended or expelled (loadLocked)
//   - the player's last trip ended at the building the lecturer's lecture room is in, and the server heard from them there recently
//   - they have the energy, and have not fought a lecturer this week
//   - no N-QRS response is already running in that room
// Approaching the lecturer opens an encounter. The fight is only accepted against an open, unexpired encounter of the same player.
import fs from "node:fs";
import path from "node:path";
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { coursesFor } from "./curriculum.js";
import { lectureVenues, isAtVenue } from "./lectureVenues.js";
import { FIGHT_ENERGY } from "./fight.js";
import { currentWeek, serverNow } from "./clock.js";
import { isJailed, isSuspended, jailedMessage, suspendedMessage, expelledMessage, isExpelled } from "./discipline.js";
import { incidentView } from "./lectureResponse.js";
import { activeIncident } from "./lectureIncident.js";
import { withExtras } from "../lib3d/mapExtras.js";

/** An encounter that is not fought within this long lapses; the player has to walk up to the lecturer again. */
export const ENCOUNTER_MS = 10 * 60_000;

let names; // map place id -> name
function placeNameOf(id) {
  if (!names) {
    names = new Map();
    try { for (const p of withExtras(JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", "oau-campus.json"), "utf8"))).places) names.set(p.id, p.name); } catch { /* names stay empty: ids are shown instead */ }
  }
  return names.get(id) ?? id;
}

const lecturerOf = (course) => ({ key: course.lecturerKey, name: course.lecturer.name, difficulty: course.difficulty, personality: course.lecturer.personality });
export const venueView = (v) => (v ? { placeId: v.placeId, placeName: placeNameOf(v.placeId), roomId: v.roomId, roomName: v.roomName, npcIndex: v.npcIndex } : null);

const COLS = { id: true, name: true, level: true, energy: true, placeId: true, placeAt: true, jailedUntil: true, suspendedUntil: true, expelled: true, expelledUntil: true, faculty: { select: { name: true, difficulty: true } } };

async function activeResponseIn(db, venue, now, excludeId) {
  return db.lectureEncounter.findFirst({ where: { venueId: venue.placeId, roomId: venue.roomId, responseState: "ACTIVE", responseEndsAt: { gt: new Date(now) }, ...(excludeId != null ? { NOT: { id: excludeId } } : {}) } });
}

/** Why this player cannot confront this lecturer right now, or null when they can (display only: startEncounter and claimEncounter decide for real). */
function whyNot(c, course, venue, now, { fought, busy }) {
  if (isJailed(c, now)) return jailedMessage(c, now);
  if (isExpelled(c, now)) return expelledMessage(c, now);
  if (isSuspended(c, now)) return suspendedMessage(c, now);
  if (!isAtVenue(c, venue, now)) return `${course.lecturer.name} is in ${venue.roomName}, ${placeNameOf(venue.placeId)}. Go there first.`;
  if (c.energy < FIGHT_ENERGY) return "You are too tired to fight. Rest first.";
  if (fought) return "You already fought a lecturer this week. Let things cool down.";
  if (busy) return "N-QRS is already at the scene, securing the lecturer.";
  return null;
}

/**
 * Where each of the player's lecturers is. With `at` (a map place id) only the ones in that building: the screen inside the building uses this to
 * stand each lecturer in the right room. Also returns the N-QRS response running for this player, if any.
 */
export async function getLectureState(db, userId, { at } = {}) {
  const c = await db.character.findUnique({ where: { userId }, select: COLS });
  if (!c) throw new GameError("Create a character first.", 404);
  const now = serverNow(), week = await currentWeek(db), courses = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)), venues = lectureVenues(c.faculty.name, courses);
  const fought = (await db.actionLog.count({ where: { characterId: c.id, action: "fight", gameWeek: week } })) > 0;
  const list = [];
  for (const course of courses) {
    const venue = venues.get(course.code); if (!venue || (at != null && venue.placeId !== at)) continue;
    const busy = !!(await activeResponseIn(db, venue, now));
    const reason = whyNot(c, course, venue, now, { fought, busy });
    list.push({ code: course.code, title: course.title, lecturer: lecturerOf(course), venue: venueView(venue), here: isAtVenue(c, venue, now), canConfront: reason == null, reason });
  }
  return { serverNow: now, courses: list, incident: await activeIncident(db, c.id, now), energyCost: FIGHT_ENERGY };
}

/**
 * The player walks up to the lecturer in their lecture room. Opens an encounter (valid for ENCOUNTER_MS) that the fight must refer to.
 * `requestId` makes a repeat harmless: the same encounter comes back.
 */
export async function startEncounter(db, userId, { code, requestId } = {}) {
  needReq(requestId); const week = await start(db, userId);
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId); // custody, suspension and expulsion are refused here
      const now = serverNow();
      const mine = await tx.lectureEncounter.findFirst({ where: { characterId: c.id, requestId } });
      if (mine) { // the same request again: the same encounter, as long as it is still the open one
        if (mine.status === "OPEN" && +mine.expiresAt > now) return startedView(mine, now);
        throw new GameError("That confrontation is already over. Walk up to your lecturer again.", 409);
      }
      const courses = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)), course = courses.find((x) => x.code === code);
      if (!course) throw new GameError("That is not one of your courses.", 404);
      const venue = lectureVenues(c.faculty.name, courses).get(code); if (!venue) throw new GameError("That lecturer has no lecture room yet.", 409);
      const fought = (await tx.actionLog.count({ where: { characterId: c.id, action: "fight", gameWeek: week } })) > 0;
      const busy = !!(await activeResponseIn(tx, venue, now));
      const why = whyNot(c, course, venue, now, { fought, busy }); if (why) throw new GameError(why, 409);
      // one open encounter per player: a new approach lapses the old one
      await tx.lectureEncounter.updateMany({ where: { characterId: c.id, status: "OPEN" }, data: { status: "EXPIRED" } });
      const row = await tx.lectureEncounter.create({ data: { characterId: c.id, requestId, courseCode: code, lecturerKey: course.lecturerKey, lecturerName: course.lecturer.name, venueId: venue.placeId, roomId: venue.roomId, npcIndex: venue.npcIndex,
        status: "OPEN", startedAt: new Date(now), expiresAt: new Date(now + ENCOUNTER_MS) } });
      return startedView(row, now);
    });
  } catch (e) {
    if (e.code === "P2002" && base) { // the same request at the same moment as another: hand back the encounter the first one made
      const row = await db.lectureEncounter.findFirst({ where: { characterId: base.id, requestId } });
      if (row && row.status === "OPEN") return startedView(row, serverNow());
    }
    throw e;
  }
}
const startedView = (row, now) => ({ ok: true, encounter: { id: String(row.id), code: row.courseCode, lecturer: { key: row.lecturerKey, name: row.lecturerName }, venue: { placeId: row.venueId, roomId: row.roomId, npcIndex: row.npcIndex }, expiresAt: +new Date(row.expiresAt), serverNow: now } });

/**
 * Used by the fight (lib/fightService.js) inside its transaction, with the player's row locked: the open encounter this fight is about, after checking it
 * is the player's own, still open, not lapsed, for this course, that they are still in the building, and that no response is running in the room.
 */
export async function claimEncounter(tx, c, { encounterId, code, now }) {
  const need = new GameError("Walk up to your lecturer in their lecture room first.", 409);
  let id; try { id = BigInt(encounterId); } catch { throw need; }
  const enc = await tx.lectureEncounter.findFirst({ where: { id, characterId: c.id } });
  if (!enc) throw need;
  if (enc.status !== "OPEN") throw new GameError("That confrontation is already over.", 409);
  if (+enc.expiresAt <= now) throw new GameError("Too much time has passed. Walk up to your lecturer again.", 409); // (a lapsed encounter is simply never accepted; the next approach tidies it)
  if (enc.courseCode !== code) throw need;
  if (c.placeId !== enc.venueId) throw new GameError("You left the lecture room.", 409);
  const venue = { placeId: enc.venueId, roomId: enc.roomId };
  await tx.lectureEncounter.updateMany({ where: { venueId: venue.placeId, roomId: venue.roomId, responseState: "ACTIVE", responseEndsAt: { lte: new Date(now) } }, data: { responseState: "DONE" } }); // responses that have ended
  if (await activeResponseIn(tx, venue, now, id)) throw new GameError("N-QRS is already at the scene, securing the lecturer.", 409);
  return enc;
}

/** The incident a (possibly repeated) fight request produced, for a replay. */
export async function incidentOfRequest(db, characterId, encounterId) {
  let id; try { id = BigInt(encounterId); } catch { return null; }
  const row = await db.lectureEncounter.findFirst({ where: { id, characterId } });
  return row && row.status === "SETTLED" ? { row, view: incidentView(row, serverNow()) } : null;
}