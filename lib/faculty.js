// lib/faculty.js
// Academics happen in person. Which building is each faculty's own, and when classes, tests and exams are open on the game clock. Pure: no database.
//
// The 15 faculties a player can pick (lib/faculties.js) each have one building on the map. Where the real map has the faculty, that is the
// building (Law, Arts, Pharmacy ...). The three clinical and basic-medical faculties and Dentistry share the College of Health Sciences.
// Six faculty buildings are game placements (lib3d/mapExtras.js) because the real-map render does not show them. See that file for the caveat.
import { facultyKey } from "./faculties.js";

export const FACULTY_PLACE = {
  "Faculty of Administration": { place: "f_admin", name: "Faculty of Administration" },
  "Faculty of Agriculture": { place: "f_agric", name: "Faculty of Agriculture" },
  "Faculty of Arts": { place: "f_arts", name: "Faculty of Arts" },
  "Faculty of Basic Medical Sciences": { place: "f_health", name: "College of Health Sciences" },
  "Faculty of Basic Clinical Sciences": { place: "f_health", name: "College of Health Sciences" },
  "Faculty of Clinical Sciences": { place: "f_health", name: "College of Health Sciences" },
  "Faculty of Computing Science & Engineering": { place: "f_cs", name: "Faculty of Computer Science" },
  "Faculty of Dentistry": { place: "f_health", name: "College of Health Sciences" },
  "Faculty of Education": { place: "f_education", name: "Faculty of Education" },
  "Faculty of Environmental Design and Management": { place: "f_edm", name: "Environmental Design and Management" },
  "Faculty of Law": { place: "f_law", name: "Faculty of Law" },
  "Faculty of Pharmacy": { place: "f_pharmacy", name: "Faculty of Pharmacy" },
  "Faculty of Science": { place: "f_science", name: "Faculty of Science" },
  "Faculty of Social Sciences": { place: "f_social", name: "Faculty of Social Sciences" },
  "Faculty of Technology": { place: "f_technology", name: "Faculty of Technology" },
};
// Older databases and tests use the short names ("Science"); facultyKey() maps every spelling to one key, as the course and job rules do.
const BY_KEY = Object.fromEntries(Object.entries(FACULTY_PLACE).map(([name, v]) => [facultyKey(name), v]));
/** { place, name } of the building a student of this faculty attends, or null for a faculty we do not know. */
export const facultyHome = (facultyName) => FACULTY_PLACE[facultyName] ?? BY_KEY[facultyKey(facultyName)] ?? null;
/** Every place id that is some faculty's building (for the interior hubs). */
export const FACULTY_PLACE_IDS = new Set(Object.values(FACULTY_PLACE).map((f) => f.place).concat(["f_arts_b2", "f_arts_b3", "f_pharmacy_new"]));
/** Arts and Pharmacy have more than one block: any block of your own faculty counts. */
const SIBLINGS = { f_arts: ["f_arts", "f_arts_b2", "f_arts_b3"], f_pharmacy: ["f_pharmacy", "f_pharmacy_new"] };
export const isOwnFacultyPlace = (facultyName, placeId) => { const h = facultyHome(facultyName); return !!h && (SIBLINGS[h.place] ?? [h.place]).includes(placeId); };

// ---- the timetable on the game clock ----
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The day of the game week (0 = Monday) and the minute of the day, from the in-game day number and the day's start (ms). */
export const dayOfWeek = (dayNumber) => (((dayNumber - 1) % 7) + 7) % 7;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const clockText = hhmm;

export const TEACHING = { from: 8 * 60, to: 18 * 60 };          // tests and exams are sat between 08:00 and 18:00
export const ATTEND = { window: 6 * 60, cap: 20 * 60 };          // a lecture admits students for 6 game hours from its slot (never past 20:00)

/** "Tue 10AM" -> { weekday: 1, from: 600, to: 960 } (the lecture starts at `from`; late students are let in until `to`). */
export function classWindow(slot) {
  const m = /^(Mon|Tue|Wed|Thu|Fri) (\d{1,2})(AM|PM)$/.exec(slot ?? ""); if (!m) return null;
  const h = (Number(m[2]) % 12) + (m[3] === "PM" ? 12 : 0), from = h * 60;
  return { weekday: WEEKDAYS.indexOf(m[1]), from, to: Math.min(ATTEND.cap, from + ATTEND.window) };
}
/** Whether a course can be attended at this moment: { open, why }. */
export function classOpen(slot, weekday, minute) {
  const w = classWindow(slot); if (!w) return { open: false, why: "This course has no timetable slot." };
  if (weekday !== w.weekday) return { open: false, why: `${slot.split(" ")[0]} is the lecture day.` };
  if (minute < w.from) return { open: false, why: `The lecture starts at ${hhmm(w.from)}.` };
  if (minute >= w.to) return { open: false, why: `The lecture has ended (students were admitted until ${hhmm(w.to)}).` };
  return { open: true, why: null };
}
export const teachingOpen = (minute) => minute >= TEACHING.from && minute < TEACHING.to;
export const teachingWhy = (minute, what) => (minute < TEACHING.from ? `The ${what} opens at ${hhmm(TEACHING.from)}.` : minute >= TEACHING.to ? `The ${what} is closed for the day (open ${hhmm(TEACHING.from)} to ${hhmm(TEACHING.to)}).` : null);