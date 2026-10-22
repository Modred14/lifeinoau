// lib/features.js
// THE FEATURE REGISTRY: the one list the OAU Map (building panel) and the OAU Guide (phone app) both read.
//
// Pure data and pure functions (no database, no React, no 3D library), so the browser, the server and the Node tests all use it.
//
// Where features come from
//   1. BUILDING ACTIVITIES are DERIVED. They are not listed here: they come from lib/activities.js (ACTIVITIES: what each activity does, costs and
//      needs; MAP: which building has which activity) and lib3d/interiors/registry.js (which place is which kind of building). Add an activity there
//      and it shows up in that building's map panel and in the guide with no second edit. numbers (cost, energy, limits, pay) are read from the same
//      objects the server enforces, so the screens cannot drift from the rules.
//   2. EVERYTHING ELSE (phone apps, in-room actions, jobs, risky options, travel, discipline...) is registered below with feature({ ... }).
//
// HOW TO ADD A FEATURE (the convention, checked by tests/features.test.mjs)
//   - A new building activity:   add it to ACTIVITIES and to the building's entry in MAP (lib/activities.js). Nothing else.
//   - A new phone app:           add it to APPS in components/Phone.js AND add a feature({ app: "<id>", ... }) entry to APP_FEATURES below.
//                                The test fails if an app has no entry, or an entry points at an app that does not exist.
//   - A new API route:           list its path in the `api` field of the feature it belongs to, or in INTERNAL_API if players never see it.
//                                The test fails for any route that is in neither, so a new interaction cannot be forgotten.
//   - Something that exists only on one place (a map panel, a desk): add `place: "<place id>"` so the map shows it in that place's panel.
//   - Turning something off:     set status: "disabled" (hidden everywhere, kept for reference) or "deprecated" (hidden from "do this now" lists).
//   - Something half built:      set status: "partial" and say what is missing in `note`. The guide shows it with a clear "not finished" label.
// Nothing here is invented: if you are not sure a feature exists, read its service in lib/*Service.js before registering it.

import { ACTIVITY_SECONDS } from "./activityTime.js";
import { ACTIVITIES, MAP, activitiesFor, labelOf, summaryOf, effectsOf, unmet, waitShort, BUDGET, HUSTLE_NAMES } from "./activities.js";
import { classify, INTERIOR } from "../lib3d/interiors/registry.js";
import { HUSTLE } from "./engine.js";
import { JOBS, SHIFT_TYPES, MAX_SHIFTS_PER_WEEK, windowText } from "./jobs.js";
import { TYPES as BUSINESS_TYPES, MAX_EMPLOYEES, MAX_LEVEL as BUSINESS_MAX_LEVEL } from "./business.js";
import { PRODUCTS, FEE_PCT, EARLY_SALE_PENALTY_PCT } from "./market.js";
import { FARE_NAIRA, MODES, MODE_INFO, DRIVER_PLANS } from "./travel.js";
import { P2P, STARTING_ALLOWANCE, SESSION_WEEKS } from "./rules.js";
import { SELL_PERCENT } from "./furniture.js";
import { SUSPENSION_MS, EXPULSION_MS, CUSTODY_NAME, RESTART_LEVEL } from "./discipline.js";
import { COSTS as COURSE_COSTS } from "./courses.js";
import { VENUES as CLUBS } from "./parties.js";
import { CLUBS as NIGHTCLUBS, HOURS_LABEL, MIN_SPEND, MAX_SPEND, DRINKS, PACKAGES, BUYOUT_TIERS } from "./clubs.js";
import { MIN_STAKE, MAX_STAKE, MAX_LEGS } from "./bet/markets.js";
import { MAX_STAKE as AVIATOR_MAX } from "./bet/aviatorMath.js";
import { MAX_STAKE as ROULETTE_MAX } from "./bet/rouletteMath.js";
import { ACHIEVEMENTS } from "./achievements.js";
import { BOARDS } from "./leaderboards.js";
import { BILLBOARD } from "../lib3d/mapExtras.js";

const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");
const hours = (ms) => `${ms / 3_600_000} hours`;

// ============================================================================================================================ vocabulary
/** The guide's sections, in order. */
export const CATEGORIES = [
  { id: "start", title: "Getting started", blurb: "Your first steps: moving around, going inside, the phone, travel and money." },
  { id: "legit", title: "Making legitimate money", blurb: "Earning money the proper way. No risk of Floor O." },
  { id: "risky", title: "Making risky money", blurb: "Bigger rewards, real danger. These can cost you money, health, your place at school, or your freedom." },
  { id: "world", title: "Explore the world", blurb: "Every place you can visit and what you can do there." },
  { id: "other", title: "Other features", blurb: "Everything else in the game: phone apps, relationships, vehicles and more." },
];
/** Sub-sections of "Other features". */
export const OTHER_GROUPS = [
  { id: "apps", title: "Phone apps" },
  { id: "money", title: "Banking and money transfers" },
  { id: "work", title: "Jobs and businesses" },
  { id: "invest", title: "Investments" },
  { id: "social", title: "Relationships, messages and events" },
  { id: "stats", title: "Your stats, leaderboards and notifications" },
  { id: "vehicles", title: "Vehicles and transport" },
  { id: "rules", title: "Rules and consequences" },
  { id: "multi", title: "Playing with others" },
];
export const STATUS = { live: "live", partial: "partial", deprecated: "deprecated", disabled: "disabled" };
const STATUS_LABEL = { live: "Working", partial: "Not finished", deprecated: "Being phased out", disabled: "Switched off" };
export const statusLabel = (s) => STATUS_LABEL[s] ?? "Working";

// ============================================================================================================================ switches
/** Activities that are switched off: they stay in lib/activities.js but are not shown or offered anywhere. Add an id here to hide it everywhere. */
export const DISABLED_ACTIVITIES = new Set();

// ============================================================================================================================ describing an activity
const STAT_WORDS = { energy: "energy", health: "health", happiness: "happiness", academics: "academics", popularity: "popularity" };
const list = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/** A plain sentence about what an activity does (written from its numbers, so it cannot disagree with them). */
function explain(def) {
  switch (def.kind) {
    case "course_attend": return "Sit in on a lecture for one of your courses. Going to class builds your attendance, which helps your exam score.";
    case "course_study": return "Study one of your courses. This builds your preparation, which helps your exam score.";
    case "course_test": return "Write a short class test on one of your courses. You are scored out of 20 from the effort you have put in.";
    case "exam": return "Sit this week's examination, but only in an exam week. Your result counts toward your CGPA. You can sit it honestly or try to cheat.";
    case "hustle_safe": return "Work an event for pay. You are always paid, but how much is random.";
    case "hustle_risky": return "A quick, shady deal. Either you are paid a lot, or N-QRS catches you and you go to Floor O.";
    default: break;
  }
  const { d } = effectsOf({ personalities: [] }, def), up = Object.keys(d).filter((k) => d[k] > 0 && STAT_WORDS[k]), down = Object.keys(d).filter((k) => d[k] < 0 && STAT_WORDS[k]);
  const bits = [];
  if (def.full) bits.push("Fills your energy to 100%");
  if (up.filter((k) => !(def.full && k === "energy")).length) bits.push(`Gives you ${list(up.filter((k) => !(def.full && k === "energy")).map((k) => STAT_WORDS[k]))}`);
  if (down.length) bits.push(`${bits.length ? "uses" : "Uses"} up ${list(down.map((k) => STAT_WORDS[k]))}`);
  return (bits.length ? bits.join(", ") : "A short activity") + ".";
}

/** What a player needs before they can start (every item is something the server really checks). */
function requirements(def) {
  const r = [], n = def.need ?? {}, { d } = effectsOf({ personalities: [] }, def), energyCost = -(d.energy ?? 0);
  if (n.maxEnergy != null) r.push(`Only when you are tired (energy ${n.maxEnergy} or less).`);
  if (n.maxHealth != null) r.push(`Only when you are not well (health ${n.maxHealth} or less).`);
  if (n.energy != null) r.push(`At least ${n.energy} energy.`);
  if (def.kind === "hustle_safe") r.push(`At least ${HUSTLE.safe.energy} energy.`);
  else if (def.kind === "hustle_risky") r.push(`At least ${HUSTLE.risky.energy} energy.`);
  else if (def.kind === "exam") r.push("At least 20 energy.", "Exam week only (every 6th week of your own timeline).");
  else if (def.kind === "course_attend") r.push(`At least ${COURSE_COSTS.attend} energy.`);
  else if (def.kind === "course_study") r.push(`At least ${COURSE_COSTS.study} energy.`);
  else if (energyCost > 0) r.push(`At least ${energyCost} energy.`);
  if (def.kind === "course_attend" || def.kind === "course_study" || def.kind === "course_test") r.push("One of your own courses (you pick which).");
  if (def.ticket) r.push("This week's ticket for this club (buy it in the Parties app).");
  if (def.home) r.push("Only in your own hall.");
  if (def.inmate) r.push("Only for people serving a sentence in Floor O.");
  if (!def.jailOk && !def.inmate) r.push("You must not be in custody.");
  return r;
}
/** What it gives. `certainty` tells new players what is sure and what is not. */
function gains(def) {
  if (def.kind === "hustle_safe") return { gives: [`${naira(HUSTLE.safe.min)} to ${naira(HUSTLE.safe.max)}, the amount is random`], certainty: "variable" };
  if (def.kind === "hustle_risky") return { gives: [`${naira(HUSTLE.risky.min)} to ${naira(HUSTLE.risky.max)} if you get away with it`], certainty: "variable" };
  if (def.kind === "exam") return { gives: ["A score that counts toward your CGPA (the result depends on your attendance, preparation, energy and luck)"], certainty: "variable" };
  if (def.kind === "course_test") return { gives: ["A mark out of 20, a little academics and happiness"], certainty: "variable" };
  if (def.kind === "course_attend") return { gives: ["Attendance for the course you pick"], certainty: "guaranteed" };
  if (def.kind === "course_study") return { gives: ["Preparation for the course you pick"], certainty: "guaranteed" };
  const { d } = effectsOf({ personalities: [] }, def), up = Object.keys(d).filter((k) => d[k] > 0 && STAT_WORDS[k]).map((k) => (k === "energy" && def.full ? "energy to 100%" : `+${d[k]} ${STAT_WORDS[k]}`));
  return { gives: up, certainty: "guaranteed" };
}
function costs(def) {
  const c = [];
  const { d } = effectsOf({ personalities: [] }, def);
  if (def.kind === "hustle_safe") c.push(`${HUSTLE.safe.energy} energy`);
  else if (def.kind === "hustle_risky") c.push(`${HUSTLE.risky.energy} energy`, `+15 suspicion`, `If caught: lose 30% of your cash, a strike, and ${HUSTLE.risky.jailMin} to ${HUSTLE.risky.jailMax} minutes in ${CUSTODY_NAME}`);
  else if (def.kind === "exam") c.push("20 energy");
  else if (def.kind === "course_attend") c.push(`${COURSE_COSTS.attend} energy`);
  else if (def.kind === "course_study") c.push(`${COURSE_COSTS.study} energy`);
  else for (const k of Object.keys(d)) if (d[k] < 0 && STAT_WORDS[k]) c.push(`${-d[k]} ${STAT_WORDS[k]}`);
  if (def.cost) c.push(naira(def.cost));
  return c;
}
function limits(def) {
  const l = [];
  if (def.kind === "hustle_safe") l.push(`${HUSTLE.safe.perDay} a day`, `${HUSTLE.safe.gapMs / 3_600_000} hours between jobs`);
  else if (def.kind === "hustle_risky") l.push(`${HUSTLE.risky.perDay} a day`);
  else {
    if (def.day != null && def.day < 99) l.push(def.day === 1 ? "Once a day" : `${def.day} times a day`);
    if (def.week != null) l.push(def.week === 1 ? "Once a week" : `${def.week} times a week`);
    if (def.cd) l.push(`Wait ${waitShort(def.cd * 1000)} between uses`);
  }
  const capped = Object.keys(def.d ?? {}).filter((k) => def.d[k] > 0 && BUDGET[k]);
  if (capped.length) l.push(`Stat gains have daily or weekly limits (${list(capped)})`);
  return l;
}
/** "safe" or "risky": the guide separates the two. Risky means the game can take something from you for doing it. */
export const riskOf = (def) => (def.kind === "hustle_risky" || def.risky ? "risky" : "safe");

/** One activity as the panels show it. `entry` is one item of a building's list in MAP (so its label may differ from the generic one). */
export function describeActivity(entry, idx = 0, placeId = "") {
  const def = ACTIVITIES[entry.act];
  const g = gains(def);
  return {
    key: `${placeId}:${entry.act}:${idx}`, act: entry.act, label: labelOf(entry), icon: def.icon, kind: def.kind, risk: riskOf(def), seconds: def.sec,
    explain: explain(def), requires: requirements(def), gives: g.gives, certainty: g.certainty, costs: costs(def), limits: limits(def), summary: summaryOf(def),
    cost: def.cost ?? 0, def,
  };
}

/** The activities a building offers, de-duplicated (the same label twice in one building is shown once) and without switched-off ones. */
export function activitiesAt(placeId, kind = "") {
  const cl = classify(placeId, kind);
  if (cl.mode !== "interior") return [];
  const seen = new Set(), out = [];
  activitiesFor(cl.spec).forEach((e, i) => {
    if (DISABLED_ACTIVITIES.has(e.act) || !ACTIVITIES[e.act]) return;
    const k = `${e.act}|${labelOf(e)}`; if (seen.has(k)) return; seen.add(k);
    out.push(describeActivity(e, i, placeId));
  });
  return out;
}

/**
 * Why THIS player cannot start an activity right now, from what the screen already knows (stats, custody, money, home). Null if nothing known blocks it.
 * The server decides for real (cooldowns and daily limits are counted there); this only avoids offering something that is plainly impossible.
 * `c` the character, `ctx` = { placeId, jailed, balanceKobo }.
 */
export function blockedFor(a, c, ctx = {}) {
  const def = a.def;
  if (!c) return null;
  if (ctx.jailed && !def.jailOk) return "You cannot do that while you are in custody.";
  if (def.inmate && !ctx.jailed) return "Only people serving a sentence use the cells.";
  const why = unmet(c, def, { now: Date.now(), runs: [], day: 0, week: 0 });
  if (why) return why;
  const need = def.kind === "hustle_safe" ? HUSTLE.safe.energy : def.kind === "hustle_risky" ? HUSTLE.risky.energy : def.kind === "exam" ? 20 : def.kind === "course_attend" ? COURSE_COSTS.attend : def.kind === "course_study" ? COURSE_COSTS.study : 0; // the same thresholds the server checks
  if (need && c.energy < need) return "You are too tired for that. Rest first.";
  if (def.cost && ctx.balanceKobo != null && BigInt(ctx.balanceKobo) < BigInt(def.cost) * 100n) return `You need ${naira(def.cost)}.`;
  return null;
}

// ============================================================================================================================ registered features
const REQUIRED = ["id", "name", "summary", "category"];
/** Fills in the defaults, so every registered feature has the same shape. */
export function feature(f) {
  for (const k of REQUIRED) if (!f[k]) throw new Error(`feature(): missing ${k} in ${JSON.stringify(f).slice(0, 80)}`);
  return Object.freeze({ group: null, earns: null, risk: "safe", place: null, app: null, needs: [], gives: [], costs: [], steps: [], api: [], certainty: null, status: "live", note: "", ...f });
}

/** Player-facing explanations of how the game works. Each one answers one "how do I...?" question. */
const START = [
  feature({ id: "start.move", category: "start", name: "Move around the world", summary: "Your room is where you start. The Map in the bottom bar is the whole campus.",
    steps: ["Your room is on the Home tab. Drag to look around it. Tap your bed to sleep and the phone on your desk to call home.", "Tap Map in the bottom bar to see the campus. Drag to move the map and pinch or scroll to zoom.", "Tap any building. A panel opens with what it is, how to get there and what you can do there.", "The Places button lists every place and has a search box."], place: null }),
  feature({ id: "start.enter", category: "start", name: "Enter buildings and use them", summary: "Most buildings have an inside you can walk around. Rings on the floor are the things you can do.",
    steps: ["Tap a building on the map, choose how to get there and press Go. Walking there yourself shows a small map; rides just take a few seconds.", "When you arrive at an enclosed building you go inside automatically. Open-air places have no inside.", "Walk with W A S D or the on-screen stick. Hold Shift (or the Run button) to run.", "A glowing ring marks something to do. Walk up to it and press the button that appears (or F). A panel shows what it costs and gives.", "Press Start. Stay on the ring until the timer ends, because walking away stops it.", "Walk out of the door (or press Exit) to leave the building."] }),
  feature({ id: "start.phone", category: "start", name: "Use the phone", summary: "The phone holds all your apps. Open it from the Phone button in the bottom bar.", app: "guide",
    steps: ["Tap Phone in the bottom bar.", "Tap an app icon to open it. The back arrow or the bar at the bottom takes you to the home screen.", "The top of the home screen shows your cash, energy and the week.", "Close the phone with Close or the bar at the bottom."] }),
  feature({ id: "start.travel", category: "start", name: "Travel between places", summary: "Pick a place, pick how to go, press Go. Walking is free; other ways cost a small fare.", api: ["/api/travel"],
    steps: ["Tap a building on the map. The panel shows the ways to get there with their prices.", `Trek is free and you walk it yourself. Keke costs ${naira(FARE_NAIRA.keke)} and bus costs ${naira(FARE_NAIRA.bus)}. Each shows how long it will take: the road distance at the vehicle's speed, plus your walk to it and from it.`, `My car costs ${naira(FARE_NAIRA.car)} for fuel and needs a car (Nepos start with one; others can buy one in the Ride app). A hired driver drives you, and a car is the quickest way across campus.`, "The fare is paid when you arrive. You cannot travel while you are held in Floor O."] }),
  feature({ id: "start.money", category: "start", name: "Understand money, rewards and progress", summary: "Cash comes in from allowance, work and luck, and goes out on rent, travel and fun. Progress is your level, CGPA and net worth.", app: "forbes",
    steps: [`Every game week (7 real days) you get an allowance: Nepos ${naira(STARTING_ALLOWANCE.NEPO / 100n)}, Mapos ${naira(STARTING_ALLOWANCE.MAPO / 100n)}, Lapos ${naira(STARTING_ALLOWANCE.LAPO / 100n)}. Missing your weekly call to your parent cuts it.`, "Rent, fares, food, tickets and fees take money out. Your cash is shown at the top of the phone.", "Energy, health, happiness, academics and popularity are your stats. Most activities spend a little energy, so sleep when you are tired.", `Each session is ${SESSION_WEEKS} weeks with exams in the middle and end. Pass and you move up a level (100L to 500L). Fail twice in a row and you are withdrawn.`, "The Forbes board in the phone shows your net worth against other players."] }),
];

/** Money you can earn without breaking any rule. Building activities that pay (the Event Gig) are added automatically from lib/activities.js. */
const jobMin = Math.min(...Object.values(JOBS).map((j) => j.pay[0])), jobMax = Math.max(...Object.values(JOBS).map((j) => j.pay[1]));
const LEGIT = [
  feature({ id: "money.jobs", category: "legit", name: "Work a job shift", app: "jobs", earns: "legit", certainty: "variable", api: ["/api/career/job", "/api/career"],
    summary: `Pick one of ${Object.keys(JOBS).length} jobs in the Jobs app and work shifts for cash. You do this from the phone, not from a building.`,
    needs: ["Your level and faculty must fit the job (some need 200L or 300L, a few need a faculty).", `Energy for the shift, and you must be awake and free.`], gives: [`About ${naira(jobMin)} to ${naira(jobMax)} a shift depending on the job. The amount is random inside that range and rises 12% with every job level.`], costs: ["Energy for the shift"],
    steps: ["Open the Jobs app and pick a job you qualify for.", `Clock in during a shift window: morning ${windowText("morning")}, night ${windowText("night")} (game clock). Night pays 25% more but tires you more.`, `You can work one shift a day and ${MAX_SHIFTS_PER_WEEK} a week.`, "When the shift ends, open the app and collect your pay."] }),
  feature({ id: "money.coding", category: "legit", name: "Coding", app: "jobs", earns: "legit", certainty: "variable", place: "f_cs",
    summary: "Coding is learning and a job. The lab practical in a computing building builds academics (not cash). The Developer and Tech Bro jobs pay for coding skill.",
    needs: [`Developer: 200L and Computer Science, Technology or Science. Tech Bro: 300L and Computer Science or Technology.`], gives: [`Developer pays about ${naira(JOBS.developer.pay[0])} to ${naira(JOBS.developer.pay[1])} a shift. Tech Bro pays about ${naira(JOBS.tech_bro.pay[0])} to ${naira(JOBS.tech_bro.pay[1])}.`],
    steps: ["Go to the Faculty of Computer Science. Inside, the 'Code in the lab' ring builds your academics (no cash).", "To earn cash from coding, open the Jobs app and take the Developer job (later Tech Bro) when you qualify.", "You can also start a Tech company or Digital agency in the Jobs app."] }),
  feature({ id: "money.business", category: "legit", name: "Run a business", app: "jobs", earns: "legit", certainty: "variable", api: ["/api/career/business"],
    summary: `Start one of ${Object.keys(BUSINESS_TYPES).length} kinds of business in the Jobs app. It trades by itself every week, with a profit or a loss.`,
    needs: ["Enough cash to start it. The number of businesses you can run equals your level (1 at 100L up to 5)."], gives: ["Weekly revenue that depends on the business, its staff and luck."], costs: [`Start-up from ${naira(Math.min(...Object.values(BUSINESS_TYPES).map((t) => t.cost)))} to ${naira(Math.max(...Object.values(BUSINESS_TYPES).map((t) => t.cost)))}. A business that runs out of capital goes bankrupt.`],
    steps: ["Open the Jobs app and choose Start a business.", `Hire up to ${MAX_EMPLOYEES} staff and upgrade to level ${BUSINESS_MAX_LEVEL} from its own capital.`, "Add or withdraw capital. A safety reserve always stays inside.", "Each game week brings revenue, costs and random events."] }),
  feature({ id: "money.invest", category: "legit", name: "Invest your money", app: "invest", earns: "legit", certainty: "variable", group: "invest", api: ["/api/invest"],
    summary: `Buy into ${Object.keys(PRODUCTS).length} fictional products from low risk to high risk in the Invest app. Prices move every game week.`,
    needs: ["Cash to invest. Your total invested is capped at ₦5,000,000 for every 100 levels."], gives: ["Growth if the price rises (not guaranteed). Low-risk products rarely lose; high-risk ones often do."], costs: [`${FEE_PCT}% fee each way, and a ${EARLY_SALE_PENALTY_PCT}% penalty if you sell inside a product's lock period.`],
    steps: ["Open the Invest app and read this week's market news.", ...Object.values(PRODUCTS).map((p) => `${p.name} (${p.risk.toLowerCase()} risk): ${p.blurb}`), "Sell when you want your money back."] }),
  feature({ id: "money.allowance", category: "legit", name: "Your weekly allowance and calling home", earns: "legit", certainty: "guaranteed", api: ["/api/parent/call"],
    summary: "Your parents send an allowance every game week. Call home once a week to keep it whole.",
    gives: [`Allowance by class: Nepo ${naira(STARTING_ALLOWANCE.NEPO / 100n)}, Mapo ${naira(STARTING_ALLOWANCE.MAPO / 100n)}, Lapo ${naira(STARTING_ALLOWANCE.LAPO / 100n)} a week.`, "Calling home sometimes brings a gift (it is a small chance, so do not count on it)."],
    steps: ["In your room, tap the phone on your desk or bedside table and press Call parent. You can do this once a week.", "Each missed week cuts your next allowance by 10%, down to half."] }),
  feature({ id: "money.furniture", category: "legit", name: "Sell furniture you bought", earns: "legit", certainty: "guaranteed", place: null,
    summary: `Furniture you bought can be sold for ${SELL_PERCENT}% of what you paid. The furniture that came with your room cannot be sold.`,
    steps: ["Tap Buy in the bottom bar to open Buy mode.", "Tap a piece of furniture in your room and press Sell."] }),
];

/** Money (or trouble) from breaking rules or gambling. The Back-Room Deal is added automatically from lib/activities.js. */
const RISKY = [
  feature({ id: "risky.exam-cheat", category: "risky", name: "Cheat in an exam", risk: "risky", certainty: "variable", place: null, api: ["/api/exam"],
    summary: "When you sit the exam you can choose 'Try to cheat'. It adds marks, but if you are caught the score is capped and you get a strike.",
    needs: ["Exam week, and you must be at the exam ring in your own faculty building."], gives: ["Extra marks if you get away with it (not guaranteed)."], costs: ["If caught: your score is capped at 25, your suspicion rises and you get a strike. Strikes lead to suspension and expulsion."],
    steps: ["Go to your faculty building in exam week.", "Walk to the 'Sit the examination' ring.", "Choose Try to cheat and confirm the warning."] }),
  feature({ id: "risky.lecturer-fight", category: "risky", name: "Fight a lecturer", risk: "risky", certainty: "variable", api: ["/api/fight"], status: "partial", note: "The game server route the fight starts from (/api/lecture) is missing in this version, so walking up to a lecturer cannot begin a fight yet.",
    summary: "Your lecturers stand in real lecture rooms. You can walk up to one and fight. It does not pay money. It costs you.",
    needs: ["Be inside the lecture building of one of your courses.", "20 energy, once a week, not in custody, suspended or expelled."], gives: ["If you win: happiness and popularity."], costs: ["Lose: health, happiness and popularity.", "Win: 80% of the time N-QRS arrives, rescues the lecturer and arrests YOU. They seize 30% of your cash, you get a strike and serve your sentence in Floor O."],
    steps: ["Open the Courses app to see which building each lecturer is in (it has a Show on map link).", "Travel there and go inside.", "Walk up to the red ring marked with the lecturer's name and confirm."] }),
  feature({ id: "risky.bet", category: "risky", name: "Gamble in the Bet app", app: "bet", risk: "risky", earns: "risky", certainty: "variable", group: "money", api: ["/api/bet/slips", "/api/bet/live", "/api/bet/aviator", "/api/bet/roulette"],
    summary: "Sports slips, Aviator and Roulette use play money from your wallet. You win or lose real in-game cash.",
    needs: ["Cash for the stake."], gives: ["A payout if you win. Wins are never guaranteed."], costs: [`Your stake is gone if you lose. Slips: ${naira(MIN_STAKE)} to ${naira(MAX_STAKE)} for up to ${MAX_LEGS} matches. Aviator: up to ${naira(AVIATOR_MAX)} a flight. Roulette: up to ${naira(ROULETTE_MAX)} a spin.`],
    steps: ["Open the Bet app.", "Choose Sports, Aviator or Roulette.", "Set a stake you can afford to lose and place the bet."] }),
];

/** One entry per phone app. The id MUST match the key in APPS in components/Phone.js (tests/features.test.mjs checks both directions). */
export const APP_FEATURES = [
  feature({ id: "app.messages", app: "messages", category: "other", group: "apps", name: "Messages", api: ["/api/messages", "/api/messages/read", "/api/messages/token", "/api/players", "/api/profile", "/api/safety", "/api/transfer"],
    summary: "Chat with other players, look at their profiles, send them money and block or report anyone.", steps: ["Search for a player by name and start a chat.", `Send money from a chat: ${naira(P2P.minNaira)} to ${naira(P2P.maxNaira)} each time, ${P2P.feePercent}% fee that leaves the economy.`, "Block or report a player from their profile."] }),
  feature({ id: "app.jobs", app: "jobs", category: "other", group: "work", name: "Jobs", summary: "Pick a job and work shifts, or start and run a business.", steps: ["See Work a job shift and Run a business in 'Making legitimate money'."] }),
  feature({ id: "app.courses", app: "courses", category: "other", group: "apps", name: "Courses", api: ["/api/courses", "/api/faculty"], summary: "Your four courses this level, their lecturers, where each one is taught, and your attendance and preparation.",
    steps: ["Open the app to see each course, its lecturer and your progress.", "Use Show on map to find the lecture building.", "Attend and study inside the building: go to the lecture rooms in your faculty and walk to the ring."] }),
  feature({ id: "app.invest", app: "invest", category: "other", group: "invest", name: "Invest", summary: "Buy and sell investments. See 'Invest your money'.", steps: ["See 'Invest your money' in 'Making legitimate money'."] }),
  feature({ id: "app.love", app: "love", category: "other", group: "social", name: "Love", api: ["/api/relationship", "/api/pregnancy"],
    summary: "Relationships with real players: talking, besties, dates, babe, sneaky link, engagement and moving in. Everything is text and not graphic. Both players must agree to every step.",
    steps: ["You can only start something with a player you have messaged and who has messaged you back.", "Dates, gifts and food build affection. Affection fades if you do not stay in touch.", "Keeping a sneaky link while you have a babe can get you caught."] }),
  feature({ id: "app.parties", app: "parties", category: "other", group: "social", name: "Parties", api: ["/api/parties"],
    summary: `Each week the three clubs (${Object.keys(CLUBS).join(", ")}) host one party. Buy a ticket for one night out per week, then go to the club to dance and mingle.`,
    steps: ["Open Parties and buy a ticket. Prices and spaces are limited.", "Travel to that club and go inside.", "Dance and the other rings only work with this week's ticket for that club."] }),
  feature({ id: "app.spending", app: "spending", category: "other", group: "money", name: "Club Spending", api: ["/api/club"],
    summary: "Your nightlife spending history: the total across 0203, Royal Divas and Quantum, split by club and by what you bought, with every transaction listed newest first.",
    steps: ["Open Spending to see your totals and your biggest purchase.", "Filter the list by club, by type (drinks, spraying, VIP, buyouts) or by dates.", "It only ever shows your own spending, and only purchases that really went through."] }),
  feature({ id: "app.forbes", app: "forbes", category: "other", group: "stats", name: "Forbes", api: ["/api/leaderboard"], summary: `Leaderboards: ${Object.values(BOARDS).map((b) => b.title).join(", ")}.`, steps: ["Open the app and switch between the boards. Lists are refreshed about once a minute."] }),
  feature({ id: "app.awards", app: "awards", category: "other", group: "stats", name: "Awards", api: ["/api/achievements"], summary: `${ACHIEVEMENTS.length} achievements to unlock, such as First Million, Graduate and Floor O Survivor.`, steps: ["Open Awards to see which you have and what is needed for the rest."] }),
  feature({ id: "app.housing", app: "housing", category: "other", group: "vehicles", name: "Housing", api: ["/api/housing"], summary: "Where you live. See your home, the rent, and move to another home.", steps: ["Open Housing to compare homes and move. Moving costs money and your own furniture comes with you."] }),
  feature({ id: "app.hire", app: "hire", category: "other", group: "vehicles", name: "Hire", api: ["/api/hire"], summary: "Hire a driver so your own car drives you, instead of you steering.",
    needs: ["You need a car."], costs: DRIVER_PLANS.map((p) => `${p.weeks} week${p.weeks === 1 ? "" : "s"}: ${naira(p.naira)}`), steps: ["Open Hire and choose a plan. Pay up front. A driver drives your car for you along the road."] }),
  feature({ id: "app.ride", app: "ride", category: "other", group: "vehicles", name: "Ride", api: ["/api/rides"], status: "partial", note: "Some cars have no verified price yet. They are shown but cannot be bought.",
    summary: "The YK Autos showroom: buy a car and choose the one you drive. Cars without a verified price cannot be bought yet.", steps: ["Open Ride, look at the cars and buy one you can afford.", "Pick a paint colour and your active car. It then appears as 'My car' when you travel."] }),
  feature({ id: "app.offishall", app: "offishall", category: "other", group: "apps", name: "Offishall Stores", api: ["/api/wardrobe"],
    summary: "The clothes shop and your wardrobe. Buy shirts, trousers, skirts, designer Elite pieces and complete outfits, then change what your character wears whenever you like.",
    needs: ["Money in your bank for what you buy. A free phone."], costs: ["Shirts ₦12,000 to ₦25,000, trousers ₦18,000 to ₦30,000, skirts ₦15,000 to ₦28,000, Elite Collection from ₦90,000 up to ₦650,000 for a complete outfit."],
    note: "You buy each item once and keep it for good: a new purchase never replaces an old one. An outfit is always complete (a top and a bottom, or one complete outfit), so your character is never half dressed. Your clothes show on the map, in buildings, to other players and in your profile picture.",
    steps: ["Open Offishall Stores and browse Shirts, Trousers, Skirts or the Elite Collection. Tap an item to see your character wearing it.", "Buy it from your bank balance.", "Open the Wardrobe tab, pick a top and a bottom (or a complete outfit) and tap Wear this outfit."] }),
  feature({ id: "app.bet", app: "bet", category: "other", group: "money", name: "Bet", summary: "Sports, Aviator and Roulette. See 'Gamble in the Bet app' in 'Making risky money'.", risk: "risky", steps: ["See 'Gamble in the Bet app' in 'Making risky money'."] }),
  feature({ id: "app.settings", app: "settings", category: "other", group: "apps", name: "Settings", summary: "Sound and music switches.", steps: ["Open Settings to turn music and sound effects on or off."] }),
  feature({ id: "app.guide", app: "guide", category: "other", group: "apps", name: "OAU Guide", summary: "This app: how the game works, where to earn, what to do next, and a directory of every place.", steps: ["Browse by section or search for anything."] }),
  feature({ id: "app.games", app: "games", category: "other", group: "multi", name: "Games", api: ["/api/games"], risk: "risky",
    summary: "Ludo, Chess, 8-Ball Pool, Basketball, Checkers, Connect Four and Tic-Tac-Toe against another real player. Challenge a friend by character name, find a random opponent, and rematch when a game ends.",
    needs: ["A free phone and another real player."], costs: ["Wagers are optional (₦100 to ₦100,000 each). Both players put in the same amount and it is held until the game ends."],
    gives: ["Win a wagered game and you take the whole prize pool (both wagers). A draw or a cancelled game returns both wagers."], certainty: "variable",
    note: "You can play in custody: the phone is not the cell door. Only one match at a time. The server decides every result, so a screen cannot claim a win.",
    steps: ["Open Games on your phone.", "Pick a game, then Challenge a friend or Find a player.", "Choose the wager (or play for fun) and check the prize shown.", "When both agree, the game starts and the wagers are held.", "After the game, ask for a rematch if you like."] }),
];

/** Features that are not apps and not building rings. */
const CLUB_NIGHTS = Object.values(NIGHTCLUBS).map((c) => feature({ id: `club.night.${c.id}`, category: "other", group: "social", name: `${c.name} nightlife: spray, bottles, VIP`, place: c.id,
  summary: `${c.name} opens ${HOURS_LABEL} (game time) and is shut in the day. Inside, open the club menu to spray money, order luxury bottles (${DRINKS.length} on the menu), buy a drink for a friend, take a bottle-service package (${PACKAGES.length}), reserve a table or buy out the club (${BUYOUT_TIERS.length} levels).`,
  needs: [`The club must be open (${HOURS_LABEL})`, "Be inside the club", `Spend from ₦${MIN_SPEND.toLocaleString("en-NG")} up to ₦${MAX_SPEND.toLocaleString("en-NG")}`],
  gives: ["A show everyone in the club sees", "VIP privileges: no ticket, free bar, gold badge (packages, lounge, tables, buyouts)", "A little mood and popularity (capped each day and week)"],
  steps: ["Travel to the club at night and walk inside.", "Tap the VIP button on the screen to open the club menu.", "Check the price and the balance, confirm, and watch the show.", "Every purchase appears in the Spending app on your phone."] }));
const OTHER = [
  feature({ id: "money.bank", category: "other", group: "money", name: "Banking", place: "ecobank", summary: "Five banks stand on campus (Ecobank, Wema, First Bank, Zenith, Access). Inside you can do your banking errand and, at the manager's office, learn to budget.",
    note: "Your money lives in your wallet. The banks are places to visit for small stat benefits, not separate accounts.", steps: ["Go to a bank and walk to the ATM lobby or the manager's office ring."] }),
  feature({ id: "money.transfer", category: "other", group: "money", name: "Send money to another player", app: "messages", summary: `You can send between ${naira(P2P.minNaira)} and ${naira(P2P.maxNaira)} to another player, up to ${naira(Number(P2P.dailyKobo / 100n))} a day. A ${P2P.feePercent}% fee is taken.`, steps: ["Open Messages, open a chat and choose Send money."] }),
  feature({ id: "other.sleep", category: "other", group: "stats", name: "Sleep and energy", api: ["/api/sleep"], summary: `Tap your bed in your room to sleep. Energy fills to 100% in about ${ACTIVITY_SECONDS} seconds. Tap the floor to wake up early.`, steps: ["Open Home, tap a bed in your room and press Go to sleep."] }),
  feature({ id: "other.shop", category: "other", group: "stats", name: "Furniture shop (Buy mode)", api: ["/api/room"], summary: "Buy furniture for your room and drag it into place. Furniture raises your room score.", steps: ["Tap Buy in the bottom bar.", "Pick an item and confirm. Drag to move it, or Turn, Store or Sell from the toolbar."] }),
  feature({ id: "other.notifications", category: "other", group: "stats", name: "Notifications", api: ["/api/notifications"], summary: "Things that happen while you are away (a bet that settled, a request from another player) pop up as messages when you return. Close them to mark them read.", steps: ["Notifications appear on their own. Messages also show an unread number on the Messages icon."] }),
  feature({ id: "rules.floor0", category: "other", group: "rules", name: "Floor O (N-QRS Custody)", place: "floor0", risk: "risky", api: ["/api/floor0/pay"],
    summary: `Caught on a risky act and you are taken to ${CUSTODY_NAME}. You serve your whole sentence there. You can message people or pay the bail to leave early.`,
    costs: [`Bail is ${naira(HUSTLE.bailPerMinute)} for every minute of the sentence still to serve.`, "While held you cannot leave, travel, work or shop. Your phone still works: you can message, bank, check your stats and play phone games."], steps: ["Wait out the sentence, or pay the bail from the custody screen or the alert on Home."] }),
  feature({ id: "rules.strikes", category: "other", group: "rules", name: "Strikes, suspension and expulsion", summary: `Caught cheating, fighting or hustling gives strikes. 3 or 4 strikes means a ${hours(SUSPENSION_MS)} suspension, 5 means a ${hours(EXPULSION_MS)} expulsion, then you restart at ${RESTART_LEVEL}L.`,
    note: "Your money, home, businesses, messages and awards are kept when you restart.", steps: ["Avoid cheating and fighting, and keep your suspicion low."] }),
  feature({ id: "social.billboards", category: "other", group: "social", name: "Billboards", place: "bb_1", api: ["/api/billboards", "/api/billboards/image"], status: "partial", note: "Payment is a test payment. No real payment provider is connected yet.",
    summary: `Ten billboards stand around campus. Each has ${BILLBOARD.SLOTS} poster spots shown in turn. You can put your own poster on one.`, costs: [`${naira(BILLBOARD.SLOT_KOBO / 100)} for one spot, ${naira(BILLBOARD.WHOLE_KOBO / 100)} for the whole board.`], steps: ["Tap a billboard on the map, pick spots, add a picture and a caption and reserve.", "Paying works as a test payment for now."] }),
  feature({ id: "multi.presence", category: "other", group: "multi", name: "See other players", api: ["/api/travel"], summary: "The map shows how many players are at each place. Inside a building you see who else is there, and you meet others on the road when you trek.", steps: ["Tap a place to see 'players here now', then go there."] }),
  feature({ id: "multi.chat", category: "other", group: "multi", name: "Messaging", app: "messages", summary: "Messages arrive live while you play. You can also message from a player's profile.", steps: ["Open Messages from the phone."] }),
];

/** Places-and-getting-around entries for "Explore the world" (the directory of places itself is built from the map data). */
const WORLD = [
  feature({ id: "world.transport", category: "world", name: "Transportation points", app: "ride", api: [],
    summary: "There are no bus stops or stations to find. You choose how to travel on any place's panel: walk (Trek), take a Keke or a Bus, or drive your own car.",
    needs: ["My car needs a car (Nepos start with one; others buy one in the Ride app)."], costs: MODES.map((m) => `${MODE_INFO[m].name}: ${FARE_NAIRA[m] ? naira(FARE_NAIRA[m]) : "free"}`),
    steps: ["Tap a place on the map.", "Choose Trek, Keke, Bus or My car. The price is shown on each.", "Press Go. You pay the fare when you arrive.", "Open the Hire app to get a driver for your car, or the Ride app to buy a car."] }),
];

export const FEATURES = [...START, ...LEGIT, ...RISKY, ...WORLD, ...APP_FEATURES, ...OTHER, ...CLUB_NIGHTS];

// Routes that exist but are not a "feature" a player uses (sign-in plumbing, the game state read, admin tools, image streams, internal helpers).
export const INTERNAL_API = ["/api/login", "/api/logout", "/api/signup", "/api/session", "/api/state", "/api/meta", "/api/character", "/api/character/hostel",
  "/api/action", "/api/risky", "/api/hustle", "/api/activity", "/api/campus/[action]", "/api/market/[...path]",
  "/api/admin/adjust", "/api/admin/overview", "/api/admin/player", "/api/admin/report-messages", "/api/admin/reports", "/api/avatars"];

// ============================================================================================================================ derived features
/** Ids the map renames when it loads (lib3d/mapExtras.js): the interior registry still lists the old id, but only the new one is a place. */
const RENAMED = new Set(["medical_unnamed"]);
/** Every named place that has an interior, with the activities in it (the unnamed `bld_` buildings all share the generic pair). */
export function derivedActivityFeatures() {
  const byAct = new Map();
  for (const id of Object.keys(INTERIOR)) if (!RENAMED.has(id)) for (const a of activitiesAt(id)) {
    const e = byAct.get(a.act) ?? { act: a.act, places: [], labels: new Set() };
    e.places.push(id); e.labels.add(a.label); byAct.set(a.act, e);
  }
  return [...byAct.values()].map((e) => {
    const def = ACTIVITIES[e.act], risk = riskOf(def), g = gains(def);
    return feature({ id: `activity.${e.act}`, category: risk === "risky" ? "risky" : def.kind === "hustle_safe" ? "legit" : "other", group: "activities",
      name: [...e.labels][0], summary: explain(def), risk, earns: def.kind === "hustle_safe" ? "legit" : def.kind === "hustle_risky" ? "risky" : null, certainty: g.certainty,
      needs: requirements(def), gives: g.gives, costs: costs(def), place: e.places[0], places: e.places, derived: true, steps: [] });
  });
}

/** The full registry: registered features plus the ones derived from the building activities. Switched-off features are left out. */
export function allFeatures({ includeDisabled = false } = {}) {
  const all = [...FEATURES, ...derivedActivityFeatures()];
  return includeDisabled ? all : all.filter((f) => f.status !== STATUS.disabled);
}
export const featureById = (id) => allFeatures({ includeDisabled: true }).find((f) => f.id === id) ?? null;
/** Features shown as "do this now" actions: switched off and being-phased-out ones are not. */
export const isOffered = (f) => f.status === STATUS.live || f.status === STATUS.partial;

/** What a map panel shows for a place: its building activities and any registered features tied to that place (never twice). */
export function featuresAt(placeId, kind = "") {
  const activities = activitiesAt(placeId, kind);
  const extra = FEATURES.filter((f) => f.place === placeId && isOffered(f) && f.category !== "start");
  return { activities, extra };
}

// ============================================================================================================================ validation
/**
 * Problems in the registry (an empty list means it is sound). Used by tests/features.test.mjs, and safe to call in development.
 * `ctx` = { placeIds: Set of every map place id, appIds: Set of phone app ids, apiRoutes: array of route paths }.
 */
export function validateRegistry(ctx) {
  const bad = [], seen = new Set(), cats = new Set(CATEGORIES.map((c) => c.id)), groups = new Set([...OTHER_GROUPS.map((g) => g.id), "activities"]);
  for (const f of allFeatures({ includeDisabled: true })) {
    if (seen.has(f.id)) bad.push(`duplicate feature id: ${f.id}`); seen.add(f.id);
    if (!cats.has(f.category)) bad.push(`${f.id}: unknown category ${f.category}`);
    if (f.group && !groups.has(f.group)) bad.push(`${f.id}: unknown group ${f.group}`);
    if (!STATUS[f.status]) bad.push(`${f.id}: unknown status ${f.status}`);
    if ((f.status === "partial" || f.status === "deprecated") && !f.note && !f.derived) bad.push(`${f.id}: a ${f.status} feature must say why in note`);
    if (f.place && ctx.placeIds && !ctx.placeIds.has(f.place)) bad.push(`${f.id}: place ${f.place} is not on the map`);
    for (const p of f.places ?? []) if (ctx.placeIds && !ctx.placeIds.has(p)) bad.push(`${f.id}: place ${p} is not on the map`);
    if (f.app && ctx.appIds && !ctx.appIds.has(f.app)) bad.push(`${f.id}: app ${f.app} does not exist in the phone`);
    if (!f.derived && !f.steps.length) bad.push(`${f.id}: no steps ("show me how" would be empty)`);
  }
  if (ctx.appIds) for (const a of ctx.appIds) if (!APP_FEATURES.some((f) => f.app === a)) bad.push(`phone app "${a}" has no entry in APP_FEATURES (lib/features.js)`);
  if (ctx.apiRoutes) {
    const claimed = new Set([...INTERNAL_API, ...FEATURES.flatMap((f) => f.api)]);
    for (const r of ctx.apiRoutes) if (!claimed.has(r)) bad.push(`API route ${r} is not registered: add it to a feature's api list (or INTERNAL_API) in lib/features.js`);
    for (const r of claimed) if (!ctx.apiRoutes.includes(r)) bad.push(`registry names API route ${r}, which does not exist`);
  }
  for (const a of Object.keys(ACTIVITIES)) {
    if (DISABLED_ACTIVITIES.has(a)) continue;
    const used = Object.values(MAP).some((m) => (Array.isArray(m) ? m : Object.values(m).flat()).some((e) => e.act === a));
    if (!used) bad.push(`activity ${a} is not placed in any building (add it to MAP in lib/activities.js)`);
  }
  return bad;
}

export { MODES, MODE_INFO, FARE_NAIRA, HUSTLE_NAMES, SHIFT_TYPES };