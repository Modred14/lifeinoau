import type { Place } from "../map";
import { Builder, SELLER_LOOKS } from "./builder";
import { layFoodCourt, layHostel } from "./canteen";
import { layClassroom, layLecture } from "./hall";
import { layAmphitheatre } from "./amphitheatre";
import { layAuditorium } from "./auditorium";
import { layViewing } from "./viewing";
import { E, N, S, W, type RoomShell, type Template, type TemplateId } from "./types";

function layLibrary(b: Builder): RoomShell {
  for (const sy of [2.2, 5.4]) {
    b.block("shelf", 7, sy, 10, 0.7);
    b.block("shelf", 23, sy, 10, 0.7);
  }
  b.block("counter", 15, 10, 3, 1, { label: "Library desk" });
  b.npcs.push({ x: 15, y: 8.8, face: S, look: SELLER_LOOKS[1] });
  for (const [tx, ty] of [[6, 11], [6, 16], [24, 11], [24, 16]]) b.table(tx, ty, 2.6, 1.2, 3, "study");
  b.block("desk", 15, 17, 1.6, 0.8);
  b.chair(15, 18, N, "tutor", "Tutorial desk");
  b.deco("plant", 1, 20.6, 0.6, 0.6);
  b.deco("plant", 29, 20.6, 0.6, 0.6);
  return { w: 30, d: 22, title: "Library", floor: 0x8d7a64, wall: 0xece6da };
}

function layBank(b: Builder): RoomShell {
  b.block("counter", 9, 3.6, 14, 1.1, { label: "Customer service" });
  for (const nx of [4, 9, 14]) b.npcs.push({ x: nx, y: 2.4, face: S, look: SELLER_LOOKS[nx === 9 ? 1 : 3] });
  for (const ay of [8, 10.5]) {
    b.block("atm", 0.6, ay, 0.8, 0.9, { face: E });
    b.spots.push({ kind: "atm", x: 1.6, y: ay, sx: 1.6, sy: ay, face: W, label: "ATM" });
  }
  for (let cx = 8; cx <= 15; cx += 1.4) b.chair(cx, 9.5, N, "sit", "Waiting chair");
  b.block("desk", 4, 12.4, 2.2, 0.8);
  b.job("loan", 4, 11.2, S, "Microfinance loan desk");
  b.deco("plant", 17, 12.6, 0.6, 0.6);
  return { w: 18, d: 14, title: "Banking hall", floor: 0xe3ded6, wall: 0xf1efe9 };
}

function layMosque(b: Builder): RoomShell {
  b.deco("board", 10, 0.2, 2.4, 0.15, { face: S, color: 0x2f6b4f });
  for (const my of [3.5, 5.8, 8.1, 10.4]) for (let mx = 3; mx <= 17; mx += 2) {
    b.deco("mat", mx, my, 1.0, 1.7, { color: [0x9b2c2c, 0x2c5f9b, 0x2c7b4f][(mx + my * 3) % 3 | 0] });
    b.spots.push({ kind: "pray", x: mx, y: my, sx: mx, sy: my, face: N, label: "Prayer mat" });
  }
  return { w: 20, d: 16, title: "Mosque", floor: 0x6f8f6a, wall: 0xf4f1ea };
}

function layChapel(b: Builder): RoomShell {
  b.block("altar", 11, 2.2, 6, 1.6);
  b.deco("board", 11, 0.2, 3, 0.15, { face: S, color: 0x6b3a2a });
  for (const py of [6, 8.4, 10.8, 13.2, 15.6]) {
    for (const [x0, x1] of [[2, 9.5], [12.5, 20]]) {
      // Pew = bench + backrest behind the sitters; you step out into the row in front.
      b.block("pew", (x0 + x1) / 2, py + 0.45, x1 - x0, 0.5);
      for (let sx = x0 + 0.6; sx < x1; sx += 1.1) b.spots.push({ kind: "pray", x: sx, y: py - 0.05, sx, sy: py - 0.75, face: N, label: "Pew" });
    }
  }
  return { w: 22, d: 20, title: "Church", floor: 0x8a5a44, wall: 0xf6f2ea };
}

function layCourt(b: Builder): RoomShell {
  b.deco("court", 9, 6, 14, 7.5);
  b.spots.push({ kind: "play", x: 6, y: 6, sx: 6, sy: 6, face: E, label: "Squash" });
  b.spots.push({ kind: "play", x: 12, y: 6, sx: 12, sy: 6, face: W, label: "Squash" });
  b.block("bench", 9, 0.9, 8, 0.6);
  for (let bx = 5.8; bx <= 12.4; bx += 1.6) b.spots.push({ kind: "sit", x: bx, y: 0.95, sx: bx, sy: 1.8, face: S, label: "Bench" });
  return { w: 18, d: 13, title: "Squash court", floor: 0xc79a5f, wall: 0xf2f2ef };
}

const LAYOUTS: Record<TemplateId, (b: Builder) => RoomShell> = {
  foodcourt: layFoodCourt,
  hostel: (b) => layViewing(b, layHostel(b)),
  lecture: layLecture,
  library: layLibrary,
  bank: layBank,
  mosque: layMosque,
  chapel: layChapel,
  classroom: layClassroom,
  court: layCourt,
  amphitheatre: layAmphitheatre,
  auditorium: layAuditorium,
};

function makeTemplate(id: TemplateId): Template {
  const b = new Builder();
  const { w, d, title, floor, wall } = LAYOUTS[id](b);
  return { id, title, w, d, floor, wall, props: b.props, cols: b.cols, spots: b.spots, npcs: b.npcs, levels: b.levels, entry: { x: w / 2, y: d - 1.6 } };
}

export const TEMPLATES: Record<TemplateId, Template> = Object.fromEntries(
  (Object.keys(LAYOUTS) as TemplateId[]).map((id) => [id, makeTemplate(id)]),
) as Record<TemplateId, Template>;

export function templateFor(p: Place): TemplateId | null {
  if (p.building === undefined) return p.kind === "hostel" ? "hostel" : null; // open areas (Main bowl...) have no inside
  const n = p.name;
  if (/student union/i.test(n)) return "foodcourt";
  if (/library/i.test(n)) return "library";
  if (/bank/i.test(n) && !/lecture|theat/i.test(n)) return "bank";
  if (/mosque/i.test(n)) return "mosque";
  if (/chapel|church|rccg|cathedral/i.test(n) || p.kind === "worship") return "chapel";
  if (/squash|court|gym/i.test(n) || p.kind === "sports") return "court";
  if (p.kind === "hostel") return "hostel";
  if (/amphi/i.test(n)) return "amphitheatre";
  if (/oduduwa/i.test(n)) return "auditorium";
  if (/lecture|theat|aud|\blt|seater|amphi|hslt|oduduwa/i.test(n)) return "lecture";
  return "classroom";
}
