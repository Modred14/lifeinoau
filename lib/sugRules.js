// lib/sugRules.js
// The rules of the SUG (Students' Union Government) election and the student government, as pure data and pure functions: no database, no clock of its own,
// no React. The server (lib/sugService.js, lib/governmentService.js, lib/assemblyService.js) enforces them; the SUG app reads the same constants so the
// screens say exactly what the server will accept. tests/sug.test.mjs checks the rules without a database.
//
// THE RULES IN ONE PLACE
//  - 41 elected seats: 9 executive posts (1 seat each), Speaker (1), Deputy Speaker (1) and 30 Honourable Member seats. (The brief says 39; the
//    arithmetic of its own list is 9 + 2 + 30 = 41, and that is what is built.) The Clerk of the Assembly is appointed by the Speaker, not elected.
//  - A player may stand for ONE position per cycle (a database unique key). The same rule applies to registering, campaigning, voting and results.
//  - Any eligible student may vote in every race, including a race they stand in. One ballot per voter per race per round (a database unique key).
//    For the Honourable Member race a voter picks one candidate and the 30 candidates with the most valid votes win.
//  - A candidate needs at least one valid vote to win. Seats nobody qualifies for stay VACANT for the term.
//  - A tie that decides who wins a seat goes to a RUNOFF between the tied candidates (a short second round). If the runoff is tied too, the candidate
//    who registered first wins. No random choice anywhere.
//  - Government privileges exist only while the government's term is running, checked against the clock on every request. They are political roles
//    only: nothing here can grant an application administrator permission.

// ============================================================================================================================ positions
export const HM_SEATS = 30;
/** Every elected post, in ballot order. `group`: EXECUTIVE or ASSEMBLY. */
export const POSITIONS = [
  { key: "PRESIDENT", title: "SUG President", short: "President", group: "EXECUTIVE", seats: 1, about: "Leads the Students' Union Government and speaks for every student." },
  { key: "VICE_PRESIDENT", title: "SUG Vice President", short: "Vice President", group: "EXECUTIVE", seats: 1, about: "Deputises for the President and coordinates the executive." },
  { key: "SECRETARY_GENERAL", title: "Secretary General", short: "Sec. General", group: "EXECUTIVE", seats: 1, about: "Keeps the Union's records and publishes meeting notices." },
  { key: "ASSISTANT_SECRETARY_GENERAL", title: "Assistant Secretary General", short: "Asst. Sec. General", group: "EXECUTIVE", seats: 1, about: "Assists the Secretary General and keeps the notices going out." },
  { key: "PRO", title: "Public Relations Officer", short: "PRO", group: "EXECUTIVE", seats: 1, about: "The Union's voice: publishes official statements." },
  { key: "DIRECTOR_SOCIALS", title: "Director of Socials", short: "Dir. Socials", group: "EXECUTIVE", seats: 1, about: "Organises parties, nights out and social events." },
  { key: "DIRECTOR_SPORTS", title: "Director of Sports", short: "Dir. Sports", group: "EXECUTIVE", seats: 1, about: "Organises sports competitions and keeps students active." },
  { key: "FINANCIAL_SECRETARY", title: "Financial Secretary", short: "Fin. Secretary", group: "EXECUTIVE", seats: 1, about: "Looks after the Union's money and reports on how it is spent." },
  { key: "WELFARE_OFFICER", title: "Welfare Officer", short: "Welfare", group: "EXECUTIVE", seats: 1, about: "Looks after student welfare: health, food, hostels, and fair treatment." },
  { key: "SPEAKER", title: "Speaker of the Assembly", short: "Speaker", group: "ASSEMBLY", seats: 1, about: "Presides over the Student Representative Assembly." },
  { key: "DEPUTY_SPEAKER", title: "Deputy Speaker", short: "Deputy Speaker", group: "ASSEMBLY", seats: 1, about: "Assists the Speaker and presides when the Speaker cannot." },
  { key: "HONOURABLE_MEMBER", title: "Honourable Member", short: "Honourable Member", group: "ASSEMBLY", seats: HM_SEATS, about: `One of the ${HM_SEATS} members who debate and vote on bills and motions.` },
];
export const CLERK = "CLERK";
export const CLERK_TITLE = "Clerk of the Assembly";
export const POSITION_KEYS = POSITIONS.map((p) => p.key);
export const positionOf = (key) => POSITIONS.find((p) => p.key === key) ?? null;
export const isElectedPosition = (key) => POSITION_KEYS.includes(key);
/** Every title a player can hold, for display (the Clerk included). */
export const titleOf = (key) => (key === CLERK ? CLERK_TITLE : positionOf(key)?.title ?? null);
/** 9 executive + 2 assembly leaders + 30 members. */
export const TOTAL_ELECTED_SEATS = POSITIONS.reduce((n, p) => n + p.seats, 0);
export const isAssemblyPosition = (key) => positionOf(key)?.group === "ASSEMBLY";
export const isAssemblyMember = (key) => key === "SPEAKER" || key === "DEPUTY_SPEAKER" || key === "HONOURABLE_MEMBER";

// ============================================================================================================================ the timetable
import { GAME_UTC_OFFSET_MIN } from "./campus-clock.js";
export const HOUR = 3_600_000;
/** A wall-clock time in the game's own zone (West Africa Time, Africa/Lagos, UTC+1, no daylight saving: see lib/campus-clock.js) as an absolute ms timestamp. */
const gameTime = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) - GAME_UTC_OFFSET_MIN * 60_000;
/**
 * THE FIXED CALENDAR of the current election (all times are game time, Africa/Lagos):
 *  - registration is open from Thursday 22 October 2026 and closes at the end of Sunday 25 October 2026 (23:59:59);
 *  - voting opens on Tuesday 27 October 2026 at 00:00, two calendar days after registration closes, and the campaign runs in between.
 * `registrationClosesAt` is the first instant a nomination is refused (a cycle's `campaignStartsAt`), `votingStartsAt` the first instant a ballot is accepted.
 * Every check (the server, the database triggers, the countdowns and the screens) reads these as the cycle's stored dates, so they cannot disagree.
 * It applies to the election announced before it, and only when SUG_TIME_SCALE is 1; later elections follow the hour-based STAGE_HOURS timetable.
 */
export const ELECTION_SCHEDULE = {
  registrationOpensAt: gameTime(2026, 10, 22, 0, 0, 0),
  registrationClosesAt: gameTime(2026, 10, 25, 23, 59, 59),
  votingStartsAt: gameTime(2026, 10, 27, 0, 0, 0),
};
/** How long each stage lasts. SUG_TIME_SCALE (an env number, default 1) shrinks or stretches all of them, for demos and tests. */
export const STAGE_HOURS = { lead: 1, registration: 24, campaign: 48, voting: 24, results: 1, runoff: 6, formation: 1, term: 24 * 7 }; // a government's term lasts one week
const scaleOf = () => { const n = Number(typeof process !== "undefined" ? process.env.SUG_TIME_SCALE : 1); return Number.isFinite(n) && n > 0 ? n : 1; };
/** A runoff, if one is needed, starts right after the voting ends and lasts this long; the term starts after it (so the timetable never has to move). */
export const runoffMs = () => STAGE_HOURS.runoff * HOUR * scaleOf();
/** The gap between one government's end and the announcement of the next election's timetable beginning (they overlap so the next term starts as this ends). */
export function leadMs(h = STAGE_HOURS, scale = scaleOf()) { return (h.lead + h.registration + h.campaign + h.voting + h.results + h.runoff + h.formation) * HOUR * scale; }

/**
 * The whole timetable of a cycle from the moment it is announced. `notBefore` keeps a new term from starting before the last one ends.
 * Every boundary is an absolute time (ms), so the stage is always worked out from the clock, never from a timer.
 */
export function buildTimetable(announceMs, { hours = STAGE_HOURS, scale = scaleOf(), notBefore = 0 } = {}) {
  const h = { ...STAGE_HOURS, ...hours }, U = HOUR * scale;
  const registrationOpensAt = announceMs + h.lead * U, campaignStartsAt = registrationOpensAt + h.registration * U, votingStartsAt = campaignStartsAt + h.campaign * U, votingEndsAt = votingStartsAt + h.voting * U;
  const termStartsAt = Math.max(votingEndsAt + (h.results + h.runoff + h.formation) * U, notBefore);
  return { announcedAt: announceMs, registrationOpensAt, campaignStartsAt, votingStartsAt, votingEndsAt, termStartsAt, termEndsAt: termStartsAt + h.term * U };
}

/** The timetable of the fixed calendar (ELECTION_SCHEDULE): same shape and same later stages as buildTimetable(). */
export function scheduledTimetable(announceMs, { hours = STAGE_HOURS } = {}) {
  const h = { ...STAGE_HOURS, ...hours }, S = ELECTION_SCHEDULE;
  const votingEndsAt = S.votingStartsAt + h.voting * HOUR, termStartsAt = votingEndsAt + (h.results + h.runoff + h.formation) * HOUR;
  return { announcedAt: Math.min(announceMs, S.registrationOpensAt), registrationOpensAt: S.registrationOpensAt, campaignStartsAt: S.registrationClosesAt, votingStartsAt: S.votingStartsAt, votingEndsAt, termStartsAt, termEndsAt: termStartsAt + h.term * HOUR };
}
/** Does this cycle (or timetable) already carry the dates of the fixed calendar? */
export const onSchedule = (t, hours = STAGE_HOURS) => {
  const s = scheduledTimetable(0, { hours }), ms = (k) => (t[k] == null ? null : +new Date(t[k]));
  return ["registrationOpensAt", "campaignStartsAt", "votingStartsAt", "votingEndsAt", "termStartsAt", "termEndsAt"].every((k) => ms(k) === s[k]);
};
/**
 * The timetable a new cycle gets. The election announced before the fixed calendar's voting day follows that calendar. Anything later (the next
 * elections, which `notBefore` marks), or any run with SUG_TIME_SCALE set for a demo or a test, follows the hour-based timetable.
 */
export function defaultTimetable(announceMs, { notBefore = 0, scale = scaleOf() } = {}) {
  return scale === 1 && !notBefore && announceMs < ELECTION_SCHEDULE.votingStartsAt ? scheduledTimetable(announceMs) : buildTimetable(announceMs, { notBefore, scale });
}

/** Checks a timetable a person typed in (admin) against the order the database insists on. Returns a message or null. */
export function timetableProblem(t) {
  const k = ["announcedAt", "registrationOpensAt", "campaignStartsAt", "votingStartsAt", "votingEndsAt", "termStartsAt", "termEndsAt"];
  for (const x of k) if (!Number.isFinite(t[x])) return `${x} is not a valid date.`;
  if (!(t.announcedAt <= t.registrationOpensAt && t.registrationOpensAt < t.campaignStartsAt && t.campaignStartsAt < t.votingStartsAt && t.votingStartsAt < t.votingEndsAt)) return "The dates must run in order: announce, registration opens, campaign starts, voting starts, voting ends.";
  if (t.termStartsAt < t.votingEndsAt + runoffMs()) return `The term must start at least ${STAGE_HOURS.runoff} hours after voting ends (room for a runoff).`;
  if (t.termEndsAt <= t.termStartsAt) return "The term must end after it starts.";
  return null;
}

export const STAGES = ["ANNOUNCED", "REGISTRATION", "CAMPAIGN", "VOTING", "RUNOFF", "RESULTS", "FORMATION", "ACTIVE", "COMPLETED"];
export const STAGE_INFO = {
  ANNOUNCED: { label: "Election announced", short: "Announced", can: "Registration opens soon. Read the timetable and get your manifesto ready." },
  REGISTRATION: { label: "Candidate registration", short: "Registration", can: "Eligible students can declare for one position. Voting and campaign events have not started." },
  CAMPAIGN: { label: "Campaign period", short: "Campaign", can: "Registration is closed. Candidates campaign: speeches, rallies, posters. Read the manifestos. Voting has not opened." },
  VOTING: { label: "Voting period", short: "Voting", can: "Vote once in each race. Results are hidden until voting ends." },
  RUNOFF: { label: "Runoff voting", short: "Runoff", can: "A tie decides a seat. Vote again, only among the tied candidates." },
  RESULTS: { label: "Results announcement", short: "Results", can: "Voting is over. The results are final and public." },
  FORMATION: { label: "Government formation", short: "Forming", can: "The winners are named and the new government is being formed. Their term has not begun." },
  ACTIVE: { label: "Active term", short: "In office", can: "The government is in office. Offices carry only the powers of their post." },
  COMPLETED: { label: "Term completed", short: "Term over", can: "The government's term has ended. Their powers have ended; the record stays." },
  CANCELLED: { label: "Election cancelled", short: "Cancelled", can: "This election was cancelled by an administrator." },
};

/**
 * The stage of a cycle at time `now` (ms), from its timestamps alone. `cycle` has the date columns as Dates or numbers.
 * Between the end of voting and the publication of the results the stage is RESULTS ("counting"); a runoff shows RUNOFF while it is open.
 */
export function stageOf(cycle, now) {
  const t = (k) => (cycle[k] == null ? null : +new Date(cycle[k]));
  if (cycle.status === "CANCELLED") return "CANCELLED";
  if (now < t("registrationOpensAt")) return "ANNOUNCED";
  if (now < t("campaignStartsAt")) return "REGISTRATION";
  if (now < t("votingStartsAt")) return "CAMPAIGN";
  if (now < t("votingEndsAt")) return "VOTING";
  if (cycle.resultsAt == null) return t("runoffStartsAt") != null && now < t("runoffEndsAt") ? "RUNOFF" : "RESULTS";
  if (now >= t("termEndsAt")) return "COMPLETED";
  if (now >= t("termStartsAt")) return "ACTIVE";
  return now < t("resultsAt") + STAGE_HOURS.results * HOUR * scaleOf() ? "RESULTS" : "FORMATION";
}
export const VOTING_STAGES = ["VOTING", "RUNOFF"];
/** The round that is open for ballots now (1 or 2), or 0. */
export function openRound(cycle, now) {
  const t = (k) => (cycle[k] == null ? null : +new Date(cycle[k]));
  if (cycle.status !== "LIVE" || cycle.resultsAt != null) return 0;
  if (now >= t("votingStartsAt") && now < t("votingEndsAt")) return 1;
  if (t("runoffStartsAt") != null && now >= t("runoffStartsAt") && now < t("runoffEndsAt")) return 2;
  return 0;
}
/** How the game's time zone shows a moment, for messages and notifications ("Sun 25 Oct, 11:59 PM"). */
export const gameWhen = (ms) => new Date(ms).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" }).replace(/\s?(am|pm)/i, (m) => " " + m.trim().toUpperCase());
export const registrationOpen = (cycle, now) => cycle.status === "LIVE" && now >= +new Date(cycle.registrationOpensAt) && now < +new Date(cycle.campaignStartsAt);
/** Campaign activities run from the start of the campaign period until voting ends (candidates may keep campaigning on voting days). */
export const campaignOpen = (cycle, now) => cycle.status === "LIVE" && now >= +new Date(cycle.campaignStartsAt) && now < +new Date(cycle.votingEndsAt);

// ============================================================================================================================ money
const N = (n) => BigInt(n) * 100n; // naira to kobo
/** Defaults for a new cycle (kept on the cycle row, so changing them never alters an old election). */
export const MONEY = { nominationFeeKobo: N(5_000), spendCapExecKobo: N(150_000), spendCapAssemblyKobo: N(60_000) };
// ============================================================================================================================ stipends
/** What office pays. Money is created by the world (like a wage), paid through the ledger, and never goes beyond what the rules below say.
 *  - the 9 executive posts, the Speaker, the Deputy Speaker and the Clerk of the Assembly: N100,000 for every full day in office;
 *  - each of the 30 Honourable Members: N70,000 for every full week in office. */
export const STIPEND = { DAILY: { amountKobo: N(100_000), periodHours: 24, per: "day" }, WEEKLY: { amountKobo: N(70_000), periodHours: 24 * 7, per: "week" } };
/** The stipend of a post (an elected position key, or CLERK), or null for anything else. */
export function stipendOf(position) {
  if (position === "HONOURABLE_MEMBER") return STIPEND.WEEKLY;
  return position === CLERK || isElectedPosition(position) ? STIPEND.DAILY : null;
}
/** "₦100,000 a day" / "₦70,000 a week", for the screens. */
export function stipendLabel(position) {
  const s = stipendOf(position); return s ? `₦${(s.amountKobo / 100n).toLocaleString("en-NG")} a ${s.per}` : null;
}
/**
 * The stipend payments that have fallen due for one appointment: [{ index, amountKobo, dueAt }]. Periods are counted from the start of the term
 * (day 1, day 2... or week 1), and a period is paid only once it is over. An appointment earns the periods that begin after it started
 * (an elected office starts with the term; a Clerk named on day 3 earns from day 4) and that end before it was revoked. Nothing is paid past the term's end.
 * `scale` is SUG_TIME_SCALE (1 in the real game): demo runs shorten the periods together with the term.
 */
export function stipendsDue({ position, startedAt, endedAt = null }, { startsAt, endsAt }, now, scale = scaleOf()) {
  const s = stipendOf(position); if (!s) return [];
  const P = s.periodHours * HOUR * scale, t0 = +startsAt, tEnd = +endsAt, from = Math.max(+startedAt, t0), to = endedAt == null ? Infinity : +endedAt;
  const first = Math.max(0, Math.ceil((from - t0) / P)), out = [];
  for (let k = first; ; k++) {
    const dueAt = t0 + (k + 1) * P;
    if (dueAt > tEnd || dueAt > now || dueAt > to) break;
    out.push({ index: k, amountKobo: s.amountKobo, dueAt });
  }
  return out;
}

/** What a candidate may spend in all on the campaign. */
export const capFor = (cycle, position) => (isAssemblyPosition(position) ? BigInt(cycle.spendCapAssemblyKobo) : BigInt(cycle.spendCapExecKobo));

// ============================================================================================================================ who may vote, who may stand
export const VOTER_MIN_AGE_MS = 2 * HOUR; // a brand new character cannot vote yet (stops a flood of fresh accounts); everyone else may
const ms = (d) => (d == null ? null : +new Date(d));

/** Reasons the player cannot vote. Empty = may vote. `c` is the Character row. The same discipline checks the rest of the game uses (lib/discipline.js), written out so this file stays pure. */
export function voterIssues(c, now) {
  if (!c) return ["You need a character to take part."];
  const out = [];
  if (!c.hostel) out.push("Choose where to live first.");
  if (c.graduated) out.push("You have graduated. Only current students take part in student politics.");
  if (c.expelled && (c.expelledUntil == null || ms(c.expelledUntil) > now)) out.push("You are expelled.");
  if (ms(c.suspendedUntil) > now) out.push("You are suspended.");
  if (ms(c.jailedUntil) > now) out.push("You are in Floor O (N-QRS Custody).");
  const age = now - ms(c.createdAt);
  if (c.createdAt && age < VOTER_MIN_AGE_MS) out.push(`Your character is too new to vote. Come back in ${Math.ceil((VOTER_MIN_AGE_MS - age) / 60_000)} minutes.`);
  return out;
}
/** Reasons the player cannot stand: everything that stops them voting, plus good academic and disciplinary standing. */
export function candidateIssues(c, now) {
  const out = voterIssues(c, now);
  if (!c) return out;
  if ((c.failedSessions ?? 0) > 0) out.push("You failed your last session. Students on academic probation cannot stand.");
  if ((c.strikes ?? 0) >= 3) out.push("You have too many disciplinary strikes (3 or more).");
  return out;
}

// ============================================================================================================================ candidate text
export const LIMITS = { slogan: 80, intro: 400, manifesto: 2000, promise: 140, promises: 5, message: 280, title: 80, body: 600, announceTitle: 80, announceBody: 600, itemTitle: 100, itemBody: 2000, speech: 600, minutes: 4000 };

// ============================================================================================================================ campaigning
/** Where campaign speeches, rallies, meetings and debates can be held: public spaces on the map (ids from public/data/oau-campus.json). */
export const CAMPAIGN_VENUES = {
  sub: "Student Union Building", oduduwa: "Oduduwa Hall", amphitheatre: "Amphitheatre", main_bowl: "Main Bowl", sports_centre: "OAU Sports Centre", library: "Hezekiah Oluwasanmi Library",
};
/**
 * The kinds of campaign activity. `live` ones last a while at a venue, and other real players can come; `instant` ones happen at once.
 *   costNaira: paid through the ledger.   energy: taken from the player.   cooldownMin: between two of this kind.   dailyMax: per in-game day.
 *   base: momentum for a success.   perFresh: momentum per NEW player reached.   freshCap: most audience momentum one event can earn.   minAttendees: a live event with fewer fails.
 */
export const EVENT_KINDS = {
  SPEECH: { label: "Campaign speech", live: true, venue: true, costNaira: 0, energy: 8, minutes: 5, cooldownMin: 30, dailyMax: 3, base: 2, perFresh: 2, freshCap: 8, minAttendees: 1, anim: ["gesture", "talk"], blurb: "Speak to students at a campus venue. It only counts if somebody comes to listen." },
  RALLY: { label: "Rally", live: true, venue: true, costNaira: 10_000, energy: 15, minutes: 15, cooldownMin: 180, dailyMax: 1, base: 5, perFresh: 2, freshCap: 16, minAttendees: 3, anim: ["gesture", "talk"], blurb: "A bigger gathering, with banners and sound. It needs at least 3 people to come." },
  MEET: { label: "Meet students", live: true, venue: true, costNaira: 0, energy: 6, minutes: 3, cooldownMin: 20, dailyMax: 4, base: 1, perFresh: 2, freshCap: 6, minAttendees: 1, anim: ["talk", "idle"], blurb: "Go round and talk to students at a venue. Someone has to stop and talk." },
  DEBATE: { label: "Debate", live: true, venue: true, costNaira: 0, energy: 12, minutes: 10, cooldownMin: 180, dailyMax: 1, base: 4, perFresh: 2, freshCap: 10, minAttendees: 1, anim: ["gesture", "talk"], opponent: true, blurb: "Challenge a candidate in your race. It only happens if they accept and turn up." },
  MESSAGE: { label: "Campaign message", live: false, venue: false, costNaira: 0, energy: 2, cooldownMin: 10, dailyMax: 5, base: 1, blurb: "Publish a short message for every student to read." },
  POSTER: { label: "Distribute posters", live: false, venue: false, costNaira: 2_000, energy: 3, cooldownMin: 30, dailyMax: 4, base: 2, blurb: "A batch of posters around campus." },
  PUBLICITY: { label: "Publicity push", live: false, venue: false, costNaira: 10_000, energy: 4, cooldownMin: 180, dailyMax: 2, base: 4, blurb: "A paid publicity push: radio spots, handbills and a banner." },
};
export const EVENT_KIND_KEYS = Object.keys(EVENT_KINDS);
/** The most momentum events can earn a candidate in one in-game day: no amount of repeating adds more. */
export const DAILY_MOMENTUM_CAP = 12;
/** The most event momentum counts towards a candidate's strength in all. */
export const EVENT_MOMENTUM_CAP = 40;
export const EVENT_JOIN_GRACE_MS = 0;
/** How many players one candidate can invite to one event, and in all per event. */
export const INVITES = { perCall: 5, perEvent: 15 };

/** What a finished live event earns. `attendees` came, `fresh` of them were new to this candidate, `room` is the daily momentum still available. */
export function eventOutcome(kind, { attendees, fresh, room, opponentCame = true }) {
  const k = EVENT_KINDS[kind];
  if (!k) throw new Error("unknown kind");
  if (!k.live) return { success: true, momentum: Math.max(0, Math.min(k.base, room)), note: room <= 0 ? "People have seen plenty from you today: no extra effect." : "Done." };
  if (k.opponent && !opponentCame) return { success: false, momentum: 0, note: "Your opponent did not turn up, so there was no debate." };
  if (attendees < k.minAttendees) return { success: false, momentum: 0, note: attendees === 0 ? "Nobody came." : `Only ${attendees} came: ${k.label.toLowerCase()} needs ${k.minAttendees}.` };
  const raw = k.base + Math.min(k.freshCap, fresh * k.perFresh);
  const momentum = Math.max(0, Math.min(raw, room));
  return { success: true, momentum, note: momentum < raw ? "A good turnout, but you have had your share of attention today." : `${attendees} came${fresh ? ` (${fresh} new to you)` : ""}.` };
}

/**
 * A candidate's campaign strength out of 100, for the cards and the voting page. It shows how far a campaign has reached; it never decides a result
 * (the result is only the ballots). Money is worth at most 20 of the 100 and each part is capped, so wealth alone cannot make a campaign.
 */
export function strengthOf({ eventMomentum = 0, supporters = 0, pledged = 0, spentKobo = 0n, capKobo = 1n }) {
  const events = Math.min(40, Math.min(EVENT_MOMENTUM_CAP, eventMomentum));
  const audience = Math.min(40, supporters + pledged * 2);
  const cap = BigInt(capKobo) > 0n ? Number(capKobo) : 1, spending = Math.min(20, Math.round(20 * Math.sqrt(Math.min(1, Number(spentKobo) / cap))));
  return { events, audience, spending, total: events + audience + spending };
}

// ============================================================================================================================ counting votes
/** Percent of valid votes in basis points (2550 = 25.50%). Rounds down; the shares never add to more than 100%. */
export const percentBp = (votes, total) => (total > 0 ? Math.floor((votes * 10_000) / total) : 0);
const order = (a, b) => b.votes - a.votes || +new Date(a.registeredAt) - +new Date(b.registeredAt) || a.id - b.id; // display order only; a tie that decides a seat never relies on it before a runoff

/**
 * Count one race after the election round.  candidates: [{ id, votes, registeredAt }], all STILL STANDING (withdrawn and disqualified candidates are
 * left out, so votes cast for them do not count). seats: 1, or 30 for the Honourable Members.
 * Returns { total, ranked, winners, tie }. `winners` is final when `tie` is null; otherwise `winners` holds only the winners who are already sure and
 * `tie` = { ids, seats } says which candidates go to the runoff and for how many seats. A candidate needs at least one vote to win.
 */
export function countRound(candidates, seats) {
  const ranked = [...candidates].sort(order), total = ranked.reduce((n, c) => n + c.votes, 0);
  const live = ranked.filter((c) => c.votes >= 1);
  if (live.length <= seats) return { total, ranked, winners: live.map((c) => c.id), tie: null, vacancies: seats - live.length };
  const edge = live[seats - 1].votes;
  if (live[seats].votes !== edge) return { total, ranked, winners: live.slice(0, seats).map((c) => c.id), tie: null, vacancies: 0 };
  const sure = live.filter((c) => c.votes > edge), group = live.filter((c) => c.votes === edge);
  return { total, ranked, winners: sure.map((c) => c.id), tie: { ids: group.map((c) => c.id), seats: seats - sure.length, votes: edge }, vacancies: 0 };
}

/**
 * Settle a tie from the runoff ballots. group: the tied candidates [{ id, registeredAt }], seats: how many of them win, votes: Map(id -> runoff votes).
 * The most runoff votes win; a tie there is broken by who registered first (documented, deterministic, no chance). Returns { winners, order, brokenByRegistration }.
 */
export function settleRunoff(group, seats, votes) {
  const v = (c) => votes.get(c.id) ?? 0;
  const sorted = [...group].sort((a, b) => v(b) - v(a) || +new Date(a.registeredAt) - +new Date(b.registeredAt) || a.id - b.id);
  const edge = sorted[seats - 1], next = sorted[seats];
  return { winners: sorted.slice(0, seats).map((c) => c.id), order: sorted.map((c) => c.id), brokenByRegistration: !!(next && v(next) === v(edge)) };
}

/**
 * The final rows of a race: every standing candidate with votes, percent, rank, outcome and seat.
 * `first` = countRound(), `runoff` = { votes: Map, result: settleRunoff() } or null. Equal votes share a rank unless a runoff or the registration rule separated them.
 */
export function finalRows(candidates, first, runoff = null) {
  const won = new Set(first.winners), inGroup = new Set(first.tie?.ids ?? []);
  if (runoff) for (const id of runoff.result.winners) won.add(id);
  const pos = new Map((runoff?.result.order ?? []).map((id, i) => [id, i]));
  const rows = candidates.map((c) => ({ ...c, won: won.has(c.id), runoffVotes: inGroup.has(c.id) ? runoff?.votes.get(c.id) ?? 0 : null, tied: inGroup.has(c.id) }));
  const cmp = (a, b) => Number(b.won) - Number(a.won) || b.votes - a.votes || (a.tied && b.tied ? pos.get(a.id) - pos.get(b.id) : 0) || +new Date(a.registeredAt) - +new Date(b.registeredAt) || a.id - b.id;
  rows.sort(cmp);
  let seat = 0;
  return rows.map((c, i) => {
    const prev = rows[i - 1], same = prev && !c.tied && !prev.tied && prev.won === c.won && prev.votes === c.votes;
    c.rank = same ? prev.rank : i + 1;
    c.percentBp = percentBp(c.votes, first.total);
    c.outcome = c.won ? "WON" : "LOST";
    c.seat = c.won ? ++seat : null;
    c.tieBreak = c.tied ? (runoff?.result.brokenByRegistration ? "REGISTRATION_ORDER" : "RUNOFF") : null;
    return c;
  });
}

// ============================================================================================================================ government
/** Which announcement kinds each post may publish. Nobody else may publish any. */
export const ANNOUNCE_KINDS = {
  EVENT: "Student event", PARTY: "Party", SPORTS: "Sports competition", WELFARE: "Welfare initiative", STATEMENT: "Official statement", MEETING: "Meeting notice", FINANCE: "Finance report", ASSEMBLY: "Assembly notice",
};
export const ANNOUNCE_PERMS = {
  PRESIDENT: ["EVENT", "STATEMENT"],
  VICE_PRESIDENT: ["STATEMENT"],
  SECRETARY_GENERAL: ["MEETING"],
  ASSISTANT_SECRETARY_GENERAL: ["MEETING"],
  PRO: ["STATEMENT"],
  DIRECTOR_SOCIALS: ["PARTY"],
  DIRECTOR_SPORTS: ["SPORTS"],
  FINANCIAL_SECRETARY: ["FINANCE"],
  WELFARE_OFFICER: ["WELFARE"],
  SPEAKER: ["ASSEMBLY"],
  DEPUTY_SPEAKER: ["ASSEMBLY"],
  CLERK: ["ASSEMBLY"],
};
export const ANNOUNCE_COOLDOWN_MS = 5 * 60_000;
export const ANNOUNCE_DAILY_MAX = 10;
/** The kinds a holder of these positions may publish. */
export const announceKindsFor = (positions) => [...new Set(positions.flatMap((p) => ANNOUNCE_PERMS[p] ?? []))];

// ============================================================================================================================ the Assembly
/** Quorum: a third of the seated members (at least one) must be present for a vote to count. */
export const quorumFor = (seated) => Math.max(1, Math.ceil(seated / 3));
/**
 * The outcome of a vote on a bill or a motion. Abstentions do not count for or against. It passes only with a quorum present and MORE yes than no;
 * a tie fails. The Clerk records the result but cannot change it: it is computed here from the recorded votes.
 */
export function legislativeOutcome({ yes, no, abstain = 0, present, seated }) {
  const quorum = quorumFor(seated);
  if (present < quorum) return { passed: false, quorum, note: `No quorum: ${present} present, ${quorum} needed.` };
  if (yes > no) return { passed: true, quorum, note: `Passed ${yes} to ${no}${abstain ? ` with ${abstain} abstaining` : ""}.` };
  return { passed: false, quorum, note: yes === no ? `Tied ${yes} to ${no}: a tie fails.` : `Defeated ${no} to ${yes}.` };
}
/** The chair may be taken by the Deputy Speaker when the Speaker has not opened the sitting this long after it was due. */
export const SPEAKER_WAIT_MS = 10 * 60_000;
export const SESSION_LIMITS = { openMax: 1, scheduleAheadMax: 30 * 24 * HOUR };
export const ITEM_KINDS = { BILL: "Bill", MOTION: "Motion" };
export const ITEM_FLOW = ["SUBMITTED", "REGISTERED", "LISTED", "DEBATING", "VOTING", "PASSED", "FAILED"];