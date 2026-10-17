import { PX_PER_METER } from "../map";

/** Synced activity ids (PlayerState.act). Index 0 = doing nothing. */
export const ACTS = ["none", "sit", "sleep", "eat", "study", "pray", "tv", "play", "atm", "cook", "tutor", "loan", "dance", "exam"] as const;
export type ActKind = Exclude<(typeof ACTS)[number], "none">;

/** How an activity looks on the character. */
export const ACT_POSE: Record<ActKind, "sit" | "lie" | "busy" | "dance"> = {
  sit: "sit",
  sleep: "lie",
  eat: "busy",
  study: "sit",
  pray: "sit",
  tv: "sit",
  play: "busy",
  atm: "busy",
  cook: "busy",
  tutor: "sit",
  loan: "busy",
  dance: "dance",
  exam: "sit",
};

/** Verb shown on the action button. */
export const ACT_VERB: Record<ActKind, string> = {
  sit: "Sit",
  sleep: "Sleep",
  eat: "Buy",
  study: "Study",
  pray: "Pray",
  tv: "Watch TV",
  play: "Play",
  atm: "Use ATM",
  cook: "Work a shift",
  tutor: "Tutor students",
  loan: "Collect loan",
  dance: "Dance",
  exam: "Write exam",
};

/** Timed activities end by themselves after this many seconds. */
export const ACT_DURATION: Partial<Record<ActKind, number>> = { eat: 5, atm: 3, play: 20, cook: 25, tutor: 30, loan: 4, exam: 90 };

/** Needs change per second while doing an activity (on top of normal decay). */
export const ACT_RATES: Record<ActKind, { food?: number; energy?: number; fun?: number }> = {
  sit: { energy: 0.25, fun: 0.05 },
  sleep: { energy: 1.4 },
  eat: {},
  study: { fun: -0.05, energy: -0.02 },
  pray: { fun: 0.35, energy: 0.1 },
  tv: { fun: 0.7, energy: 0.15 },
  play: { fun: 1.2, energy: -0.35, food: -0.1 },
  atm: {},
  cook: { energy: -0.3, fun: -0.1 },
  tutor: { energy: -0.2 },
  loan: {},
  dance: { fun: 0.6, energy: -0.25 },
  exam: { energy: -0.15, fun: -0.1 },
};

/** Normal decay per second (needs run 0..100). */
export const NEEDS_DECAY = { food: 0.05, energy: 0.035, fun: 0.04 };
export const START_CASH = 2000;
export const ALLOWANCE = 3000;
/** Seconds between ATM allowances. */
export const ALLOWANCE_COOLDOWN = 180;
/** Seconds of studying per study point. */
export const STUDY_SECONDS_PER_POINT = 10;
/** Max distance (map px) from a spot's stand point to use it. */
export const USE_DISTANCE = 2.6 * PX_PER_METER;
