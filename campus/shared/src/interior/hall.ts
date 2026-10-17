import { SELLER_LOOKS, type Builder } from "./builder";
import { E, N, S, W, type RoomShell, type Surface } from "./types";

export const HALL = {
  w: 26,
  d: 21,
  rows: 10,
  pitch: 1,
  rise: 0.12,
  firstRow: 7.2,
  tierFront: 0.6,
  seatsPerRow: 18,
  seatWidth: 0.55,
  blocks: [2, 14.1],
  dais: 0.18,
  ledgeH: 0.74,
  ledgeDepth: 0.3,
  ledgeNear: 0.28,
} as const;

const HALL_LEDGE: Surface = { h: HALL.ledgeH, near: HALL.ledgeNear };

function aisleStand(block: number, seat: number): number {
  const half = HALL.seatsPerRow / 2;
  const left = seat < half;
  const rank = left ? seat : HALL.seatsPerRow - 1 - seat;
  if (block === 0) return left ? 1.38 - rank * 0.07 : 12.52 + rank * 0.05;
  return left ? 13.48 - rank * 0.05 : 24.62 + rank * 0.07;
}

export function layLecture(b: Builder): RoomShell {
  const { w, d, rows, pitch, rise, firstRow, tierFront, seatsPerRow, seatWidth, blocks, dais } = HALL;
  const blockW = seatsPerRow * seatWidth;
  b.level(5, 0.15, 16, 3.6, dais);
  b.deco("board", 11, 0.2, 7.4, 0.15, { face: S, floor: dais });
  b.deco("screen", 17.4, 0.2, 2.6, 0.1, { face: S, floor: dais });
  b.block("desk", 9.4, 2.4, 1.8, 0.7, { style: "teacher", floor: dais, face: S });
  b.block("lectern", 15.6, 2.7, 0.6, 0.5, { floor: dais });
  b.npcs.push({ x: 15.6, y: 1.9, face: S, look: SELLER_LOOKS[1] });
  for (let row = 0; row < rows; row++) {
    const y = firstRow + row * pitch;
    const floor = row * rise;
    b.level(0, y - tierFront, w, pitch, floor);
    blocks.forEach((x0, block) => {
      const cx = x0 + blockW / 2;
      b.deco("bench", cx, y, blockW, 0.36, { seat: "fixed", floor, face: N });
      b.deco("ledge", cx, y - HALL.ledgeNear - HALL.ledgeDepth / 2, blockW, HALL.ledgeDepth, { floor });
      for (let seat = 0; seat < seatsPerRow; seat++) {
        const x = x0 + seatWidth * (seat + 0.5);
        b.spots.push({ kind: "study", x, y, sx: aisleStand(block, seat), sy: y - 0.1, face: N, label: "Lecture seat", seat: "fixed", floor, surface: HALL_LEDGE });
      }
    });
  }
  const backY = firstRow + rows * pitch - tierFront;
  b.level(0, backY, w, d - backY, rows * rise);
  const blockY = firstRow - HALL.ledgeNear - HALL.ledgeDepth;
  for (const x0 of blocks) b.solid(x0, blockY, blockW, firstRow + (rows - 1) * pitch + 0.24 - blockY);
  return { w, d, title: "Lecture theatre", floor: 0xb5ad9f, wall: 0xece6da };
}

export const CLASSROOM = {
  w: 14.4,
  d: 13,
  blocks: [1.9, 5, 8.1, 11.2],
  rows: 5,
  pitch: 1.2,
  firstDesk: 4.6,
  deskW: 0.62,
  deskD: 0.42,
  deskH: 0.75,
  chairGap: 0.52,
} as const;

export function layClassroom(b: Builder): RoomShell {
  const { w, d, blocks, rows, pitch, firstDesk, deskW, deskD, deskH, chairGap } = CLASSROOM;
  const surface: Surface = { h: deskH, near: chairGap - deskD / 2 };
  b.deco("board", 7.2, 0.2, 5.2, 0.15, { face: S });
  b.block("desk", 4.4, 2.4, 1.5, 0.7, { style: "teacher", face: S });
  for (const x0 of blocks) {
    for (let row = 0; row < rows; row++) {
      const y = firstDesk + row * pitch;
      [0, 1].forEach((side) => {
        const x = x0 + 0.325 + side * 0.65;
        b.deco("desk", x, y, deskW, deskD, { style: "school" });
        b.chair(x, y + chairGap, N, "study", "Desk", { seat: "school", surface, stand: { x: side === 0 ? x0 - 0.65 : x0 + 1.95, y: y + chairGap } });
      });
    }
    b.solid(x0, firstDesk - deskD / 2, 1.3, (rows - 1) * pitch + chairGap + 0.2 + deskD / 2);
  }
  b.block("vending", 13.75, 11.4, 0.9, 1.2, { face: W });
  b.spots.push({ kind: "eat", x: 12.55, y: 11.4, sx: 12.55, sy: 11.4, face: E, label: "Vending: biscuit & drink", price: 250, food: 15, fun: 5 });
  b.deco("plant", 0.6, 12.2, 0.6, 0.6);
  return { w, d, title: "Classroom", floor: 0xb8ad9a, wall: 0xece6da };
}
