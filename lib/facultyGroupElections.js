// lib/facultyGroupElections.js
// Faculty elections inside Faculty Groups. There is NO second election system: a faculty's Faculty Representative and Assistant Faculty
// Representative are the SUG election's faculty races (FACULTY_REP_<facultyId>, ASST_FACULTY_REP_<facultyId>, lib/sugRules.js), which already
// restrict nominations and votes to that faculty's students, keep one ballot per voter per race (a unique key), run ties to a runoff, publish
// results once, and have administrator tooling (lib/sugAdmin.js). This file only READS that election for the caller's own faculty and shapes it
// for the Faculty Groups screen. Voting and registering are done through /api/sug, so the rules live in one place.
import { myGroup, facultyOffices } from "./facultyGroupService.js";
import { getSug, getCandidates, getResults } from "./sugService.js";
import * as R from "./sugRules.js";

/** The faculty-elections screen for the caller's own faculty: the SUG election's stage, the two faculty races with their candidates, what the caller may do, and final results. */
export async function view(db, userId) {
  const g = await myGroup(db, userId);
  const mine = new Set(R.facultyPositionKeys(g.facultyId));
  const offices = await facultyOffices(db, g.facultyId);
  const sug = await getSug(db, userId); // advances the election clock, and returns ONLY the caller's own faculty's races (R.mayVoteIn)
  const races = sug.races.filter((r) => mine.has(r.position)); // belt and braces: never show a race of another faculty
  const open = !!sug.cycle && sug.me.votingOpen;
  const out = { serverNow: sug.serverNow, cycle: sug.cycle ? { id: sug.cycle.id, title: sug.cycle.title, stage: sug.cycle.stage, stageLabel: sug.cycle.stageLabel, stageHint: sug.cycle.stageHint, next: sug.cycle.next, timetable: sug.cycle.timetable } : null,
    nextElection: sug.next ?? null, me: { canRegister: sug.me.canRegister, registerWhy: sug.me.registerWhy ?? null, mayVote: sug.me.mayVote, voterIssues: sug.me.voterIssues, candidacy: sug.me.candidacy && mine.has(sug.me.candidacy.position) ? { position: sug.me.candidacy.position, title: sug.me.candidacy.title } : null },
    votingOpen: open, round: sug.me.round ?? 0, offices, races: [], results: null };
  for (const r of races) {
    const round = out.round, canVote = open && sug.me.mayVote && ((round === 1 && r.status === "OPEN" && !r.voted) || (round === 2 && r.status === "RUNOFF" && r.inRunoff && !r.votedRunoff));
    let candidates = [];
    if (sug.cycle && r.candidates) { // the candidate list of a race (the SUG service shows only ACTIVE candidates until results are out)
      try { candidates = (await getCandidates(db, userId, r.position)).candidates.map((c) => ({ id: c.id, name: c.who.name, level: c.who.level, slogan: c.slogan, intro: c.intro, isMe: c.isMe, status: c.status })); } catch { candidates = []; }
    }
    out.races.push({ position: r.position, title: r.title, status: r.status, candidatesCount: r.candidates, voted: round === 2 ? r.votedRunoff : r.voted, inRunoff: r.inRunoff, canVote, candidates });
  }
  const res = await getResults(db, userId);
  if (res.available) {
    const rows = res.races.filter((x) => mine.has(x.position));
    out.results = { cycle: res.cycle, races: rows.map((x) => ({ position: x.position, title: x.title, status: x.status, rows: x.rows.map((y) => ({ name: y.who.name, votes: y.votes, runoffVotes: y.runoffVotes ?? null, percent: y.percent, won: y.outcome === "WON", tieBreak: y.tieBreak ?? null })) })) };
  }
  return out;
}

export { facultyOffices };
