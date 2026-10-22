// lib/profileRules.js
// The rules for editing a player's own profile. Pure functions (no database), shared by the server and the Settings screen, so the screen warns about exactly what the server will refuse.
import { schoolHalls } from "./rules.js";

export const NAME_RE = /^[A-Za-z0-9 _.-]{3,20}$/; // the same rule as creating a character (src/app/api/character/route.js)
export const NAME_RULE = "3 to 20 letters, numbers, spaces, dots, dashes or underscores.";
export const RENAME_COOLDOWN_MS = 7 * 24 * 3600 * 1000; // a name can be changed once a week, so nobody can dodge a reputation or pose as someone else by hopping names
export const cleanName = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
export const nameError = (name) => (NAME_RE.test(name) ? null : "Name must be 3-20 letters, numbers or spaces.");

/** A school hall keeps its kind and price when the player's gender changes: Awo and Moremi are the small halls, Angola and Mozambique the big ones, and so on.
 *  The pairs sit at the same position in each gender's list, so a class that may live in a hall may live in its pair. A private home never changes. */
const HALL_PAIR = { M: { Awo: "Moremi", Fajuyi: "Akintola", Angola: "Mozambique", ETF: "Alumni" }, F: { Moremi: "Awo", Akintola: "Fajuyi", Mozambique: "Angola", Alumni: "ETF" } };
export function hostelForGender(hostel, gender) {
  if (!hostel || schoolHalls(gender).includes(hostel)) return hostel; // already a hall of this gender, or a private home
  const from = gender === "F" ? "M" : "F"; // the hall belongs to the other gender: find its pair
  return HALL_PAIR[from][hostel] ?? hostel;
}

/** Why this player cannot change gender right now (a sentence), or null if they can. `facts` = { sleeping, romantic, pregnant } read from the database. */
export function genderChangeBlock({ sleeping, romantic, pregnant }) {
  if (sleeping) return "Wake up first. You cannot change your look while you are asleep.";
  if (pregnant) return "You cannot change gender while a pregnancy or a child's care is part of your story. Everything else about your look can still change.";
  if (romantic) return "End your relationship (babe, fiance or sneaky link) first. Those depend on your gender. Everything else about your look can still change.";
  return null;
}

export const RELATION_KINDS_BLOCKING = ["SNEAKY", "BABE", "ENGAGED"];
