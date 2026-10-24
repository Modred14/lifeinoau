// lib/hubActions.js
// What the yellow rings do. Every building plan (lib3d/interiors/plans*.js, planKit.js hub()) puts a few yellow "desk" rings on the floor: the reception,
// the notice board, the stewards' desk, the back stairwell... They are not the teal activity rings of lib/activities.js. Before this file they all fell
// through to the "About this place" card, so using one did nothing.
//
// Every yellow ring now leads to something that really works, and this table is the only place that says what:
//   { acts: [...] }   a building activity. The character WALKS to the nearest teal ring of the first of these the building offers (the walk, the cost, the
//                     limits and the reward are exactly those of that activity: nothing is paid or given here), and its panel opens there.
//   { app: "..." }    a phone app (components/Phone.js), opened on top of the room. Used where the desk's job is information (timetable, notices,
//                     housing, parties) and no ring does it.
//   { desk: "custody" } the charge desk in Floor O (N-QRS Custody).
//   { club: "dj" | "menu" } inside a nightclub: the DJ booth opens the music screen, the bottle-service spot opens the VIP menu (components/ClubLayer.js listens for "oau:club-ui").
// The key is the ring's label. A ring that carries a type of its own (`act` in the plan: "lecture", "test", "exam", "crew", "backstairs", "faculty")
// falls back to BY_TYPE when its label is not listed. tests/hub-actions.test.mjs walks every ring of every real building and fails when one has no
// target, when a target activity is not offered in that building, or when a target app does not exist.

export const BY_LABEL = {
  // faculties and lecture buildings (these desks stand beside the rings they stand for)
  "Entrance desk: timetable and notices": { app: "courses" },
  "Faculty office desk": { app: "courses" },
  "Lecture hall: take a seat": { acts: ["attend_class"] },
  "Test hall: class test": { acts: ["class_test"] },
  "Examination hall": { acts: ["sit_exam"] },
  "Check your timetable": { app: "courses" },
  "Library services and courses": { app: "courses" },
  "Academic affairs desk": { acts: ["academic_adviser"] },
  // halls, blocks and the Students' Union
  "Hall reception": { app: "housing" },
  "Notice board": { app: "sug" },
  "Meet people and join clubs": { acts: ["join_club"] },
  // the two hustles
  "Stewards' desk: join the event crew": { acts: ["event_gig"] },
  "Back stairwell: backstairs runs": { acts: ["back_room_deal"] },
  "Events and tickets": { acts: ["hall_event"] },
  "Events and parties": { acts: ["attend_event"] },
  "Cooperative services": { acts: ["coop_desk"] },
  // money, shops and food
  "Banking enquiries": { acts: ["fin_advice", "bank_errand"] },
  "Phone shop": { acts: ["phone_fix"] },
  "School bookshop": { acts: ["bookshop_revision"] },
  "Hang out": { acts: ["hotspot_hangout"] },
  "Eat something": { acts: ["eat_meal"] },
  "Buy snacks": { acts: ["buy_snack"] },
  "Provisions": { acts: ["provisions"] },
  "Market life": { acts: ["fresh_produce"] },
  // health, sport, learning, worship, nightlife, custody
  "Reception": { acts: ["health_checkup"] },
  "Book a court": { acts: ["play_squash"] },
  "Museum information": { acts: ["museum_tour"] },
  "School office": { acts: ["volunteer_teach"] },
  "Join the fellowship": { acts: ["fellowship"] },
  "Join the community": { acts: ["fellowship"] },
  "This week's parties": { app: "parties" },
  "DJ booth: the music": { club: "dj" },
  "Bottle service: VIP menu": { club: "menu" },
  "Settle your bill": { desk: "custody" },
};

/** The plan's own type of a ring (its `act`) when its label is not in BY_LABEL. */
export const BY_TYPE = {
  faculty: { app: "courses" },
  lecture: { acts: ["attend_class"] },
  test: { acts: ["class_test"] },
  exam: { acts: ["sit_exam"] },
  crew: { acts: ["event_gig"] },
  backstairs: { acts: ["back_room_deal"] },
};

/**
 * What a yellow ring leads to: { kind: "activity", acts } | { kind: "app", app } | { kind: "desk", desk } | { kind: "club", panel } | { kind: "info" }.
 * `info` (the About card) is only the last resort for a ring the table does not know, so a new ring is never dead: the test makes sure none reaches it.
 */
export function resolveHub(hub) {
  const t = BY_LABEL[hub?.label] ?? BY_TYPE[hub?.act] ?? null;
  if (!t) return { kind: "info" };
  if (t.acts) return { kind: "activity", acts: t.acts };
  if (t.app) return { kind: "app", app: t.app };
  if (t.desk) return { kind: "desk", desk: t.desk };
  if (t.club) return { kind: "club", panel: t.club };
  return { kind: "info" };
}

/** The first of `acts` that has a card among `cards` ({ act, blocked }): a usable one if there is one, else the first that exists (so its reason can be shown). */
export function pickCard(cards, acts) {
  const mine = (cards ?? []).filter((c) => acts.includes(c.act));
  if (!mine.length) return null;
  const rank = (c) => acts.indexOf(c.act);
  const usable = mine.filter((c) => !c.blocked).sort((a, b) => rank(a) - rank(b));
  return usable[0] ?? [...mine].sort((a, b) => rank(a) - rank(b))[0];
}
