// lib/classes.js
// Everything the UI says about LAPO, MAPO and NEPO, derived from the real rules so the screens can't drift from the game.
// Safe to import in the browser (no node-only modules).
import { STARTING_ALLOWANCE, startingTransport, rentOf } from "./rules.js";

export const CLASS_ORDER = ["LAPO", "MAPO", "NEPO"];
// Mirrors drawClass() in lib/rng.js, which runs on the server only.
export const ODDS = { LAPO: 30, MAPO: 60, NEPO: 10 };
export const SAFE_HUSTLE = [8000, 25000]; // ACTIONS.hustle in lib/engine.js
export const PARENT_GIFT = { chancePct: 15, shareOfAllowancePct: 20 }; // resolveCall in lib/engine.js

export const CLASS_INFO = {
  LAPO: { name: "LAPO", color: "var(--lapo)", tagline: "Self-made hits different.", play: "Every naira has a job, and a good hustle week can nearly double what home sends you." },
  MAPO: { name: "MAPO", color: "var(--mapo)", tagline: "Comfortable. Your family covers the basics.", play: "Rent barely dents your allowance, so you can afford a few mistakes." },
  NEPO: { name: "NEPO", color: "var(--nepo)", tagline: "Born into money. Do not waste it.", play: "Cash is rarely your problem. Staying out of trouble is." },
};

export const allowanceOf = (cls) => Number(STARTING_ALLOWANCE[cls] / 100n); // kobo to naira
export const fmtN = (n) => "₦" + Number(n).toLocaleString("en-NG");
export const range = (a, b) => (a === b ? fmtN(a) : `${fmtN(a)} to ${fmtN(b)}`);

/** The full list of what a class comes with, for the roll result screen. `hostels` is what the server says this player may choose from. */
export function classPackage(cls, hostels = []) {
  const allowance = allowanceOf(cls), rents = (hostels.length ? hostels : ["Off-campus"]).map(rentOf);
  const rentMin = Math.min(...rents), rentMax = Math.max(...rents);
  const gift = Math.round((allowance * PARENT_GIFT.shareOfAllowancePct) / 100);
  const [hLo, hHi] = SAFE_HUSTLE;
  return {
    cls, allowance, rentMin, rentMax, keepMin: allowance - rentMax, keepMax: allowance - rentMin, gift,
    hustlePct: [Math.round((hLo / allowance) * 100), Math.round((hHi / allowance) * 100)],
    transport: startingTransport(cls), hostels, odds: ODDS[cls],
    ojajaAt200: cls === "MAPO" && !hostels.includes("Ojaja"),
  };
}