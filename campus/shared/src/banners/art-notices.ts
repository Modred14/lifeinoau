import type { GameTime } from "../clock";
import { FACULTY_TEAMS, facultyOfWeek } from "../social/faculties";
import { EXAM_DAY, LECTURE_DAYS, REGISTRATION_DAYS } from "../semester";
import { BIG_PRINT, POSTER_ONLY, SMALL_PRINT, WEEKDAYS, makeArt, type ArtEntry, type PaletteName } from "./art";
import { hash3, pick } from "./seed";
import type { BannerZone } from "./types";

const HALLS: readonly BannerZone[] = ["hostel"];
const CLASSES: readonly BannerZone[] = ["faculty", "union"];
const ROADSIDE: readonly BannerZone[] = ["road", "gate", "union", "hostel"];

export const NOTICES: readonly ArtEntry[] = [
  makeArt("notice", "cultism", "Say no to cultism", ["Your future pass any gang", "See something? Report am"], "red", { footer: "Division of Student Affairs", weight: 2 }),
  makeArt("notice", "malpractice", "No to exam malpractice", ["No phone, no chit, no giraffing", "Two cases and you go home"], "white", { footer: "Exams and Records", weight: 2 }),
  makeArt("notice", "id-card", "No ID card, no entry", ["Carry your student ID always"], "blue", { footer: "Security Unit", zones: ["gate", "hostel", "faculty"] }),
  makeArt("notice", "lawn", "Keep off the lawn", ["Use the walkway"], "green", { footer: "Parks and Gardens", kinds: ["aframe", "flex"] }),
  makeArt("notice", "clean", "Keep Ife clean", ["Drop your pure water nylon in the bin"], "teal", { footer: "Environmental Health" }),
  makeArt("notice", "speed", "Drive slow, students dey cross", ["Campus limit is 30 km/h"], "yellow", { footer: "Security Unit", kinds: BIG_PRINT, zones: ROADSIDE, weight: 1.5 }),
  makeArt("notice", "welcome", "Welcome to Great Ife", ["For learning and culture", "Drive carefully"], "green", { kinds: ["billboard"], zones: ["gate"], weight: 12 }),
  makeArt("notice", "welcome-strip", "Welcome to Great Ife", ["Drive carefully"], "green", { kinds: ["cross"], zones: ["gate"], weight: 2 }),
  makeArt("notice", "okada", "Okada riders: use the park", ["No picking on the walkway"], "orange", { footer: "Transport Unit", zones: ROADSIDE }),
  makeArt("notice", "lights-out", "Light out 12am", ["Reading room stays open"], "black", { footer: "Hall Warden", zones: HALLS, weight: 2 }),
  makeArt("notice", "no-cooking", "No cooking in rooms", ["Use the kitchenette", "Hot plate will be seized"], "red", { footer: "Hall Warden", zones: HALLS, weight: 2 }),
  makeArt("notice", "visitors", "Visitors out by 10pm", ["Sign the book at the porter's lodge"], "white", { footer: "Hall Warden", zones: HALLS }),
  makeArt("notice", "squatting", "No squatting", ["Bed space is for the owner only"], "yellow", { footer: "Hall Management", zones: HALLS }),
  makeArt("notice", "water", "Water runs 6am to 8am", ["Fetch early and keep the queue"], "sky", { footer: "Hall Works Unit", zones: HALLS }),
  makeArt("notice", "sanitation", "Hall sanitation on Saturday", ["7am sharp", "Every room must join"], "green", { footer: "Hall Executives", zones: HALLS, days: [3, 4, 5] }),
  makeArt("notice", "lost-id", "Lost ID card", ["Found near the Amphi Theatre", "Name starts with Ade"], "paper", { footer: "Collect at the SUB secretariat", kinds: POSTER_ONLY }),
  makeArt("notice", "lost-wallet", "Missing: black wallet", ["Dropped on the Moremi shuttle", "ID card and ATM card inside"], "paper", { footer: "Tell the hall porter", kinds: POSTER_ONLY }),
  makeArt("notice", "found-keys", "Found: bunch of keys", ["Picked up at the 1000 Seater LT"], "paper", { footer: "Ask at the security post", kinds: POSTER_ONLY }),
  makeArt("notice", "lost-calculator", "Lost: scientific calculator", ["Left in AUD II after MTH 101", "Name scratched on the back"], "paper", { footer: "Reward for the finder", kinds: POSTER_ONLY }),
  makeArt("notice", "registration", "Course registration closes Tuesday 6pm", ["Late fee applies after"], "blue", { footer: "Registry", zones: CLASSES, days: [...REGISTRATION_DAYS] }),
  makeArt("notice", "clearance", "Freshers clearance", ["Bring 6 passports", "Bring your admission letter"], "white", { footer: "Admissions Office", zones: CLASSES, kinds: SMALL_PRINT }),
  makeArt("notice", "library", "Library opens 8am to 10pm", ["Return books on time", "Silence inside"], "paper", { footer: "University Library", near: /library/i, kinds: SMALL_PRINT }),
  makeArt("notice", "malaria", "Free malaria test", ["Health Centre", "Weekdays 9am to 3pm"], "teal", { footer: "Health Centre", days: WEEKDAYS }),
  makeArt("notice", "blood", "Donate blood this Wednesday", ["One pint saves three people"], "red", { footer: "Health Centre", days: [0, 1, 2] }),
  makeArt("notice", "daily-test", "Evening test 4pm", ["1000 Seater Lecture Theatre", "Come with your ID card"], "yellow", { footer: "General Studies Unit", near: /1000 seater/i, days: [...LECTURE_DAYS], weight: 1.5 }),
  makeArt("notice", "semester-exam", "Weekly assessment Saturday 10am", ["1000 Seater Lecture Theatre", "Come with your ID card"], "yellow", { footer: "Exams and Records", near: /1000 seater/i, days: [...LECTURE_DAYS, EXAM_DAY], weight: 1.5 }),
  makeArt("notice", "sunday-quiet", "Quiet hours on Sunday morning", ["Keep speakers low till noon"], "sky", { footer: "Hall Executives", zones: HALLS, days: [5, 6] }),
];

const weekTitle = (name: string) => `${name} Faculty Week`;
const WEEK_PROGRAMME: readonly string[] = ["Opening lecture, 10am", "Quiz and debate, 2pm", "Sports day, 4pm", "Career talk, 11am", "Cultural day and dinner", "Novelty match, 9am", "Thanksgiving service"];
const WEEK_PALETTES: readonly PaletteName[] = ["purple", "blue", "green", "orange", "teal"];
const DEPARTMENTS: readonly string[] = ["Chemical Engineering", "Computer Science", "Economics", "English", "Microbiology", "Architecture", "Law", "Pharmacy", "Geology", "Music", "Accounting", "Physics"];
const DEPARTMENT_EVENTS: readonly string[] = ["Freshers welcome party", "Departmental dinner", "Final year sign out", "Alumni lecture", "Excursion list is out"];
const WEEK_WEIGHT = 3;

export function facultyWeek(t: GameTime): ArtEntry[] {
  const week = Math.floor(t.dayIndex / 7);
  const out: ArtEntry[] = [];
  const faculty = FACULTY_TEAMS[facultyOfWeek(week)];
  if (faculty) {
    const art = makeArt("notice", `faculty-week-${week}`, weekTitle(faculty.name), [`Today: ${WEEK_PROGRAMME[t.weekday]}`, "All students are invited"], pick(WEEK_PALETTES, hash3(week, 3, 1)), { footer: "Faculty Students Association", weight: WEEK_WEIGHT });
    if (faculty.place >= 0) art.near = faculty.place;
    out.push(art);
  }
  for (let k = 0; k < 2; k++) {
    const dept = pick(DEPARTMENTS, hash3(week, k, 2));
    const event = pick(DEPARTMENT_EVENTS, hash3(week, k, 4));
    out.push(makeArt("notice", `dept-${week}-${k}`, `${dept} Students`, [event, `This ${t.weekday < 5 ? "Friday" : "weekend"}`], pick(WEEK_PALETTES, hash3(week, k, 6)), { footer: "Departmental Association", zones: CLASSES }));
  }
  return out;
}
