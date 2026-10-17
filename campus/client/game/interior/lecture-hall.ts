import { HALL, type Template } from "@campuslife/shared/interiors";

export function hallFans(t: Template): [number, number][] {
  const blockW = HALL.seatsPerRow * HALL.seatWidth;
  const xs = HALL.blocks.map((x0) => x0 + blockW / 2);
  const zs = [HALL.firstRow + 1.5, HALL.firstRow + 5.5, Math.min(t.d - 2, HALL.firstRow + 9.5)];
  return zs.flatMap((z) => xs.map((x): [number, number] => [x, z]));
}
