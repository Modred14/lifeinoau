import type { UnionState, CongressCount, CongressSide } from "@campuslife/shared";
import type { Candidacy, CandidacyPatch, CandidateCount, ImpeachmentRow, MarkCount, OfficeRow, PoliticsStore, RentalRow, VoteCount } from "./types";

interface Vote {
  accountId: string;
  cycle: number;
  race: string;
  candidate: string;
  informed: boolean;
}

const DOWN = "politics store unavailable";

export class MemoryPoliticsStore implements PoliticsStore {
  down = false;
  candidacies: Candidacy[] = [];
  votes: Vote[] = [];
  endorsements: Omit<Vote, "informed">[] = [];
  marks = new Set<string>();
  rows: OfficeRow[] = [];
  rented: RentalRow[] = [];
  rerunRaces: { cycle: number; race: string; by: string }[] = [];
  campus: UnionState[] = [];
  standing = new Map<string, CongressSide>();
  removals: ImpeachmentRow[] = [];

  private check() {
    if (this.down) throw new Error(DOWN);
  }

  async candidacyOf(accountId: string, cycle: number) {
    this.check();
    const found = this.candidacies.find((c) => c.accountId === accountId && c.cycle === cycle);
    return found ? structuredClone(found) : undefined;
  }

  async candidaciesIn(cycle: number, races: readonly string[]) {
    this.check();
    return structuredClone(this.candidacies.filter((c) => c.cycle === cycle && races.includes(c.race)));
  }

  async candidaciesOf(cycle: number) {
    this.check();
    return structuredClone(this.candidacies.filter((c) => c.cycle === cycle));
  }

  async addCandidacy(candidacy: Candidacy) {
    this.check();
    if (this.candidacies.some((c) => c.accountId === candidacy.accountId && c.cycle === candidacy.cycle)) return false;
    this.candidacies.push(structuredClone(candidacy));
    return true;
  }

  async saveCandidacy(id: string, patch: CandidacyPatch) {
    this.check();
    const found = this.candidacies.find((c) => c.id === id);
    if (found) Object.assign(found, structuredClone(patch));
  }

  async endorse(accountId: string, cycle: number, race: string, candidate: string) {
    this.check();
    if (this.endorsements.some((e) => e.accountId === accountId && e.cycle === cycle)) return false;
    this.endorsements.push({ accountId, cycle, race, candidate });
    return true;
  }

  async endorsementOf(accountId: string, cycle: number) {
    this.check();
    const e = this.endorsements.find((x) => x.accountId === accountId && x.cycle === cycle);
    return e ? { race: e.race, candidate: e.candidate } : undefined;
  }

  async endorsementCounts(cycle: number, races: readonly string[]) {
    this.check();
    const out = new Map<string, CandidateCount>();
    for (const e of this.endorsements) {
      if (e.cycle !== cycle || !races.includes(e.race)) continue;
      const key = `${e.race}#${e.candidate}`;
      const row = out.get(key) ?? { race: e.race, candidate: e.candidate, count: 0 };
      row.count++;
      out.set(key, row);
    }
    return [...out.values()];
  }

  async vote(accountId: string, cycle: number, race: string, candidate: string, informed: boolean) {
    this.check();
    if (this.votes.some((v) => v.accountId === accountId && v.cycle === cycle && v.race === race)) return false;
    this.votes.push({ accountId, cycle, race, candidate, informed });
    return true;
  }

  async votedRaces(accountId: string, cycle: number) {
    this.check();
    return this.votes.filter((v) => v.accountId === accountId && v.cycle === cycle).map((v) => v.race);
  }

  async voteCounts(cycle: number, races: readonly string[]) {
    this.check();
    const out = new Map<string, VoteCount>();
    for (const v of this.votes) {
      if (v.cycle !== cycle || !races.includes(v.race)) continue;
      const key = `${v.race}#${v.candidate}`;
      const row = out.get(key) ?? { race: v.race, candidate: v.candidate, votes: 0, informed: 0 };
      row.votes++;
      if (v.informed) row.informed++;
      out.set(key, row);
    }
    return [...out.values()];
  }

  async mark(accountId: string, cycle: number, kind: string) {
    this.check();
    const key = `${accountId}|${cycle}|${kind}`;
    if (this.marks.has(key)) return false;
    this.marks.add(key);
    return true;
  }

  async marksOf(accountId: string, cycle: number) {
    this.check();
    const prefix = `${accountId}|${cycle}|`;
    return [...this.marks].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }

  async seat(rows: readonly OfficeRow[]) {
    this.check();
    for (const row of rows) if (!this.rows.some((r) => r.cycle === row.cycle && r.race === row.race)) this.rows.push({ ...row });
  }

  async offices(cycle: number) {
    this.check();
    return this.rows.filter((r) => r.cycle === cycle).map((r) => ({ ...r }));
  }

  async claimStipend(cycle: number, race: string, accountId: string) {
    this.check();
    const row = this.rows.find((r) => r.cycle === cycle && r.race === race && r.accountId === accountId && !r.stipendPaid);
    if (!row) return false;
    row.stipendPaid = true;
    return true;
  }

  async usePower(cycle: number, race: string, accountId: string, at: number) {
    this.check();
    const row = this.rows.find((r) => r.cycle === cycle && r.race === race && r.accountId === accountId && r.powerUsedAt === null);
    if (!row) return false;
    row.powerUsedAt = at;
    return true;
  }

  async unpaidOffices(accountId: string, fromCycle: number, toCycle: number) {
    this.check();
    return this.rows.filter((r) => r.accountId === accountId && !r.stipendPaid && r.cycle >= fromCycle && r.cycle <= toCycle).map((r) => ({ ...r }));
  }

  async reseat(row: OfficeRow) {
    this.check();
    this.rows = [...this.rows.filter((r) => r.cycle !== row.cycle || r.race !== row.race), { ...row }];
  }

  async transferOffice(cycle: number, race: string, accountId: string | null, name: string) {
    this.check();
    const row = this.rows.find((r) => r.cycle === cycle && r.race === race);
    if (!row) return;
    if (accountId === null) this.rows = this.rows.filter((r) => r !== row);
    else Object.assign(row, { accountId, name, stipendPaid: true });
  }

  async rent(row: Omit<RentalRow, "slot">, cap: number) {
    this.check();
    const here = this.rented.filter((r) => r.cycle === row.cycle && r.area === row.area);
    if (here.some((r) => r.candidacyId === row.candidacyId)) return -1;
    for (let slot = 0; slot < cap; slot++) {
      if (here.some((r) => r.slot === slot)) continue;
      this.rented.push({ ...row, slot });
      return slot;
    }
    return -1;
  }

  async rentals(cycle: number) {
    this.check();
    return this.rented.filter((r) => r.cycle === cycle).map((r) => ({ ...r }));
  }

  async rerun(cycle: number, race: string, by: string) {
    this.check();
    if (this.rerunRaces.some((r) => r.cycle === cycle && r.race === race)) return false;
    this.rerunRaces.push({ cycle, race, by });
    return true;
  }

  async reruns(cycle: number) {
    this.check();
    return this.rerunRaces.filter((r) => r.cycle === cycle).map((r) => r.race);
  }

  async markCounts(cycle: number, prefix: string) {
    this.check();
    const out = new Map<string, MarkCount>();
    for (const key of this.marks) {
      const [, at, ...rest] = key.split("|");
      const kind = rest.join("|");
      if (Number(at) !== cycle || !kind.startsWith(prefix)) continue;
      const row = out.get(kind) ?? { kind, count: 0 };
      row.count++;
      out.set(kind, row);
    }
    return [...out.values()];
  }

  async countMark(kind: string) {
    this.check();
    return [...this.marks].filter((key) => key.split("|").slice(2).join("|") === kind).length;
  }

  async addState(state: UnionState) {
    this.check();
    if (this.campus.some((s) => s.id === state.id)) return false;
    this.campus.push({ ...state });
    return true;
  }

  async states(after: number) {
    this.check();
    return this.campus.filter((s) => s.until > after).map((s) => ({ ...s }));
  }

  async setSide(sitting: string, accountId: string, side: CongressSide | null) {
    this.check();
    const key = `${sitting}|${accountId}`;
    if (side) this.standing.set(key, side);
    else this.standing.delete(key);
  }

  async sides(sitting: string): Promise<CongressCount> {
    this.check();
    const mine = [...this.standing].filter(([key]) => key.startsWith(`${sitting}|`)).map(([, side]) => side);
    return { aye: mine.filter((s) => s === "aye").length, nay: mine.filter((s) => s === "nay").length };
  }

  async impeach(row: ImpeachmentRow) {
    this.check();
    if (this.removals.some((r) => r.cycle === row.cycle && r.race === row.race)) return false;
    this.removals.push({ ...row });
    return true;
  }

  async impeachments(cycle: number) {
    this.check();
    return this.removals.filter((r) => r.cycle === cycle).map((r) => ({ ...r }));
  }
}
