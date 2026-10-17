import { ATLAS_WIDTH, BAYS_PER_ROW, BAY_PX, ROW_PX } from "./atlas-layout";
import type { RowPainter } from "./painter";

export const WALL_TONE = 0xf2f0ea;
const SLAB = 0xdcd8ce;
const FRAME = 0xe8e6e0;
const BAR = 0x262626;
const CLOTHES = [0xc0392b, 0x2e6fb7, 0xf1c40f, 0xffffff, 0x2e8b57, 0xe67e22, 0x7d3c98, 0x34495e, 0xf5f0dc, 0xd9534f];
const CURTAINS = [0xb05a4a, 0x4a7ab0, 0xd9c27a, 0x6a9a6a, 0xcfc8ba];
const DOORS = [0x6b4a2e, 0x3d5a6b, 0x5a6b3d, 0x7a5236];

export const eachBay = (fn: (x: number, bay: number) => void) => {
  for (let bay = 0; bay < BAYS_PER_ROW; bay++) fn(bay * BAY_PX, bay);
};

export function wallBase(p: RowPainter, tone = WALL_TONE, streaks = 14) {
  p.fill(0, 0, ATLAS_WIDTH, ROW_PX, tone);
  p.grain(12);
  p.streaks(streaks, 0x5c5548, 0.2);
}

export function slabLine(p: RowPainter) {
  p.fill(0, 0, ATLAS_WIDTH, 6, SLAB);
  p.fill(0, 6, ATLAS_WIDTH, 2, 0, 0.18);
}

export function louvre(p: RowPainter, x: number, y: number, w: number, h: number, lit: boolean, curtain?: number) {
  p.fill(x - 3, y - 3, w + 6, h + 6, FRAME);
  p.glass(x, y, w, h, lit);
  if (curtain !== undefined) p.fill(x, y, w, h, curtain, 0.38);
  for (let yy = y + 2; yy < y + h; yy += 6) {
    p.fill(x, yy, w, 1, 0x1a242c, 0.55);
    p.fill(x, yy + 1, w, 1, 0xd3dee4, 0.3);
  }
  p.fill(x + w / 2 - 1, y, 3, h, 0xd8d6d0);
  for (let xx = x + 5; xx < x + w; xx += 9) p.fill(xx, y, 1, h, BAR, 0.7);
  p.fill(x, y + h * 0.33, w, 1, BAR, 0.7);
  p.fill(x, y + h * 0.66, w, 1, BAR, 0.7);
}

function cloth(p: RowPainter, x: number, y: number, w: number, h: number) {
  const hex = CLOTHES[Math.floor(p.rand() * CLOTHES.length)];
  p.fill(x + 2, y + h, w, 3, 0, 0.2);
  p.fill(x, y, w, h, hex, 0.96);
  if (p.rand() < 0.5) {
    const second = CLOTHES[Math.floor(p.rand() * CLOTHES.length)];
    for (let yy = y + 4; yy < y + h - 2; yy += 7) p.fill(x, yy, w, 2, second, 0.55);
  }
  p.fill(x, y, 2, h, 0, 0.15);
}

export function hostelRooms(p: RowPainter) {
  wallBase(p);
  p.fill(0, 98, ATLAS_WIDTH, 30, 0x8f8676, 0.13);
  slabLine(p);
  eachBay((x, bay) => {
    p.fill(x, 0, 3, ROW_PX, 0xd5d1c7);
    p.fill(x + 14, 16, 100, 5, 0xe9e6de);
    p.fill(x + 14, 21, 100, 4, 0, 0.22);
    const lit = p.rand() < 0.55;
    louvre(p, x + 24, 28, 80, 52, lit, p.rand() < 0.6 ? CURTAINS[Math.floor(p.rand() * CURTAINS.length)] : undefined);
    if (bay === 2 || bay === 5) p.fill(x + 30, 46, 28, 6, 0x10161b, 0.9);
    p.fill(x + 20, 82, 88, 3, 0xd6d2c8);
    p.fill(x + 30 + p.rand() * 50, 85, 3, 28, 0x6b6257, 0.2);
    if (bay === 3 || bay === 6) cloth(p, x + 34, 60, 22, 30);
  });
}

export function hostelCorridor(p: RowPainter) {
  p.fill(0, 0, ATLAS_WIDTH, ROW_PX, 0x57514a);
  p.grain(10);
  p.fill(0, 0, ATLAS_WIDTH, 9, 0xe6e2d8);
  p.fill(0, 9, ATLAS_WIDTH, 16, 0, 0.38);
  eachBay((x, bay) => {
    const door = DOORS[Math.floor(p.rand() * DOORS.length)];
    p.fill(x + 16, 32, 34, 96, 0xbdb7aa);
    p.fill(x + 18, 34, 30, 94, door);
    p.fill(x + 18, 78, 30, 1, 0, 0.3);
    p.fill(x + 60, 36, 48, 36, 0xbdb7aa);
    p.glass(x + 62, 38, 44, 32, p.rand() < 0.5);
    for (let yy = 40; yy < 70; yy += 6) p.fill(x + 62, yy, 44, 1, 0x1a242c, 0.5);
    for (let xx = x + 66; xx < x + 106; xx += 8) p.fill(xx, 38, 1, 32, BAR, 0.6);
    if (bay % 3 === 1) {
      p.fill(x + 8, 26, 112, 1, 0xd8d8d8, 0.7);
      for (let k = 0; k < 3; k++) cloth(p, x + 14 + k * 34 + p.rand() * 8, 27, 14 + p.rand() * 10, 18 + p.rand() * 14);
    }
    p.fill(x + 6, 88, 116, 40, 0xe9e5db);
    p.fill(x + 6, 86, 116, 4, 0xf6f3ec);
    p.fill(x + 6, 90, 116, 2, 0, 0.18);
    p.fill(x + 20 + p.rand() * 80, 92, 3, 30, 0x6b6257, 0.22);
    if (bay % 2 === 0) cloth(p, x + 30 + p.rand() * 50, 84, 18 + p.rand() * 12, 20 + p.rand() * 16);
    p.fill(x, 0, 7, ROW_PX, 0xeeeae0);
    p.fill(x + 121, 0, 7, ROW_PX, 0xeeeae0);
    p.fill(x + 7, 9, 2, ROW_PX, 0, 0.25);
  });
}

export function hostelRail(p: RowPainter) {
  wallBase(p, 0xf0ede6, 22);
  p.fill(0, 0, ATLAS_WIDTH, 9, 0xfaf8f2);
  p.fill(0, 9, ATLAS_WIDTH, 3, 0, 0.16);
  p.fill(0, 112, ATLAS_WIDTH, 16, 0x3a352e, 0.22);
  eachBay((x) => {
    p.fill(x, 0, 2, ROW_PX, 0, 0.14);
    for (let y = 20; y < 98; y += 14) for (let xx = x + 12; xx < x + 116; xx += 14) p.fill(xx, y, 7, 7, 0x353a3b, 0.7);
    const count = Math.floor(p.rand() * 3.4);
    for (let k = 0; k < count; k++) cloth(p, x + 8 + p.rand() * 88, 0, 18 + p.rand() * 18, 44 + p.rand() * 60);
  });
}

export function stairScreen(p: RowPainter) {
  wallBase(p);
  slabLine(p);
  eachBay((x) => {
    p.fill(x + 18, 12, 92, 106, 0xe4e0d6);
    for (let gy = 14; gy < 114; gy += 11) for (let gx = x + 20; gx < x + 106; gx += 11) p.fill(gx + 2, gy + 2, 6, 6, 0x2e2b28, 0.88);
    p.fill(x + 18, 12, 92, 2, 0, 0.2);
    p.fill(x + 16, 10, 2, 110, 0xcfcbc1);
    p.fill(x + 110, 10, 2, 110, 0xcfcbc1);
  });
}
