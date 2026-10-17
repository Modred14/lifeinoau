import { ServerMsg, electionCycle, electionNews, parsePoliticsAction, resultsOut, weekMinute, type CampusEffects, type UnionState, type GameTime, type NewsLine, type Point, type PoliticsAction } from "@campuslife/shared";
import { attend, buyForm, buyMaterial, castVote, endorse, speak } from "./politics/actions";
import { CampaignTrail } from "./politics/campaign";
import { CongressFloor } from "./politics/congress";
import { PoliticsCore, REGISTER_DOWN } from "./politics/core";
import { signPetition } from "./politics/impeach";
import { MarchLine, claimRelief } from "./politics/march";
import { ResultsNight, celebrate, petition } from "./politics/night";
import { applyOffice, finalize, joinGathering, payLateStipends, refreshOffices, usePower } from "./politics/office";
import { rentSpot } from "./politics/rentals";
import { buildStatus, offlineStatus } from "./politics/status";
import type { PoliticsHost, PoliticsPlayer } from "./politics/types";
import { refreshWorld, sendWorld } from "./politics/world";

export type { PoliticsHost, PoliticsPlayer, PoliticsStore } from "./politics/types";
export { MemoryPoliticsStore } from "./politics/memory";

const OFFICE_REFRESH_MS = 30_000;
const RETRY_MS = 10_000;
const ANNOUNCE_WINDOW_MINUTES = 10;
const ANNOUNCE_MEMORY = 120;
const NEWS_ICON = "🗳️";

export class PoliticsDesk {
  readonly core: PoliticsCore;
  private busy = new Set<string>();
  private trail = new CampaignTrail();
  private night = new ResultsNight();
  private floor = new CongressFloor();
  private line = new MarchLine();
  private said = new Set<string>();
  private finalized = new Set<number>();
  private news: { cycle: number; lines: NewsLine[] } = { cycle: -1, lines: [] };
  private finalizing = false;
  private refreshing = false;
  private nextRefreshAt = 0;
  private nextFinalizeAt = 0;

  constructor(host: PoliticsHost) {
    this.core = new PoliticsCore(host);
  }

  async handle(id: string, payload: unknown): Promise<void> {
    const action = parsePoliticsAction(payload);
    const p = this.core.host.player(id);
    if (!action || !p || this.busy.has(id)) return;
    this.busy.add(id);
    const t = this.core.time();
    try {
      await this.core.bind(p, electionCycle(t));
      await this.run(id, p, action, t);
    } catch (err) {
      console.error("[politics] action failed", action.a, err);
      if (action.a !== "status") this.core.notice(id, REGISTER_DOWN);
    } finally {
      this.busy.delete(id);
    }
    if (action.a !== "status") this.core.dirty();
    await this.sendStatus(id);
  }

  private run(id: string, p: PoliticsPlayer, action: PoliticsAction, t: GameTime): Promise<void> | void {
    const core = this.core;
    switch (action.a) {
      case "status":
        return;
      case "form":
        return buyForm(core, id, p, action.post, action.look, t);
      case "campaign":
        return this.trail.start(core, id, p, action.site, t);
      case "material":
        return buyMaterial(core, id, p, action.item, t);
      case "rent":
        return rentSpot(core, id, p, action.area, t);
      case "endorse":
        return endorse(core, id, p, action.post, action.c, t);
      case "vote":
        return castVote(core, id, p, action.post, action.c, t);
      case "speak":
        return speak(core, id, p, t);
      case "attend":
        return attend(core, id, p, t);
      case "power":
        return usePower(core, id, p, t).then(() => refreshWorld(core, t));
      case "join":
        return joinGathering(core, id, p, action.g, t);
      case "celebrate":
        return celebrate(core, id, p, t);
      case "petition":
        return petition(core, id, p, t);
      case "relief":
        return claimRelief(core, id, p, t);
      case "sign":
        return signPetition(core, id, p, action.race, t);
    }
  }

  async sendStatus(id: string): Promise<void> {
    const p = this.core.host.player(id);
    if (!p) return;
    const t = this.core.time();
    try {
      this.core.host.send(id, ServerMsg.Politics, await buildStatus(this.core, p, t, this.trail.speakingMs(id, this.core.wall())));
    } catch (err) {
      console.error("[politics] status failed", err);
      this.core.host.send(id, ServerMsg.Politics, offlineStatus(this.core, p, t));
    }
  }

  async joined(id: string) {
    const p = this.core.host.player(id);
    if (!p) return;
    const t = this.core.time();
    await applyOffice(this.core, id, p);
    sendWorld(this.core, id, t);
    await payLateStipends(this.core, p, t);
  }

  left(id: string) {
    const p = this.core.host.player(id);
    if (p) this.core.unbind(p.profileId);
    this.trail.left(id);
    this.busy.delete(id);
  }

  campusStates(): readonly UnionState[] {
    return this.core.states;
  }

  campusEffects(): CampusEffects {
    return this.core.effects(this.core.time());
  }

  fareFactor(): number {
    return this.campusEffects().fareFactor;
  }

  roadCrowd<T extends Point>(walkers: readonly T[]): Point[] {
    const march = this.line.blockers(this.core);
    return march.length > 0 ? [...walkers, ...march] : (walkers as readonly Point[] as Point[]);
  }

  async tick(): Promise<void> {
    try {
      const t = this.core.time();
      this.announce(t);
      await this.trail.tick(this.core, t);
      await this.settle(t);
      await this.refresh(t);
      await this.night.tick(this.core, t);
      await this.floor.tick(this.core, t);
      await this.line.tick(this.core, t);
    } catch (err) {
      console.error("[politics] tick failed", err);
    }
  }

  private announce(t: GameTime) {
    const cycle = electionCycle(t);
    const m = weekMinute(t);
    if (this.news.cycle !== cycle) this.news = { cycle, lines: electionNews(cycle) };
    for (const line of this.news.lines) {
      if (m < line.at || m >= line.at + ANNOUNCE_WINDOW_MINUTES) continue;
      const key = `${cycle}:${line.at}:${line.text}`;
      if (this.said.has(key)) continue;
      this.said.add(key);
      this.core.host.broadcast(`${NEWS_ICON} ${line.text}`);
    }
    if (this.said.size > ANNOUNCE_MEMORY) this.said = new Set([...this.said].slice(-ANNOUNCE_MEMORY / 2));
  }

  private async settle(t: GameTime) {
    const cycle = electionCycle(t);
    const due = [cycle - 1, ...(resultsOut(t) ? [cycle] : [])].filter((c) => c >= 0 && !this.finalized.has(c));
    if (due.length === 0 || this.finalizing || this.core.wall() < this.nextFinalizeAt) return;
    this.finalizing = true;
    try {
      for (const c of due) {
        await finalize(this.core, c);
        this.finalized.add(c);
      }
      this.core.forgetResults(cycle - 1);
      this.nextRefreshAt = 0;
    } catch (err) {
      console.error("[politics] could not settle the election, will retry", err);
      this.nextFinalizeAt = this.core.wall() + RETRY_MS;
    } finally {
      this.finalizing = false;
    }
  }

  private async refresh(t: GameTime) {
    if (this.refreshing || this.core.wall() < this.nextRefreshAt) return;
    this.refreshing = true;
    this.nextRefreshAt = this.core.wall() + OFFICE_REFRESH_MS;
    try {
      await refreshOffices(this.core, t);
      await refreshWorld(this.core, t);
    } catch (err) {
      console.error("[politics] could not load office holders, will retry", err);
      this.nextRefreshAt = this.core.wall() + RETRY_MS;
    } finally {
      this.refreshing = false;
    }
  }
}
