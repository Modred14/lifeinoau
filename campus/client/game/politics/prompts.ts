import {
  ALUTA_GATHERING,
  ALUTA_MARK,
  AMPHI_PLACE,
  CAMPAIGN,
  CELEBRATE,
  CONGRESS,
  CONGRESS_SITE,
  DEBATE_MARK,
  DEBATE_SITE,
  FORM_DESK,
  GATHERING_SITES,
  POLITICS_REACH,
  POLL_UNITS,
  RALLY_POINTS,
  activeRallies,
  campaignsOpen,
  campusEffects,
  congressSide,
  congressesFor,
  debateOn,
  electionCycle,
  findMotion,
  formsOnSale,
  gatheringMark,
  marchAt,
  marchPlan,
  pollsOpen,
  sittingPhase,
  withMarch,
  type CongressSitting,
  type GameTime,
  type Point,
} from "@campuslife/shared";
import type { PoliticsLink } from "./link";

export interface PoliticsPrompt {
  d: number;
  p: { id: string; icon: string; label: string; detail?: string; disabled?: boolean };
  run: () => void;
}

const WIDE_REACH = POLITICS_REACH * 2;
const PRIORITY = 30;
const INDOOR_DISTANCE = 0;
const ICON = { form: "📝", campaign: "🎉", vote: "📝", debate: "📚", gather: "🎉", relief: "🍱", congress: "✋", march: "✊" };
const RELIEF_MARK = "relief:";
const SIDE_LABEL = { aye: "You are with the Ayes", nay: "You are with the Nays" };

export function liveSittings(link: PoliticsLink, t: GameTime): CongressSitting[] {
  const called = link.world?.called;
  return [...congressesFor(electionCycle(t)), ...(called ? [called] : [])].filter((s) => {
    const phase = sittingPhase(s, t.total);
    return phase === "gather" || phase === "vote" || phase === "count";
  });
}

export function debateAlt(link: PoliticsLink, place: number, t: GameTime): { p: { icon: string; label: string }; run: () => void } | null {
  if (place !== AMPHI_PLACE || !debateOn(t)) return null;
  const status = link.status;
  if (status?.mine && !status.mine.spoke) return { p: { icon: ICON.debate, label: "Face the press" }, run: () => link.send({ a: "speak" }) };
  if (!status?.marks.includes(DEBATE_MARK)) return { p: { icon: ICON.debate, label: "Watch the debate" }, run: () => link.send({ a: "attend" }) };
  return null;
}
const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

export function politicsPrompts(link: PoliticsLink, x: number, y: number, inside: number, t: GameTime): PoliticsPrompt[] {
  const status = link.status;
  const out: PoliticsPrompt[] = [];
  const outdoors = inside < 0;
  const near = (site: Point, reach = POLITICS_REACH) => {
    const d = Math.hypot(site.x - x, site.y - y);
    return outdoors && d <= reach ? d : -1;
  };
  const add = (d: number, id: string, icon: string, label: string, detail: string | undefined, run: () => void) => out.push({ d: d - PRIORITY, p: { id, icon, label, detail }, run });
  const tell = (d: number, id: string, icon: string, label: string, detail: string) => out.push({ d: d - PRIORITY, p: { id, icon, label, detail, disabled: true }, run: () => undefined });

  if (formsOnSale(t) && !status?.mine) {
    const d = near(FORM_DESK);
    if (d >= 0) add(d, "pol-form", ICON.form, "Buy nomination form", "SUIEC desk", () => link.open({ kind: "form" }));
  }
  if (campaignsOpen(t) && status?.mine) {
    const live = new Set(activeRallies(t).map((r) => RALLY_POINTS[r.site]?.id));
    for (const site of RALLY_POINTS) {
      const d = near(site);
      if (d < 0) continue;
      const rally = live.has(site.id);
      if (link.speaking) add(d, `pol-speaking-${site.id}`, ICON.campaign, "Speaking to the hall", "Hold your ground", () => undefined);
      else add(d, `pol-campaign-${site.id}-${rally}`, ICON.campaign, "Campaign here", `${naira(CAMPAIGN.cost)} logistics${rally ? " · rally crowd" : ""}`, () => link.send({ a: "campaign", site: site.id }));
    }
  }
  if (pollsOpen(t)) {
    for (const unit of POLL_UNITS) {
      const d = near(unit);
      if (d >= 0) add(d, `pol-vote-${unit.id}`, ICON.vote, "Vote here", `${unit.name} polling unit`, () => link.open({ kind: "ballot", unit: unit.id }));
    }
  }
  if (debateOn(t)) {
    const d = inside === AMPHI_PLACE ? INDOOR_DISTANCE : near(DEBATE_SITE, WIDE_REACH);
    if (d >= 0 && status?.mine && !status.mine.spoke) add(d, "pol-speak", ICON.debate, "Face the press", "Give your manifesto", () => link.send({ a: "speak" }));
    else if (d >= 0 && !status?.marks.includes(DEBATE_MARK)) add(d, "pol-attend", ICON.debate, "Watch Press Night and Debate", "Informed voters count extra", () => link.send({ a: "attend" }));
  }
  for (const g of status?.gatherings ?? []) {
    if (g.until <= t.total || status?.marks.includes(g.id === ALUTA_GATHERING ? ALUTA_MARK : gatheringMark(g.id))) continue;
    const d = near(GATHERING_SITES[g.site], WIDE_REACH);
    if (d >= 0) add(d, `pol-join-${g.id}`, ICON.gather, `Join: ${g.title}`, `Fun +${g.fun}`, () => link.send({ a: "join", g: g.id }));
  }
  if (status?.outcome === "won" && !status.marks.includes(CELEBRATE.mark) && outdoors) add(POLITICS_REACH, "pol-celebrate", ICON.campaign, "Celebrate your win", "Your people are waiting", () => link.send({ a: "celebrate" }));
  const effects = campusEffects(link.world?.states ?? [], t.total);
  if (effects.reliefPacks > 0 && !status?.claimed.includes(`${RELIEF_MARK}${effects.relief}`) && !status?.marks.includes(`${RELIEF_MARK}${effects.relief}`)) {
    const d = near(FORM_DESK, WIDE_REACH);
    if (d >= 0) add(d, "pol-relief", ICON.relief, "Collect relief pack", "Free, from the union", () => link.send({ a: "relief" }));
  }
  for (const sitting of liveSittings(link, t)) {
    const d = near(CONGRESS_SITE, CONGRESS.reach);
    if (d < 0) continue;
    const phase = sittingPhase(sitting, t.total);
    const side = congressSide({ x, y });
    const label = phase === "vote" ? (side ? SIDE_LABEL[side] : "Stand on a side to vote") : phase === "gather" ? "Congress is gathering" : "The Speaker is counting";
    tell(d, `pol-congress-${sitting.id}-${phase}-${side}`, ICON.congress, label, `Motion: ${findMotion(sitting.motion).issue}`);
  }
  for (const state of link.world?.states ?? []) {
    if (state.kind !== "protest") continue;
    const spot = marchAt(marchPlan(state), t.total);
    if (outdoors && withMarch({ x, y }, spot)) tell(POLITICS_REACH, `pol-march-${state.id}-${spot.phase}`, ICON.march, spot.phase === "forming" ? "The march is forming" : "You are marching", "Stay with the crowd to be counted");
  }
  return out;
}
