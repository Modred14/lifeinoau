import campus from "../data/campus.json";
import { AREAS, GATE, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, ROADS, nearBuilding, onRoad, pointInPoly, type Point } from "../map";
import { SELLER_LOOKS } from "./builder";
import { placeSocial } from "../social/place";
import type { Npc, Spot } from "./types";

const M = PX_PER_METER;

export type StallStyle = "umbrella" | "table" | "barrow" | "grill" | "cooler" | "kiosk";

export interface Stall {
  name: string;
  style: StallStyle;
  goods: number;
  roadside: boolean;
  /** Centre (map px) and facing (towards customers). */
  x: number;
  y: number;
  face: number;
  /** Collider (map px). */
  col: { x: number; y: number; w: number; h: number };
  spot: number;
  npc: Npc;
}

const STALL_MENU: Record<string, { label: string; price: number; food: number; fun: number }> = {
  buka: { label: "Mama Put: rice, beans & plantain", price: 400, food: 45, fun: 0 },
  suya: { label: "Suya spot", price: 500, food: 30, fun: 10 },
  water: { label: "Pure water & gala", price: 100, food: 10, fun: 3 },
  boli: { label: "Boli & groundnut", price: 200, food: 22, fun: 2 },
  shawarma: { label: "Shawarma stand", price: 1000, food: 50, fun: 10 },
};

const STALL_PLAN: [RegExp, (keyof typeof STALL_MENU)[]][] = [
  [/student union/i, ["buka", "suya", "shawarma", "water"]],
  [/^new buka$/i, ["buka", "buka", "suya", "boli", "water"]],
  [/moremi/i, ["buka", "water"]],
  [/fajuyi/i, ["buka", "suya"]],
  [/^etf hall$/i, ["buka", "water"]],
  [/awolowo hall/i, ["buka", "boli"]],
  [/angola/i, ["buka"]],
  [/mozambique/i, ["buka"]],
  [/alumni/i, ["water"]],
  [/postgraduate/i, ["buka"]],
  [/oluwasanmi library/i, ["water"]],
  [/oduduwa hall/i, ["suya"]],
  [/faculty of technology/i, ["boli", "water"]],
  [/1000 seater/i, ["water"]],
  [/oau sports centre/i, ["water", "boli"]],
];

export function placeStalls(spots: Spot[]): Stall[] {
  const out: Stall[] = [];
  const free = (x: number, y: number) =>
    x > 5 * M && y > 5 * M && x < MAP_WIDTH_PX - 5 * M && y < MAP_HEIGHT_PX - 5 * M &&
    !nearBuilding(x, y, 3.2 * M) && !onRoad(x, y, 2.2 * M) &&
    out.every((s) => Math.hypot(s.x - x, s.y - y) > 7 * M);
  for (const [re, kinds] of STALL_PLAN) {
    const place = PLACES.find((p) => re.test(p.name));
    if (!place) continue;
    const d = place.door;
    for (const kind of kinds) {
      let found: Point | null = null;
      for (let r = 9; r <= 36 && !found; r += 1.5) {
        for (let k = 0; k < 20; k++) {
          const a = (k / 20) * Math.PI * 2 + r;
          const x = d.x + Math.cos(a) * r * M;
          const y = d.y + Math.sin(a) * r * M;
          if (free(x, y)) {
            found = { x, y };
            break;
          }
        }
      }
      if (!found) continue;
      // Face the door (snap to a cardinal direction so the collider stays axis-aligned).
      const raw = Math.atan2(d.y - found.y, d.x - found.x);
      const face = Math.round(raw / (Math.PI / 2)) * (Math.PI / 2);
      const fx = Math.round(Math.cos(face));
      const fy = Math.round(Math.sin(face));
      const along = 2.6 * M;
      const deep = 1.2 * M;
      const cw = fx !== 0 ? deep : along;
      const ch = fx !== 0 ? along : deep;
      const menu = STALL_MENU[kind];
      const spot = spots.length;
      spots.push({
        kind: "eat",
        x: found.x + fx * 1.5 * M,
        y: found.y + fy * 1.5 * M,
        sx: found.x + fx * 1.5 * M,
        sy: found.y + fy * 1.5 * M,
        face: face + Math.PI,
        label: menu.label,
        price: menu.price,
        food: menu.food,
        fun: menu.fun,
        place: -1,
      });
      out.push({
        name: menu.label,
        style: "umbrella",
        goods: 0,
        roadside: false,
        x: found.x,
        y: found.y,
        face,
        col: { x: found.x - cw / 2, y: found.y - ch / 2, w: cw, h: ch },
        spot,
        npc: { x: found.x - fx * 1.0 * M, y: found.y - fy * 1.0 * M, face, look: SELLER_LOOKS[out.length % SELLER_LOOKS.length] },
      });
    }
  }
  placeRoadside(spots, out, free);
  placeSocial(spots, out, free);
  return out;
}

interface Trade {
  label: string;
  price: number;
  food: number;
  fun: number;
  style: StallStyle;
}

export const ROADSIDE_TRADES: readonly Trade[] = [
  { label: "Oranges & bananas", price: 150, food: 12, fun: 2, style: "barrow" },
  { label: "Roasted corn & ube", price: 200, food: 20, fun: 2, style: "grill" },
  { label: "Puff-puff & buns", price: 150, food: 16, fun: 4, style: "table" },
  { label: "Cold minerals & zobo", price: 250, food: 6, fun: 10, style: "cooler" },
  { label: "Akara & bread", price: 300, food: 30, fun: 2, style: "table" },
  { label: "Groundnut & popcorn", price: 100, food: 8, fun: 4, style: "table" },
  { label: "Sugarcane", price: 100, food: 8, fun: 5, style: "barrow" },
  { label: "Kiosk snacks", price: 200, food: 12, fun: 5, style: "kiosk" },
  { label: "Business centre & pure water", price: 50, food: 5, fun: 0, style: "kiosk" },
];

const FOOD_TRADES = 8;
const BUSINESS_CENTRE = { goods: 8, share: 0.14, salt: 3436 };

const ROADSIDE = {
  minRoadWidth: 4.5 * M,
  spacing: 55 * M,
  setback: 2.8 * M,
  busyChance: 0.24,
  quietChance: 0.03,
  busyRadius: 120 * M,
  stopClear: 14 * M,
  gateClear: 26 * M,
  doorClear: 6 * M,
  max: 96,
};

function chance(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const NO_STALL_AREAS = AREAS.filter((a) => a.kind === "water" || a.kind === "field");
const BUS_STOPS: Point[] = (campus.transit ?? []).flatMap((line) => line.stops.map((st) => ({ x: line.pts[st.i * 2], y: line.pts[st.i * 2 + 1] })));

function placeRoadside(spots: Spot[], out: Stall[], free: (x: number, y: number) => boolean) {
  const R = ROADSIDE;
  const near = (list: readonly Point[], x: number, y: number, d: number) => list.some((p) => Math.hypot(p.x - x, p.y - y) < d);
  const doors = campus.places.map((p) => ({ x: p.door[0], y: p.door[1] }));
  const first = out.length;
  ROADS.forEach((road, ri) => {
    if (road.kind !== "road" || road.width < R.minRoadWidth) return;
    let carry = R.spacing * chance(ri, 7);
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const ax = road.pts[i], ay = road.pts[i + 1], bx = road.pts[i + 2], by = road.pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      let d = carry;
      for (; d < len; d += R.spacing) {
        if (out.length - first >= R.max) return;
        const cx = ax + ((bx - ax) * d) / len;
        const cy = ay + ((by - ay) * d) / len;
        const roll = chance(Math.round(cx), Math.round(cy));
        if (roll > (near(doors, cx, cy, R.busyRadius) ? R.busyChance : R.quietChance)) continue;
        const side = chance(Math.round(cy), Math.round(cx) + 3) < 0.5 ? 1 : -1;
        const nx = (-(by - ay) / len) * side;
        const ny = ((bx - ax) / len) * side;
        const x = cx + nx * (road.width / 2 + R.setback);
        const y = cy + ny * (road.width / 2 + R.setback);
        if (!free(x, y) || near(BUS_STOPS, x, y, R.stopClear) || near(doors, x, y, R.doorClear)) continue;
        if (GATE && Math.hypot(GATE.x - x, GATE.y - y) < R.gateClear) continue;
        if (NO_STALL_AREAS.some((a) => pointInPoly(x, y, a.poly))) continue;
        const face = Math.round(Math.atan2(-ny, -nx) / (Math.PI / 2)) * (Math.PI / 2);
        const fx = Math.round(Math.cos(face));
        const fy = Math.round(Math.sin(face));
        const stand = { x: x + fx * 1.5 * M, y: y + fy * 1.5 * M };
        if (onRoad(stand.x, stand.y, 0.4 * M) || nearBuilding(stand.x, stand.y, 0.8 * M)) continue;
        const n = out.length - first;
        const goods = chance(n, BUSINESS_CENTRE.salt) < BUSINESS_CENTRE.share ? BUSINESS_CENTRE.goods : Math.floor(chance(n, ri + 11) * FOOD_TRADES);
        const trade = ROADSIDE_TRADES[goods];
        const cw = fx !== 0 ? 1.2 * M : 2.6 * M;
        const ch = fx !== 0 ? 2.6 * M : 1.2 * M;
        const spot = spots.length;
        spots.push({ kind: "eat", x: stand.x, y: stand.y, sx: stand.x, sy: stand.y, face: face + Math.PI, label: trade.label, price: trade.price, food: trade.food, fun: trade.fun, place: -1, roadside: true });
        out.push({
          name: trade.label,
          style: trade.style,
          goods,
          roadside: true,
          x,
          y,
          face,
          col: { x: x - cw / 2, y: y - ch / 2, w: cw, h: ch },
          spot,
          npc: { x: x - fx * 1.0 * M, y: y - fy * 1.0 * M, face, look: SELLER_LOOKS[out.length % SELLER_LOOKS.length] },
        });
      }
      carry = d - len;
    }
  });
}
