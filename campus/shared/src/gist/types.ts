import type { AttendanceBook } from "../academics/attendance";
import type { AdminRecord } from "../admin/record";
import type { Point } from "../map";
import type { UnionState } from "../politics/campus-state";
import type { CongressSitting } from "../politics/congress";

export type GistKind = "class" | "show" | "match" | "sport" | "election" | "congress" | "march" | "light" | "water" | "portal" | "hostel" | "calendar" | "food";

export interface GistItem {
  id: string;
  kind: GistKind;
  title: string;
  detail: string;
  start: number;
  end: number;
  live: boolean;
  priority: number;
  act: boolean;
  place?: number;
  door?: Point;
  where?: string;
}

export interface GistMe {
  department: string;
  level: string;
  at?: Point;
  place?: number;
  book?: AttendanceBook;
  admin?: AdminRecord;
  states?: readonly UnionState[];
  called?: CongressSitting | null;
  voted?: boolean;
  contesting?: boolean;
}

export const GIST_SOON_MINUTES = 120;
export const GIST_LIMIT = 12;

export const GIST_PRIORITY = {
  act: 90,
  live: 70,
  mine: 60,
  soon: 40,
  today: 20,
  note: 10,
} as const;

export const GIST_KIND_LABEL: Record<GistKind, string> = {
  class: "Class",
  show: "Show",
  match: "Match",
  sport: "Sport",
  election: "Election",
  congress: "Congress",
  march: "March",
  light: "Light",
  water: "Water",
  portal: "Portal",
  hostel: "Hostel",
  calendar: "Campus week",
  food: "Food",
};

export const gistClock = (total: number): string => {
  const minute = ((Math.floor(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};

export function gistSpan(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function soonness(start: number, total: number): number {
  const wait = Math.max(0, start - total);
  return Math.max(0, 1 - wait / GIST_SOON_MINUTES) * 9;
}
