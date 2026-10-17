import {
  ELECTION_TIMES,
  IMPEACH,
  WEEK_MINUTES,
  impeachMark,
  npcWorked,
  parseRace,
  signatureTotal,
  sittingDue,
  srcSitting,
  termCycle,
  verdictLine,
  type GameTime,
  type HolderRecord,
} from "@campuslife/shared";
import type { PoliticsCore, RaceRef } from "./core";
import { refreshOffices } from "./office";
import type { ImpeachmentRow, PoliticsPlayer } from "./types";
import { refreshWorld } from "./world";

const ACTING = "an acting officer from the SRC";
const TEXT = {
  noTerm: "Nobody has been sworn in yet.",
  notYours: "You can only sign against officers of your own union, faculty or department.",
  vacant: "That office is vacant.",
  self: "You cannot sign a petition against yourself.",
  sat: "The SRC has already sat on this one this term.",
  signed: "You have signed this petition already.",
};

async function turnoutFell(core: PoliticsCore, term: number, race: string): Promise<boolean> {
  if (term < 1) return false;
  const [now, before] = await Promise.all([core.store.voteCounts(term, [race]), core.store.voteCounts(term - 1, [race])]);
  const sum = (rows: readonly { votes: number }[]) => rows.reduce((n, r) => n + r.votes, 0);
  return sum(now) < sum(before);
}

export async function signPetition(core: PoliticsCore, id: string, p: PoliticsPlayer, race: string, t: GameTime) {
  const term = termCycle(t);
  if (term < 0) return core.notice(id, TEXT.noTerm);
  const ref: RaceRef | undefined = core.racesFor(p).find((r) => r.race === race);
  if (!ref) return core.notice(id, TEXT.notYours);
  const [past, results] = await Promise.all([core.store.impeachments(term), core.resultsFor(term, [ref])]);
  if (past.some((row) => row.race === race)) return core.notice(id, TEXT.sat);
  const result = results[0];
  const holder = result?.rows.find((r) => r.id === result.winner);
  if (!result || !holder) return core.notice(id, TEXT.vacant);
  const seat = core.offices.find((r) => r.cycle === term && r.race === race);
  if (seat?.accountId === p.profileId) return core.notice(id, TEXT.self);
  if (!(await core.store.mark(p.profileId, term, impeachMark(race)))) return core.notice(id, TEXT.signed);
  const [counts, fell] = await Promise.all([core.store.markCounts(term, impeachMark(race)), turnoutFell(core, term, race)]);
  const record: HolderRecord = {
    usedPower: seat ? seat.powerUsedAt !== null : npcWorked(term, race),
    turnoutFell: fell,
    minutesInOffice: t.total - (term * WEEK_MINUTES + ELECTION_TIMES.swearingIn),
  };
  const signatures = signatureTotal(term, race, record, counts.find((c) => c.kind === impeachMark(race))?.count ?? 1);
  core.notice(id, `✍️ You signed the petition against ${holder.name}. ${signatures} of ${IMPEACH.threshold} signatures.`);
  if (!sittingDue(signatures)) return;
  const vote = srcSitting(term, race, record);
  const runnerUp = vote.removed ? result.rows.find((r) => r.id !== result.winner) : undefined;
  const heir = runnerUp && !runnerUp.npc ? (await core.store.candidaciesIn(term, [race])).find((c) => c.id === runnerUp.id) : undefined;
  const row: ImpeachmentRow = { cycle: term, race, ousted: holder.name, successor: vote.removed ? (runnerUp?.name ?? ACTING) : "", successorAccount: heir?.accountId ?? null, removed: vote.removed, at: t.total };
  if (!(await core.store.impeach(row))) return;
  if (vote.removed) {
    if (heir) await core.store.reseat({ cycle: term, race, accountId: heir.accountId, name: heir.name, stipend: 0, stipendPaid: true, powerUsedAt: null });
    else await core.store.transferOffice(term, race, null, "");
  }
  core.host.broadcast(verdictLine(parseRace(race)?.post.title ?? "officer", holder.name, row.successor, vote));
  await refreshOffices(core, t);
  await refreshWorld(core, t);
}
