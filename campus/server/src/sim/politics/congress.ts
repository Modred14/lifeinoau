import {
  CONGRESS,
  CONGRESS_SITE,
  CONGRESS_VENUE,
  MINUTES_PER_DAY,
  congressSide,
  congressStateId,
  congressResult,
  congressesFor,
  electionCycle,
  findMotion,
  interiorAt,
  resultLine,
  settlesAt,
  sittingPhase,
  stateFromCongress,
  stateLine,
  voteOpensAt,
  weekClock,
  type CongressSide,
  type CongressSitting,
  type GameTime,
} from "@campuslife/shared";
import type { PoliticsCore } from "./core";
import { refreshWorld } from "./world";

const RESOLVE_WINDOW_MINUTES = MINUTES_PER_DAY;
const SIDE_NAME: Record<CongressSide, string> = { aye: "Ayes", nay: "Nays" };
const clock = (total: number) => weekClock(((total % (7 * MINUTES_PER_DAY)) + 7 * MINUTES_PER_DAY) % (7 * MINUTES_PER_DAY)).slice(4);

export function sittingsNear(core: PoliticsCore, t: GameTime): CongressSitting[] {
  const cycle = electionCycle(t);
  const called = core.called();
  return [...congressesFor(cycle - 1), ...congressesFor(cycle), ...(called ? [called] : [])].filter((s) => t.total >= s.start && t.total < settlesAt(s) + RESOLVE_WINDOW_MINUTES);
}

export class CongressFloor {
  private standing = new Map<string, CongressSide>();
  private said = new Set<string>();
  private settled = new Set<string>();
  private busy = false;

  async tick(core: PoliticsCore, t: GameTime) {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const sitting of sittingsNear(core, t)) await this.run(core, sitting, t);
    } finally {
      this.busy = false;
    }
  }

  private once(key: string): boolean {
    if (this.said.has(key)) return false;
    this.said.add(key);
    return true;
  }

  private async run(core: PoliticsCore, s: CongressSitting, t: GameTime) {
    const phase = sittingPhase(s, t.total);
    const motion = findMotion(s.motion);
    if (phase === "gather" && this.once(`${s.id}:gather`)) {
      core.host.broadcast(`📜 Congress is sitting at ${CONGRESS_VENUE} over ${motion.issue}. The Speaker calls the vote at ${clock(voteOpensAt(s))}.`);
    }
    if (phase === "vote") {
      if (this.once(`${s.id}:vote`)) core.host.broadcast(`🗣️ The Speaker has put the question: ${motion.question} Stand on the Aye side or the Nay side of the ground now.`);
      await this.count(core, s);
    }
    if (phase === "done") await this.settle(core, s, t);
  }

  private async count(core: PoliticsCore, s: CongressSitting) {
    for (const [id, p] of core.host.players()) {
      const key = `${s.id}|${p.profileId}`;
      const side = interiorAt(p.x, p.y) ? null : congressSide(p, CONGRESS_SITE);
      const before = this.standing.get(key) ?? null;
      if (side === before) continue;
      if (side) this.standing.set(key, side);
      else this.standing.delete(key);
      await core.store.setSide(s.id, p.profileId, side);
      if (!side) {
        core.notice(id, "You stepped off the ground. Your vote is not counted unless you stand on a side.");
        continue;
      }
      core.notice(id, `✋ You are standing with the ${SIDE_NAME[side]}. Stay there till the Speaker counts.`);
      if (!(await core.store.mark(p.profileId, electionCycle(core.time()), `congress:${s.id}`))) continue;
      const online = core.byProfile(p.profileId);
      if (!online) continue;
      online[1].fun = Math.min(100, online[1].fun + CONGRESS.fun);
      core.host.changed(online[0]);
    }
  }

  private async settle(core: PoliticsCore, s: CongressSitting, t: GameTime) {
    const id = congressStateId(s);
    if (this.settled.has(id)) return;
    const landed = core.states.find((state) => state.id === id);
    if (landed) {
      this.settled.add(id);
      this.forget(s.id);
      core.host.broadcast(stateLine(landed));
      return;
    }
    this.settled.add(id);
    this.forget(s.id);
    try {
      const result = congressResult(s, await core.store.sides(s.id));
      const state = stateFromCongress(s, result);
      if (!(await core.store.addState(state))) {
        this.settled.delete(id);
        return;
      }
      core.host.broadcast(resultLine(s, result));
      core.host.broadcast(stateLine(state));
    } catch (err) {
      this.settled.delete(id);
      throw err;
    } finally {
      await refreshWorld(core, t);
    }
  }

  private forget(sittingId: string) {
    const prefix = `${sittingId}|`;
    for (const key of this.standing.keys()) if (key.startsWith(prefix)) this.standing.delete(key);
  }
}
