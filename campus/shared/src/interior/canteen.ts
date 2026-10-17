import { STAND_BACK, type Builder } from "./builder";
import { E, N, S, SEATS, W, type RoomShell, type Surface } from "./types";

export const PLASTIC_TABLE = { size: 0.86, h: 0.72, chair: 0.66 } as const;
export const LONG_TABLE = { w: 0.75, len: 2.2, h: 0.75, bench: 0.6, seats: 3 } as const;

class Dining {
  private tables = 0;
  private counters: number[];

  constructor(private b: Builder) {
    this.counters = b.spots.map((s, i) => (s.kind === "eat" && s.price !== undefined ? i : -1)).filter((i) => i >= 0);
  }

  private menu() {
    return this.counters.length ? this.counters[this.tables++ % this.counters.length] : undefined;
  }

  plastic(x: number, y: number) {
    const { size, h, chair } = PLASTIC_TABLE;
    const b = this.b;
    const menu = this.menu();
    const surface: Surface = { h, near: chair - size / 2 };
    b.block("table", x, y, size, size, { style: "plastic" });
    for (const face of [S, N, E, W]) {
      const cx = x - Math.cos(face) * chair;
      const cy = y - Math.sin(face) * chair;
      b.chair(cx, cy, face, "sit", "Table", { seat: "plastic", surface });
      b.spots[b.spots.length - 1].menu = menu;
    }
  }

  long(x: number, y: number) {
    const { w, len, h, bench, seats } = LONG_TABLE;
    const b = this.b;
    const menu = this.menu();
    const surface: Surface = { h, near: bench - w / 2 };
    b.block("table", x, y, w, len, { style: "long" });
    for (const face of [E, W]) {
      const bx = x - Math.cos(face) * bench;
      b.deco("bench", bx, y, SEATS.bench.depth, len, { seat: "bench", face });
      for (let k = 0; k < seats; k++) {
        const sy = y - len / 2 + (len / seats) * (k + 0.5);
        b.spots.push({ kind: "sit", x: bx, y: sy, sx: bx - Math.cos(face) * (STAND_BACK + 0.05), sy, face, label: "Bench", seat: "bench", surface, menu });
      }
    }
  }
}

export function layFoodCourt(b: Builder): RoomShell {
  b.counter(5, 1.6, 6, "Amala & ewedu", 500, 45);
  b.counter(13, 1.6, 6, "Jollof rice & chicken", 800, 60);
  b.counter(21, 1.6, 6, "Shawarma", 1200, 55, 10);
  b.counter(29, 1.6, 6, "Zobo & puff-puff", 300, 20, 10);
  b.job("cook", 33, 1.6, W, "Buka kitchen");
  for (const fx of [9, 17, 25]) b.block("fridge", fx, 0.6, 0.7, 0.65, { face: S });
  const dining = new Dining(b);
  for (const ty of [7.4, 10.2, 13, 15.8, 18.6]) {
    dining.plastic(2.6, ty);
    dining.plastic(14.2, ty);
  }
  for (const ty of [8, 12, 16, 20]) dining.long(9, ty);
  // Dance floor + DJ booth (parties on Friday and Saturday nights).
  b.deco("dancefloor", 20.5, 13.5, 8, 9);
  b.block("dj", 20.5, 7.6, 3, 1);
  for (const dx of [17.5, 19.5, 21.5, 23.5]) for (const dy of [10.5, 13, 15.5, 18]) b.job("dance", dx, dy, N, "Dance floor");
  b.block("snooker", 29.5, 10.5, 3, 1.6);
  b.spots.push({ kind: "play", x: 29.5, y: 12.4, sx: 29.5, sy: 12.4, face: N, label: "Snooker" });
  b.spots.push({ kind: "play", x: 29.5, y: 8.6, sx: 29.5, sy: 8.6, face: S, label: "Snooker" });
  b.deco("tv", 33.7, 18.5, 0.15, 2.2, { face: W });
  b.couch(30, 18.5, E, 3);
  b.block("basin", 5, 23.4, 1.2, 0.5, { face: N });
  b.deco("plant", 1, 22.6, 0.6, 0.6);
  b.deco("plant", 33, 22.6, 0.6, 0.6);
  return { w: 34, d: 24, title: "Food court", floor: 0xd6cfc2, wall: 0xece6da };
}

export function layHostel(b: Builder): RoomShell {
  for (const bx of [1.5, 4, 6.5, 9, 11.5]) b.bed(bx, 2.2);
  for (const bx of [1.5, 4, 6.5, 9, 11.5]) b.bed(bx, 7.4);
  b.deco("partition", 13.6, 5, 0.2, 9.8);
  for (const dy of [12, 14.5, 17]) {
    b.block("desk", 0.75, dy, 0.9, 1.4);
    b.chair(1.75, dy, W, "study", "Study desk");
  }
  b.counter(20, 1.6, 6, "Hall buka: rice & beans", 400, 45);
  b.counter(27, 1.6, 4.5, "Noodles & egg", 350, 35);
  b.job("cook", 29.6, 3.4, N, "Hall buka kitchen");
  const dining = new Dining(b);
  dining.long(18, 8.4);
  dining.plastic(22.5, 8);
  dining.plastic(25.5, 8);
  dining.long(15.4, 8.4);
  b.deco("rug", 25.5, 15.5, 5, 4.5);
  b.deco("tv", 29.7, 15.5, 0.15, 2.2, { face: W });
  b.couch(25, 15.5, E, 3);
  b.couch(27.5, 18.6, N, 2);
  b.deco("plant", 13.6, 20.8, 0.6, 0.6);
  return { w: 30, d: 22, title: "Hall", floor: 0xbfb39e, wall: 0xe9e1cf };
}
