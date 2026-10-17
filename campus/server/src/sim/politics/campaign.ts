import { CAMPAIGN, CAMPAIGN_TRAIN, RALLY_POINTS, activeRallies, campaignGain, campaignsOpen, electionCycle, parseRace, rallyPoint, stopKey, trainBonus, type GameTime, type PoliticsSite } from "@campuslife/shared";
import { naira, type PoliticsCore } from "./core";
import type { PoliticsPlayer } from "./types";

const SPEECH_SECONDS = Math.round(CAMPAIGN.speechMs / 1000);
const TEXT = {
  noForm: "You are not contesting this week. Pick a form at the SUB on Monday.",
  campaignClosed: "Campaigns run from Tuesday 6 am to Thursday 6 pm.",
  notAtHall: "Walk up to a hall front or the Anglo-Moz car park to campaign.",
  breathe: "Catch your breath first.",
  speaking: "You are still speaking. Finish this one first.",
  tired: "You are too tired to campaign. Rest small.",
  noLogistics: `Campaign logistics cost ${naira(CAMPAIGN.cost)} each stop. You no get reach.`,
  hallDone: "This place don hear you finish. Try another hall.",
  walkedOff: "You walked off before you finished. The hall no hear you.",
};

interface Speech {
  site: PoliticsSite;
  startedAt: number;
}

interface Finisher {
  id: string;
  at: number;
  paired: boolean;
}

export class CampaignTrail {
  private speeches = new Map<string, Speech>();
  private lastAt = new Map<string, number>();
  private train = new Map<string, Finisher[]>();
  private locks = new Map<string, Promise<void>>();

  speakingMs(id: string, now: number): number {
    const speech = this.speeches.get(id);
    return speech ? Math.max(0, speech.startedAt + CAMPAIGN.speechMs - now) : 0;
  }

  left(id: string) {
    this.speeches.delete(id);
    this.lastAt.delete(id);
  }

  async start(core: PoliticsCore, id: string, p: PoliticsPlayer, siteId: string, t: GameTime) {
    const site = rallyPoint(siteId);
    if (!site) return;
    if (!campaignsOpen(t)) return core.notice(id, TEXT.campaignClosed);
    if (!core.outdoorsNear(p, site)) return core.notice(id, TEXT.notAtHall);
    const now = core.wall();
    if (this.speeches.has(id)) return core.notice(id, TEXT.speaking);
    if (now - (this.lastAt.get(id) ?? -Infinity) < CAMPAIGN.cooldownMs) return core.notice(id, TEXT.breathe);
    if (p.energy < CAMPAIGN.energy) return core.notice(id, TEXT.tired);
    if (p.cash < CAMPAIGN.cost) return core.notice(id, TEXT.noLogistics);
    const mine = await core.store.candidacyOf(p.profileId, electionCycle(t));
    if (!mine) return core.notice(id, TEXT.noForm);
    const body = parseRace(mine.race)?.post.body ?? "sug";
    if (campaignGain(body, mine.support[site.id] ?? 0, false, mine.stops?.[stopKey(site.id, t.weekday)] ?? 0) <= 0) return core.notice(id, TEXT.hallDone);
    this.lastAt.set(id, now);
    this.speeches.set(id, { site, startedAt: now });
    core.host.cheer(id);
    core.notice(id, `📣 You are speaking at ${site.name}. Hold your ground for ${SPEECH_SECONDS} seconds.`);
  }

  async tick(core: PoliticsCore, t: GameTime) {
    const now = core.wall();
    const due = [...this.speeches].filter(([, speech]) => now - speech.startedAt >= CAMPAIGN.speechMs);
    for (const [id, speech] of due) {
      this.speeches.delete(id);
      const p = core.host.player(id);
      if (!p) continue;
      try {
        await this.finish(core, id, p, speech.site, t, now);
      } catch (err) {
        console.error("[politics] campaign stop failed", err);
      }
    }
  }

  private async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private async finish(core: PoliticsCore, id: string, p: PoliticsPlayer, site: PoliticsSite, t: GameTime, now: number) {
    const train = await this.locked(p.profileId, () => this.stop(core, id, p, site, t, now));
    if (train) await this.join(core, site, id, now, train.partners, train.bonus, t);
  }

  private async stop(core: PoliticsCore, id: string, p: PoliticsPlayer, site: PoliticsSite, t: GameTime, now: number): Promise<{ partners: Finisher[]; bonus: number } | void> {
    if (!campaignsOpen(t)) return core.notice(id, TEXT.campaignClosed);
    if (!core.outdoorsNear(p, site)) return core.notice(id, TEXT.walkedOff);
    const mine = await core.store.candidacyOf(p.profileId, electionCycle(t));
    if (!mine) return core.notice(id, TEXT.noForm);
    if (p.energy < CAMPAIGN.energy) return core.notice(id, TEXT.tired);
    if (p.cash < CAMPAIGN.cost) return core.notice(id, TEXT.noLogistics);
    const body = parseRace(mine.race)?.post.body ?? "sug";
    const rally = activeRallies(t).some((r) => RALLY_POINTS[r.site]?.id === site.id);
    const key = stopKey(site.id, t.weekday);
    const stopsToday = mine.stops?.[key] ?? 0;
    const gain = campaignGain(body, mine.support[site.id] ?? 0, rally, stopsToday);
    if (gain <= 0) return core.notice(id, TEXT.hallDone);
    const partners = rally ? this.partners(core, site.id, id, now) : [];
    const support = { ...mine.support, [site.id]: (mine.support[site.id] ?? 0) + gain };
    const bonus = partners.length > 0 ? trainBonus(body, support[CAMPAIGN_TRAIN.key] ?? 0) : 0;
    if (bonus > 0) support[CAMPAIGN_TRAIN.key] = (support[CAMPAIGN_TRAIN.key] ?? 0) + bonus;
    p.cash -= CAMPAIGN.cost;
    p.energy -= CAMPAIGN.energy;
    core.host.changed(id);
    try {
      await core.store.saveCandidacy(mine.id, { support, stops: { ...mine.stops, [key]: stopsToday + 1 } });
    } catch (err) {
      core.refund(p.profileId, CAMPAIGN.cost, CAMPAIGN.energy);
      throw err;
    }
    core.host.cheer(id);
    const fading = stopsToday > 0 ? " They have heard you here today, so it is fading." : "";
    core.notice(id, `📣 You campaigned at ${site.name}. +${gain} support${rally ? ", the rally crowd doubled it" : ""}.${fading}`);
    return rally ? { partners, bonus } : undefined;
  }

  private partners(core: PoliticsCore, site: string, id: string, now: number): Finisher[] {
    const fresh = (this.train.get(site) ?? []).filter((f) => now - f.at <= CAMPAIGN_TRAIN.windowMs && core.host.player(f.id));
    this.train.set(site, fresh);
    return fresh.filter((f) => f.id !== id);
  }

  private async join(core: PoliticsCore, site: PoliticsSite, id: string, now: number, partners: Finisher[], bonus: number, t: GameTime) {
    const list = (this.train.get(site.id) ?? []).filter((f) => f.id !== id);
    list.push({ id, at: now, paired: partners.length > 0 });
    this.train.set(site.id, list);
    if (partners.length === 0) return;
    const names = [id, ...partners.map((f) => f.id)].map((who) => core.host.name(who)).join(" and ");
    if (bonus > 0) core.notice(id, `🚂 Campaign train at ${site.name}! ${names} moved together. +${bonus} support.`);
    for (const partner of partners) {
      if (partner.paired) continue;
      partner.paired = true;
      const q = core.host.player(partner.id);
      if (!q) continue;
      const extra = await this.locked(q.profileId, async () => {
        const theirs = await core.store.candidacyOf(q.profileId, electionCycle(t));
        if (!theirs) return 0;
        const add = trainBonus(parseRace(theirs.race)?.post.body ?? "sug", theirs.support[CAMPAIGN_TRAIN.key] ?? 0);
        if (add > 0) await core.store.saveCandidacy(theirs.id, { support: { ...theirs.support, [CAMPAIGN_TRAIN.key]: (theirs.support[CAMPAIGN_TRAIN.key] ?? 0) + add } });
        return add;
      });
      if (extra <= 0) continue;
      core.notice(partner.id, `🚂 Campaign train at ${site.name}! ${names} moved together. +${extra} support.`);
    }
  }
}
