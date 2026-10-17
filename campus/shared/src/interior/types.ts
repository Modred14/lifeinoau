import type { Point } from "../map";
import type { ActKind } from "./acts";

export type SeatStyle = "chair" | "plastic" | "fixed" | "bench" | "school";

export interface SeatSpec {
  h: number;
  depth: number;
  back: number;
  hip: number;
}

export const SEATS: Record<SeatStyle, SeatSpec> = {
  chair: { h: 0.45, depth: 0.42, back: 0.42, hip: -0.05 },
  plastic: { h: 0.44, depth: 0.42, back: 0.4, hip: -0.05 },
  fixed: { h: 0.45, depth: 0.36, back: 0.4, hip: -0.03 },
  bench: { h: 0.45, depth: 0.3, back: 0, hip: 0 },
  school: { h: 0.45, depth: 0.38, back: 0.38, hip: -0.04 },
};

export interface Surface {
  h: number;
  near: number;
}

export interface Spot {
  kind: ActKind;
  /** Where the character is while using it (map px). */
  x: number;
  y: number;
  /** A free spot to stand when using / leaving it (map px). */
  sx: number;
  sy: number;
  /** Facing while using it: map-space angle, atan2(dy, dx). */
  face: number;
  label: string;
  price?: number;
  food?: number;
  fun?: number;
  /** Place index of the interior it belongs to, or -1 for outdoors. */
  place: number;
  seat?: SeatStyle;
  floor?: number;
  surface?: Surface;
  menu?: number;
  roadside?: boolean;
}

export type PropType =
  | "table" | "chair" | "counter" | "bed" | "desk" | "shelf" | "couch" | "tv" | "board" | "lectern"
  | "atm" | "mat" | "rug" | "plant" | "snooker" | "vending" | "bench" | "court" | "partition"
  | "pew" | "altar" | "dancefloor" | "dj"
  | "ledge" | "screen" | "fridge" | "basin"
  | "stage" | "speaker" | "truss" | "backdrop" | "curtain" | "wing" | "terrace" | "seatrow" | "parapet" | "projector";

export type PropStyle = "plastic" | "long" | "school" | "teacher" | "serving";

export interface Prop {
  type: PropType;
  /** Centre, metres (local). */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Facing (map angle) for chairs/couches/screens. */
  face?: number;
  label?: string;
  color?: number;
  seat?: SeatStyle;
  floor?: number;
  style?: PropStyle;
}

export interface RectM {
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface Level extends RectM {
  h: number;
}

export interface SpotM {
  kind: ActKind;
  x: number;
  y: number;
  sx: number;
  sy: number;
  face: number;
  label: string;
  price?: number;
  food?: number;
  fun?: number;
  seat?: SeatStyle;
  floor?: number;
  surface?: Surface;
  menu?: number;
}

/** A shopkeeper standing behind a counter (client draws a character). */
export interface Npc {
  x: number;
  y: number;
  face: number;
  look: string;
}

export type TemplateId = "foodcourt" | "hostel" | "lecture" | "library" | "bank" | "mosque" | "chapel" | "classroom" | "court" | "amphitheatre" | "auditorium";

export interface Template {
  id: TemplateId;
  title: string;
  w: number;
  d: number;
  floor: number;
  wall: number;
  props: Prop[];
  cols: RectM[];
  spots: SpotM[];
  npcs: Npc[];
  levels: Level[];
  /** Where you appear when you walk in. */
  entry: Point;
}

export interface RoomShell {
  w: number;
  d: number;
  title: string;
  floor: number;
  wall: number;
}

export const N = -Math.PI / 2;
export const S = Math.PI / 2;
export const E = 0;
export const W = Math.PI;

export function levelAt(levels: readonly Level[], x: number, y: number): number {
  let h = 0;
  for (const l of levels) if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.d && l.h > h) h = l.h;
  return h;
}
