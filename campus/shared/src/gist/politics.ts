import type { GameTime } from "../clock";
import { ELECTION_TIMES, WEEK_MINUTES, activeRallies, campaignsOpen, debateOn, electionCycle, formsOnSale, pollsOpen, resultsOut, swornIn, weekClock } from "../politics/calendar";
import { STATE_LABEL, activeStates, findConcession } from "../politics/campus-state";
import { CONGRESS_SITE, CONGRESS_VENUE, congressesFor, findMotion, sittingPhase, voteClosesAt, type CongressSitting } from "../politics/congress";
import { facultyOf } from "../politics/faculty";
import { marchAt, marchLive, marchPlan } from "../politics/march";
import { DEBATE_SITE, FORM_DESK, POLL_UNITS, RALLY_POINTS, unitForFaculty } from "../politics/sites";
import { GIST_PRIORITY, GIST_SOON_MINUTES, gistClock, soonness, type GistItem, type GistMe } from "./types";

const VOTE_FIRST = 10;
const TEXT = {
  vote: "Election day: go and vote",
  voteDetail: (unit: string, closes: string) => `Your polling unit is ${unit}. Polls close ${closes}`,
  voted: "You don vote",
  votedDetail: (when: string) => `SUIEC go declare results ${when}`,
  forms: "SUIEC forms dey on sale",
  formsDetail: (closes: string) => `Want to contest? Buy a form at the SUIEC desk before ${closes}`,
  debate: "Press Night and Debate",
  debateDetail: (venue: string) => `Candidates dey face the crowd at ${venue}`,
  rally: "Campaign rally dey on",
  rallyDetail: (site: string, end: string) => `${site} till ${end}`,
  results: "Election results are out",
  resultsDetail: "Open the Union app to see who won",
  sitting: "Congress dey sit",
  sittingDetail: (issue: string) => `Motion on ${issue}. Stand on the Aye or Nay side to vote`,
  congress: (start: number) => `Congress by ${gistClock(start)}`,
  congressDetail: (issue: string, venue: string) => `${venue}. Motion on ${issue}`,
  march: "Protest march dey move",
  marchDetail: (issue: string) => `Over ${issue}. Join the line and waka with them`,
  marchSoon: (start: number) => `Protest march forms by ${gistClock(start)}`,
  marchSoonDetail: (issue: string) => `Over ${issue}. Anglo-Moz car park`,
};

function electionGist(t: GameTime, me: GistMe): GistItem[] {
  const weekStart = electionCycle(t) * WEEK_MINUTES;
  const span = (from: number, to: number) => ({ start: weekStart + from, end: weekStart + to });
  const out: GistItem[] = [];
  if (pollsOpen(t)) {
    const faculty = facultyOf(me.department);
    const unit = faculty ? unitForFaculty(faculty.key) : POLL_UNITS[0];
    if (me.voted) out.push({ id: "election:voted", kind: "election", title: TEXT.voted, detail: TEXT.votedDetail(weekClock(ELECTION_TIMES.declaration)), ...span(ELECTION_TIMES.pollsOpen, ELECTION_TIMES.declaration), live: true, act: false, priority: GIST_PRIORITY.note });
    else if (unit) out.push({ id: "election:vote", kind: "election", title: TEXT.vote, detail: TEXT.voteDetail(unit.name, weekClock(ELECTION_TIMES.pollsClose)), ...span(ELECTION_TIMES.pollsOpen, ELECTION_TIMES.pollsClose), live: true, act: true, priority: GIST_PRIORITY.act + VOTE_FIRST, place: unit.place, door: { x: unit.x, y: unit.y }, where: unit.name });
  }
  if (formsOnSale(t) && !me.contesting) out.push({ id: "election:forms", kind: "election", title: TEXT.forms, detail: TEXT.formsDetail(weekClock(ELECTION_TIMES.formsClose)), ...span(ELECTION_TIMES.formsOpen, ELECTION_TIMES.formsClose), live: true, act: false, priority: GIST_PRIORITY.soon, place: FORM_DESK.place, door: { x: FORM_DESK.x, y: FORM_DESK.y }, where: FORM_DESK.name });
  if (debateOn(t)) out.push({ id: "election:debate", kind: "election", title: TEXT.debate, detail: TEXT.debateDetail(DEBATE_SITE.name), ...span(ELECTION_TIMES.debateStart, ELECTION_TIMES.debateEnd), live: true, act: false, priority: GIST_PRIORITY.live, place: DEBATE_SITE.place, door: { x: DEBATE_SITE.x, y: DEBATE_SITE.y }, where: DEBATE_SITE.name });
  if (campaignsOpen(t)) {
    const rally = activeRallies(t)[0];
    const site = rally ? RALLY_POINTS[rally.site] : undefined;
    if (rally && site) out.push({ id: `election:rally:${rally.start}`, kind: "election", title: TEXT.rally, detail: TEXT.rallyDetail(site.name, gistClock(rally.end)), ...span(rally.start, rally.end), live: true, act: false, priority: GIST_PRIORITY.soon + 5, place: site.place, door: { x: site.x, y: site.y }, where: site.name });
  }
  if (resultsOut(t) && !swornIn(t)) out.push({ id: "election:results", kind: "election", title: TEXT.results, detail: TEXT.resultsDetail, ...span(ELECTION_TIMES.results, ELECTION_TIMES.swearingIn), live: true, act: false, priority: GIST_PRIORITY.today });
  return out;
}

function sittingGist(s: CongressSitting, t: GameTime): GistItem[] {
  const phase = sittingPhase(s, t.total);
  const issue = findMotion(s.motion).issue;
  const at = { place: CONGRESS_SITE.place, door: { x: CONGRESS_SITE.x, y: CONGRESS_SITE.y }, where: CONGRESS_VENUE };
  if (phase === "gather" || phase === "vote") return [{ id: `congress:${s.id}`, kind: "congress", title: TEXT.sitting, detail: TEXT.sittingDetail(issue), start: s.start, end: voteClosesAt(s), live: true, act: true, priority: GIST_PRIORITY.act, ...at }];
  if (phase !== "before") return [];
  const wait = s.start - t.total;
  const today = Math.floor(s.start / 1440) === t.dayIndex;
  if (wait > GIST_SOON_MINUTES && !today) return [];
  return [{ id: `congress:${s.id}`, kind: "congress", title: TEXT.congress(s.start), detail: TEXT.congressDetail(issue, CONGRESS_VENUE), start: s.start, end: voteClosesAt(s), live: false, act: false, priority: (wait <= GIST_SOON_MINUTES ? GIST_PRIORITY.soon : GIST_PRIORITY.today) + soonness(s.start, t.total), ...at }];
}

function stateGist(t: GameTime, me: GistMe): GistItem[] {
  const out: GistItem[] = [];
  for (const state of me.states ?? []) {
    if (state.kind !== "protest") continue;
    const plan = marchPlan(state);
    if (marchLive(plan, t.total)) {
      const spot = marchAt(plan, t.total);
      out.push({ id: `march:${state.id}`, kind: "march", title: TEXT.march, detail: TEXT.marchDetail(state.issue), start: plan.forms, end: plan.end, live: true, act: true, priority: GIST_PRIORITY.act, door: { x: spot.x, y: spot.y } });
    } else if (t.total < plan.forms && plan.forms - t.total <= GIST_SOON_MINUTES * 2) {
      const spot = marchAt(plan, plan.forms);
      out.push({ id: `march:${state.id}`, kind: "march", title: TEXT.marchSoon(plan.forms), detail: TEXT.marchSoonDetail(state.issue), start: plan.forms, end: plan.end, live: false, act: false, priority: GIST_PRIORITY.soon + soonness(plan.forms, t.total), door: { x: spot.x, y: spot.y } });
    }
  }
  for (const state of activeStates(me.states ?? [], t.total)) {
    const deal = state.kind === "concession" ? findConcession(state.concession) : undefined;
    if (deal) out.push({ id: `deal:${state.id}`, kind: "congress", title: STATE_LABEL.concession, detail: deal.line, start: state.from, end: state.until, live: true, act: false, priority: GIST_PRIORITY.note + 5 });
  }
  return out;
}

export function politicsGist(t: GameTime, me: GistMe): GistItem[] {
  const sittings = [...congressesFor(electionCycle(t)), ...(me.called ? [me.called] : [])];
  return [...electionGist(t, me), ...sittings.flatMap((s) => sittingGist(s, t)), ...stateGist(t, me)];
}
