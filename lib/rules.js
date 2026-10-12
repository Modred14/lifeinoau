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

// Weekly rent in naira, for display only. Mirrors RENT in lib/tick.js, which is what actually charges the player.
export const HOSTEL_RENT = { "Off-campus": 6000, Ojaja: 15000 };
export const SCHOOL_HOSTEL_RENT = 2000;
export const rentOf = (hostel) => HOSTEL_RENT[hostel] ?? SCHOOL_HOSTEL_RENT;