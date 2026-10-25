// lib/facultyGuard.js: one place that decides whether a student may attend a class, sit a test or sit an exam RIGHT NOW.
// Every server path that does one of those three things calls this inside its transaction (with the player's row locked), so the
// phone, the faculty panels and a hand-made request all hit the same rules: awake, free, at their own faculty, not mid-shift or mid-hustle,
// and inside the timetable on the synchronised game clock.
import { dayWindow } from "./clock.js";
import { gameMinuteOfDay } from "./campus-clock.js";
import { placeOf } from "./travel.js";
import { isJailed } from "./discipline.js";
import { facultyHome, isOwnFacultyPlace, dayOfWeek, classOpen, teachingWhy, FACULTY_PLACE_IDS } from "./faculty.js";

/** kind: "class" (needs opts.slot) | "test" | "exam". Returns why not, or null. */
export async function academicBlock(tx, c, kind, opts = {}, nowMs = Date.now()) {
  if (c.sleepingSince) return "You are asleep. Wake up first.";
  if (isJailed(c, nowMs)) return "You are in N-QRS custody.";
  const home = facultyHome(c.faculty.name); if (!home) return "Your faculty has no building on the map yet.";
  const here = placeOf(c);
  if (!isOwnFacultyPlace(c.faculty.name, here))
    return FACULTY_PLACE_IDS.has(here) ? `This is not your faculty. You study at ${home.name}.` : `You have to be at your own faculty, ${home.name}, for this.`;
  if (await tx.jobShift.findFirst({ where: { characterId: c.id, status: "ACTIVE" } })) return "You are on a job shift. Finish it first.";
  if (await tx.hustleRun.findFirst({ where: { characterId: c.id, status: "ACTIVE" } })) return "You are in the middle of a hustle.";
  const day = await dayWindow(tx, nowMs), minute = gameMinuteOfDay(nowMs);
  if (kind === "class") { const r = classOpen(opts.slot, dayOfWeek(day.day), minute); return r.open ? null : r.why; }
  return teachingWhy(minute, kind === "exam" ? "examination hall" : "test hall");
}