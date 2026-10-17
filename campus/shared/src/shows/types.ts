import { PLACES } from "../map";

export type ShowKind =
  | "concert" | "comedy" | "play" | "gospel" | "movie" | "dinner"
  | "carnival" | "freshers" | "talent" | "pageant" | "lecture" | "quiz";

export type VenueId = "amphi" | "oduduwa";
export type SpecialShow = "cultural" | "dinner" | "rave" | "matric";

export interface ShowMoment {
  at: number;
  text: string;
  fun: number;
}

export interface Show {
  key: string;
  kind: ShowKind;
  title: string;
  act: string;
  venue: VenueId;
  place: number;
  dayIndex: number;
  start: number;
  end: number;
  startTotal: number;
  endTotal: number;
  fee: number;
  fun: number;
  color: number;
  dance: boolean;
  moments: ShowMoment[];
  faculty?: number;
  special?: SpecialShow;
}

export interface ReservedSlot {
  venue: VenueId;
  weekday: number;
  start: number;
  end: number;
  holder: string;
}

const VENUE_NAMES: Record<VenueId, RegExp> = { amphi: /amphi/i, oduduwa: /oduduwa/i };

export const VENUE_PLACE: Record<VenueId, number> = {
  amphi: PLACES.findIndex((p) => VENUE_NAMES.amphi.test(p.name)),
  oduduwa: PLACES.findIndex((p) => VENUE_NAMES.oduduwa.test(p.name)),
};

export const RESERVED_SLOTS: readonly ReservedSlot[] = [
  { venue: "amphi", weekday: 3, start: 18 * 60, end: 23 * 60, holder: "Press Night and Debate" },
];

export const SHOW_PARTY_GAP = 30;
