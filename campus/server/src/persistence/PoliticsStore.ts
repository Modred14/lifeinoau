import { CAMPUS_STATE_KINDS, type UnionState, type CampusStateKind, type CongressCount, type CongressSide } from "@campuslife/shared";
import { and, eq, gt, gte, inArray, isNull, like, lte, sql } from "drizzle-orm";
import { db } from "../database/database";
import {
  politicsCampusStates,
  politicsCandidacies,
  politicsCongressSides,
  politicsEndorsements,
  politicsImpeachments,
  politicsMarks,
  politicsOffices,
  politicsRentals,
  politicsReruns,
  politicsVotes,
  type PoliticsCandidacyRow,
  type PoliticsOfficeRow,
} from "../database/schema/politics";
import type { Candidacy, CandidacyPatch, CandidateCount, ImpeachmentRow, MarkCount, OfficeRow, PoliticsStore, RentalRow, VoteCount } from "../sim/politics/types";

const toCandidacy = (row: PoliticsCandidacyRow): Candidacy => ({
  id: row.id,
  accountId: row.accountId,
  cycle: row.cycle,
  race: row.race,
  name: row.name,
  support: row.support ?? {},
  materials: row.materials ?? [],
  spoke: row.spoke,
  look: { nick: row.nick, slogan: row.slogan, color: row.color },
  stops: row.stops ?? {},
});

const toOffice = (row: PoliticsOfficeRow): OfficeRow => ({
  cycle: row.cycle,
  race: row.race,
  accountId: row.accountId,
  name: row.name,
  stipend: row.stipend,
  stipendPaid: row.stipendPaid,
  powerUsedAt: row.powerUsedAt,
});

export class PgPoliticsStore implements PoliticsStore {
  async candidacyOf(accountId: string, cycle: number) {
    const [row] = await db.select().from(politicsCandidacies).where(and(eq(politicsCandidacies.accountId, accountId), eq(politicsCandidacies.cycle, cycle))).limit(1);
    return row ? toCandidacy(row) : undefined;
  }

  async candidaciesIn(cycle: number, races: readonly string[]) {
    if (races.length === 0) return [];
    const rows = await db.select().from(politicsCandidacies).where(and(eq(politicsCandidacies.cycle, cycle), inArray(politicsCandidacies.race, [...races])));
    return rows.map(toCandidacy);
  }

  async candidaciesOf(cycle: number) {
    const rows = await db.select().from(politicsCandidacies).where(eq(politicsCandidacies.cycle, cycle));
    return rows.map(toCandidacy);
  }

  async addCandidacy(c: Candidacy) {
    const added = await db
      .insert(politicsCandidacies)
      .values({ id: c.id, accountId: c.accountId, cycle: c.cycle, race: c.race, name: c.name, support: c.support, materials: c.materials, spoke: c.spoke, nick: c.look?.nick ?? 0, slogan: c.look?.slogan ?? 0, color: c.look?.color ?? 0, stops: c.stops ?? {} })
      .onConflictDoNothing()
      .returning({ id: politicsCandidacies.id });
    return added.length > 0;
  }

  async saveCandidacy(id: string, patch: CandidacyPatch) {
    await db.update(politicsCandidacies).set(patch).where(eq(politicsCandidacies.id, id));
  }

  async endorse(accountId: string, cycle: number, race: string, candidate: string) {
    const added = await db.insert(politicsEndorsements).values({ accountId, cycle, race, candidate }).onConflictDoNothing().returning({ race: politicsEndorsements.race });
    return added.length > 0;
  }

  async endorsementOf(accountId: string, cycle: number) {
    const [row] = await db
      .select({ race: politicsEndorsements.race, candidate: politicsEndorsements.candidate })
      .from(politicsEndorsements)
      .where(and(eq(politicsEndorsements.accountId, accountId), eq(politicsEndorsements.cycle, cycle)))
      .limit(1);
    return row;
  }

  async endorsementCounts(cycle: number, races: readonly string[]): Promise<CandidateCount[]> {
    if (races.length === 0) return [];
    return db
      .select({ race: politicsEndorsements.race, candidate: politicsEndorsements.candidate, count: sql<number>`count(*)::int` })
      .from(politicsEndorsements)
      .where(and(eq(politicsEndorsements.cycle, cycle), inArray(politicsEndorsements.race, [...races])))
      .groupBy(politicsEndorsements.race, politicsEndorsements.candidate);
  }

  async vote(accountId: string, cycle: number, race: string, candidate: string, informed: boolean) {
    const added = await db.insert(politicsVotes).values({ accountId, cycle, race, candidate, informed }).onConflictDoNothing().returning({ race: politicsVotes.race });
    return added.length > 0;
  }

  async votedRaces(accountId: string, cycle: number) {
    const rows = await db.select({ race: politicsVotes.race }).from(politicsVotes).where(and(eq(politicsVotes.accountId, accountId), eq(politicsVotes.cycle, cycle)));
    return rows.map((r) => r.race);
  }

  async voteCounts(cycle: number, races: readonly string[]): Promise<VoteCount[]> {
    if (races.length === 0) return [];
    return db
      .select({
        race: politicsVotes.race,
        candidate: politicsVotes.candidate,
        votes: sql<number>`count(*)::int`,
        informed: sql<number>`(count(*) filter (where ${politicsVotes.informed}))::int`,
      })
      .from(politicsVotes)
      .where(and(eq(politicsVotes.cycle, cycle), inArray(politicsVotes.race, [...races])))
      .groupBy(politicsVotes.race, politicsVotes.candidate);
  }

  async mark(accountId: string, cycle: number, kind: string) {
    const added = await db.insert(politicsMarks).values({ accountId, cycle, kind }).onConflictDoNothing().returning({ kind: politicsMarks.kind });
    return added.length > 0;
  }

  async marksOf(accountId: string, cycle: number) {
    const rows = await db.select({ kind: politicsMarks.kind }).from(politicsMarks).where(and(eq(politicsMarks.accountId, accountId), eq(politicsMarks.cycle, cycle)));
    return rows.map((r) => r.kind);
  }

  async seat(rows: readonly OfficeRow[]) {
    if (rows.length === 0) return;
    await db.insert(politicsOffices).values(rows.map((r) => ({ ...r }))).onConflictDoNothing();
  }

  async offices(cycle: number) {
    const rows = await db.select().from(politicsOffices).where(eq(politicsOffices.cycle, cycle));
    return rows.map(toOffice);
  }

  async claimStipend(cycle: number, race: string, accountId: string) {
    const claimed = await db
      .update(politicsOffices)
      .set({ stipendPaid: true })
      .where(and(eq(politicsOffices.cycle, cycle), eq(politicsOffices.race, race), eq(politicsOffices.accountId, accountId), eq(politicsOffices.stipendPaid, false)))
      .returning({ race: politicsOffices.race });
    return claimed.length > 0;
  }

  async usePower(cycle: number, race: string, accountId: string, at: number) {
    const used = await db
      .update(politicsOffices)
      .set({ powerUsedAt: at })
      .where(and(eq(politicsOffices.cycle, cycle), eq(politicsOffices.race, race), eq(politicsOffices.accountId, accountId), isNull(politicsOffices.powerUsedAt)))
      .returning({ race: politicsOffices.race });
    return used.length > 0;
  }

  async unpaidOffices(accountId: string, fromCycle: number, toCycle: number) {
    const rows = await db
      .select()
      .from(politicsOffices)
      .where(and(eq(politicsOffices.accountId, accountId), eq(politicsOffices.stipendPaid, false), gte(politicsOffices.cycle, fromCycle), lte(politicsOffices.cycle, toCycle)));
    return rows.map(toOffice);
  }

  async reseat(row: OfficeRow) {
    await db
      .insert(politicsOffices)
      .values({ ...row })
      .onConflictDoUpdate({ target: [politicsOffices.cycle, politicsOffices.race], set: { accountId: row.accountId, name: row.name, stipend: row.stipend, stipendPaid: row.stipendPaid, powerUsedAt: row.powerUsedAt } });
  }

  async transferOffice(cycle: number, race: string, accountId: string | null, name: string) {
    const where = and(eq(politicsOffices.cycle, cycle), eq(politicsOffices.race, race));
    if (accountId === null) await db.delete(politicsOffices).where(where);
    else await db.update(politicsOffices).set({ accountId, name, stipendPaid: true }).where(where);
  }

  async rent(row: Omit<RentalRow, "slot">, cap: number) {
    for (let slot = 0; slot < cap; slot++) {
      const added = await db.insert(politicsRentals).values({ ...row, slot }).onConflictDoNothing().returning({ slot: politicsRentals.slot });
      if (added.length > 0) return slot;
      const [mine] = await db
        .select({ slot: politicsRentals.slot })
        .from(politicsRentals)
        .where(and(eq(politicsRentals.cycle, row.cycle), eq(politicsRentals.area, row.area), eq(politicsRentals.candidacyId, row.candidacyId)))
        .limit(1);
      if (mine) return -1;
    }
    return -1;
  }

  async rentals(cycle: number): Promise<RentalRow[]> {
    return db.select({ cycle: politicsRentals.cycle, area: politicsRentals.area, slot: politicsRentals.slot, candidacyId: politicsRentals.candidacyId }).from(politicsRentals).where(eq(politicsRentals.cycle, cycle));
  }

  async rerun(cycle: number, race: string, by: string) {
    const added = await db.insert(politicsReruns).values({ cycle, race, by }).onConflictDoNothing().returning({ race: politicsReruns.race });
    return added.length > 0;
  }

  async reruns(cycle: number) {
    const rows = await db.select({ race: politicsReruns.race }).from(politicsReruns).where(eq(politicsReruns.cycle, cycle));
    return rows.map((r) => r.race);
  }

  async markCounts(cycle: number, prefix: string): Promise<MarkCount[]> {
    return db
      .select({ kind: politicsMarks.kind, count: sql<number>`count(*)::int` })
      .from(politicsMarks)
      .where(and(eq(politicsMarks.cycle, cycle), like(politicsMarks.kind, `${prefix}%`)))
      .groupBy(politicsMarks.kind);
  }

  async countMark(kind: string) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(politicsMarks).where(eq(politicsMarks.kind, kind));
    return row?.count ?? 0;
  }

  async addState(state: UnionState) {
    const added = await db
      .insert(politicsCampusStates)
      .values({ id: state.id, kind: state.kind, issue: state.issue, startsAt: state.from, endsAt: state.until, concession: state.concession })
      .onConflictDoNothing()
      .returning({ id: politicsCampusStates.id });
    return added.length > 0;
  }

  async states(after: number): Promise<UnionState[]> {
    const rows = await db.select().from(politicsCampusStates).where(gt(politicsCampusStates.endsAt, after));
    return rows
      .filter((row) => CAMPUS_STATE_KINDS.includes(row.kind as CampusStateKind))
      .map((row) => ({ id: row.id, kind: row.kind as CampusStateKind, issue: row.issue, from: row.startsAt, until: row.endsAt, concession: row.concession }));
  }

  async setSide(sitting: string, accountId: string, side: CongressSide | null) {
    const where = and(eq(politicsCongressSides.sitting, sitting), eq(politicsCongressSides.accountId, accountId));
    if (side === null) await db.delete(politicsCongressSides).where(where);
    else await db.insert(politicsCongressSides).values({ sitting, accountId, side }).onConflictDoUpdate({ target: [politicsCongressSides.sitting, politicsCongressSides.accountId], set: { side } });
  }

  async sides(sitting: string): Promise<CongressCount> {
    const rows = await db.select({ side: politicsCongressSides.side, count: sql<number>`count(*)::int` }).from(politicsCongressSides).where(eq(politicsCongressSides.sitting, sitting)).groupBy(politicsCongressSides.side);
    const of = (side: CongressSide) => rows.find((r) => r.side === side)?.count ?? 0;
    return { aye: of("aye"), nay: of("nay") };
  }

  async impeach(row: ImpeachmentRow) {
    const added = await db.insert(politicsImpeachments).values({ ...row }).onConflictDoNothing().returning({ race: politicsImpeachments.race });
    return added.length > 0;
  }

  async impeachments(cycle: number): Promise<ImpeachmentRow[]> {
    const rows = await db.select().from(politicsImpeachments).where(eq(politicsImpeachments.cycle, cycle));
    return rows.map((r) => ({ cycle: r.cycle, race: r.race, ousted: r.ousted, successor: r.successor, successorAccount: r.successorAccount, removed: r.removed, at: r.at }));
  }
}

export const politicsStore: PoliticsStore = new PgPoliticsStore();
