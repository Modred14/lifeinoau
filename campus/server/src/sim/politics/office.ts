import {
  ALUTA_GATHERING,
  ALUTA_MARK,
  GATHERING_SITES,
  PACKS_MAX,
  POLITICS_REACH,
  RELIEF_RADIUS,
  WEEK_MINUTES,
  alutaFor,
  electionCycle,
  gatheringMark,
  interiorAt,
  officeIndex,
  parseRace,
  termCycle,
  weekMinute,
  withinReach,
  type GameTime,
  type GatheringView,
} from "@campuslife/shared";
import { naira, type PoliticsCore, type RaceRef } from "./core";
import type { OfficeRow, PoliticsPlayer } from "./types";

const GATHERING_MINUTES = 90;
const GATHERING_REACH = POLITICS_REACH * 2;
const STIPEND_GRACE_TERMS = 2;
const TEXT = {
  noOffice: "You hold no office this week.",
  powerUsed: "You have used your office power this week.",
  noGathering: "That gathering has ended.",
  joinedAlready: "You are already counted here.",
};

export async function finalize(core: PoliticsCore, cycle: number, only?: string): Promise<OfficeRow[]> {
  const all = await core.store.candidaciesOf(cycle);
  const refs: RaceRef[] = [...new Set(all.map((c) => c.race))].flatMap((race) => {
    const parsed = parseRace(race);
    return parsed && (!only || race === only) ? [{ ...parsed, race }] : [];
  });
  const results = await core.resultsFor(cycle, refs);
  const rows: OfficeRow[] = [];
  for (const result of results) {
    const winner = all.find((c) => c.race === result.race && c.id === result.winner);
    const post = parseRace(result.race)?.post;
    if (winner && post) rows.push({ cycle, race: result.race, accountId: winner.accountId, name: winner.name, stipend: post.stipend, stipendPaid: false, powerUsedAt: null });
    else if (only) await core.store.transferOffice(cycle, result.race, null, "");
  }
  if (only) for (const row of rows) await core.store.reseat(row);
  else await core.store.seat(rows);
  return rows;
}

export async function refreshOffices(core: PoliticsCore, t: GameTime) {
  const term = termCycle(t);
  const rows = await core.store.offices(term);
  const known = core.officesCycle === term ? new Map(core.offices.map((r) => [r.race, r.powerUsedAt])) : undefined;
  core.offices = rows;
  core.officesCycle = term;
  for (const row of rows) {
    const power = parseRace(row.race)?.post.power;
    if (known && power && row.powerUsedAt !== null && known.get(row.race) === null) core.host.broadcast(power.notice);
  }
  for (const [id, p] of core.host.players()) await applyOffice(core, id, p);
}

const claiming = new WeakMap<PoliticsCore, Set<string>>();

async function payStipend(core: PoliticsCore, row: OfficeRow, text: (amount: string) => string) {
  const pending = claiming.get(core) ?? new Set<string>();
  claiming.set(core, pending);
  const key = `${row.cycle}:${row.race}`;
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const claimed = await core.store.claimStipend(row.cycle, row.race, row.accountId);
    row.stipendPaid = true;
    const online = core.byProfile(row.accountId);
    if (!claimed) return;
    if (!online) {
      row.stipendPaid = false;
      await core.store.reseat({ ...row });
      return;
    }
    const got = core.host.earn(online[0], row.stipend);
    core.host.changed(online[0]);
    core.notice(online[0], text(naira(got)));
  } finally {
    pending.delete(key);
  }
}

export async function applyOffice(core: PoliticsCore, id: string, p: PoliticsPlayer) {
  const row = core.offices.find((r) => r.accountId === p.profileId);
  const post = row ? parseRace(row.race)?.post : undefined;
  core.host.setOffice(id, post ? officeIndex(post) : 0);
  if (!row || !post || row.stipendPaid) return;
  await payStipend(core, row, (amount) => `🏛️ You have been sworn in as ${post.title}. Your weekly stipend of ${amount} has landed.`);
}

export async function payLateStipends(core: PoliticsCore, p: PoliticsPlayer, t: GameTime) {
  const term = termCycle(t);
  const rows = await core.store.unpaidOffices(p.profileId, term - STIPEND_GRACE_TERMS, term);
  for (const row of rows) {
    const post = parseRace(row.race)?.post;
    if (!post) continue;
    const mine = core.offices.find((r) => r.cycle === row.cycle && r.race === row.race) ?? row;
    await payStipend(core, mine, (amount) => (row.cycle === term ? `🏛️ You are the ${post.title}. Your weekly stipend of ${amount} was waiting for you.` : `🏛️ Your stipend of ${amount} from your term as ${post.title} was waiting for you.`));
  }
}

export function gatherings(core: PoliticsCore, t: GameTime): GatheringView[] {
  const out: GatheringView[] = [];
  const cycle = electionCycle(t);
  const aluta = alutaFor(cycle);
  const m = weekMinute(t);
  if (aluta && m >= aluta.start && m < aluta.end) out.push({ id: ALUTA_GATHERING, title: aluta.title, site: aluta.site, until: cycle * WEEK_MINUTES + aluta.end, fun: aluta.fun });
  for (const row of core.offices) {
    const power = parseRace(row.race)?.post.power;
    if (power?.kind !== "gathering" || row.powerUsedAt === null || t.total >= row.powerUsedAt + GATHERING_MINUTES) continue;
    out.push({ id: row.race, title: power.title, site: power.site, until: row.powerUsedAt + GATHERING_MINUTES, fun: power.fun });
  }
  return out;
}

export async function joinGathering(core: PoliticsCore, id: string, p: PoliticsPlayer, gathering: string, t: GameTime) {
  const g = gatherings(core, t).find((x) => x.id === gathering);
  if (!g) return core.notice(id, TEXT.noGathering);
  const site = GATHERING_SITES[g.site];
  if (!core.outdoorsNear(p, site, GATHERING_REACH)) return core.notice(id, `${g.title} is at ${site.name}. Go there to join.`);
  const aluta = g.id === ALUTA_GATHERING;
  const fresh = await core.store.mark(p.profileId, aluta ? electionCycle(t) : core.officesCycle, aluta ? ALUTA_MARK : gatheringMark(g.id));
  if (!fresh) return core.notice(id, TEXT.joinedAlready);
  p.fun = Math.min(100, p.fun + g.fun);
  core.host.changed(id);
  core.host.cheer(id);
  core.notice(id, aluta ? `✊ You joined the ${g.title.toLowerCase()}. Aluta continua! Fun +${g.fun}.` : `📣 You joined: ${g.title}. Now you know what the union is doing. Fun +${g.fun}.`);
}

export async function usePower(core: PoliticsCore, id: string, p: PoliticsPlayer, t: GameTime) {
  const row = core.offices.find((r) => r.accountId === p.profileId);
  const post = row ? parseRace(row.race)?.post : undefined;
  if (!row || !post) return core.notice(id, TEXT.noOffice);
  if (row.powerUsedAt !== null) return core.notice(id, TEXT.powerUsed);
  const power = post.power;
  if (power.kind === "gathering" && !core.outdoorsNear(p, GATHERING_SITES[power.site], GATHERING_REACH)) return core.notice(id, `Go to ${GATHERING_SITES[power.site].name} first.`);
  if (!(await core.store.usePower(row.cycle, row.race, row.accountId, t.total))) {
    row.powerUsedAt = row.powerUsedAt ?? t.total;
    return core.notice(id, TEXT.powerUsed);
  }
  row.powerUsedAt = t.total;
  if (power.kind === "relief") {
    for (const [other, q] of core.host.players()) {
      if (interiorAt(q.x, q.y) || !withinReach(q, p, RELIEF_RADIUS)) continue;
      q.packs = Math.min(PACKS_MAX, q.packs + power.packs);
      core.host.changed(other);
    }
  }
  core.host.broadcast(power.notice);
}
