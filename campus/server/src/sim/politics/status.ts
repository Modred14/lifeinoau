import {
  IMPEACH_PREFIX,
  SUG_SCOPE,
  UNION_POSTS,
  activeStates,
  candidateKey,
  electionCycle,
  facultyOf,
  parseRace,
  petitionFee,
  raceKey,
  resultsDeclared,
  resultsOut,
  returnsUntil,
  safeLook,
  termCycle,
  weekMinute,
  type GameTime,
  type OfficeHolderView,
  type PoliticsStatus,
  type RaceOutcome,
} from "@campuslife/shared";
import { toPlayerCandidate, type PoliticsCore } from "./core";
import { worldMarkCycles } from "./march";
import { gatherings } from "./office";
import type { PoliticsPlayer } from "./types";

const HEAD_RACE = raceKey(UNION_POSTS[0], SUG_SCOPE);

export function offlineStatus(core: PoliticsCore, p: PoliticsPlayer, t: GameTime): PoliticsStatus {
  const department = core.departmentOf(p);
  return {
    ok: false,
    cycle: electionCycle(t),
    level: p.level,
    faculty: facultyOf(department)?.key ?? "",
    department,
    mine: null,
    endorsed: "",
    voted: [],
    marks: [],
    players: [],
    endorsements: {},
    results: [],
    holders: [],
    office: null,
    gatherings: gatherings(core, t),
    declared: resultsDeclared(t),
    returns: [],
    outcome: "",
    petitionFee: 0,
    signed: [],
    signatures: {},
    impeachments: [],
    claimed: [],
  };
}

export async function buildStatus(core: PoliticsCore, p: PoliticsPlayer, t: GameTime, speakingMs = 0): Promise<PoliticsStatus> {
  const cycle = electionCycle(t);
  const term = termCycle(t);
  const refs = core.racesFor(p);
  const races = refs.map((r) => r.race);
  const store = core.store;
  const scope = races.join(",");
  const others = [...new Set([term, ...worldMarkCycles(activeStates(core.states, t.total))])].filter((c) => c >= 0 && c !== cycle);
  const [mine, endorsement, voted, marks, players, endorsements, termPlayers, signatures] = await Promise.all([
    store.candidacyOf(p.profileId, cycle),
    store.endorsementOf(p.profileId, cycle),
    store.votedRaces(p.profileId, cycle),
    store.marksOf(p.profileId, cycle),
    core.cached(`players:${cycle}:${scope}`, () => store.candidaciesIn(cycle, races)),
    core.cached(`endorsed:${cycle}:${scope}`, () => store.endorsementCounts(cycle, races)),
    term === cycle || term < 0 ? Promise.resolve(undefined) : core.cached(`players:${term}:${scope}`, () => store.candidaciesIn(term, races)),
    term < 0 ? Promise.resolve([]) : core.cached(`signatures:${term}`, () => store.markCounts(term, IMPEACH_PREFIX)),
  ]);
  const extra = await Promise.all(others.map((c) => store.marksOf(p.profileId, c)));
  const declared = resultsDeclared(t);
  const results = declared ? await core.resultsFor(cycle, refs) : [];
  const seated = term === cycle ? results : term < 0 ? [] : await core.resultsFor(term, refs);
  const office = core.offices.find((r) => r.accountId === p.profileId);
  const holders: OfficeHolderView[] = seated.flatMap((result) => {
    const removal = core.impeached.find((row) => row.cycle === term && row.race === result.race && row.removed);
    if (removal) return [{ race: result.race, name: removal.successor, npc: removal.successorAccount === null, mine: removal.successorAccount === p.profileId }];
    const winner = result.rows.find((row) => row.id === result.winner);
    if (!winner) return [];
    const owner = (termPlayers ?? players).find((c) => c.id === winner.id && c.race === result.race);
    return [{ race: result.race, name: winner.name, npc: winner.npc, mine: owner?.accountId === p.profileId }];
  });
  const counting = resultsOut(t) && !declared;
  const shown = counting ? refs.filter((r) => r.race === HEAD_RACE || r.race === mine?.race) : [];
  const returns = counting ? (await core.resultsFor(cycle, shown)).map((result) => ({ race: result.race, units: returnsUntil(cycle, result, weekMinute(t)) })) : [];
  const myResult = mine ? results.find((r) => r.race === mine.race) : undefined;
  const outcome: RaceOutcome = mine && myResult ? (myResult.winner === mine.id ? "won" : "lost") : "";
  const post = mine ? parseRace(mine.race)?.post : undefined;
  const termMarks = term === cycle ? marks : extra.flat();
  return {
    ...offlineStatus(core, p, t),
    ok: true,
    mine: mine
      ? { id: mine.id, race: mine.race, support: mine.support, materials: mine.materials, spoke: mine.spoke, effort: toPlayerCandidate(mine).effort, look: safeLook(mine.look), stops: mine.stops ?? {}, rented: core.rented.filter((r) => r.candidacy === mine.id).map((r) => r.area), speakingMs }
      : null,
    endorsed: endorsement ? candidateKey(endorsement.race, endorsement.candidate) : "",
    voted,
    marks,
    players: players.map(toPlayerCandidate),
    endorsements: Object.fromEntries(endorsements.map((e) => [candidateKey(e.race, e.candidate), e.count])),
    results,
    holders,
    office: office ? { race: office.race, powerUsed: office.powerUsedAt !== null } : null,
    returns,
    outcome,
    petitionFee: post ? petitionFee(post) : 0,
    signed: termMarks.filter((m) => m.startsWith(IMPEACH_PREFIX)).map((m) => m.slice(IMPEACH_PREFIX.length)),
    signatures: Object.fromEntries(signatures.map((s) => [s.kind.slice(IMPEACH_PREFIX.length), s.count])),
    impeachments: core.impeached.filter((row) => row.cycle === term).map((row) => ({ race: row.race, ousted: row.ousted, successor: row.successor, removed: row.removed })),
    claimed: extra.flat(),
  };
}
