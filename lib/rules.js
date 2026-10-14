// lib/rules.js
export const PERSONALITIES = ["Party Animal", "Introvert", "Extrovert", "Shana"];
const HOSTELS = { M: ["Awo", "Fajuyi", "Angola", "ETF"], F: ["Moremi", "Mozambique", "Akintola", "Alumni"] };
/** The two flats a player can rent from the Housing app on the phone (they are not offered when the character is first created). */
export const FLATS = ["1-Bedroom Flat", "2-Bedroom Flat"];
/** Every home that is not a school hall. */
export const PRIVATE_HOMES = ["Off-campus", "Ojaja", ...FLATS];
/** The school halls for this gender. */
export const schoolHalls = (gender) => HOSTELS[gender] ?? [];
/** Housing app: any player may rent any of these (the price is the only gate), or go back to a hall of their own gender. */
export const canLiveIn = (gender, hostel) => PRIVATE_HOMES.includes(hostel) || schoolHalls(gender).includes(hostel);
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
export const SESSION_RENT = { school: 50_000, Ojaja: 310_000, "Off-campus": 450_000, "1-Bedroom Flat": 600_000, "2-Bedroom Flat": 900_000 };
export const sessionRentOf = (hostel) => (Object.hasOwn(SESSION_RENT, hostel) ? SESSION_RENT[hostel] : SESSION_RENT.school);
/** The average a week of that rent costs (session price / 12), in naira. For "what you keep each week" figures only. */
export const rentOf = (hostel) => Math.round(sessionRentOf(hostel) / SESSION_WEEKS);
/** What is actually collected in week `i` of a session (0 to 11), in kobo. The 12 instalments sum to exactly the session price. */
export const rentInstalmentKobo = (hostel, i) => {
  const fee = BigInt(sessionRentOf(hostel)) * 100n, k = BigInt(Math.min(SESSION_WEEKS - 1, Math.max(0, i)));
  return (fee * (k + 1n)) / BigInt(SESSION_WEEKS) - (fee * k) / BigInt(SESSION_WEEKS);
};

// ---- Who shares a room. A range per kind of hostel; each player gets a fixed number inside it (see occupantsFor). ----
export const OCCUPANCY = { school: [6, 8], bigSchool: [8, 10], Ojaja: [2, 2], "Off-campus": [1, 2], "1-Bedroom Flat": [1, 2], "2-Bedroom Flat": [2, 4] };
export const occupancyKey = (hostel) => (PRIVATE_HOMES.includes(hostel) ? hostel : hostel === "Angola" || hostel === "Mozambique" ? "bigSchool" : "school");
export const occupancyRange = (hostel) => OCCUPANCY[occupancyKey(hostel)];
/** How many people sleep in this player's room (the player included). Same answer every time for the same player. */
export function occupantsFor(hostel, seed = "") {
  const [lo, hi] = occupancyRange(hostel); let h = 2166136261; for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return lo + (h % (hi - lo + 1));
}
export const occupancyText = (hostel) => { const [lo, hi] = occupancyRange(hostel); return lo === hi ? `${lo} in a room` : `${lo} to ${hi} in a room`; };
export const isSchoolHostel = (hostel) => !PRIVATE_HOMES.includes(hostel);

/** One line about each home, for the hostel picker and the Housing app. */
export function aboutHome(hostel) {
  if (isSchoolHostel(hostel)) return "Iron double bunks and wardrobes. No kitchen, no TV, and the room gets rough fast.";
  if (hostel === "Ojaja") return "One bedroom with single beds and wardrobe, a kitchen, a toilet and a passage. No TV. Kept clean.";
  if (hostel === "Off-campus") return "One bedroom with single beds and wardrobe, a kitchen, a toilet and a passage, and a TV. Kept clean.";
  if (hostel === "1-Bedroom Flat") return "A bedroom with a double bed, a sitting room, a kitchen, a toilet, a store room and a passage. Kept clean.";
  return "Two bedrooms, a sitting room, a dining area, a kitchen, a toilet and a store room. The best home in the game. Kept clean.";
}

/**
 * What moving into `to` costs RIGHT NOW. Rent is paid weekly, so the weeks of this session that have not been collected yet
 * (week+1 up to the session's last week) are paid up front at the new home's rate. Any of those weeks already paid up front for the
 * home you are leaving (rentPaidUntil) are given back, so moving around never costs more than the difference.
 * `net` above zero is paid by the player, below zero is paid back to them. `prepaidUntil` is the last week now paid for (0 for none).
 */
export function movePricing({ from, to, week, sessionStart, paidUntil = 0 }) {
  const last = sessionStart + SESSION_WEEKS - 1;
  let charge = 0n, refund = 0n, weeks = 0;
  for (let w = week + 1; w <= last; w++) {
    charge += rentInstalmentKobo(to, w - sessionStart); weeks++;
    if (w <= paidUntil) refund += rentInstalmentKobo(from, w - sessionStart);
  }
  return { weeks, chargeKobo: charge, refundKobo: refund, netKobo: charge - refund, prepaidUntil: weeks ? last : 0 };
}