// lib/relationships.js
// The rules of the Love app, as plain functions with no database and no browser in them. The server (relationshipService.js) decides with
// these, and the phone (RelationshipApp.js) uses the same numbers to show a change the instant a button is tapped.
//
// Players only. Two players can start something once they have really talked (a message each way). Opposite genders can go on to date;
// the same gender stays bestie. Dates, a meal and a visit unlock "be my babe" / "be my sneaky link". A babe can be proposed to after a week,
// and a babe can be asked to move in once you live off campus. Keep a sneaky link on the side while you have a babe and you can get caught.

export const KINDS = ["TALKING", "BESTIE", "SNEAKY", "BABE", "ENGAGED", "EX"];
export const LABEL = { TALKING: "Talking", BESTIE: "Bestie", SNEAKY: "Sneaky link", BABE: "Babe", ENGAGED: "Engaged", EX: "Ex" };
export const LIVE = ["TALKING", "BESTIE", "SNEAKY", "BABE", "ENGAGED"]; // every kind except a breakup
export const COUPLE = ["BABE", "ENGAGED"]; // the one main partner
export const ROMANTIC = ["TALKING", "SNEAKY", "BABE", "ENGAGED"];

/** What two players need to have done before either can ask the other to be babe or sneaky link. */
export const NEED = { dates: 2, meals: 1, visits: 1 };
export const PROPOSE_AFTER_WEEKS = 1; // weeks as babe before a proposal (a week is the game's own unit)
export const MAX_SNEAKY = 2; // sneaky links one player can keep at a time
export const REQUEST_WEEKS = 3; // a request nobody answers lapses after this many weeks
export const RECONCILE_WEEKS = 4; // how long after a breakup you can still ask for another chance
export const MAX_OPEN_REQUESTS = 8; // requests one player can have waiting at once

const N = (n) => BigInt(n) * 100n;
/** Money in naira, kobo is applied by the service. */
export const COST = { food: 8_000, date: 15_000, hang: 3_000, safe: 3_000, apology: 50_000, reconcile: 10_000 };
export const GIFTS = { small: [5_000, 5], medium: [20_000, 12], big: [50_000, 22] }; // [naira, affection]
export const RINGS = { simple: [250_000, 20], classic: [750_000, 30], royal: [2_000_000, 45] }; // [naira, affection]
export const PREGNANCY_RISK = { risky: 6, safe: 1 }; // percent per night in

/**
 * Every shared or solo activity. `solo` ones happen at once, the rest are invites the other player answers.
 * energy: spent by each player (the one buying or both for an invite). happy: gained by each. cost: naira paid by the one who invites.
 */
export const ACTIVITY = {
  note:  { solo: true,  label: "Send a note",   aff: 2,  energy: 0,  happy: 2,  cost: 0,                 limit: "player", kinds: LIVE },
  food:  { solo: true,  label: "Buy them food", aff: 6,  energy: 3,  happy: 4,  cost: COST.food,         limit: "player", kinds: LIVE, counts: "meals" },
  gift:  { solo: true,  label: "Send a gift",   aff: 0,  energy: 0,  happy: 4,  cost: 0,                 limit: "player", kinds: LIVE },
  date:  { solo: false, label: "Go on a date",  aff: 14, energy: 15, happy: 10, cost: COST.date,         limit: "pair",   kinds: ROMANTIC, counts: "dates" },
  visit: { solo: false, label: "Have them over", aff: 8, energy: 8,  happy: 5,  cost: 0,                 limit: "pair",   kinds: LIVE, counts: "visits" },
  hang:  { solo: false, label: "Hang out",      aff: 8,  energy: 8,  happy: 8,  cost: COST.hang,         limit: "pair",   kinds: ["BESTIE"] },
  night: { solo: false, label: "A night in",    aff: 10, energy: 10, happy: 12, cost: 0,                 limit: "pair",   kinds: ["SNEAKY", "BABE", "ENGAGED"] },
};
/** The notes one player can send another (they land in Messages). Chosen by number so nothing else can be injected. */
export const NOTES = ["Just thinking about you.", "You crossed my mind today. That is all.", "Come and see me later?", "You made my day."];
export const INVITES = ["date", "visit", "hang", "night"];
export const ASKS = ["BABE", "SNEAKY", "PROPOSE", "MOVEIN", "RECONCILE"];
export const REQUEST_KINDS = [...INVITES.map((k) => k.toUpperCase()), ...ASKS];

// ---- small helpers ----
export const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
export const pairIds = (a, b) => (a < b ? [a, b] : [b, a]);
export const otherOf = (bond, me) => (bond.lowId === me ? bond.highId : bond.lowId);
export const sameSex = (a, b) => a === b;
export const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");
export const offCampus = (hostel, privateHomes) => privateHomes.includes(hostel);

/** What a bond starts as: opposite genders are "talking", the same gender are besties. */
export const startKind = (genderA, genderB) => (genderA === genderB ? "BESTIE" : "TALKING");

/** Affection after the weeks of silence. Three a week; a couple living together only lose one. */
export const decayFor = (lastWeek, week, together = false) => (together ? 1 : 3) * Math.max(0, week - lastWeek - 1);
export const affectionNow = (bond, week, together = false) => clamp(bond.affection - decayFor(bond.lastWeek, week, together));

export const MOODS = [[80, "Inseparable"], [60, "Smitten"], [40, "Into each other"], [20, "Warming up"], [0, "Just getting to know each other"]];
export const moodOf = (aff) => MOODS.find(([min]) => aff >= min)[1];

/** The checklist shown before "be my babe": what has been done and what has not. */
export function progress(bond) {
  const items = [
    { key: "dates", label: "Go on 2 dates", have: Math.min(bond.dates, NEED.dates), need: NEED.dates },
    { key: "meals", label: "Buy each other food", have: Math.min(bond.meals, NEED.meals), need: NEED.meals },
    { key: "visits", label: "Have them over to your side", have: Math.min(bond.visits, NEED.visits), need: NEED.visits },
  ];
  return { items, ready: items.every((i) => i.have >= i.need) };
}

/** The weekly limit slot for an activity: one per pair, or one per player. */
export const limitKey = (activity, me) => (ACTIVITY[activity].limit === "player" ? `${me}:${activity}` : activity);
export const doneThisWeek = (bond, activity, me, week) => (bond.done ?? {})[limitKey(activity, me)] === week;

/**
 * Can this player do this activity with this bond right now? `ctx` is what the caller knows:
 *   me (id), week, energy (mine), theirEnergy (for invites, optional)
 * Returns null when it is fine, otherwise the reason to show.
 */
export function whyNotActivity(bond, activity, ctx) {
  const a = ACTIVITY[activity];
  if (!a) return "Unknown activity.";
  if (bond.kind === "EX") return "You two are not together any more.";
  if (!a.kinds.includes(bond.kind)) return activity === "date" ? "Dates are for people who are into each other, not besties." : activity === "hang" ? "Only besties hang out like that." : "That is not available for this bond yet.";
  if (bond.cheatedBy && bond.cheatedBy === ctx.me && !a.solo) return "Trust is broken. They have to forgive you first.";
  if (bond.cheatedBy && bond.cheatedBy !== ctx.me && !a.solo) return "You caught them. Forgive them or end it first.";
  if (doneThisWeek(bond, activity, ctx.me, ctx.week)) return a.limit === "pair" ? "You two already did that this week." : "You already did that this week.";
  if (a.energy && ctx.energy < a.energy) return "You are too tired for that.";
  return null;
}

/**
 * Can a status ask (BABE, SNEAKY, PROPOSE, MOVEIN, RECONCILE) be made? `ctx`:
 *   me, week, myGender, theirGender, myHostel, offCampus (am I off campus), hasBabe (I already have a babe or fiance, someone else),
 *   theyHaveBabe, mySneaky (how many sneaky links I have), theirSneaky
 * Returns null when it is fine, otherwise the reason to show.
 */
export function whyNotAsk(bond, kind, ctx) {
  if (kind === "RECONCILE") {
    if (bond.kind !== "EX") return "You are not broken up.";
    if (ctx.week - (bond.endedWeek ?? 0) > RECONCILE_WEEKS) return "Too much time has passed. Start over as friends instead.";
    if (COUPLE.includes(bond.prevKind) && (ctx.hasBabe || ctx.theyHaveBabe)) return "One of you has a babe now.";
    return null;
  }
  if (bond.kind === "EX") return "You two are not together any more.";
  if (bond.cheatedBy) return bond.cheatedBy === ctx.me ? "Trust is broken. They have to forgive you first." : "You caught them. Forgive them or end it first.";
  if (kind === "BABE" || kind === "SNEAKY") {
    if (ctx.myGender === ctx.theirGender) return "Same gender stays bestie. Only opposite genders can date.";
    if (bond.kind === "BESTIE") return "Besties stay besties.";
    if (COUPLE.includes(bond.kind)) return "You are already a couple.";
    if (kind === "SNEAKY" && bond.kind === "SNEAKY") return "They are already your sneaky link.";
    if (!progress(bond).ready) return "Do more together first: 2 dates, food and a visit.";
    if (kind === "BABE" && (ctx.hasBabe || ctx.theyHaveBabe)) return ctx.hasBabe ? "You already have a babe." : "They already have a babe.";
    if (kind === "SNEAKY" && (ctx.mySneaky >= MAX_SNEAKY || ctx.theirSneaky >= MAX_SNEAKY)) return ctx.mySneaky >= MAX_SNEAKY ? `You already have ${MAX_SNEAKY} sneaky links.` : "They have too many sneaky links.";
    return null;
  }
  if (kind === "PROPOSE") {
    if (bond.kind === "ENGAGED") return "You are already engaged.";
    if (bond.kind !== "BABE") return "You can only propose to your babe.";
    if (ctx.week - bond.kindWeek < PROPOSE_AFTER_WEEKS) return `Date for ${PROPOSE_AFTER_WEEKS} week first.`;
    return null;
  }
  if (kind === "MOVEIN") {
    if (!COUPLE.includes(bond.kind)) return "Only your babe can move in with you.";
    if (!ctx.offCampus) return "You have to live off campus before you can take your babe home.";
    if (ctx.together) return "You already live together.";
    return null;
  }
  return "Unknown request.";
}

/** Same checks for a request kind that is an invite (DATE, VISIT, HANG, NIGHT). */
export const whyNotInvite = (bond, kind, ctx) => whyNotActivity(bond, kind.toLowerCase(), ctx);

/** The label of the thing a request asks for, for the person answering. */
export const REQUEST_TEXT = {
  DATE: (n) => `${n} wants to take you on a date`,
  VISIT: (n) => `${n} invited you over to their place`,
  HANG: (n) => `${n} wants to hang out`,
  NIGHT: (n) => `${n} invited you for a night in`,
  BABE: (n) => `${n} wants you to be their babe`,
  SNEAKY: (n) => `${n} wants you as their sneaky link`,
  PROPOSE: (n) => `${n} is proposing to you`,
  MOVEIN: (n) => `${n} wants you to move in with them`,
  RECONCILE: (n) => `${n} wants another chance`,
};

/**
 * The chance (percent) that the babe finds out while this player is with a sneaky link.
 * `ctx`: luck, popularity (of the one who might get caught), together (they live with their babe), sameHall (same hostel).
 */
export function catchChance(activity, { luck = 50, popularity = 10, together = false, sameHall = false } = {}) {
  const base = { note: 3, food: 8, gift: 5, visit: 20, date: 25, night: 30 }[activity] ?? 0;
  if (!base) return 0;
  return Math.max(3, Math.min(70, Math.round(base - luck * 0.1 + popularity * 0.06 + (together ? 15 : 0) + (sameHall ? 8 : 0))));
}
export const CAUGHT = { affection: 35, happiness: 12, popularity: 3, babeHappiness: 15, apology: 15, forgiveAffection: 10 };

/** What a finished activity changes for each player. Pure: the service writes it, the phone mirrors it. */
export function outcome(activity, { variant, tier } = {}) {
  const a = ACTIVITY[activity];
  let aff = a.aff, costNaira = a.cost, note = null;
  if (activity === "gift") { const g = GIFTS[tier]; if (!g) return { error: "Choose a gift." }; aff = g[1]; costNaira = g[0]; }
  if (activity === "night") { costNaira = variant === "safe" ? COST.safe : 0; }
  return { aff, costNaira, costKobo: N(costNaira), energy: a.energy, happy: a.happy, counts: a.counts ?? null, note };
}

/** The ring's price and what it does to the bond. */
export const ringOf = (tier) => { const r = RINGS[tier]; return r ? { costNaira: r[0], costKobo: N(r[0]), aff: r[1] } : null; };

export const weeksSince = (week, since) => Math.max(0, week - since);