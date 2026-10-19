// lib3d/avatar/activityPlans.js
// What the character DOES for each activity: which clip, whether they sit on a chair or lie down, and what they turn to face. Pure data and one pure lookup
// (no 3D library), so the scene uses it to act the activity out and the tests check every activity in the catalogue has a sensible, distinct plan.
// clip: the animation to play; `cycle` plays several in turn (every CYCLE_S seconds); seat: "chair" | "lie" | null; face: item types to turn towards.
export const CYCLE_S = 5;
const BOARD = ["blackboard", "whiteboard", "podium"], PCS = ["pcrow", "pcdesk"], TABLES = ["table", "roundtable", "meetingtable", "desk", "studentdesk", "officedesk", "counter"];
const P = (clip, o = {}) => Object.freeze({ clip, cycle: null, seat: null, face: [], ...o });

const BY_ID = {
  // resting
  sleep_bed: P("sleepLie", { seat: "lie" }), bunk_rest: P("sleepLie", { seat: "lie" }), ward_rest: P("sleepLie", { seat: "lie" }), cell_bunk: P("sleepLie", { seat: "lie" }),
  nap_common: P("sit", { seat: "chair" }), triage_treatment: P("sit", { seat: "chair" }), cell_pushups: P("work"),
  // food, shopping, errands
  eat_meal: P("eatSit", { seat: "chair", face: TABLES }), buy_snack: P("eat"),
  fresh_produce: P("shop", { face: ["stall", "stalls", "shelf", "bookshelf"] }), provisions: P("shop", { face: ["shelf", "bookshelf", "stall", "stalls"] }),
  bookshop_revision: P("shop", { face: ["bookshelf"] }), buy_medicine: P("shop", { face: ["shelf", "counter"] }), haggle: P("talk", { cycle: ["talk", "gesture"], face: ["stall", "stalls"] }),
  hostel_cook: P("work", { face: ["counter", "table"] }), bank_errand: P("interact", { face: ["counter"] }), registry_errand: P("interact", { face: ["counter", "desk"] }),
  coop_desk: P("interact", { face: ["counter", "desk"] }), help_desk: P("interact", { cycle: ["interact", "talk"], face: ["counter", "desk"] }), catering_help: P("work", { face: ["counter", "table"] }),
  buy_data: P("phone"), phone_fix: P("phone", { cycle: ["phone", "interact"] }),
  // talking with a person
  fin_advice: P("talk", { face: ["desk", "officedesk", "counter"] }), academic_adviser: P("talk", { face: ["desk", "officedesk"] }), health_checkup: P("talk", { face: ["desk"] }),
  pastoral_chat: P("talk"), hall_chat: P("talk"), patio_chat: P("talk"), student_dialogue: P("listen", { seat: "chair", cycle: ["listen", "talk"] }),
  // learning
  attend_class: P("listen", { seat: "chair", face: BOARD }), study_course: P("read", { seat: "chair", cycle: ["read", "write"], face: TABLES }),
  class_test: P("write", { seat: "chair", face: TABLES }), sit_exam: P("write", { seat: "chair", face: TABLES }),
  research_session: P("read", { seat: "chair", face: TABLES }), quran_study: P("read", { seat: "chair", face: TABLES }), group_study: P("talk", { seat: "chair", cycle: ["talk", "read"], face: TABLES }),
  eresource_lab: P("type", { seat: "chair", face: PCS }), ict_lab: P("type", { seat: "chair", face: PCS }), practical: P("work", { cycle: ["work", "type"], face: ["labbench", "workbench", "soilbench"] }),
  museum_tour: P("lookAround"), edu_session: P("listen", { seat: "chair", face: BOARD }), training_session: P("listen", { seat: "chair", face: BOARD }), senate_session: P("listen", { seat: "chair", face: ["podium", "meetingtable"] }),
  // meetings, worship, events
  union_meeting: P("listen", { seat: "chair", face: ["podium", "meetingtable"] }), coop_meeting: P("listen", { seat: "chair", face: ["podium", "meetingtable"] }),
  worship_service: P("pray", { face: ["podium"] }), fellowship: P("greet", { cycle: ["greet", "talk"] }), join_club: P("greet", { cycle: ["greet", "talk"] }),
  hall_event: P("listen", { seat: "chair", cycle: ["listen", "cheer"], face: ["podium", "stage"] }), attend_event: P("listen", { seat: "chair", cycle: ["listen", "cheer"], face: ["podium", "stage"] }),
  stage_rehearsal: P("present", { cycle: ["present", "cheer"], face: ["stage", "podium"] }), volunteer_teach: P("present", { cycle: ["present", "talk"], face: BOARD }),
  network_vip: P("greet", { cycle: ["greet", "talk", "drink"] }), vip_mingle: P("greet", { cycle: ["greet", "talk", "drink"] }), hotspot_hangout: P("talk", { cycle: ["talk", "drink", "greet"] }),
  // play
  play_games: P("cheer"), watch_match: P("cheer"), play_squash: P("play"), dance: P("idleEmote", { cycle: ["idleEmote", "cheer"] }), club_drink: P("drink"),
  // hustles
  event_gig: P("greet", { cycle: ["greet", "gesture", "talk"] }), back_room_deal: P("talk", { cycle: ["talk", "gesture"] }),
};
const FALLBACK = P("interact");

/** The plan for an activity id (an unknown id gets a neutral standing "interact"). */
export const planFor = (id) => BY_ID[id] ?? FALLBACK;
/** Which clip of a plan to show `elapsed` seconds into the activity, given the clips the character can actually play. */
export function clipAt(plan, elapsed, has) {
  const list = (plan.cycle?.length ? plan.cycle : [plan.clip]).filter((n) => has(n));
  if (!list.length) return has(plan.clip) ? plan.clip : "idle";
  return list[Math.floor(Math.max(0, elapsed) / CYCLE_S) % list.length];
}
export const PLAN_IDS = Object.keys(BY_ID);
