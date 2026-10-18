// lib/achievements.js
// Achievements are earned once and stored. Each rule looks at a snapshot of facts, so rules are easy to test.
const M = (n) => BigInt(n) * 100n; // naira -> kobo
export const ACHIEVEMENTS = [
  { key: "first_million", title: "First Million", text: "Hold ₦1,000,000 in cash.", check: (s) => s.cash >= M(1_000_000) },
  { key: "billionaire", title: "Billionaire", text: "Hold ₦1,000,000,000 in cash.", check: (s) => s.cash >= M(1_000_000_000) },
  { key: "lapo_legend", title: "LAPO to Legend", text: "Start as LAPO and hold ₦5,000,000.", check: (s) => s.class === "LAPO" && s.cash >= M(5_000_000) },
  { key: "nepo_royalty", title: "NEPO Royalty", text: "Start as NEPO and graduate.", check: (s) => s.class === "NEPO" && s.graduated },
  { key: "graduate", title: "Graduate", text: "Finish your degree.", check: (s) => s.graduated },
  { key: "first_class", title: "First Class", text: "Graduate with First Class honours.", check: (s) => s.graduated && s.classification === "First Class" },
  { key: "deans_list", title: "Dean's List", text: "Hold a CGPA of 4.0+ after at least 4 exams.", check: (s) => s.exams >= 4 && s.cgpa >= 4 },
  { key: "campus_big", titleFor: { M: "Campus Big Boy", F: "Campus Big Girl" }, text: "Reach 70 popularity.", check: (s) => s.popularity >= 70 },
  { key: "most_popular", title: "Most Popular", text: "Reach 90 popularity.", check: (s) => s.popularity >= 90 },
  { key: "party_animal", title: "Party Animal", text: "Go out 5 times.", check: (s) => s.tickets >= 5 },
  { key: "first_relationship", title: "First Relationship", text: "Reach the dating stage.", check: (s) => s.datedStage },
  { key: "engaged", title: "Put a Ring on It", text: "Get engaged to your babe.", check: (s) => s.engaged },
  { key: "bestie", title: "Ride or Die", text: "Grow a bestie bond to 80 affection.", check: (s) => s.bestie },
  { key: "busted", title: "Busted", text: "Get caught with a sneaky link while you have a babe.", check: (s) => s.busted },
  { key: "floor0", title: "Floor O Survivor", text: "Get caught by N-QRS once.", check: (s) => s.arrests >= 1 },
  { key: "first_business", title: "First Business", text: "Start a business.", check: (s) => s.bizEver >= 1 },
  { key: "tech_bro", title: "Tech Bro", text: "Start a tech company.", check: (s) => s.techEver >= 1 },
  { key: "business_mogul", title: "Business Mogul", text: "Run 3 businesses at once.", check: (s) => s.bizActive >= 3 },
];
export const titleOf = (a, gender) => a.title ?? a.titleFor[gender] ?? a.titleFor.M;
/** Keys the snapshot qualifies for. Pure. */
export const evaluate = (snap) => ACHIEVEMENTS.filter((a) => !a.unavailable && a.check(snap)).map((a) => a.key);