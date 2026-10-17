import { SELLER_LOOKS, type Builder } from "./builder";
import { N, S, type RoomShell } from "./types";

export const VIEWING = {
  annex: 11,
  wall: 0.3,
  wallOff: 0.25,
  door: 5.2,
  screenW: 5,
  screenY: 0.25,
  rows: 7,
  firstRow: 4.6,
  pitch: 1.4,
  seats: 10,
  seatGap: 0.7,
  benchDepth: 0.3,
  standBack: 0.6,
  boardW: 1.8,
} as const;

export const VIEWING_SEAT_LABEL = "Viewing centre bench";
export const VIEWING_TITLE = "Hall and viewing centre";
const WALL_INSET = 0.15;
const GATE_DESK = { off: 1.3, w: 1.2, d: 0.6 };

export interface ViewingArea {
  x0: number;
  mid: number;
  screenY: number;
  screenW: number;
  boardX: number;
}

export function viewingArea(roomW: number): ViewingArea {
  const x0 = roomW - VIEWING.annex;
  const inner = x0 + VIEWING.wallOff + VIEWING.wall;
  return { x0, mid: inner + (roomW - inner) / 2, screenY: VIEWING.screenY, screenW: VIEWING.screenW, boardX: roomW - 1.5 };
}

export function layViewing(b: Builder, shell: RoomShell): RoomShell {
  const { annex, wall, wallOff, door, screenW, screenY, rows, firstRow, pitch, seats, seatGap, benchDepth, standBack, boardW } = VIEWING;
  const w = shell.w + annex;
  const { x0, mid, boardX } = viewingArea(w);
  const wallD = shell.d - door - WALL_INSET;
  b.block("partition", x0 + wallOff + wall / 2, WALL_INSET + wallD / 2, wall, wallD);
  b.deco("projector", mid, screenY, screenW, 0.1, { face: S });
  b.deco("board", boardX, 0.2, boardW, 0.15, { face: S });
  const length = seats * seatGap;
  for (let row = 0; row < rows; row++) {
    const y = firstRow + row * pitch;
    b.deco("bench", mid, y, length, benchDepth, { seat: "bench", face: N });
    for (let k = 0; k < seats; k++) {
      const x = mid - length / 2 + seatGap * (k + 0.5);
      b.spots.push({ kind: "tv", x, y, sx: x, sy: y + standBack, face: N, label: VIEWING_SEAT_LABEL, seat: "bench" });
    }
  }
  const deskY = shell.d - door + 0.1;
  b.block("desk", x0 + wallOff + GATE_DESK.off, deskY, GATE_DESK.w, GATE_DESK.d);
  b.npcs.push({ x: x0 + wallOff + GATE_DESK.off, y: deskY - 1, face: S, look: SELLER_LOOKS[3] });
  return { ...shell, w, title: VIEWING_TITLE };
}
