import {
  SUG_SCOPE,
  ServerMsg,
  UNION_POSTS,
  ballotFor,
  calledSitting,
  campusEffects,
  candidateKey,
  effortOf,
  facultyOf,
  gameMinutesAt,
  gameTime,
  interiorAt,
  parseRace,
  raceKey,
  rerunEntries,
  tallyRace,
  withinReach,
  POLITICS_REACH,
  type BallotEntry,
  type CampusEffects,
  type UnionState,
  type CongressSitting,
  type ElectionCandidate,
  type GameTime,
  type PlayerCandidate,
  type Point,
  type RaceResult,
  type RentedSpot,
  type UnionPost,
} from "@campuslife/shared";
import type { Candidacy, ImpeachmentRow, OfficeRow, PoliticsHost, PoliticsPlayer } from "./types";

const BIND_PREFIX = "dept:";
const SHARED_TTL_MS = 20_000;
const MEMO_LIMIT = 200;
const HEAD_RACE = raceKey(UNION_POSTS[0], SUG_SCOPE);

export interface RaceRef {
  post: UnionPost;
  scope: string;
  race: string;
}

export const REGISTER_DOWN = "SUIEC's register is offline right now. Try again shortly.";
export const naira = (amount: number) => `₦${Math.round(amount).toLocaleString("en-NG")}`;

export function toPlayerCandidate(c: Candidacy): PlayerCandidate {
  const body = parseRace(c.race)?.post.body ?? "sug";
  return { id: c.id, race: c.race, name: c.name, effort: effortOf(body, c.support, c.materials, c.spoke), look: c.look };
}

export class PoliticsCore {
  offices: OfficeRow[] = [];
  officesCycle = Number.NaN;
  states: UnionState[] = [];
  rented: RentedSpot[] = [];
  impeached: ImpeachmentRow[] = [];
  reruns = new Set<string>();
  worldStamp = "";
  private results = new Map<string, RaceResult>();
  private memo = new Map<string, { at: number; value: Promise<unknown> }>();
  private bound = new Map<string, { cycle: number; department: string }>();

  constructor(readonly host: PoliticsHost) {}

  get store() {
    return this.host.store;
  }

  time(): GameTime {
    return gameTime(this.host.clock?.() ?? gameMinutesAt(Date.now()));
  }

  wall(): number {
    return this.host.wallClock?.() ?? Date.now();
  }

  notice(id: string, text: string) {
    this.host.send(id, ServerMsg.Notice, text);
  }

  byProfile(profileId: string): [string, PoliticsPlayer] | undefined {
    for (const entry of this.host.players()) if (entry[1].profileId === profileId) return entry;
    return undefined;
  }

  refund(profileId: string, cash: number, energy = 0) {
    const found = this.byProfile(profileId);
    if (!found) return;
    found[1].cash += cash;
    found[1].energy += energy;
    this.host.changed(found[0]);
  }

  departmentOf(p: PoliticsPlayer): string {
    return this.bound.get(p.profileId)?.department ?? p.department;
  }

  async bind(p: PoliticsPlayer, cycle: number): Promise<string> {
    const known = this.bound.get(p.profileId);
    if (known?.cycle === cycle) return known.department;
    const saved = (await this.store.marksOf(p.profileId, cycle)).filter((m) => m.startsWith(BIND_PREFIX)).sort()[0];
    let department = saved?.slice(BIND_PREFIX.length);
    if (department === undefined) {
      if (!facultyOf(p.department)) return p.department;
      await this.store.mark(p.profileId, cycle, `${BIND_PREFIX}${p.department}`);
      department = p.department;
    }
    this.bound.set(p.profileId, { cycle, department });
    return department;
  }

  unbind(profileId: string) {
    this.bound.delete(profileId);
  }

  scopeFor(p: PoliticsPlayer, post: UnionPost): string | undefined {
    if (post.body === "sug") return SUG_SCOPE;
    const department = this.departmentOf(p);
    const faculty = facultyOf(department);
    if (!faculty) return undefined;
    return post.body === "faculty" ? faculty.key : department;
  }

  refFor(p: PoliticsPlayer, post: UnionPost): RaceRef | undefined {
    const scope = this.scopeFor(p, post);
    return scope ? { post, scope, race: raceKey(post, scope) } : undefined;
  }

  racesFor(p: PoliticsPlayer): RaceRef[] {
    return UNION_POSTS.flatMap((post) => this.refFor(p, post) ?? []);
  }

  everyone(type: string, payload: unknown) {
    if (this.host.everyone) return this.host.everyone(type, payload);
    for (const [id] of this.host.players()) this.host.send(id, type, payload);
  }

  effects(t: GameTime): CampusEffects {
    return campusEffects(this.states, t.total);
  }

  called(): CongressSitting | null {
    const row = this.offices.find((r) => r.race === HEAD_RACE && r.powerUsedAt !== null);
    return row && row.powerUsedAt !== null ? calledSitting(row.cycle, row.powerUsedAt) : null;
  }

  outdoorsNear(p: PoliticsPlayer, site: Point, reach = POLITICS_REACH): boolean {
    return !interiorAt(p.x, p.y) && withinReach(p, site, reach);
  }

  async ballot(cycle: number, ref: RaceRef): Promise<ElectionCandidate[]> {
    const players = await this.store.candidaciesIn(cycle, [ref.race]);
    return ballotFor(cycle, ref.post, ref.scope, players.map(toPlayerCandidate)).filter((c) => !c.disqualified);
  }

  async resultsFor(cycle: number, refs: readonly RaceRef[]): Promise<RaceResult[]> {
    const missing = refs.filter((r) => !this.results.has(`${cycle}:${r.race}`));
    if (missing.length > 0) {
      const races = missing.map((r) => r.race);
      const [players, endorsements, votes, reruns] = await Promise.all([this.store.candidaciesIn(cycle, races), this.store.endorsementCounts(cycle, races), this.store.voteCounts(cycle, races), this.store.reruns(cycle)]);
      for (const race of reruns) this.reruns.add(`${cycle}:${race}`);
      const endorsed = new Map(endorsements.map((e) => [candidateKey(e.race, e.candidate), e.count]));
      const voted = new Map(votes.map((v) => [candidateKey(v.race, v.candidate), v]));
      const live = players.map(toPlayerCandidate);
      for (const ref of missing) {
        const entries: BallotEntry[] = ballotFor(cycle, ref.post, ref.scope, live).map((c) => {
          const key = candidateKey(ref.race, c.id);
          return { id: c.id, name: c.npc ? `${c.name} "${c.nick}"` : c.name, npc: c.npc, base: c.base, endorsements: endorsed.get(key) ?? 0, votes: voted.get(key)?.votes ?? 0, informed: voted.get(key)?.informed ?? 0, disqualified: c.disqualified };
        });
        this.results.set(`${cycle}:${ref.race}`, tallyRace(cycle, ref.race, ref.post, reruns.includes(ref.race) ? rerunEntries(cycle, ref.race, entries) : entries));
      }
    }
    return refs.flatMap((r) => this.results.get(`${cycle}:${r.race}`) ?? []);
  }

  cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.wall();
    const hit = this.memo.get(key);
    if (hit && now - hit.at < SHARED_TTL_MS) return hit.value as Promise<T>;
    if (this.memo.size >= MEMO_LIMIT) this.memo.clear();
    const value = load();
    this.memo.set(key, { at: now, value });
    value.catch(() => this.memo.delete(key));
    return value;
  }

  dirty() {
    this.memo.clear();
  }

  forgetRace(cycle: number, race: string) {
    this.results.delete(`${cycle}:${race}`);
  }

  forgetResults(before: number) {
    for (const key of this.results.keys()) if (Number(key.slice(0, key.indexOf(":"))) < before) this.results.delete(key);
  }
}
