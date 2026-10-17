import type { Builder } from "./builder";
import { E, N, S, W, type RectM, type RoomShell } from "./types";

export const AMPHI = {
  w: 44,
  d: 30,
  cx: 22,
  stageFront: 7,
  stageHalf: 9,
  stageH: 0.9,
  pit: 8,
  tiers: 10,
  pitch: 1.2,
  rise: 0.3,
  mid: 0.45,
  shoulder: 0.8,
  seatGap: 0.7,
  benchDepth: 0.4,
  benchInset: 0.2,
  standOff: 0.55,
  endGap: 0.35,
  sideStart: 0.5,
} as const;

export const AMPHI_SEAT_LABEL = "Amphitheatre step";
export const STAGE_FRONT_LABEL = "Front of stage";
const WALL_INSET = 0.15;
const DANCE_ROWS = [1.6, 3.2];
const DANCE_COLUMNS = [-5, -3, -1, 1, 3, 5];

export const ringRadius = (ring: number) => AMPHI.pit + ring * AMPHI.pitch;

function outside(r: number): RectM[] {
  const { w, d, cx, stageFront: y0, mid, shoulder } = AMPHI;
  const corner = (1 - mid) * r;
  const hip = (1 - shoulder) * r;
  return [
    { x: 0, y: y0, w: cx - r, d: d - y0 },
    { x: cx + r, y: y0, w: w - cx - r, d: d - y0 },
    { x: cx - r, y: y0 + r, w: 2 * r, d: d - y0 - r },
    { x: cx - r, y: y0 + shoulder * r, w: corner, d: hip },
    { x: cx + mid * r, y: y0 + shoulder * r, w: corner, d: hip },
    { x: cx - r, y: y0 + mid * r, w: hip, d: (shoulder - mid) * r },
    { x: cx + shoulder * r, y: y0 + mid * r, w: hip, d: (shoulder - mid) * r },
  ];
}

function bench(b: Builder, floor: number, face: number, from: number, to: number, fixed: number) {
  const { seatGap, benchDepth, standOff } = AMPHI;
  const count = Math.floor((to - from) / seatGap);
  if (count < 1) return;
  const length = count * seatGap;
  const start = (from + to - length) / 2;
  const along = face === N;
  const centre = start + length / 2;
  b.deco("terrace", along ? centre : fixed, along ? fixed : centre, along ? length : benchDepth, along ? benchDepth : length, { seat: "bench", floor, face });
  for (let k = 0; k < count; k++) {
    const at = start + seatGap * (k + 0.5);
    const x = along ? at : fixed;
    const y = along ? fixed : at;
    b.spots.push({ kind: "sit", x, y, sx: x + Math.cos(face) * standOff, sy: y + Math.sin(face) * standOff, face, label: AMPHI_SEAT_LABEL, seat: "bench", floor });
  }
}

export function layAmphitheatre(b: Builder): RoomShell {
  const { w, d, cx, stageFront: y0, stageHalf, stageH, tiers, rise, mid, shoulder, benchInset, endGap, sideStart } = AMPHI;
  const stageD = y0 - WALL_INSET;
  b.level(cx - stageHalf, WALL_INSET, stageHalf * 2, stageD, stageH);
  b.deco("stage", cx, WALL_INSET + stageD / 2, stageHalf * 2, stageD, { floor: stageH });
  b.deco("backdrop", cx, 0.4, stageHalf * 2 - 2, 0.2, { floor: stageH, face: S });
  b.deco("truss", cx, y0 - 0.8, stageHalf * 2 - 0.6, 0.4, { floor: stageH });
  for (const side of [-1, 1]) {
    b.block("wing", cx + side * (stageHalf + (cx - stageHalf) / 2), y0 / 2, cx - stageHalf, y0);
    b.block("speaker", cx + side * (stageHalf - 1), y0 - 1, 1.2, 1.2, { floor: stageH });
  }
  for (const dy of DANCE_ROWS) for (const dx of DANCE_COLUMNS) b.job("dance", cx + dx, y0 + dy, N, STAGE_FRONT_LABEL);
  for (let ring = 0; ring <= tiers; ring++) {
    const floor = (ring + 1) * rise;
    for (const r of outside(ringRadius(ring))) b.level(r.x, r.y, r.w, r.d, floor);
  }
  for (let tier = 0; tier < tiers; tier++) {
    const floor = (tier + 1) * rise;
    const back = ringRadius(tier + 1);
    bench(b, floor, N, cx - mid * back + endGap, cx + mid * back - endGap, y0 + back - benchInset);
    for (const side of [-1, 1]) {
      const a = cx + side * (mid * back + endGap);
      const c = cx + side * (shoulder * back - endGap);
      bench(b, floor, N, Math.min(a, c), Math.max(a, c), y0 + shoulder * back - benchInset);
      bench(b, floor, side < 0 ? E : W, y0 + sideStart, y0 + mid * back - endGap, cx + side * (back - benchInset));
    }
  }
  return { w, d, title: "Amphitheatre", floor: 0xa9a59c, wall: 0xcfc8b8 };
}
