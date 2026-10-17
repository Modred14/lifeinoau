import type { GameTime } from "./clock";
import { allShowsFor } from "./shows/calendar";
import type { Show } from "./shows/types";

export { KINDS as SHOW_KINDS } from "./shows/bill";
export type { KindSpec as ShowKindSpec } from "./shows/bill";
export { SHOW_SLOTS, showsFor } from "./shows/programme";
export { RESERVED_SLOTS, VENUE_PLACE } from "./shows/types";
export type { ReservedSlot, Show, ShowKind, ShowMoment, SpecialShow, VenueId } from "./shows/types";
export {
  BANTER as MATCH_BANTER,
  BREAK_MINUTES,
  HALF_MINUTES,
  MATCH_AFTER,
  MATCH_FEES,
  MATCH_GATE_OPENS,
  MATCH_MINUTES,
  VIEWING_PLACES,
  currentMatch,
  matchState,
  matchesFor,
  scoreLine,
} from "./shows/matches";
export * from "./shows/league";
export * from "./shows/calendar";
export * from "./shows/predict";
export * from "./shows/night-food";
export * from "./social/faculties";
export * from "./social/grounds";
export * from "./social/save";
export * from "./social/trades";
export * from "./social/actions";
export { SOCIAL_SITES } from "./social/place";
export type { FinalistPoint, SocialSites } from "./social/place";
export type { Club as FootballClub, Goal as MatchGoal, Match as FootballMatch, MatchPhase, MatchState, MatchTier } from "./shows/matches";
export { eventsOn, pitchOn, showBanners, whatsOn } from "./shows/whats-on";
export type { WhatsOnItem } from "./shows/whats-on";

const LOOK_AHEAD_DAYS = 8;

export function currentShows(t: GameTime): Show[] {
  return allShowsFor(t.dayIndex).filter((s) => t.total >= s.startTotal && t.total < s.endTotal);
}

export function showAt(place: number, t: GameTime): Show | undefined {
  return currentShows(t).find((s) => s.place === place);
}

export function nextShows(t: GameTime, n: number): Show[] {
  const out: Show[] = [];
  for (let d = 0; d < LOOK_AHEAD_DAYS && out.length < n; d++) for (const s of allShowsFor(t.dayIndex + d)) if (s.startTotal > t.total && out.length < n) out.push(s);
  return out;
}

export { AMPHI, AMPHI_SEAT_LABEL, STAGE_FRONT_LABEL } from "./interior/amphitheatre";
export { AUDITORIUM, HALL_SEAT_LABEL } from "./interior/auditorium";
export { VIEWING, VIEWING_SEAT_LABEL, viewingArea } from "./interior/viewing";
export type { ViewingArea } from "./interior/viewing";
