import {
  CELEBRATE,
  ELECTION_TIMES,
  PETITION,
  SUG_SCOPE,
  UNION_POSTS,
  electionCycle,
  parseRace,
  petitionFee,
  petitionGranted,
  raceKey,
  resultsDeclared,
  returnLine,
  swornIn,
  unitReturns,
  weekMinute,
  type GameTime,
  type RaceResult,
} from "@campuslife/shared";
import { naira, type PoliticsCore, type RaceRef } from "./core";
import { finalize } from "./office";
import { drawSecret } from "../secret";
import type { PoliticsPlayer } from "./types";

const WINDOW_MINUTES = 10;
const HEAD: RaceRef = { post: UNION_POSTS[0], scope: SUG_SCOPE, race: raceKey(UNION_POSTS[0], SUG_SCOPE) };
const NICK = /"([^"]+)"/;
const TEXT = {
  early: "SUIEC has not declared yet. Wait for the last unit.",
  noForm: "You did not contest this week.",
  notWinner: "Only the winner celebrates. Next time.",
  celebrated: "You have celebrated already. Go and rest.",
  late: "The new executives are sworn in. SUIEC has closed petitions.",
  won: "You won this one. Nothing to petition.",
  petitioned: "SUIEC has ruled on your petition already.",
  upheld: "⚖️ SUIEC looked at your petition and upheld the result.",
};

const shortName = (name: string) => NICK.exec(name)?.[1] ?? name;
const votes = (n: number) => n.toLocaleString("en-NG");

export class ResultsNight {
  private said = new Set<string>();

  async tick(core: PoliticsCore, t: GameTime) {
    const m = weekMinute(t);
    if (m < ELECTION_TIMES.results || m >= ELECTION_TIMES.declaration + WINDOW_MINUTES) return;
    const cycle = electionCycle(t);
    const [result] = await core.resultsFor(cycle, [HEAD]);
    if (!result) return;
    const names = new Map(result.rows.map((r) => [r.id, shortName(r.name)]));
    for (const unit of unitReturns(cycle, result)) {
      if (m < unit.at || m >= unit.at + WINDOW_MINUTES || !this.once(`${cycle}:${unit.unit}`)) continue;
      core.host.broadcast(returnLine(unit, (id) => names.get(id) ?? id));
    }
    if (!resultsDeclared(t) || !this.once(`${cycle}:declared`)) return;
    const winner = result.rows.find((r) => r.id === result.winner);
    if (winner) core.host.broadcast(`🏆 SUIEC declares ${winner.name} the new ${HEAD.post.title} with ${votes(winner.total)} votes${result.runoff ? " after a run-off" : ""}.`);
    await this.tellCandidates(core, cycle);
  }

  private once(key: string): boolean {
    if (this.said.has(key)) return false;
    this.said.add(key);
    return true;
  }

  private async tellCandidates(core: PoliticsCore, cycle: number) {
    const all = await core.store.candidaciesOf(cycle);
    for (const mine of all) {
      const online = core.byProfile(mine.accountId);
      const parsed = parseRace(mine.race);
      if (!online || !parsed) continue;
      const [result] = await core.resultsFor(cycle, [{ ...parsed, race: mine.race }]);
      if (!result) continue;
      if (result.winner === mine.id) core.notice(online[0], `🏆 You won! You are the new ${parsed.post.title}. Tap Celebrate, your people are waiting.`);
      else core.notice(online[0], `You lost the ${parsed.post.title} race by ${votes(marginOf(result, mine.id))} votes. You can petition SUIEC in the Union app for ${naira(petitionFee(parsed.post))} before the swearing-in.`);
    }
  }
}

function marginOf(result: RaceResult, id: string): number {
  const top = result.rows.find((r) => r.id === result.winner)?.total ?? 0;
  return Math.max(0, top - (result.rows.find((r) => r.id === id)?.total ?? 0));
}

async function myRace(core: PoliticsCore, p: PoliticsPlayer, t: GameTime) {
  const cycle = electionCycle(t);
  const mine = await core.store.candidacyOf(p.profileId, cycle);
  const parsed = mine ? parseRace(mine.race) : undefined;
  if (!mine || !parsed) return undefined;
  const ref: RaceRef = { ...parsed, race: mine.race };
  const [result] = await core.resultsFor(cycle, [ref]);
  return result ? { cycle, mine, ref, result } : undefined;
}

export async function celebrate(core: PoliticsCore, id: string, p: PoliticsPlayer, t: GameTime) {
  if (!resultsDeclared(t)) return core.notice(id, TEXT.early);
  const run = await myRace(core, p, t);
  if (!run) return core.notice(id, TEXT.noForm);
  if (run.result.winner !== run.mine.id) return core.notice(id, TEXT.notWinner);
  if (!(await core.store.mark(p.profileId, run.cycle, CELEBRATE.mark))) return core.notice(id, TEXT.celebrated);
  p.fun = Math.min(100, p.fun + CELEBRATE.fun);
  core.host.changed(id);
  core.host.cheer(id);
  core.host.broadcast(`🎉 ${run.mine.name} is celebrating the ${run.ref.post.title} win. Gbosa!`);
}

export async function petition(core: PoliticsCore, id: string, p: PoliticsPlayer, t: GameTime) {
  if (!resultsDeclared(t)) return core.notice(id, TEXT.early);
  if (swornIn(t)) return core.notice(id, TEXT.late);
  const run = await myRace(core, p, t);
  if (!run) return core.notice(id, TEXT.noForm);
  if (run.result.winner === run.mine.id) return core.notice(id, TEXT.won);
  const fee = petitionFee(run.ref.post);
  const short = `A petition costs ${naira(fee)}. You no get reach.`;
  if (p.cash < fee) return core.notice(id, short);
  p.cash -= fee;
  let fresh = false;
  try {
    fresh = await core.store.mark(p.profileId, run.cycle, PETITION.mark);
  } finally {
    if (!fresh) p.cash += fee;
  }
  if (!fresh) return core.notice(id, TEXT.petitioned);
  core.host.changed(id);
  if (!petitionGranted(run.cycle, run.ref.race, run.mine.id, drawSecret())) return core.notice(id, TEXT.upheld);
  if (!(await core.store.rerun(run.cycle, run.ref.race, run.mine.id))) return core.notice(id, TEXT.upheld);
  core.reruns.add(`${run.cycle}:${run.ref.race}`);
  core.forgetRace(run.cycle, run.ref.race);
  const [again] = await core.resultsFor(run.cycle, [run.ref]);
  await finalize(core, run.cycle, run.ref.race);
  const winner = again?.rows.find((r) => r.id === again.winner);
  core.host.broadcast(`⚖️ SUIEC ordered a re-run of the ${run.ref.post.title} race after a petition. ${winner ? `${winner.name} takes it with ${votes(winner.total)} votes.` : "The seat stays open."}`);
}
