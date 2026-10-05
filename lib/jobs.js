// lib/jobs.js
// Jobs: repeatable shifts that pay more as you gain experience. Fictional numbers tuned against the weekly allowance.
import { clamp } from "./engine.js";
const N = (n) => BigInt(n) * 100n;
const CS = ["Computer Science", "Technology"];
export const JOBS = {
  vendor:          { title: "Vendor",          minLevel: 100, pay: [6_000, 12_000],  energy: 15 },
  barber:          { title: "Barber",          minLevel: 100, pay: [8_000, 16_000],  energy: 18 },
  hairdresser:     { title: "Hairdresser",     minLevel: 100, pay: [8_000, 18_000],  energy: 18 },
  lash_tech:       { title: "Lash Tech",       minLevel: 100, pay: [10_000, 20_000], energy: 18 },
  nail_tech:       { title: "Nail Tech",       minLevel: 100, pay: [9_000, 18_000],  energy: 18 },
  content_creator: { title: "Content Creator", minLevel: 100, pay: [4_000, 26_000],  energy: 15, pop: 1 }, // hit or miss
  hypeman:         { title: "Hypeman",         minLevel: 100, pay: [8_000, 20_000],  energy: 20, pop: 1 },
  photographer:    { title: "Photographer",    minLevel: 200, pay: [12_000, 26_000], energy: 20 },
  dj:              { title: "DJ",              minLevel: 200, pay: [15_000, 32_000], energy: 22, pop: 1 },
  freelancer:      { title: "Freelancer",      minLevel: 200, pay: [12_000, 30_000], energy: 20 },
  developer:       { title: "Developer",       minLevel: 200, pay: [18_000, 38_000], energy: 22, faculties: [...CS, "Science"] },
  tech_bro:        { title: "Tech Bro",        minLevel: 300, pay: [25_000, 50_000], energy: 25, faculties: CS },
};
export const MAX_SHIFTS_PER_WEEK = 5;
export const SHIFTS_PER_LEVEL = 5, MAX_JOB_LEVEL = 10;
export const jobLevel = (xp) => Math.min(MAX_JOB_LEVEL, Math.floor(xp / SHIFTS_PER_LEVEL));
export function canTake(job, level, faculty) {
  if (level < job.minLevel) return `Needs ${job.minLevel}L.`;
  if (job.faculties && !job.faculties.includes(faculty)) return `Needs one of: ${job.faculties.join(", ")}.`;
  return null;
}
/** One shift. Pay = base roll x (1 + 12% per job level). Returns { error } or { payKobo, stats, xp }. */
export function resolveShift(c, job, xp, roll) {
  if (c.energy < job.energy) return { error: "You are too tired for a shift." };
  const pay = Math.round(roll(job.pay[0], job.pay[1]) * (1 + 0.12 * jobLevel(xp)));
  return { payKobo: N(pay), xp: xp + 1, stats: { energy: clamp(c.energy - job.energy), popularity: clamp(c.popularity + (job.pop ?? 0)) } };
}
