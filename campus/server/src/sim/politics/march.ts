import {
  FORM_DESK,
  MARCH,
  MINUTES_PER_DAY,
  PACKS_MAX,
  POLITICS_REACH,
  WEEK_MINUTES,
  afterMarchId,
  interiorAt,
  marchAt,
  marchBlockers,
  marchMark,
  marchPlan,
  marchSecondsNeeded,
  marchTurnout,
  stateAfterMarch,
  stateLine,
  weekClock,
  withMarch,
  type UnionState,
  type GameTime,
  type MarchPlan,
  type Point,
} from "@campuslife/shared";
import type { PoliticsCore } from "./core";
import type { PoliticsPlayer } from "./types";
import { refreshWorld } from "./world";

const RESOLVE_WINDOW_MINUTES = MINUTES_PER_DAY;
const MAX_STEP_SECONDS = 2;
const RELIEF_REACH = POLITICS_REACH * 2;
const TEXT = {
  noRelief: "No relief packs are being shared now.",
  reliefPlace: "Relief packs are shared at the SUIEC desk outside the Student Union Building.",
  reliefTaken: "You have collected your relief pack already.",
};
const cycleOf = (state: Pick<UnionState, "from">) => Math.floor(state.from / WEEK_MINUTES);
const clock = (total: number) => weekClock(((total % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES).slice(4);

export class MarchLine {
  private plans = new Map<string, MarchPlan>();
  private walked = new Map<string, number>();
  private counted = new Set<string>();
  private said = new Set<string>();
  private settled = new Set<string>();
  private lastWall = 0;
  private busy = false;
  private block: { minute: number; points: Point[] } = { minute: -1, points: [] };

  plan(state: UnionState): MarchPlan {
    let plan = this.plans.get(state.id);
    if (!plan) this.plans.set(state.id, (plan = marchPlan(state)));
    return plan;
  }

  blockers(core: PoliticsCore): Point[] {
    const minute = core.time().total;
    if (this.block.minute === minute) return this.block.points;
    const points = core.states.filter((s) => s.kind === "protest").flatMap((s) => marchBlockers(this.plan(s), minute));
    this.block = { minute, points };
    return points;
  }

  async tick(core: PoliticsCore, t: GameTime) {
    const now = core.wall();
    const step = Math.min(MAX_STEP_SECONDS, Math.max(0, (now - this.lastWall) / 1000));
    this.lastWall = now;
    if (this.busy) return;
    this.busy = true;
    try {
      for (const state of core.states) if (state.kind === "protest") await this.run(core, state, t, step);
    } finally {
      this.busy = false;
    }
  }

  private once(key: string): boolean {
    if (this.said.has(key)) return false;
    this.said.add(key);
    return true;
  }

  private async run(core: PoliticsCore, state: UnionState, t: GameTime, step: number) {
    const plan = this.plan(state);
    if (t.total < plan.forms) return;
    if (t.total >= plan.end) return this.settle(core, plan, t);
    const spot = marchAt(plan, t.total);
    if (spot.phase === "forming" && this.once(`${plan.id}:forming`)) core.host.broadcast(`✊ The march over ${plan.issue} is forming at the Anglo-Moz car park. It moves at ${clock(plan.start)}. Placards and songs only.`);
    if (t.total >= plan.start && this.once(`${plan.id}:moving`)) core.host.broadcast("✊ The march has left Anglo-Moz for the SUB and the Main Gate. Walk with the crowd to be counted.");
    if (spot.phase === "holding" && this.once(`${plan.id}:sub`)) core.host.broadcast("✊ The march is at the Student Union Building. Solidarity songs, then on to the Main Gate.");
    if (spot.phase !== "walking") return;
    const needed = marchSecondsNeeded(plan);
    for (const [, p] of core.host.players()) {
      const key = `${plan.id}|${p.profileId}`;
      if (this.counted.has(key) || interiorAt(p.x, p.y) || !withMarch(p, spot)) continue;
      const total = (this.walked.get(key) ?? 0) + step;
      this.walked.set(key, total);
      if (total < needed) continue;
      this.counted.add(key);
      this.walked.delete(key);
      if (!(await core.store.mark(p.profileId, cycleOf(state), marchMark(plan.id)))) continue;
      const online = core.byProfile(p.profileId);
      if (!online) continue;
      online[1].fun = Math.min(100, online[1].fun + MARCH.fun);
      online[1].energy = Math.max(0, online[1].energy - MARCH.energy);
      core.host.changed(online[0]);
      core.host.cheer(online[0]);
      core.notice(online[0], `✊ You marched with Great Ife over ${plan.issue}. You are counted in the turnout. Fun +${MARCH.fun}.`);
    }
  }

  private async settle(core: PoliticsCore, plan: MarchPlan, t: GameTime) {
    const id = afterMarchId(plan.id);
    if (this.settled.has(id) || t.total >= plan.end + RESOLVE_WINDOW_MINUTES) return;
    const landed = core.states.find((s) => s.id === id);
    if (landed) return this.heard(core, plan, landed);
    this.settled.add(id);
    this.forget(plan.id);
    try {
      const turnout = marchTurnout(plan.id, await core.store.countMark(marchMark(plan.id)));
      const state = stateAfterMarch(plan, turnout);
      if (!(await core.store.addState(state))) {
        this.settled.delete(id);
        return;
      }
      core.host.broadcast(`✊ The march reached the Main Gate with about ${turnout.total.toLocaleString("en-NG")} students. It ended in peace.`);
      core.host.broadcast(stateLine(state));
    } catch (err) {
      this.settled.delete(id);
      throw err;
    } finally {
      await refreshWorld(core, t);
    }
  }

  private heard(core: PoliticsCore, plan: MarchPlan, state: UnionState) {
    this.settled.add(state.id);
    this.forget(plan.id);
    core.host.broadcast(stateLine(state));
  }

  private forget(planId: string) {
    const prefix = `${planId}|`;
    for (const key of this.walked.keys()) if (key.startsWith(prefix)) this.walked.delete(key);
    for (const key of this.counted) if (key.startsWith(prefix)) this.counted.delete(key);
  }
}

export async function claimRelief(core: PoliticsCore, id: string, p: PoliticsPlayer, t: GameTime) {
  const effects = core.effects(t);
  const state = core.states.find((s) => s.id === effects.relief);
  if (!state || effects.reliefPacks <= 0) return core.notice(id, TEXT.noRelief);
  if (!core.outdoorsNear(p, FORM_DESK, RELIEF_REACH)) return core.notice(id, TEXT.reliefPlace);
  if (!(await core.store.mark(p.profileId, cycleOf(state), reliefMark(state.id)))) return core.notice(id, TEXT.reliefTaken);
  const online = core.byProfile(p.profileId);
  if (!online) return;
  online[1].packs = Math.min(PACKS_MAX, online[1].packs + effects.reliefPacks);
  core.host.changed(online[0]);
  core.notice(online[0], "🍱 You collected a free food relief pack. Management kept its word this time.");
}

export const reliefMark = (stateId: string): string => `relief:${stateId}`;
export const worldMarkCycles = (states: readonly UnionState[]): number[] => [...new Set(states.map(cycleOf))];
