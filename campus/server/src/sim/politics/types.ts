import type { CampaignLook, UnionState, CongressCount, CongressSide } from "@campuslife/shared";

export interface Candidacy {
  id: string;
  accountId: string;
  cycle: number;
  race: string;
  name: string;
  support: Record<string, number>;
  materials: string[];
  spoke: boolean;
  look?: CampaignLook;
  stops?: Record<string, number>;
}

export type CandidacyPatch = Partial<Pick<Candidacy, "support" | "materials" | "spoke" | "stops">>;

export interface RentalRow {
  cycle: number;
  area: string;
  slot: number;
  candidacyId: string;
}

export interface MarkCount {
  kind: string;
  count: number;
}

export interface ImpeachmentRow {
  cycle: number;
  race: string;
  ousted: string;
  successor: string;
  successorAccount: string | null;
  removed: boolean;
  at: number;
}

export interface CandidateCount {
  race: string;
  candidate: string;
  count: number;
}

export interface VoteCount {
  race: string;
  candidate: string;
  votes: number;
  informed: number;
}

export interface OfficeRow {
  cycle: number;
  race: string;
  accountId: string;
  name: string;
  stipend: number;
  stipendPaid: boolean;
  powerUsedAt: number | null;
}

export interface PoliticsStore {
  candidacyOf(accountId: string, cycle: number): Promise<Candidacy | undefined>;
  candidaciesIn(cycle: number, races: readonly string[]): Promise<Candidacy[]>;
  candidaciesOf(cycle: number): Promise<Candidacy[]>;
  addCandidacy(candidacy: Candidacy): Promise<boolean>;
  saveCandidacy(id: string, patch: CandidacyPatch): Promise<void>;
  endorse(accountId: string, cycle: number, race: string, candidate: string): Promise<boolean>;
  endorsementOf(accountId: string, cycle: number): Promise<{ race: string; candidate: string } | undefined>;
  endorsementCounts(cycle: number, races: readonly string[]): Promise<CandidateCount[]>;
  vote(accountId: string, cycle: number, race: string, candidate: string, informed: boolean): Promise<boolean>;
  votedRaces(accountId: string, cycle: number): Promise<string[]>;
  voteCounts(cycle: number, races: readonly string[]): Promise<VoteCount[]>;
  mark(accountId: string, cycle: number, kind: string): Promise<boolean>;
  marksOf(accountId: string, cycle: number): Promise<string[]>;
  seat(rows: readonly OfficeRow[]): Promise<void>;
  offices(cycle: number): Promise<OfficeRow[]>;
  claimStipend(cycle: number, race: string, accountId: string): Promise<boolean>;
  usePower(cycle: number, race: string, accountId: string, at: number): Promise<boolean>;
  unpaidOffices(accountId: string, fromCycle: number, toCycle: number): Promise<OfficeRow[]>;
  reseat(row: OfficeRow): Promise<void>;
  transferOffice(cycle: number, race: string, accountId: string | null, name: string): Promise<void>;
  rent(row: Omit<RentalRow, "slot">, cap: number): Promise<number>;
  rentals(cycle: number): Promise<RentalRow[]>;
  rerun(cycle: number, race: string, by: string): Promise<boolean>;
  reruns(cycle: number): Promise<string[]>;
  markCounts(cycle: number, prefix: string): Promise<MarkCount[]>;
  countMark(kind: string): Promise<number>;
  addState(state: UnionState): Promise<boolean>;
  states(after: number): Promise<UnionState[]>;
  setSide(sitting: string, accountId: string, side: CongressSide | null): Promise<void>;
  sides(sitting: string): Promise<CongressCount>;
  impeach(row: ImpeachmentRow): Promise<boolean>;
  impeachments(cycle: number): Promise<ImpeachmentRow[]>;
}

export interface PoliticsPlayer {
  x: number;
  y: number;
  cash: number;
  energy: number;
  fun: number;
  packs: number;
  gpTotal: number;
  exams: number;
  malpractice: number;
  rusticatedUntil: number;
  level: string;
  department: string;
  profileId: string;
}

export interface PoliticsHost {
  store: PoliticsStore;
  player(id: string): PoliticsPlayer | undefined;
  players(): Iterable<[string, PoliticsPlayer]>;
  name(id: string): string;
  send(id: string, type: string, payload: unknown): void;
  broadcast(text: string): void;
  changed(id: string): void;
  earn(id: string, amount: number): number;
  setOffice(id: string, office: number): void;
  cheer(id: string): void;
  everyone?(type: string, payload: unknown): void;
  clock?(): number;
  wallClock?(): number;
}
