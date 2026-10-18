// lib/activities.js
// lib/activities.js
// Building activities: what a player can DO inside each building, what it costs, and what it changes.
// Plain data and pure functions (no database, no 3D library, safe in the browser), shared by the server (which enforces every rule),
// the interior scene (which draws the gold/teal rings where the activities are), the screens (which only read these numbers) and the tests.
//
// How it fits together
//   ACTIVITIES   every activity once: its cost, duration, cooldown, daily/weekly limit, eligibility and what it does to the five stats
//                (health, energy, happiness, academics, popularity). Most are plain stat changes; a few reuse the rules the game already had
//                (attend/study a course, a class test, the exam, the two hustles) so there is one rule set, not two.
//   MAP          building -> which activities it has and in which room each one stands. Keyed by the interior family (lib3d/interiors/registry.js)
//                and, inside a family, by the building's own variant (a faculty's discipline, a club, a shop...). Nothing here invents a building:
//                the test walks every place that has an interior and fails if one has no activity or an activity cannot be placed.
//   BUDGET       how much each stat can be GAINED from activities per in-game day or week, so activities can never be farmed into a maxed player.
//   PRESENCE     how a player's position inside a building is checked on the server (speed, distance, freshness).
//
// Every number lives in this file so balance changes are one edit, and the screens can never drift from what the server does.
import { clamp, HUSTLE } from "./engine.js";

export const STAT_KEYS = ["health", "energy", "happiness", "academics", "popularity"];
/** What the two hustles are called to the player. The ledger memos ("Safe hustle", "Risky hustle") are NOT changed: the leaderboards read them. */
export const HUSTLE_NAMES = { safe: "Event Gig", risky: "Back-Room Deal" };

/** Gains from activities are capped per in-game day / game week (losses always apply). Hustles, the exam and courses have their own limits. */
export const BUDGET = {
  energy: { per: "day", gain: 70 },
  health: { per: "day", gain: 8 },
  happiness: { per: "day", gain: 14 },
  academics: { per: "week", gain: 3 },
  popularity: { per: "week", gain: 5 },
};

/** Position rules (metres and milliseconds). The run speed in the scene is 3.7 m/s; the extra allowance covers network jitter. */
export const PRESENCE = {
  maxSpeed: 4.6, slack: 5, // a step between two server-stamped positions may be at most slack + maxSpeed * seconds
  staleMs: 30_000, // the last position must be this fresh when an activity starts or ends
  hubRadius: 2.4, // to start an activity you must be this close to its ring (the on-screen prompt appears at 1.7 m)
  stayRadius: 3.6, // while it runs you may not wander farther than this from the ring
  enterRadius: 3.5, // the first position after walking in must be this close to the door
  pingEveryMs: 4_000, // how often the screen reports where you are (only while you are inside)
  expireMs: 5 * 60_000, // an activity not finished this long after it ended is lost
};

const A = (o) => Object.freeze({ cost: 0, cd: 0, day: 99, kind: "stats", icon: "sparkle", anim: ["idle"], need: {}, d: {}, ...o });

// ============================================================================================================================ catalog
// d: stat changes (positive = gain, negative = cost). cost: naira. sec: how long it takes. cd: cooldown in seconds after it ends.
// day / week: uses per in-game day / game week. need: eligibility. anim: avatar animations to try, in order.
export const ACTIVITIES = {
  // ---- rest and recovery
  sleep_bed: A({ label: "Sleep in your bed", doing: "Sleeping…", done: "You slept soundly. Energy is full.", icon: "moon", sec: 30, full: true, d: { health: 2 }, cd: 60, day: 6, need: { maxEnergy: 90 }, home: true, anim: ["sleep", "sit"] }),
  bunk_rest: A({ label: "Sleep on a bunk", doing: "Sleeping…", done: "You slept well. Energy is full.", icon: "moon", sec: 30, full: true, d: { health: 1 }, cd: 60, day: 6, need: { maxEnergy: 90 }, anim: ["sleep", "sit"] }),
  nap_common: A({ label: "Rest on the sofa", doing: "Resting…", done: "A short rest did you good.", icon: "sofa", sec: 40, d: { energy: 10 }, cd: 900, day: 2, need: { maxEnergy: 85 }, anim: ["sit"] }),
  ward_rest: A({ label: "Rest in the observation ward", doing: "Resting…", done: "The nurses let you rest.", icon: "health", sec: 60, d: { energy: 20, health: 3 }, cost: 1000, cd: 3600, day: 1, need: { maxEnergy: 60 }, anim: ["sleep", "sit"], memo: "Observation ward" }),
  cell_bunk: A({ label: "Lie down on the bunk", doing: "Resting…", done: "You got a little sleep.", icon: "moon", sec: 45, d: { energy: 10 }, cd: 1800, day: 3, need: { maxEnergy: 70 }, inmate: true, jailOk: true, anim: ["sleep", "sit"] }),
  cell_pushups: A({ label: "Do press-ups", doing: "Exercising…", done: "You worked off some frustration.", icon: "health", sec: 40, d: { health: 2, energy: -6 }, cd: 1800, day: 2, inmate: true, jailOk: true, anim: ["interact", "idle"] }),

  // ---- food, shopping and errands
  eat_meal: A({ label: "Eat a meal", doing: "Eating…", done: "A proper meal. You feel better.", icon: "kitchen", sec: 25, d: { energy: 12, health: 2, happiness: 2 }, cost: 1500, cd: 5400, day: 3, anim: ["eat"], memo: "Meal" }),
  buy_snack: A({ label: "Buy a snack", doing: "Snacking…", done: "That hit the spot.", icon: "bag", sec: 12, d: { energy: 4, happiness: 1 }, cost: 500, cd: 600, day: 4, anim: ["eat"], memo: "Snack" }),
  fresh_produce: A({ label: "Buy fresh produce", doing: "Shopping…", done: "Fresh fruit and vegetables for the week.", icon: "bag", sec: 20, d: { health: 3, energy: 3 }, cost: 1200, cd: 7200, day: 2, anim: ["interact"], memo: "Fresh produce" }),
  haggle: A({ label: "Haggle at the stalls", doing: "Haggling…", done: "You won a few rounds of haggling.", icon: "talk", sec: 30, d: { happiness: 2, energy: -3 }, cd: 3600, day: 3, anim: ["gesture", "talk"] }),
  hostel_cook: A({ label: "Cook a meal", doing: "Cooking…", done: "Home cooking beats the canteen.", icon: "kitchen", sec: 40, d: { energy: 10, health: 2, happiness: 1 }, cost: 800, cd: 7200, day: 2, anim: ["interact"], memo: "Groceries" }),
  provisions: A({ label: "Stock up on provisions", doing: "Shopping…", done: "The cupboard is full again.", icon: "bag", sec: 15, d: { health: 2, happiness: 1 }, cost: 2000, cd: 10800, day: 1, anim: ["interact"], memo: "Provisions" }),
  buy_data: A({ label: "Buy a data bundle", doing: "Topping up…", done: "Data on. Time to scroll.", icon: "phone", sec: 12, d: { happiness: 2 }, cost: 1500, cd: 21600, day: 1, anim: ["phone"], memo: "Data bundle" }),
  phone_fix: A({ label: "Fix or upgrade your phone", doing: "Waiting for the repair…", done: "Your phone feels new.", icon: "phone", sec: 25, d: { happiness: 4 }, cost: 3000, cd: 43200, day: 1, anim: ["phone", "interact"], memo: "Phone shop" }),
  bank_errand: A({ label: "Do your banking", doing: "Banking…", done: "Banking sorted.", icon: "bank", sec: 20, d: { happiness: 1, energy: -3 }, cd: 3600, day: 2, anim: ["interact"] }),
  fin_advice: A({ label: "Meet the account officer", doing: "Talking numbers…", done: "You learned how to budget better.", icon: "bank", sec: 40, d: { academics: 1, energy: -4 }, cd: 43200, day: 1, anim: ["talk"] }),
  bookshop_revision: A({ label: "Buy a revision guide", doing: "Browsing the shelves…", done: "A good revision guide in hand.", icon: "study", sec: 20, d: { academics: 1, energy: -1 }, cost: 2500, cd: 86400, day: 1, anim: ["interact"], memo: "Revision guide" }),

  // ---- health
  health_checkup: A({ label: "See the doctor", doing: "In consultation…", done: "The doctor sorted you out.", icon: "health", sec: 40, d: { health: 10, energy: -2 }, cost: 3000, cd: 7200, day: 2, need: { maxHealth: 85 }, anim: ["talk", "sit"], memo: "Consultation" }),
  buy_medicine: A({ label: "Buy medicine", doing: "At the dispensary…", done: "The medicine helps.", icon: "health", sec: 15, d: { health: 5 }, cost: 2000, cd: 14400, day: 2, need: { maxHealth: 90 }, anim: ["interact"], memo: "Medicine" }),
  triage_treatment: A({ label: "Get treated in triage", doing: "Being treated…", done: "You are on the mend.", icon: "health", sec: 50, d: { health: 20, energy: -3 }, cost: 8000, cd: 21600, day: 1, need: { maxHealth: 50 }, anim: ["sit"], memo: "Treatment" }),

  // ---- classes, tests and exams (these reuse the course and exam rules the game already has)
  attend_class: A({ label: "Attend a lecture", doing: "In the lecture…", done: "You sat through a lecture.", icon: "courses", sec: 45, kind: "course_attend", day: 8, anim: ["sit", "study"] }),
  study_course: A({ label: "Study a course", doing: "Studying…", done: "You studied hard.", icon: "study", sec: 60, kind: "course_study", day: 8, anim: ["study", "type", "sit"] }),
  class_test: A({ label: "Take a class test", doing: "Writing the test…", done: "Test done.", icon: "courses", sec: 60, kind: "course_test", week: 1, need: { energy: 8 }, anim: ["type", "sit"] }),
  sit_exam: A({ label: "Sit the examination", doing: "Writing the exam…", done: "Exam done.", icon: "courses", sec: 90, kind: "exam", day: 1, anim: ["type", "sit"] }),

  // ---- academic extras (small, capped by the weekly academics budget)
  research_session: A({ label: "Do research reading", doing: "Reading…", done: "You found some useful sources.", icon: "study", sec: 60, d: { academics: 1, energy: -10, happiness: -1 }, cd: 3600, day: 2, anim: ["study", "sit"] }),
  group_study: A({ label: "Join a study group", doing: "Studying together…", done: "Explaining it to others helped you too.", icon: "talk", sec: 50, d: { academics: 1, popularity: 1, energy: -8 }, cd: 7200, day: 1, social: true, anim: ["talk", "sit"] }),
  eresource_lab: A({ label: "Use the computer lab", doing: "Working on the computer…", done: "You got a lot done online.", icon: "study", sec: 45, d: { academics: 1, energy: -8 }, cost: 300, cd: 7200, day: 2, anim: ["type", "sit"], memo: "Computer lab" }),
  practical: A({ label: "Do a practical", doing: "Working…", done: "Hands-on work teaches fast.", icon: "study", sec: 60, d: { academics: 1, energy: -12, happiness: -1 }, cd: 7200, day: 2, anim: ["interact", "type"] }),
  academic_adviser: A({ label: "See an academic adviser", doing: "In the meeting…", done: "Good advice on your courses.", icon: "talk", sec: 40, d: { academics: 1, happiness: 1, energy: -4 }, cd: 43200, day: 1, anim: ["talk"] }),
  registry_errand: A({ label: "Sort out your records", doing: "At the desk…", done: "Paperwork sorted. What a relief.", icon: "list", sec: 30, d: { happiness: 1, energy: -4 }, cd: 3600, day: 2, anim: ["interact"] }),
  senate_session: A({ label: "Observe a Senate session", doing: "Observing…", done: "You saw how the university is run.", icon: "hall", sec: 45, d: { academics: 1, energy: -5 }, cd: 43200, day: 1, anim: ["sit"] }),
  museum_tour: A({ label: "Tour the exhibits", doing: "Touring…", done: "A fascinating afternoon.", icon: "statue", sec: 45, d: { happiness: 3, academics: 1, energy: -5 }, cost: 500, cd: 21600, day: 1, anim: ["lookAround", "idle"], memo: "Museum ticket" }),
  edu_session: A({ label: "Join a school-visit session", doing: "Learning…", done: "The visiting pupils taught you something.", icon: "courses", sec: 40, d: { academics: 1, happiness: 1, energy: -5 }, cd: 43200, day: 1, anim: ["talk", "sit"] }),
  ict_lab: A({ label: "Use the cyber and training lab", doing: "Working…", done: "You picked up a few new skills.", icon: "study", sec: 45, d: { academics: 1, energy: -8 }, cost: 200, cd: 7200, day: 2, anim: ["type", "sit"], memo: "Cyber lab" }),
  training_session: A({ label: "Attend a training session", doing: "In training…", done: "A useful training session.", icon: "study", sec: 50, d: { academics: 1, energy: -8 }, cd: 21600, day: 1, anim: ["sit", "talk"] }),
  quran_study: A({ label: "Study in the Quran library", doing: "Reading…", done: "A calm, reflective hour.", icon: "study", sec: 45, d: { happiness: 2, academics: 1, energy: -3 }, cd: 21600, day: 1, anim: ["study", "sit"] }),

  // ---- social life (popularity is capped weekly; Introverts gain less, Extroverts more)
  play_games: A({ label: "Play a game", doing: "Playing…", done: "Good fun. Good exercise.", icon: "game", sec: 40, d: { happiness: 3, energy: -5, health: 1 }, cd: 600, day: 4, anim: ["cheer", "gesture"] }),
  union_meeting: A({ label: "Attend a union meeting", doing: "In the meeting…", done: "People noticed you spoke up.", icon: "social", sec: 45, d: { popularity: 1, happiness: 1, energy: -6 }, cd: 21600, day: 1, social: true, anim: ["sit", "talk"] }),
  join_club: A({ label: "Join a club session", doing: "At the club…", done: "You made new friends.", icon: "users", sec: 40, d: { popularity: 1, happiness: 2, energy: -5 }, cd: 7200, day: 2, social: true, anim: ["talk", "greet"] }),
  hall_event: A({ label: "Attend an event in the hall", doing: "At the event…", done: "A memorable event.", icon: "hall", sec: 45, d: { happiness: 3, popularity: 1, energy: -4 }, cd: 3600, day: 2, social: true, anim: ["sit", "cheer"] }),
  stage_rehearsal: A({ label: "Rehearse in the green room", doing: "Rehearsing…", done: "The rehearsal went well.", icon: "party", sec: 45, d: { popularity: 1, happiness: 2, energy: -6 }, cd: 7200, day: 1, social: true, anim: ["cheer", "talk"] }),
  network_vip: A({ label: "Network in the VIP lounge", doing: "Networking…", done: "You made some useful contacts.", icon: "talk", sec: 40, d: { popularity: 1, energy: -4 }, cd: 7200, day: 1, social: true, anim: ["greet", "talk"] }),
  hall_chat: A({ label: "Chat with hallmates", doing: "Chatting…", done: "Good gist with the neighbours.", icon: "talk", sec: 30, d: { popularity: 1, happiness: 2, energy: -2 }, cd: 3600, day: 2, social: true, anim: ["talk"] }),
  worship_service: A({ label: "Attend the service", doing: "At the service…", done: "You feel at peace.", icon: "happy", sec: 60, d: { happiness: 4, health: 1, energy: -4 }, cd: 3600, day: 2, anim: ["sit"] }),
  fellowship: A({ label: "Join the fellowship", doing: "In fellowship…", done: "The community welcomed you.", icon: "users", sec: 40, d: { popularity: 1, happiness: 2, energy: -4 }, cd: 7200, day: 1, social: true, anim: ["greet", "talk"] }),
  pastoral_chat: A({ label: "Speak with the pastor", doing: "Talking…", done: "A kind word lifted your spirits.", icon: "talk", sec: 35, d: { happiness: 3, energy: -2 }, cd: 21600, day: 1, anim: ["talk"] }),
  volunteer_teach: A({ label: "Volunteer to teach a class", doing: "Teaching…", done: "The pupils loved it.", icon: "courses", sec: 50, d: { popularity: 1, happiness: 2, energy: -8 }, cd: 7200, day: 1, social: true, anim: ["gesture", "talk"] }),
  play_squash: A({ label: "Play squash", doing: "Playing squash…", done: "A tough, healthy game.", icon: "ball", sec: 60, d: { health: 4, energy: -12, happiness: 3 }, cost: 1000, cd: 7200, day: 2, anim: ["run", "jump"], memo: "Court fee" }),
  watch_match: A({ label: "Watch a match", doing: "Watching…", done: "Great game to watch.", icon: "ball", sec: 30, d: { happiness: 2, popularity: 1, energy: -2 }, cd: 3600, day: 2, social: true, anim: ["sit", "cheer"] }),
  hotspot_hangout: A({ label: "Hang out with friends", doing: "Hanging out…", done: "Time flew by.", icon: "users", sec: 40, d: { happiness: 4, popularity: 1, energy: -3 }, cost: 1000, cd: 3600, day: 2, social: true, anim: ["talk", "drink"], memo: "Hangout" }),
  student_dialogue: A({ label: "Join a student-management dialogue", doing: "In the dialogue…", done: "Your voice was heard.", icon: "talk", sec: 45, d: { popularity: 1, happiness: 1, energy: -5 }, cd: 86400, day: 1, social: true, anim: ["talk", "sit"] }),
  coop_meeting: A({ label: "Attend a cooperative meeting", doing: "In the meeting…", done: "You learned about saving together.", icon: "users", sec: 45, d: { popularity: 1, happiness: 1, energy: -5 }, cd: 21600, day: 1, social: true, anim: ["sit", "talk"] }),
  coop_desk: A({ label: "Use the savings desk", doing: "At the desk…", done: "Your savings plan is in order.", icon: "coins", sec: 25, d: { happiness: 1, energy: -2 }, cd: 7200, day: 2, anim: ["interact"] }),
  attend_event: A({ label: "Attend an event", doing: "At the event…", done: "What a gathering.", icon: "party", sec: 45, d: { happiness: 3, popularity: 1, energy: -4 }, cd: 3600, day: 2, social: true, anim: ["sit", "cheer"] }),
  catering_help: A({ label: "Help the caterers", doing: "Serving…", done: "Hard work, but you made friends.", icon: "kitchen", sec: 45, d: { popularity: 1, happiness: 1, energy: -8 }, cd: 7200, day: 1, social: true, anim: ["interact"] }),
  help_desk: A({ label: "Get help at the help desk", doing: "At the desk…", done: "Problem solved.", icon: "talk", sec: 25, d: { happiness: 2, energy: -2 }, cd: 3600, day: 2, anim: ["interact", "talk"] }),

  // ---- nightlife (the night itself is the ticket from the Parties screen; these need that week's ticket for THIS club)
  dance: A({ label: "Dance", doing: "Dancing…", done: "You owned the dance floor.", icon: "club", sec: 45, d: { happiness: 4, popularity: 1, energy: -8 }, cd: 900, day: 3, social: true, ticket: true, anim: ["idleEmote", "cheer"], pers: { "Party Animal": { happiness: 2 } } }),
  club_drink: A({ label: "Order a drink", doing: "Sipping…", done: "Cheers!", icon: "club", sec: 20, d: { happiness: 2, energy: -2 }, cost: 2500, cd: 1800, day: 3, ticket: true, anim: ["drink"], memo: "Drinks" }),
  vip_mingle: A({ label: "Mingle in the VIP room", doing: "Mingling…", done: "The VIP room is where the contacts are.", icon: "club", sec: 40, d: { popularity: 1, happiness: 2, energy: -3 }, cd: 7200, day: 1, social: true, ticket: true, anim: ["greet", "talk"] }),
  patio_chat: A({ label: "Chat on the patio", doing: "Chatting…", done: "Fresh air and good gist.", icon: "talk", sec: 35, d: { popularity: 1, happiness: 2, energy: -2 }, cd: 3600, day: 2, social: true, ticket: true, anim: ["talk"] }),

  // ---- the two hustles (they use the existing hustle rules: payout, daily limit, 6 hour gap, N-QRS, jail and bail all live in lib/engine.js)
  event_gig: A({ label: HUSTLE_NAMES.safe, doing: "Working the event…", done: "Event gig done. Cash added.", icon: "hustle", sec: 45, kind: "hustle_safe", anim: ["greet", "gesture", "talk"] }),
  back_room_deal: A({ label: HUSTLE_NAMES.risky, doing: "Making the deal…", done: "Deal done.", icon: "dice", sec: 30, kind: "hustle_risky", risky: true, anim: ["gesture", "talk"] }),
};
export const isActivity = (id) => Object.hasOwn(ACTIVITIES, id);

// ============================================================================================================================ building -> activities
// Each entry: S(activity, where, { label }). `where` is R(room-name pattern, options):
//   nth   which of the matching rooms (wraps round)        each   one ring in EVERY matching room (beds)       item   only rooms that hold one of these items
//   near  stand beside the first item of one of these types  or    other places to try when the pattern matches nothing
// When nothing matches, the ring goes in the entrance hall. The patterns are matched against the room names in lib3d/interiors/plans*.js.
const R = (room, o = {}) => ({ room, ...o });
const S = (act, at, o = {}) => ({ act, at, ...o });

const LEC = "Lecture Room|Classroom|Law Lecture|Teaching Practice Classroom";
const STUDY = "Reading|Library|Resource Room|Archive|Research Room|Study room|Legal Research";
const BEDROOM = "^Room \\d+";
/** Classes, tests, the exam and a study spot: every faculty and teaching building has these four. */
const std = (o = {}) => [
  S("attend_class", o.attend ?? R(LEC), o.attendLabel ? { label: o.attendLabel } : {}),
  S("class_test", o.test ?? R("Seminar|Tutorial|Mediation|Case Study|Crit|Microteaching|Extension", { or: [R(LEC, { nth: 1 })] })),
  S("sit_exam", o.exam ?? R(LEC, { nth: 1 }), o.examLabel ? { label: o.examLabel } : {}),
  S("study_course", o.study ?? R(STUDY, { or: [R("Drug Information|Departmental Seminar|Project Presentation|Drawing Room|Planning Studio|Seminar|Crit|foyer|reception")] }), { label: "Study a course" }),
];

export const MAP = {
  // ---- campus core
  ceremonial: [ // Oduduwa Hall: ceremonies, convocations and cultural events. The low-risk hustle (Event Gig) is here.
    S("event_gig", R("Entrance foyer"), { label: HUSTLE_NAMES.safe }), S("hall_event", R("Main hall")),
    S("stage_rehearsal", R("Green room")), S("network_vip", R("VIP lounge")),
  ],
  sub: [ // Student Union Building: games, meetings, clubs and a snack counter. The high-risk hustle (Back-Room Deal) is here.
    S("back_room_deal", R("Meeting room 2"), { label: HUSTLE_NAMES.risky }), S("play_games", R("Student lounge", { near: ["pingpong", "foosball"] })),
    S("union_meeting", R("Union assembly hall")), S("join_club", R("Entrance and services hall")), S("buy_snack", R("Entrance and services hall", { near: ["counter"] }), { label: "Buy a snack at the counter" }),
  ],
  library: [
    S("study_course", R("Quiet study hall", { or: [R("open stacks")] })), S("research_session", R("Reference and reading")),
    S("eresource_lab", R("Electronic resources")), S("group_study", R("Group study")),
  ],
  senate: [S("academic_adviser", R("Academic Affairs")), S("registry_errand", R("^Registry")), S("senate_session", R("Council Chamber"))],

  // ---- faculties and academic buildings (keyed by the discipline in lib3d/interiors/registry.js)
  faculty: {
    science: [...std(), S("practical", R("Chemistry Teaching Laboratory|Biology Laboratory|Physics Laboratory"), { label: "Run a lab practical" })],
    engineering: [...std(), S("practical", R("Mechanical Workshop|Electronics Laboratory"), { label: "Work in the workshop" }), S("eresource_lab", R("Computer-Aided Design"), { label: "Work in the CAD lab" })],
    computing: [...std(), S("practical", R("Computer Laboratory 1"), { label: "Code in the lab" }), S("practical", R("Hardware and Robotics"), { label: "Build in the robotics lab" })],
    law: [...std(), S("practical", R("Moot Court"), { label: "Argue in the moot court" })],
    arts1: [...std(), S("group_study", R("Seminar Room"), { label: "Join a seminar debate" }), S("eresource_lab", R("Language Laboratory"), { label: "Practise in the language lab" })],
    arts2: [...std(), S("group_study", R("Departmental Seminar|Seminar Room 3"), { label: "Join a seminar debate" })],
    arts3: [...std(), S("group_study", R("Literature Seminar"), { label: "Join a literature seminar" }), S("eresource_lab", R("Language Laboratory"), { label: "Practise in the language lab" })],
    education: [...std(), S("volunteer_teach", R("Teaching Practice Classroom"), { label: "Do teaching practice" }), S("help_desk", R("Guidance"), { label: "Visit the guidance unit" })],
    pharmacy: [...std(), S("practical", R("Pharmaceutics|Pharmaceutical Chemistry|Pharmacognosy"), { label: "Do a dispensing practical" })],
    pharmacy_new: [...std(), S("practical", R("Clinical Pharmacy|Pharmacology"), { label: "Do a dispensing practical" })],
    health: [...std(), S("practical", R("Anatomy|Simulation Ward|Physiology"), { label: "Practise clinical skills" })],
    social: [...std(), S("eresource_lab", R("Data Analysis"), { label: "Analyse survey data" })],
    management: [...std(), S("group_study", R("Case Study"), { label: "Work a case study" })],
    edm: [...std(), S("practical", R("Architecture Design Studio|Planning Studio"), { label: "Work in the design studio" }), S("practical", R("Model-making"), { label: "Build a scale model" })],
    architecture: [...std({ attend: R("Design Studio", { nth: 0 }), attendLabel: "Attend a studio class", test: R("Crit"), exam: R("Design Studio", { nth: 1 }), examLabel: "Sit the design examination" }), S("practical", R("Model Workshop"), { label: "Build a scale model" })],
    agric: [...std(), S("practical", R("Greenhouse|Soil Science|Demonstration"), { label: "Do a farm practical" }), S("practical", R("Machinery"), { label: "Service farm machinery" })],
    geology: [...std(), S("practical", R("Mineralogy|Rock Specimen"), { label: "Examine rock specimens" })],
    central_lab: [...std({ attend: R("General Chemistry"), attendLabel: "Attend a lab class", test: R("Instrumentation"), exam: R("Biological Analysis"), examLabel: "Sit a practical examination" }), S("practical", R("Sample Preparation"), { label: "Run an analysis" })],
    chem_lab: [...std({ attend: R("Unit Operations"), attendLabel: "Attend a lab class", test: R("Process Control"), exam: R("Pilot Plant"), examLabel: "Sit a practical examination" }), S("practical", R("Pilot Plant"), { label: "Run the pilot plant" })],
    civil: [...std(), S("practical", R("Structures"), { label: "Test a concrete beam" }), S("eresource_lab", R("Surveying and Computing"), { label: "Process survey data" })],
  },
  theatre: [S("attend_class", R("Lecture hall")), S("class_test", R("Lecture hall")), S("sit_exam", R("Lecture hall")), S("study_course", R("^Foyer"), { label: "Study in the foyer" })],
  classrooms: [
    S("attend_class", R("Classroom", { nth: 0 })), S("class_test", R("Seminar room")), S("sit_exam", R("Classroom", { nth: 1 })),
    S("study_course", R("Study room")), S("practical", R("Teaching lab"), { label: "Work in the teaching lab" }),
  ],

  // ---- administration
  admin: {
    executive: [S("student_dialogue", R("Conference room")), S("registry_errand", R("Reception"), { label: "Hand in an application" })],
    offices: [S("registry_errand", R("^Registry")), S("help_desk", R("Accounts office"), { label: "Query a bill at the accounts office" })],
    pg: [S("study_course", R("Postgraduate reading room")), S("eresource_lab", R("Research computing"), { label: "Use the research computers" }), S("group_study", R("Postgraduate seminar"), { label: "Join a thesis seminar" })],
    ict: [S("ict_lab", R("Cyber and training")), S("help_desk", R("Help desk"), { label: "Get help at the ICT help desk" })],
  },
  museum: [S("museum_tour", R("Palaeontology gallery")), S("museum_tour", R("Biodiversity gallery")), S("edu_session", R("Education room"))],
  school: [S("volunteer_teach", R("Classroom 1")), S("study_course", R("Reading corner"), { label: "Study in the reading corner" })],
  multihall: {
    cooperative: [S("coop_meeting", R("Meeting hall")), S("coop_desk", R("Cooperative society office"))],
    events: [S("attend_event", R("Event hall")), S("catering_help", R("Catering kitchen"))],
    spider: [S("training_session", R("Training room")), S("attend_event", R("Assembly room"), { label: "Attend a seminar" }), S("study_course", R("Resource room"), { label: "Study in the resource room" })],
  },

  // ---- health, sport, custody
  clinic: [
    S("health_checkup", R("Consulting room 1")), S("buy_medicine", R("^Pharmacy")), S("ward_rest", R("Observation ward")), S("triage_treatment", R("Triage")),
  ],
  squash: [S("play_squash", R("Squash court 1")), S("watch_match", R("Spectators"))],
  custody: [S("cell_bunk", R("^Cell 1")), S("cell_pushups", R("^Cell 2"))], // for people serving a sentence (see `inmate` in the catalog)

  // ---- worship
  church: [S("worship_service", R("Nave|Worship hall|Sanctuary")), S("fellowship", R("Entrance porch")), S("pastoral_chat", R("Sacristy|Vestry|Prayer and counselling|Pastor's study"))],
  mosque: [S("worship_service", R("Prayer hall"), { label: "Join the congregational prayer" }), S("fellowship", R("Entrance and shoe area"), { label: "Join the community" }), S("quran_study", R("Quran library"))],

  // ---- banks, shops and food
  bank: [S("bank_errand", R("ATM lobby")), S("fin_advice", R("Manager's office"))],
  shop: {
    books: [S("bookshop_revision", R("Bookshop", { near: ["shelves"] })), S("study_course", R("Bookshop", { near: ["table"] }), { label: "Read at the bookshop table" })],
    hotspot: [S("hotspot_hangout", R("Hangout spot", { near: ["roundtable"] })), S("buy_snack", R("Hangout spot", { near: ["counter"] }), { label: "Grab a snack and a drink" })],
    phones: [S("phone_fix", R("Phone shop", { near: ["counter"] })), S("buy_data", R("Phone shop", { near: ["display"] }))],
    canteen: [S("eat_meal", R("Eatery", { near: ["roundtable"] })), S("buy_snack", R("Eatery", { near: ["counter"] }), { label: "Grab a snack to go" })],
    kiosk: [S("buy_snack", R("Kiosk", { near: ["counter"] }))],
    store: [S("provisions", R("Provisions store", { near: ["shelves"] }))],
  },
  market: [S("fresh_produce", R("Market hall", { near: ["croptray", "stall"] })), S("haggle", R("Market hall", { near: ["stall"] })), S("buy_snack", R("Market hall", { near: ["freezer"] }), { label: "Buy street food" })],

  // ---- nightlife
  club: {
    quantum: [S("dance", R("Main dance floor", { near: ["dancefloor"] })), S("club_drink", R("Main dance floor", { near: ["bar"] }))],
    "0203": [S("dance", R("Lounge and live floor", { near: ["dancefloor"] })), S("club_drink", R("Lounge and live floor", { near: ["bar"] })), S("patio_chat", R("Open-air patio"))],
    divas: [S("dance", R("Lounge and runway", { near: ["dancefloor"] })), S("club_drink", R("Lounge and runway", { near: ["bar"] })), S("vip_mingle", R("VIP room 1"))],
  },

  // ---- where people live
  hostel: [
    S("sleep_bed", R(BEDROOM, { each: true, item: ["bed", "bunk"] })), S("nap_common", R("Common room")), S("hall_chat", R("Hall lobby")),
    S("hostel_cook", R("Shared kitchen")), S("study_course", R("Reading room"), { label: "Study in the reading room" }),
  ],
  block: [
    S("bunk_rest", R(BEDROOM, { each: true, item: ["bed", "bunk"] })), S("nap_common", R("Block common room")), S("hall_chat", R("Entrance hall")), S("hostel_cook", R("Block kitchen")),
  ],

  // ---- unnamed buildings on the map: a plain inside, so a plain pair of activities
  generic: [S("nap_common", R("Entrance hall"), { label: "Rest on a bench in the hall" }), S("study_course", R("Classroom|Meeting room|Staff room"), { label: "Study in a quiet room" })],
};

/** The activities of one interior (`spec` is what classify() in lib3d/interiors/registry.js returns: { t, v?, d?, pcs? }). */
export function activitiesFor(spec) {
  const m = MAP[spec?.t]; if (!m) return [];
  const list = Array.isArray(m) ? m : m[spec.v ?? spec.d] ?? [];
  const extra = spec.t === "theatre" && spec.pcs ? [S("practical", R("Lecture hall"), { label: "Work on the lab computers" })] : [];
  return [...list, ...extra];
}
export const labelOf = (entry) => entry.label ?? ACTIVITIES[entry.act].label;

// ============================================================================================================================ rules
/** What an activity does, in one line, for the prompt: "−12 energy · ₦1,500 · 60s". */
export function summaryOf(def, c = null) {
  const bits = [], d = effectsOf(c ?? { personalities: [] }, def).d, nm = { energy: "energy", health: "health", happiness: "happiness", academics: "academics", popularity: "popularity" };
  for (const k of STAT_KEYS) if (d[k] && !(def.full && k === "energy")) bits.push(`${d[k] > 0 ? "+" : "−"}${Math.abs(d[k])} ${nm[k]}`);
  if (def.full) bits.unshift("energy to 100%");
  if (def.kind === "hustle_safe") bits.unshift(`₦${HUSTLE.safe.min.toLocaleString("en-NG")}–₦${HUSTLE.safe.max.toLocaleString("en-NG")}`, `−${HUSTLE.safe.energy} energy`);
  if (def.kind === "hustle_risky") bits.unshift(`₦${HUSTLE.risky.min.toLocaleString("en-NG")}–₦${HUSTLE.risky.max.toLocaleString("en-NG")} or Floor O`, `−${HUSTLE.risky.energy} energy`);
  if (def.kind === "course_attend") bits.push("−12 energy");
  if (def.kind === "course_study") bits.push("−15 energy");
  if (def.kind === "exam") bits.push("−20 energy");
  if (def.cost) bits.push(`₦${def.cost.toLocaleString("en-NG")}`);
  bits.push(def.sec >= 60 ? `${Math.floor(def.sec / 60)}m${def.sec % 60 ? ` ${def.sec % 60}s` : ""}` : `${def.sec}s`);
  return bits.join(" · ");
}

/** The stat changes this player gets from `def`, before the daily/weekly budgets. Personality nudges the social ones a little. */
export function effectsOf(c, def) {
  const d = { ...def.d }, ps = c?.personalities ?? [];
  if (def.full) d.energy = Math.max(0, 100 - (c?.energy ?? 0)); // sleep: energy climbs steadily to 100% over the sleep (30 s), whatever it started at
  for (const p of ps) for (const [k, v] of Object.entries(def.pers?.[p] ?? {})) d[k] = (d[k] ?? 0) + v;
  if (def.social && d.popularity > 0) { if (ps.includes("Introvert")) d.popularity -= 1; if (ps.includes("Extrovert")) d.popularity += 1; }
  for (const k of STAT_KEYS) if (!d[k]) delete d[k];
  return { d, cost: def.cost ?? 0 };
}

/** Which windows the budgets are counted in. `runs` are this player's finished runs ({ delta, startedAt, gameWeek }). */
export function spentOf(runs, { week, dayStart }) {
  const out = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  for (const r of runs) { if (r.status !== "DONE" || !r.delta) continue;
    for (const [k, v] of Object.entries(r.delta)) { const b = BUDGET[k]; if (!b || !(v > 0)) continue;
      if (b.per === "week" ? r.gameWeek === week : +new Date(r.startedAt) >= dayStart) out[k] += v; } }
  return out;
}
/** Apply the budgets: a gain is cut down to what is left of the day's or week's allowance. `capped` lists the stats that were cut. */
export function budgeted(d, spent) {
  const out = { ...d }, capped = [];
  for (const [k, v] of Object.entries(d)) { const b = BUDGET[k]; if (!b || !(v > 0)) continue;
    const left = Math.max(0, b.gain - (spent[k] ?? 0)); if (v > left) { out[k] = left; capped.push(k); } if (!out[k]) delete out[k]; }
  return { d: out, capped };
}
/** True if an activity that is only worth doing for its gains would give nothing at all right now. */
export function worthless(def, c, spent) {
  if (def.full) return false;
  const { d } = effectsOf(c, def), gains = Object.entries(d).filter(([, v]) => v > 0).map(([k]) => k);
  if (!gains.length) return false;
  return Object.keys(budgeted(d, spent).d).filter((k) => d[k] > 0).length === 0;
}
/** The stats after the activity (clamped 0 to 100), and the change that really happened. */
export function apply(c, d) {
  const stats = {}, applied = {};
  for (const k of STAT_KEYS) { stats[k] = clamp((c[k] ?? 0) + (d[k] ?? 0)); const real = stats[k] - (c[k] ?? 0); if (real) applied[k] = real; }
  return { stats, applied };
}

/** null if this player may do `def` now, otherwise why not. `st` = { now, runs (this activity's runs, newest first), day: count today, week: count this week }. */
export function unmet(c, def, st) {
  const need = def.need ?? {}, { d } = effectsOf(c, def), cost = -(d.energy ?? 0);
  if (need.maxEnergy != null && c.energy > need.maxEnergy) return "You are not tired enough for that.";
  if (need.maxHealth != null && c.health > need.maxHealth) return "You are in good health. You do not need that.";
  if (need.energy != null && c.energy < need.energy) return "You are too tired for that. Rest first.";
  if (cost > 0 && c.energy < cost) return "You are too tired for that. Rest first.";
  if (def.kind === "stats" || def.kind === "course_test") { /* the energy cost above covers it */ }
  if (st.cooldownEndsAt && st.cooldownEndsAt > st.now) return `You did that a moment ago. Again in ${waitShort(st.cooldownEndsAt - st.now)}.`;
  if (def.day != null && def.day < 99 && st.day >= def.day) return def.day === 1 ? "You already did that today. Come back tomorrow." : `You have done that ${def.day} times today. Come back tomorrow.`;
  if (def.week != null && st.week >= def.week) return "You already did that this week. Come back next week.";
  return null;
}
/** "5h 59m", "42m", "30s" */
export const waitShort = (ms) => { const s = Math.ceil(Math.max(0, ms) / 1000); return s < 60 ? `${Math.max(1, s)}s` : s < 3600 ? `${Math.ceil(s / 60)}m` : `${Math.floor(s / 3600)}h ${String(Math.ceil((s % 3600) / 60)).padStart(2, "0")}m`; };

/** When this activity may be done again (ms), from its runs (any status that counted: RUNNING and DONE), or 0. */
export function cooldownEnd(def, runs) {
  if (!def.cd) return 0;
  let last = 0; for (const r of runs) { if (r.status !== "DONE" && r.status !== "RUNNING") continue; const t = +new Date(r.finishedAt ?? r.endsAt ?? r.startedAt); if (t > last) last = t; }
  return last ? last + def.cd * 1000 : 0;
}

// ---- where a player stands inside a building
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** Could a player have walked from `prev` ({ x, z, at (ms) }) to `next` ({ x, z }) by `nowMs`? */
export function stepAllowed(prev, next, nowMs) {
  if (![next.x, next.z].every(Number.isFinite)) return false;
  const secs = Math.max(0, (nowMs - prev.at) / 1000);
  return distance(prev, next) <= PRESENCE.slack + PRESENCE.maxSpeed * secs;
}
export const nearHub = (pos, hub, radius = PRESENCE.hubRadius) => (pos.floor ?? 0) === (hub.floor ?? 0) && distance(pos, hub) <= radius;