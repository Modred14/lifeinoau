import { ATLAS_WIDTH, ROW, ROW_PX } from "./atlas-layout";
import { WALL_TONE, eachBay, hostelCorridor, hostelRail, hostelRooms, louvre, slabLine, stairScreen, wallBase } from "./facades-hostel";
import type { RowPainter } from "./painter";

const W = ATLAS_WIDTH;
const H = ROW_PX;
const SIGNS = [0x1f5fa8, 0xc0392b, 0x1e8449, 0xf1c40f, 0xffffff, 0x6c3483];
const SHUTTERS = [0x2f5f8f, 0x4a7a55, 0x7a7f84, 0x8a4a32];
const HOUSE_DOORS = [0x6b4a2e, 0x2f5f6b, 0x4a6b3d, 0x8a8f94];
const STAINED = [0xd9a441, 0x4a7ab0, 0x4f9a68];

function ribbon(p: RowPainter) {
  p.fill(0, 0, W, H, 0x4b5258);
  p.fill(0, 0, W, 8, WALL_TONE);
  for (let x = 0; x < W; x += 32) {
    p.glass(x, 16, 30, 74, p.rand() < 0.45);
    p.fill(x + 30, 16, 2, 74, 0x8c9296);
    for (let y = 18; y < 40; y += 6) p.fill(x, y, 30, 1, 0x1a242c, 0.4);
  }
  p.fill(0, 40, W, 2, 0x8c9296);
  p.fill(0, 8, W, 12, 0, 0.42);
  p.fill(0, 92, W, 36, WALL_TONE);
  p.fill(0, 90, W, 2, 0, 0.3);
  p.streaks(18, 0x5c5548, 0.22, 92);
  p.grain(8);
}

function brise(p: RowPainter) {
  p.fill(0, 0, W, H, 0x3c4146);
  eachBay((x) => p.glass(x + 8, 8, 112, 112, p.rand() < 0.4));
  for (let x = 0; x < W; x += 32) {
    p.fill(x, 0, 7, H, 0xf0ede6);
    p.fill(x + 7, 0, 6, H, 0, 0.34);
  }
  for (let y = 0; y < H; y += 32) {
    p.fill(0, y, W, 6, 0xf0ede6);
    p.fill(0, y + 6, W, 6, 0, 0.34);
  }
  p.grain(8);
}

function pilotis(p: RowPainter) {
  p.fill(0, 0, W, H, 0x2b2927);
  p.fill(0, 118, W, 10, 0x8a8378, 0.5);
  eachBay((x) => {
    const roll = p.rand();
    if (roll < 0.3) {
      p.glass(x + 12, 30, 104, 90, p.rand() < 0.6);
      for (let xx = x + 38; xx < x + 116; xx += 26) p.fill(xx, 30, 2, 90, 0x8c9296);
      p.fill(x + 12, 52, 104, 2, 0x8c9296);
    } else if (roll < 0.5) p.fill(x + 34, 50, 60, 34, 0x4a4032);
    else p.fill(x + 10, 30, 108, 88, 0x3a3733, 0.6);
    p.fill(x, 0, 10, H, 0xe6e2d8);
    p.fill(x + 118, 0, 10, H, 0xe6e2d8);
    p.fill(x + 10, 14, 3, H, 0, 0.3);
  });
  p.fill(0, 0, W, 14, 0xe9e6de);
  p.fill(0, 14, W, 12, 0, 0.42);
  p.grain(8);
}

function grooved(p: RowPainter) {
  p.fill(0, 0, W, H, 0xe6e3da);
  for (let x = 48; x < W; x += 4) {
    p.fill(x, 0, 1, H, 0, 0.15);
    p.fill(x + 1, 0, 1, H, 0xffffff, 0.12);
  }
  p.fill(0, 42, W, 1, 0, 0.16);
  p.fill(0, 85, W, 1, 0, 0.16);
  p.streaks(26, 0x4a4a40, 0.26);
  p.grain(10);
}

function bungalow(p: RowPainter) {
  wallBase(p);
  p.fill(0, 92, W, 36, 0x8f8676, 0.16);
  p.fill(0, 116, W, 12, 0x9a5a3a, 0.24);
  eachBay((x, bay) => {
    if (bay % 4 === 1) {
      p.fill(x + 43, 31, 42, 97, 0xdedad0);
      p.fill(x + 46, 34, 36, 94, HOUSE_DOORS[Math.floor(p.rand() * HOUSE_DOORS.length)]);
      p.fill(x + 46, 80, 36, 1, 0, 0.3);
      p.fill(x + 38, 122, 52, 6, 0xbdb7aa);
    } else louvre(p, x + 30, 36, 68, 44, p.rand() < 0.5, p.rand() < 0.5 ? 0xcfc8ba : undefined);
  });
  p.fill(0, 0, W, 10, 0, 0.3);
  p.fill(0, 10, W, 7, 0, 0.12);
}

function shop(p: RowPainter) {
  wallBase(p, WALL_TONE, 8);
  p.fill(0, 120, W, 8, 0x8f8676, 0.3);
  eachBay((x) => {
    p.fill(x + 4, 6, 120, 26, SIGNS[Math.floor(p.rand() * SIGNS.length)]);
    p.fill(x + 16, 13, 50 + p.rand() * 40, 4, p.rand() < 0.5 ? 0xffffff : 0x1c1c1c, 0.8);
    p.fill(x + 16, 21, 30 + p.rand() * 30, 3, 0x1c1c1c, 0.5);
    if (p.rand() < 0.35) {
      p.fill(x + 18, 40, 92, 88, 0x1c1a18);
      p.glass(x + 24, 46, 80, 50, true);
      for (let y = 58; y < 96; y += 13) p.fill(x + 24, y, 80, 3, 0x8a6a3a);
    } else {
      p.fill(x + 18, 40, 92, 88, SHUTTERS[Math.floor(p.rand() * SHUTTERS.length)]);
      for (let y = 46; y < 128; y += 8) p.fill(x + 18, y, 92, 1, 0, 0.18);
      p.fill(x + 63, 40, 2, 88, 0, 0.4);
    }
    p.fill(x, 0, 6, H, 0xd8d4ca);
  });
}

function office(p: RowPainter) {
  wallBase(p);
  slabLine(p);
  p.fill(0, 100, W, 28, 0x8f8676, 0.12);
  eachBay((x) => {
    for (const wx of [x + 12, x + 70]) {
      p.fill(wx - 3, 31, 52, 54, 0xe0ddd5);
      p.glass(wx, 34, 46, 48, p.rand() < 0.45);
      p.fill(wx + 22, 34, 2, 48, 0xd0d0cc);
      for (let xx = wx + 4; xx < wx + 46; xx += 8) p.fill(xx, 34, 1, 48, 0x262626, 0.5);
      p.fill(wx - 5, 85, 56, 3, 0xd6d2c8);
      if (p.rand() < 0.3) {
        p.fill(wx + 10, 90, 26, 14, 0xd9d9d6);
        p.fill(wx + 12, 93, 22, 1, 0, 0.3);
        p.fill(wx + 12, 97, 22, 1, 0, 0.3);
        p.fill(wx + 21, 104, 3, 24, 0x5a5348, 0.28);
      }
    }
  });
}

function worship(p: RowPainter) {
  wallBase(p);
  p.fill(0, 108, W, 20, 0x8f8676, 0.14);
  eachBay((x) => {
    p.fill(x + 37, 40, 54, 80, 0xdedad0);
    p.blot(x + 64, 40, 27, 0xdedad0, 1);
    p.glass(x + 42, 18, 44, 98, p.rand() < 0.6, true);
    p.fill(x + 42, 40, 44, 76, STAINED[Math.floor(p.rand() * STAINED.length)], 0.3);
    p.fill(x + 63, 22, 2, 94, 0xdedad0);
    for (let y = 48; y < 116; y += 22) p.fill(x + 42, y, 44, 2, 0xdedad0);
  });
}

function shed(p: RowPainter) {
  p.fill(0, 0, W, 84, 0xdfe1df);
  for (let x = 48; x < W; x += 6) {
    p.fill(x, 0, 1, 84, 0, 0.13);
    p.fill(x + 1, 0, 1, 84, 0xffffff, 0.16);
  }
  p.fill(0, 84, W, 44, 0xe9e4d8);
  for (let y = 84; y < H; y += 11) p.fill(0, y, W, 1, 0, 0.14);
  for (let x = 0; x < W; x += 22) for (let y = 84; y < H; y += 22) p.fill(x + (y % 2) * 11, y, 1, 11, 0, 0.12);
  eachBay((x, bay) => {
    p.glass(x + 16, 10, 96, 16, p.rand() < 0.4);
    for (let y = 12; y < 26; y += 4) p.fill(x + 16, y, 96, 1, 0x1a242c, 0.5);
    if (bay === 3) {
      p.fill(x + 20, 40, 88, 88, 0x5c6f7a);
      for (let xx = x + 26; xx < x + 108; xx += 8) p.fill(xx, 40, 1, 88, 0, 0.2);
    }
  });
  p.streaks(20, 0x7a4a2c, 0.3);
  p.grain(10);
}

function roofZinc(p: RowPainter) {
  p.fill(0, 0, W, H, 0xdcdcd8);
  for (let i = 0; i < 70; i++) {
    const y = 30 + Math.pow(p.rand(), 0.6) * 98;
    p.blot(p.rand() * W, y, 14 + p.rand() * 30, 0x5a2f1a, 0.1 + p.rand() * 0.2, 0.3 + p.rand() * 0.5);
  }
  for (let x = 0; x < W; x += 8) {
    p.fill(x, 0, 2, H, 0, 0.18);
    p.fill(x + 4, 0, 2, H, 0xffffff, 0.2);
  }
  p.fill(0, 64, W, 2, 0, 0.2);
  p.fill(0, 0, W, 6, 0xf2f2ee);
  p.fill(0, 6, W, 2, 0, 0.2);
  p.grain(10);
}

function roofConcrete(p: RowPainter) {
  p.fill(0, 0, W, H, 0xd2cfc8);
  for (let i = 0; i < 140; i++) p.blot(p.rand() * W, p.rand() * H, 2 + p.rand() * 7, 0x2f3a2c, 0.08 + p.rand() * 0.18, 3 + p.rand() * 3);
  for (let i = 0; i < 6; i++) p.fill(60 + p.rand() * (W - 160), 10 + p.rand() * 100, 50 + p.rand() * 70, 5 + p.rand() * 8, 0x5a5a58, 0.4);
  p.grain(14);
}

function plain(p: RowPainter) {
  wallBase(p, WALL_TONE, 20);
}

export const ROW_PAINTERS: Record<number, (p: RowPainter) => void> = {
  [ROW.plain]: plain,
  [ROW.hostelRooms]: hostelRooms,
  [ROW.hostelCorridor]: hostelCorridor,
  [ROW.hostelRail]: hostelRail,
  [ROW.stairScreen]: stairScreen,
  [ROW.ribbon]: ribbon,
  [ROW.brise]: brise,
  [ROW.pilotis]: pilotis,
  [ROW.grooved]: grooved,
  [ROW.bungalow]: bungalow,
  [ROW.shop]: shop,
  [ROW.office]: office,
  [ROW.worship]: worship,
  [ROW.shed]: shed,
  [ROW.roofZinc]: roofZinc,
  [ROW.roofConcrete]: roofConcrete,
};
