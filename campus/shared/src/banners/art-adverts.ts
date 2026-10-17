import type { GameTime } from "../clock";
import { BIG_PRINT, POSTER_ONLY, SMALL_PRINT, makeArt, type ArtEntry, type PaletteName } from "./art";
import { hash3, pick } from "./seed";
import type { BannerZone } from "./types";

const STUDY: readonly BannerZone[] = ["faculty", "hostel", "union"];
const BUSY: readonly BannerZone[] = ["union", "gate", "commerce", "hostel", "road"];

export const ADVERTS: readonly ArtEntry[] = [
  makeArt("advert", "mth101", "MTH 101 tutorial", ["4pm daily at AUD II", "First class is free"], "yellow", { footer: "Bright Scholars Tutors", zones: STUDY, weight: 2 }),
  makeArt("advert", "phy101", "PHY 101 crash class", ["Saturday 9am, HSLT A", "Past questions solved"], "blue", { footer: "Apex Tutorial Centre", zones: STUDY }),
  makeArt("advert", "chm101", "CHM 101 past questions", ["2015 to date with answers", "N500 per copy"], "white", { footer: "Scholars Bookshop, SUB", zones: STUDY }),
  makeArt("advert", "gst", "GST summary class", ["Use of English in 3 days", "6pm at the 1000 Seater LT"], "orange", { footer: "Top Grade Tutors", zones: STUDY }),
  makeArt("advert", "csc101", "Learn to code this semester", ["Python from zero", "Weekends, 10am"], "black", { footer: "Byte Camp Ife", zones: STUDY }),
  makeArt("advert", "eco101", "ECO 101 weekend class", ["Graphs made easy", "Bring your friend, pay for one"], "teal", { footer: "Bright Scholars Tutors", zones: STUDY }),
  makeArt("advert", "project", "Project and seminar help", ["Typing, analysis and binding", "Ready in 48 hours"], "paper", { footer: "Ask at SUB shop 9", kinds: SMALL_PRINT }),
  makeArt("advert", "paykolo", "PayKolo", ["Send money free on campus", "Download the app today"], "purple", { footer: "PayKolo. Money wey no stress", kinds: BIG_PRINT, zones: BUSY, weight: 2 }),
  makeArt("advert", "okra-bank", "Okra Bank student account", ["Open with your ID card", "No minimum balance"], "green", { footer: "Okra Bank", zones: BUSY, weight: 1.5 }),
  makeArt("advert", "zapcash", "ZapCash data deals", ["1GB for N250", "Airtime at 3 percent off"], "orange", { footer: "Dial the ZapCash code", zones: BUSY }),
  makeArt("advert", "ajo-circle", "Ajo Circle", ["Save small small with your roommates", "Collect at the end of the month"], "teal", { footer: "Ajo Circle app", zones: BUSY }),
  makeArt("advert", "meridian", "Meridian Trust Bank", ["Student desk now open at the SUB", "Weekdays 9am to 4pm"], "blue", { footer: "Meridian Trust Bank", kinds: BIG_PRINT, zones: BUSY, weight: 1.5 }),
  makeArt("advert", "kudibox", "KudiBox POS", ["Withdraw cash at any buka", "N100 charge per N5,000"], "yellow", { footer: "Look for the KudiBox sticker", zones: BUSY }),
  makeArt("advert", "teejay", "Tee Jay Business Centre", ["Typing, printing, photocopy, binding", "Photocopy N10 per page"], "white", { footer: "SUB shop 14", zones: ["union", "faculty", "hostel"], weight: 1.5 }),
  makeArt("advert", "divine-favour", "Divine Favour Computers", ["Online registration and scanning", "Lamination while you wait"], "sky", { footer: "Opposite the car park", zones: ["union", "hostel", "commerce"] }),
  makeArt("advert", "sharp-prints", "Sharp Sharp Prints", ["Passport photo in 2 minutes", "Flex banners and T shirts"], "red", { footer: "Beside New Buka", zones: BUSY }),
  makeArt("advert", "phone-repair", "Fix It Phone Repairs", ["Screen, battery, charging port", "Same day collection"], "black", { footer: "SUB shop 21", zones: BUSY }),
  makeArt("advert", "laundry", "Mama Tee Laundry", ["Wash and iron, N200 per cloth", "Pick up from your hall"], "pink", { footer: "Drop your bag with the porter", zones: ["hostel"] }),
  makeArt("advert", "barber", "Smooth Cuts barbing salon", ["Low cut N500", "Open 8am to 9pm"], "black", { footer: "Hall shopping complex", zones: ["hostel", "union"], kinds: ["aframe", "board", "flex"] }),
  makeArt("advert", "braids", "Hair by Ronke", ["Braids, wigs and fixing", "Book before the weekend rush"], "pink", { footer: "Ask at the common room", zones: ["hostel"], kinds: SMALL_PRINT }),
  makeArt("advert", "shawarma", "New shawarma spot at the SUB", ["Double sausage N1,500", "Open till 10pm"], "orange", { footer: "Crunch Corner", zones: ["union", "hostel", "commerce"] }),
  makeArt("advert", "tshirts", "Faculty T shirts and hoodies", ["Order in bulk for your class", "Ready in one week"], "purple", { footer: "Sharp Sharp Prints", kinds: SMALL_PRINT }),
  makeArt("advert", "room-to-let", "Room to let", ["Self contain off campus", "Water and light steady"], "paper", { footer: "Ask for the caretaker", kinds: POSTER_ONLY, weight: 1.5 }),
  makeArt("advert", "bed-space", "Bed space available", ["One space in a room of four", "Serious students only"], "paper", { footer: "Leave a note with the porter", kinds: POSTER_ONLY, weight: 1.5 }),
  makeArt("advert", "roommate", "Roommate wanted", ["Shared flat near the gate", "Split rent in two"], "paper", { footer: "Final year student preferred", kinds: POSTER_ONLY }),
  makeArt("advert", "sublet", "Room for the long break", ["Three months, pay once", "Fan and reading table inside"], "paper", { footer: "Ask at Block C common room", kinds: POSTER_ONLY }),
  makeArt("advert", "fridge", "For sale: table top fridge", ["Used for one session", "Price is slightly negotiable"], "paper", { footer: "Graduating student", kinds: POSTER_ONLY }),
  makeArt("advert", "textbooks", "Used textbooks for 100 level", ["Physics, Chemistry, Maths", "Half the bookshop price"], "paper", { footer: "Check the notice board weekly", kinds: POSTER_ONLY }),
];

const BIRTHDAY_NAMES: readonly string[] = ["Tomiwa", "Chidinma", "Abdulrahman", "Ebunoluwa", "Kelechi", "Zainab", "Oluwaseun", "Ifeoma", "Damilare", "Halima", "Tobiloba", "Nkechi", "Babatunde", "Aisha", "Ayomide", "Emeka"];
const BIRTHDAY_NICKNAMES: readonly string[] = ["Mr Calculus", "Class Captain", "Fine Girl", "Baba Tutorial", "Sharp Guy", "The Scholar", "Madam President", "Oga Prefect"];
const BIRTHDAY_FROM: readonly string[] = ["From your roommates", "From the whole class", "From Block B family", "From your padi dem", "From the fellowship choir", "From the tutorial squad"];
const BIRTHDAY_PALETTES: readonly PaletteName[] = ["pink", "purple", "black", "blue", "orange"];
const BIRTHDAYS_PER_DAY = 3;

export function birthdays(t: GameTime): ArtEntry[] {
  const out: ArtEntry[] = [];
  const used = new Set<string>();
  for (let k = 0; k < BIRTHDAYS_PER_DAY; k++) {
    const name = pick(BIRTHDAY_NAMES, hash3(t.dayIndex, k, 71));
    if (used.has(name)) continue;
    used.add(name);
    out.push(
      makeArt("advert", `birthday-${t.dayIndex}-${k}`, `Happy birthday ${name}`, [pick(BIRTHDAY_NICKNAMES, hash3(t.dayIndex, k, 72)), "More wins this year"], pick(BIRTHDAY_PALETTES, hash3(t.dayIndex, k, 73)), {
        footer: pick(BIRTHDAY_FROM, hash3(t.dayIndex, k, 74)),
        kinds: ["flex", "board"],
        zones: ["hostel", "union", "faculty"],
      }),
    );
  }
  return out;
}
