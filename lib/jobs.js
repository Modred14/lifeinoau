// lib/jobs.js
import { facultyKey } from "./faculties.js";
// Jobs: repeatable shifts that pay more as you gain experience. Fictional numbers tuned against the weekly allowance.
import { clamp } from "./engine.js";
import { gameMinuteText, gameZoneLabel } from "./campus-clock.js"; // every time of day below is on the ONE game clock (West Africa Time), see lib/campus-clock.js
import { ACTIVITY_MS, ACTIVITY_SECONDS } from "./activityTime.js";
const N = (n) => BigInt(n) * 100n;
const CS = ["Computer Science", "Technology"];
export const JOBS = {
  vendor:          { title: "Vendor",          minLevel: 100, pay: [6_000, 12_000],  energy: 15, shifts: ["morning", "night"], hours: 3 },
  barber:          { title: "Barber",          minLevel: 100, pay: [8_000, 16_000],  energy: 18, shifts: ["morning"], hours: 3 },
  hairdresser:     { title: "Hairdresser",     minLevel: 100, pay: [8_000, 18_000],  energy: 18, shifts: ["morning"], hours: 3 },
  lash_tech:       { title: "Lash Tech",       minLevel: 100, pay: [10_000, 20_000], energy: 18, shifts: ["morning"], hours: 3 },
  nail_tech:       { title: "Nail Tech",       minLevel: 100, pay: [9_000, 18_000],  energy: 18, shifts: ["morning"], hours: 3 },
  content_creator: { title: "Content Creator", minLevel: 100, pay: [4_000, 26_000],  energy: 15, shifts: ["morning", "night"], hours: 2, pop: 1 }, // hit or miss
  hypeman:         { title: "Hypeman",         minLevel: 100, pay: [8_000, 20_000],  energy: 20, shifts: ["night"], hours: 3, pop: 1 },
  photographer:    { title: "Photographer",    minLevel: 200, pay: [12_000, 26_000], energy: 20, shifts: ["morning", "night"], hours: 4 },
  dj:              { title: "DJ",              minLevel: 200, pay: [15_000, 32_000], energy: 22, shifts: ["night"], hours: 4, pop: 1 },
  freelancer:      { title: "Freelancer",      minLevel: 200, pay: [12_000, 30_000], energy: 20, shifts: ["morning", "night"], hours: 4 },
  developer:       { title: "Developer",       minLevel: 200, pay: [18_000, 38_000], energy: 22, shifts: ["morning", "night"], hours: 5, faculties: [...CS, "Science"] },
  tech_bro:        { title: "Tech Bro",        minLevel: 300, pay: [25_000, 50_000], energy: 25, shifts: ["morning", "night"], hours: 5, faculties: CS },
};
export const MAX_SHIFTS_PER_WEEK = 5; // one in-game week is 7 in-game days: at most one shift a day, five in a week
export const SHIFTS_PER_LEVEL = 5, MAX_JOB_LEVEL = 10;
export const jobLevel = (xp) => Math.min(MAX_JOB_LEVEL, Math.floor(xp / SHIFTS_PER_LEVEL));
export function canTake(job, level, faculty) {
  if (level < job.minLevel) return `Needs ${job.minLevel}L.`;
  if (job.faculties && !job.faculties.includes(facultyKey(faculty))) return `Needs one of: ${job.faculties.join(", ")}.`;
  return null;
}

// ---------- Shifts ----------
// Everything is in GAME minutes on the synchronised game clock (1:1 with real time, see lib/campus-clock.js).
// A shift can be clocked into during its window; it then runs for one activity length (ACTIVITY_SECONDS, 15 s). The pay is rolled when the shift starts (so a refresh
// cannot re-roll it) and released once, when the shift is claimed after it has ended.
export const SHIFT_TYPES = {
  morning: { label: "Morning shift", from: 6 * 60, to: 11 * 60, payMult: 1, energyMult: 1 },       // clock in 06:00 to 11:00
  night: { label: "Night shift", from: 18 * 60, to: 23 * 60, payMult: 1.25, energyMult: 1.15 },   // clock in 18:00 to 23:00, pays a premium and tires you more
};
/** The story length of the job (hours on the job, shown as flavour). The shift you actually work lasts shiftMs(), one activity length. */
export const shiftMinutes = (job) => job.hours * 60;
export const shiftMs = () => ACTIVITY_MS;
export const SHIFT_SECONDS = ACTIVITY_SECONDS;
export const shiftEnergy = (job, shift) => Math.ceil(job.energy * SHIFT_TYPES[shift].energyMult);
export const windowText = (shift) => `${gameMinuteText(SHIFT_TYPES[shift].from)} to ${gameMinuteText(SHIFT_TYPES[shift].to)} ${gameZoneLabel()}`;
// The minute of the day a shift is checked against is gameMinuteOfDay(now) from lib/campus-clock.js: the same clock the phone shows. There is no second one here.

/** Pay for a shift: base roll x (1 + 12% per job level) x the shift's premium. Returns naira (whole). */
export function rollPay(job, xp, shift, roll) {
  return Math.round(roll(job.pay[0], job.pay[1]) * (1 + 0.12 * jobLevel(xp)) * SHIFT_TYPES[shift].payMult);
}

/**
 * Why this shift cannot be started right now, or null. Pure: the service passes in what it read from the database.
 *   ctx = { minute, energy, activeShift, lastShiftDay, day, weekShifts, busy }   (busy: a reason string when asleep / in custody / mid-hustle)
 */
export function shiftBlock(job, shift, ctx) {
  const t = SHIFT_TYPES[shift];
  if (!t || !job.shifts.includes(shift)) return `This job has no ${shift} shift.`;
  if (ctx.busy) return ctx.busy;
  if (ctx.activeShift) return "You are already on a shift.";
  if (ctx.lastShiftDay === ctx.day) return "You have already worked today. Next shift opens tomorrow.";
  if (ctx.weekShifts >= MAX_SHIFTS_PER_WEEK) return `You can work ${MAX_SHIFTS_PER_WEEK} shifts a week.`;
  if (ctx.minute < t.from) return `The ${shift} shift opens at ${gameMinuteText(t.from)}.`;
  if (ctx.minute >= t.to) return `The ${shift} shift is closed for today (clock in ${windowText(shift)}).`;
  if (ctx.energy < shiftEnergy(job, shift)) return `You need ${shiftEnergy(job, shift)} energy for this shift.`;
  return null;
}

/** One shift, as it would start now. Returns { error } or { payNaira, energyCost, endsAtMs }. */
export function beginShift(c, job, xp, shift, nowMs, roll) {
  const energyCost = shiftEnergy(job, shift);
  if (c.energy < energyCost) return { error: `You need ${energyCost} energy for this shift.` };
  return { payNaira: rollPay(job, xp, shift, roll), energyCost, endsAtMs: nowMs + shiftMs(job) };
}

/** Kept for the economy simulation: one shift of the job as an old-style roll. */
export function resolveShift(c, job, xp, roll) {
  if (c.energy < job.energy) return { error: "You are too tired for a shift." };
  const pay = Math.round(roll(job.pay[0], job.pay[1]) * (1 + 0.12 * jobLevel(xp)));
  return { payKobo: N(pay), xp: xp + 1, stats: { energy: clamp(c.energy - job.energy), popularity: clamp(c.popularity + (job.pop ?? 0)) } };
}