// lib/parties.js
// Parties are DERIVED from (venue, week): no cron job and no party table to keep in sync. Attendance lives in the database.
import { clamp } from "./engine.js";
const N = (n) => BigInt(n) * 100n;
export const VENUES = { "0203": { base: 10_000, cap: 600 }, "Royal Divas": { base: 15_000, cap: 350 }, "Quantum": { base: 20_000, cap: 500 } };
const THEMES = ["Afrobeats Night", "Throwback Thursday", "Amapiano Overload", "All White", "Neon Glow", "Campus Rave", "Silent Disco", "Owambe Vibes"];
const DJS = ["DJ Kolade", "DJ Sade Spins", "DJ Bamidele", "DJ Zinny", "MC Ayo", "DJ Femi Fire"]; // fictional
const NIGHTS = ["Thursday 9PM", "Friday 10PM", "Saturday 10PM"];

const seed = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const prng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export function partyFor(venue, week) {
  const v = VENUES[venue]; if (!v) return null;
  const r = prng(seed(`${venue}:${week}`)), pick = (a) => a[Math.floor(r() * a.length)];
  const price = Math.round((v.base * (0.8 + r() * 0.7)) / 500) * 500; // 80%-150% of base, nearest N500
  return { venue, theme: pick(THEMES), headliner: pick(DJS), night: pick(NIGHTS), priceKobo: N(price), capacity: Math.round(v.cap * (0.8 + r() * 0.4)) };
}

/** What happens on the night. Returns final clamped stats, an optional extra cost, and a headline. */
export function resolveNight(c, roll) {
  const introvert = c.personalities.includes("Introvert"), animal = c.personalities.includes("Party Animal"), extro = c.personalities.includes("Extrovert");
  const energyCost = introvert ? 25 : 20;
  if (c.energy < energyCost) return { error: "You are too tired to go out. Rest first." };
  let happy = 8 - (introvert ? 3 : 0), pop = 4 + (animal ? 2 : 0) + (extro ? 2 : 0) - (introvert ? 1 : 0), susp = 0, health = 0, cost = 0n, title, note = null;
  const r = roll(1, 100);
  if (r <= 55) { title = "A great night"; happy += 6; pop += 2; }
  else if (r <= 70) { title = "You met someone"; happy += 9; pop += 2; note = "Someone got your number."; }
  else if (r <= 82) { title = "You overspent on drinks"; cost = N(roll(5_000, 20_000)); }
  else if (r <= 90) { title = "Your phone was stolen"; cost = N(8_000); }
  else if (r <= 96) { title = "Things got rowdy"; pop -= 3; susp += 5; }
  else { title = "QRS raided a spot nearby"; susp += 10; health -= 5; }
  return { title, note, costKobo: cost, stats: { energy: clamp(c.energy - energyCost), happiness: clamp(c.happiness + happy), popularity: clamp(c.popularity + pop),
    suspicion: clamp(c.suspicion + susp), health: clamp(c.health + health) } };
}