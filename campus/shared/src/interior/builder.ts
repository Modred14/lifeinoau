import type { ActKind } from "./acts";
import { N, S, SEATS, type Level, type Npc, type Prop, type PropType, type RectM, type SeatStyle, type SpotM, type Surface } from "./types";

// Fixed looks for shopkeepers (encodeLook format, see avatar.ts).
export const SELLER_LOOKS = [
  "f|owambe|owambe|owambe|owambe|1|0|9|9|0",
  "m|corporate|corporate|corporate|corporate|0|0|3|0|0",
  "f|casual|casual|casual|casual|2|0|12|4|0",
  "m|casual|casual|casual|casual|3|0|5|1|0",
];

export const TABLE_TOP = 0.77;
export const CHAIR_GAP = 0.32;
export const STAND_BACK = 0.75;

export interface ChairOptions {
  seat?: SeatStyle;
  surface?: Surface;
  floor?: number;
  stand?: { x: number; y: number };
}

export class Builder {
  props: Prop[] = [];
  cols: RectM[] = [];
  spots: SpotM[] = [];
  npcs: Npc[] = [];
  levels: Level[] = [];
  private npcN = 0;

  block(type: PropType, x: number, y: number, w: number, d: number, extra: Partial<Prop> = {}) {
    this.props.push({ type, x, y, w, d, ...extra });
    this.cols.push({ x: x - w / 2, y: y - d / 2, w, d });
  }
  deco(type: PropType, x: number, y: number, w: number, d: number, extra: Partial<Prop> = {}) {
    this.props.push({ type, x, y, w, d, ...extra });
  }
  solid(x: number, y: number, w: number, d: number) {
    this.cols.push({ x, y, w, d });
  }
  level(x: number, y: number, w: number, d: number, h: number) {
    if (h > 0) this.levels.push({ x, y, w, d, h });
  }
  /** A chair you can sit on (chairs don't block, so rooms stay easy to walk). */
  chair(x: number, y: number, face: number, kind: ActKind = "sit", label = "Chair", options: ChairOptions = {}) {
    const seat = options.seat ?? "chair";
    const size = SEATS[seat].depth;
    this.props.push({ type: "chair", x, y, w: size, d: size, face, seat, floor: options.floor });
    const sx = options.stand?.x ?? x - Math.cos(face) * STAND_BACK;
    const sy = options.stand?.y ?? y - Math.sin(face) * STAND_BACK;
    this.spots.push({ kind, x, y, sx, sy, face, label, seat, floor: options.floor, surface: options.surface });
  }
  /** Table with chairs on its long sides. */
  table(x: number, y: number, w = 1.6, d = 0.9, perSide = 2, kind: ActKind = "sit") {
    this.block("table", x, y, w, d);
    const surface = { h: TABLE_TOP, near: CHAIR_GAP };
    const label = kind === "study" ? "Desk" : "Table";
    for (let k = 0; k < perSide; k++) {
      const cx = x - w / 2 + (w / perSide) * (k + 0.5);
      this.chair(cx, y - d / 2 - CHAIR_GAP, S, kind, label, { surface });
      this.chair(cx, y + d / 2 + CHAIR_GAP, N, kind, label, { surface });
    }
  }
  /** Food counter along a north wall, with a seller behind and the customer spot in front. */
  counter(x: number, y: number, w: number, label: string, price: number, food: number, fun = 0, kind: ActKind = "eat") {
    this.block("counter", x, y, w, 1.1, { label, style: "serving" });
    this.npcs.push({ x, y: y - 1.2, face: S, look: SELLER_LOOKS[this.npcN++ % SELLER_LOOKS.length] });
    this.spots.push({ kind, x, y: y + 1.2, sx: x, sy: y + 1.2, face: N, label, price, food, fun });
  }
  /** A paid shift spot (cook at a buka, tutor at a desk, loan desk...). */
  job(kind: ActKind, x: number, y: number, face: number, label: string) {
    this.spots.push({ kind, x, y, sx: x, sy: y, face, label });
  }
  bed(x: number, y: number) {
    // Bunk along the y axis against a wall; you lie on it, head to the north.
    this.block("bed", x, y, 1.0, 2.1);
    this.spots.push({ kind: "sleep", x, y, sx: x, sy: y + 1.75, face: N, label: "Bunk" });
  }
  couch(x: number, y: number, face: number, seats: number, kind: ActKind = "tv") {
    const across = Math.abs(Math.cos(face)) > 0.5; // faces east/west => long along y
    const len = seats * 0.8;
    this.block("couch", x, y, across ? 0.9 : len, across ? len : 0.9, { face });
    for (let k = 0; k < seats; k++) {
      const o = -len / 2 + 0.8 * (k + 0.5);
      const sx = x + Math.cos(face) * 1.15;
      const sy = y + Math.sin(face) * 1.15;
      this.spots.push({
        kind,
        x: across ? x : x + o,
        y: across ? y + o : y,
        sx: across ? sx : sx + o,
        sy: across ? sy + o : sy,
        face,
        label: "Couch",
      });
    }
  }
}
