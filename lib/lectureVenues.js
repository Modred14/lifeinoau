// lib/lectureVenues.js
// Where each lecturer physically is: the lecture room of the course they teach. Pure (no database, no 3D library), so the server, the browser and the
// tests all agree on it. The rooms come from the interior plans (lib3d/interiors), which already stand a lecturer at the front of every lecture room.
//
// A player's four courses get four DIFFERENT rooms (faculty building first, then the big lecture theatres), so every lecturer has a room of their own and
// the lecturer you meet in a room is always the right one. Which room a course gets depends only on the faculty, the level and the course code.
import { facultyKey } from "./faculties.js";
import { buildPlan } from "../lib3d/interiors/index.js";
import { hashId } from "../lib3d/interiors/registry.js";

/** The faculty buildings (map place ids) whose lecture rooms a faculty's courses use. */
export const FACULTY_BUILDINGS = {
  "Science": ["f_science"], "Technology": ["f_technology"], "Computer Science": ["f_cs"], "Law": ["f_law"],
  "Arts": ["f_arts", "f_arts_b2", "f_arts_b3"], "Education": ["f_education"], "Pharmacy": ["f_pharmacy", "f_pharmacy_new"],
  "College of Health Sciences": ["f_health"], "Basic Medical Sciences": ["f_health"], "Basic Clinical Sciences": ["f_health"], "Clinical Sciences": ["f_health"], "Dentistry": ["f_health"],
  "Social Sciences": ["f_social"], "Administration": ["f_admin"], "Environmental Design & Management": ["f_edm"], "Agriculture": ["f_agric"],
};
/** Shared lecture theatres: used when a faculty's own building has fewer lecture rooms than the player has courses. */
export const THEATRES = ["hslta", "hsltb", "hsltc", "hsltc_n", "hsltc_s", "chem_eng_lt", "first_bank_lt", "computer_auditorium", "boob", "booc", "lt_1000"];

const cache = new Map(); // building id -> its lecture rooms
/** The rooms of a building where a lecturer stands at the front, on the ground floor: [{ placeId, roomId, roomName, npcIndex }] in plan order. */
export function lectureRoomsOf(placeId) {
  if (cache.has(placeId)) return cache.get(placeId);
  let rooms = [];
  try {
    const plan = buildPlan({ id: placeId, name: placeId, kind: "" });
    if (plan) {
      plan.npcs.forEach((n, npcIndex) => {
        if (n.role !== "lecturer" || n.mode === "sit" || (n.floor ?? 0) !== 0) return; // seated "lecturers" are in seminar and meeting rooms; upper floors are not used
        const room = plan.byId.get(n.room); if (!room) return;
        rooms.push({ placeId, roomId: n.room, roomName: room.name, npcIndex, x: n.x, z: n.z, yaw: n.yaw ?? 0 });
      });
      // plain "Lecture Room" rooms first, when the building has any; studios and laboratories only fill in for buildings with none (Environmental Design)
      const plain = rooms.filter((r) => /lecture/i.test(r.roomName)); if (plain.length) rooms = plain;
    }
  } catch { rooms = []; }
  cache.set(placeId, rooms); return rooms;
}

const hash = (s) => hashId(String(s));
const pickFrom = (list, from, used) => { for (let k = 0; k < list.length; k++) { const r = list[(from + k) % list.length]; if (!used.has(r.placeId + "/" + r.roomId)) return r; } return null; };

/**
 * The lecture room of every course in `courses` (as coursesFor returns them): a Map from course code to { placeId, roomId, roomName, npcIndex }.
 * Distinct courses never share a room.
 */
export function lectureVenues(facultyName, courses) {
  const own = (FACULTY_BUILDINGS[facultyKey(facultyName)] ?? []).flatMap(lectureRoomsOf), shared = THEATRES.flatMap(lectureRoomsOf), used = new Set(), out = new Map();
  for (const c of courses) {
    const r = pickFrom(own, own.length ? hash(c.code) % own.length : 0, used) ?? pickFrom(shared, shared.length ? hash(c.code) % shared.length : 0, used);
    if (!r) continue; used.add(r.placeId + "/" + r.roomId);
    out.set(c.code, { placeId: r.placeId, roomId: r.roomId, roomName: r.roomName, npcIndex: r.npcIndex });
  }
  return out;
}
export const lectureVenueFor = (facultyName, courses, code) => lectureVenues(facultyName, courses).get(code) ?? null;

// ---- being there ----
/** A player counts as being at a place for this long after the server last heard from them there (lib/travel.js PRESENCE_MINUTES). */
export const AT_VENUE_MS = 4 * 60_000;
/**
 * Is this character standing in the building right now? Decided from what the SERVER recorded: the place the last trip ended at, and when the player was
 * last seen there. Nothing the browser reports about where it stands is used.
 */
export const isAtVenue = (c, venue, now) => !!venue && !!c && c.placeId === venue.placeId && c.placeAt != null && now - +new Date(c.placeAt) <= AT_VENUE_MS && now - +new Date(c.placeAt) >= -60_000;