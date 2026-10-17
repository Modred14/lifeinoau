import { SELLER_LOOKS, type Builder } from "./builder";
import { STAGE_FRONT_LABEL } from "./amphitheatre";
import { N, S, type RoomShell } from "./types";

export const AUDITORIUM = {
  w: 34,
  d: 32,
  stageX: 5,
  stageW: 24,
  stageFront: 8,
  stageH: 1.1,
  rows: 14,
  stallRows: 10,
  pitch: 1,
  firstRow: 12,
  tierFront: 0.6,
  rise: 0.08,
  galleryBase: 1.5,
  galleryRise: 0.25,
  seatsPerRow: 14,
  seatWidth: 0.55,
  blocks: [2.2, 13.15, 24.1],
  aisleGap: 0.62,
  aisleStep: 0.05,
} as const;

export const HALL_SEAT_LABEL = "Hall seat";
export const TICKET_DESK_LABEL = "Ticket desk";
const WALL_INSET = 0.15;
const DANCE_Y = 9.7;
const DANCE_XS = [12, 14, 16, 18, 20, 22];
const DESK = { x: 23.5, y: 29.3, w: 2.4, d: 0.9 };

export function rowFloor(row: number): number {
  const { stallRows, rise, galleryBase, galleryRise } = AUDITORIUM;
  return row < stallRows ? row * rise : galleryBase + (row - stallRows) * galleryRise;
}

function aisleStand(x0: number, blockW: number, seat: number): number {
  const { seatsPerRow, aisleGap, aisleStep } = AUDITORIUM;
  const left = seat < seatsPerRow / 2;
  const rank = left ? seat : seatsPerRow - 1 - seat;
  return left ? x0 - aisleGap - rank * aisleStep : x0 + blockW + aisleGap + rank * aisleStep;
}

export function layAuditorium(b: Builder): RoomShell {
  const { w, d, stageX, stageW, stageFront, stageH, rows, stallRows, pitch, firstRow, tierFront, seatsPerRow, seatWidth, blocks, galleryBase } = AUDITORIUM;
  const blockW = seatsPerRow * seatWidth;
  const stageD = stageFront - WALL_INSET;
  const cx = stageX + stageW / 2;
  b.level(stageX, WALL_INSET, stageW, stageD, stageH);
  b.deco("stage", cx, WALL_INSET + stageD / 2, stageW, stageD, { floor: stageH });
  b.deco("backdrop", cx, 0.4, stageW - 2, 0.2, { floor: stageH, face: S, color: 0x6a040f });
  b.deco("truss", cx, stageFront - 1, stageW - 0.6, 0.4, { floor: stageH });
  for (const side of [-1, 1]) {
    b.deco("curtain", cx + side * (stageW / 2 - 1.3), stageFront - 0.5, 2.6, 0.3, { floor: stageH });
    b.block("wing", side < 0 ? stageX / 2 : w - stageX / 2, stageFront / 2, stageX, stageFront);
  }
  b.block("lectern", stageX + 5, stageFront - 1.8, 0.6, 0.5, { floor: stageH });
  for (const x of DANCE_XS) b.job("dance", x, DANCE_Y, N, STAGE_FRONT_LABEL);
  for (let row = 0; row < rows; row++) {
    const y = firstRow + row * pitch;
    const floor = rowFloor(row);
    b.level(0, y - tierFront, w, pitch, floor);
    for (const x0 of blocks) {
      b.deco("seatrow", x0 + blockW / 2, y, blockW, 0.36, { seat: "fixed", floor, face: N });
      for (let seat = 0; seat < seatsPerRow; seat++) {
        b.spots.push({ kind: "sit", x: x0 + seatWidth * (seat + 0.5), y, sx: aisleStand(x0, blockW, seat), sy: y - 0.1, face: N, label: HALL_SEAT_LABEL, seat: "fixed", floor });
      }
    }
  }
  const backY = firstRow + rows * pitch - tierFront;
  b.level(0, backY, w, d - backY, rowFloor(rows));
  for (const x0 of blocks) b.deco("parapet", x0 + blockW / 2, firstRow + stallRows * pitch - tierFront, blockW, 0.12, { floor: galleryBase });
  for (const x0 of blocks) b.solid(x0, firstRow - 0.3, blockW, (rows - 1) * pitch + 0.55);
  b.block("counter", DESK.x, DESK.y, DESK.w, DESK.d, { label: TICKET_DESK_LABEL });
  b.npcs.push({ x: DESK.x, y: DESK.y - 1.1, face: S, look: SELLER_LOOKS[1] });
  return { w, d, title: "Auditorium", floor: 0x7a4b3a, wall: 0xe6dcc8 };
}
