// lib/rules.js
export const PERSONALITIES = ["Party Animal", "Introvert", "Extrovert", "Shana"];
const HOSTELS = { M: ["Awo", "Fajuyi", "Angola", "ETF"], F: ["Moremi", "Mozambique", "Akintola", "Alumni"] };
export const STARTING_ALLOWANCE = { NEPO: 50_000_000n, MAPO: 10_000_000n, LAPO: 3_000_000n }; // kobo
/** Single source of truth for where a player may live. */
export function allowedHostels(cls, gender, level) {
  const h = HOSTELS[gender];
  if (cls === "NEPO") return ["Ojaja", "Off-campus"];
  if (cls === "MAPO") return [...h.slice(0, 3), "Off-campus", ...(level >= 200 ? ["Ojaja"] : [])];
  return [...h, "Off-campus"]; // LAPO: school hostels
}
export const startingTransport = (cls) => (cls === "NEPO" ? "Daddy Benz" : "Trek");

// Player-to-player money: limits and a fee (a money sink) to blunt funnelling and alt-account abuse.
export const P2P = { minNaira: 100, maxNaira: 5_000_000, dailyKobo: 1_000_000_000n, feePercent: 2n };
export const feeFor = (amountKobo) => (BigInt(amountKobo) * P2P.feePercent) / 100n;
export const cleanText = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

// ---- Hostel rent: a price PER SESSION (12 game weeks), in naira. tick.js collects it in 12 weekly instalments that add up exactly to it. ----
export const SESSION_WEEKS = 12; // same as SESSION_WEEKS in lib/engine.js (kept here so the browser need not load the engine)
export const SESSION_RENT = { school: 50_000, Ojaja: 310_000, "Off-campus": 450_000 };
export const sessionRentOf = (hostel) => SESSION_RENT[hostel] ?? SESSION_RENT.school;
/** The average a week of that rent costs (session price / 12), in naira. For "what you keep each week" figures only. */
export const rentOf = (hostel) => Math.round(sessionRentOf(hostel) / SESSION_WEEKS);
/** What is actually collected in week `i` of a session (0 to 11), in kobo. The 12 instalments sum to exactly the session price. */
export const rentInstalmentKobo = (hostel, i) => {
  const fee = BigInt(sessionRentOf(hostel)) * 100n, k = BigInt(Math.min(SESSION_WEEKS - 1, Math.max(0, i)));
  return (fee * (k + 1n)) / BigInt(SESSION_WEEKS) - (fee * k) / BigInt(SESSION_WEEKS);
};

// ---- Who shares a room. A range per kind of hostel; each player gets a fixed number inside it (see occupantsFor). ----
export const OCCUPANCY = { school: [6, 8], bigSchool: [8, 10], Ojaja: [2, 2], "Off-campus": [1, 2] };
export const occupancyKey = (hostel) => (hostel === "Ojaja" || hostel === "Off-campus" ? hostel : hostel === "Angola" || hostel === "Mozambique" ? "bigSchool" : "school");
export const occupancyRange = (hostel) => OCCUPANCY[occupancyKey(hostel)];
/** How many people sleep in this player's room (the player included). Same answer every time for the same player. */
export function occupantsFor(hostel, seed = "") {
  const [lo, hi] = occupancyRange(hostel); let h = 2166136261; for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return lo + (h % (hi - lo + 1));
}
export const occupancyText = (hostel) => { const [lo, hi] = occupancyRange(hostel); return lo === hi ? `${lo} in a room` : `${lo} to ${hi} in a room`; };
export const isSchoolHostel = (hostel) => hostel !== "Ojaja" && hostel !== "Off-campus";