import * as THREE from "three";
import { CLASSROOM, HALL, LONG_TABLE, PLASTIC_TABLE, SEATS, type Prop, type SeatStyle } from "@campuslife/shared/interiors";
import { boxAt, mergeParts, placed, yawOf, type Kit } from "./kit";
import { CHAIR_COLORS, PLASTIC_WHITE, STEEL, WOOD, WOOD_DARK } from "./palette";

const lambert = (color: number) => () => new THREE.MeshLambertMaterial({ color });

export function fixedBench(kit: Kit, p: Prop) {
  const seat = SEATS.fixed;
  const floor = p.floor ?? 0;
  kit.box(WOOD, p.w, 0.04, seat.depth, p.x, floor + seat.h - 0.04, p.y);
  kit.box(WOOD, p.w, seat.back - 0.1, 0.03, p.x, floor + seat.h + 0.1, p.y + seat.depth / 2 + 0.015);
  const step = HALL.seatWidth * 3;
  for (let x = p.x - p.w / 2; x <= p.x + p.w / 2 + 0.01; x += step) {
    kit.instance("bench-frame", () => ({
      geometry: mergeParts([
        boxAt(0.04, seat.h - 0.04, 0.04, 0, 0, -seat.depth / 2 + 0.04),
        boxAt(0.04, seat.h + seat.back, 0.04, 0, 0, seat.depth / 2 + 0.02),
        boxAt(0.04, 0.03, seat.depth, 0, seat.h - 0.07, 0),
      ]),
      material: lambert(STEEL),
    }), placed(x, floor, p.y));
  }
}

export function ledge(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(WOOD, p.w, 0.03, p.d, p.x, floor + HALL.ledgeH - 0.03, p.y);
  kit.box(WOOD_DARK, p.w, 0.05, 0.02, p.x, floor + HALL.ledgeH, p.y - p.d / 2 + 0.01);
  const step = HALL.seatWidth * 3;
  for (let x = p.x - p.w / 2; x <= p.x + p.w / 2 + 0.01; x += step) {
    kit.instance("ledge-post", () => ({
      geometry: mergeParts([boxAt(0.04, HALL.ledgeH - 0.03, 0.04, 0, 0, -p.d / 2 + 0.04), boxAt(0.04, 0.03, p.d - 0.04, 0, HALL.ledgeH - 0.06, 0)]),
      material: lambert(STEEL),
    }), placed(x, floor, p.y));
  }
}

function chairParts(style: SeatStyle, legs: number) {
  const { h, depth, back } = SEATS[style];
  const half = depth / 2;
  const parts = [boxAt(depth, 0.03, depth, 0, h - 0.03, 0), boxAt(depth, back * 0.55, 0.03, 0, h + back * 0.45, -half + 0.015)];
  const posts = [boxAt(legs, h + back, legs, -half + legs / 2, 0, -half + legs / 2), boxAt(legs, h + back, legs, half - legs / 2, 0, -half + legs / 2)];
  posts.push(boxAt(legs, h - 0.03, legs, -half + legs / 2, 0, half - legs / 2), boxAt(legs, h - 0.03, legs, half - legs / 2, 0, half - legs / 2));
  return { parts, posts };
}

export function chair(kit: Kit, p: Prop, index: number) {
  const style = p.seat ?? "chair";
  const at = placed(p.x, p.floor ?? 0, p.y, yawOf(p.face));
  if (style === "school") {
    kit.instance("school-chair-wood", () => ({ geometry: mergeParts(chairParts(style, 0.025).parts), material: lambert(WOOD) }), at);
    kit.instance("school-chair-steel", () => ({ geometry: mergeParts(chairParts(style, 0.025).posts), material: lambert(STEEL) }), at);
    return;
  }
  kit.instance(`chair-${style}`, () => {
    const { parts, posts } = chairParts(style, 0.04);
    return { geometry: mergeParts([...parts, ...posts]), material: lambert(0xffffff) };
  }, at, CHAIR_COLORS[index % CHAIR_COLORS.length]);
}

export function schoolDesk(kit: Kit, p: Prop) {
  const { deskW: w, deskD: d, deskH: h } = CLASSROOM;
  const at = placed(p.x, p.floor ?? 0, p.y);
  kit.instance("school-desk-wood", () => ({
    geometry: mergeParts([boxAt(w, 0.025, d, 0, h - 0.025, 0), boxAt(w - 0.06, 0.11, d * 0.5, 0, h - 0.135, -d * 0.2)]),
    material: lambert(WOOD),
  }), at);
  kit.instance("school-desk-steel", () => ({
    geometry: mergeParts([-1, 1].flatMap((sx) => [-1, 1].map((sz) => boxAt(0.025, h - 0.025, 0.025, sx * (w / 2 - 0.02), 0, sz * (d / 2 - 0.02))))),
    material: lambert(STEEL),
  }), at);
}

export function diningTable(kit: Kit, p: Prop) {
  if (p.style === "plastic") {
    const { size, h } = PLASTIC_TABLE;
    kit.box(PLASTIC_WHITE, size, 0.03, size, p.x, h - 0.03, p.y);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(PLASTIC_WHITE, 0.045, h - 0.03, 0.045, p.x + sx * (size / 2 - 0.08), 0, p.y + sz * (size / 2 - 0.08));
    return;
  }
  const { h } = LONG_TABLE;
  kit.box(WOOD, p.w, 0.04, p.d, p.x, h - 0.04, p.y);
  for (const sz of [-1, 1]) {
    kit.box(WOOD_DARK, p.w - 0.12, h - 0.04, 0.05, p.x, 0, p.y + sz * (p.d / 2 - 0.2));
    kit.box(WOOD_DARK, p.w - 0.12, 0.05, 0.07, p.x, 0, p.y + sz * (p.d / 2 - 0.2));
  }
}

export function looseBench(kit: Kit, p: Prop) {
  const { h } = SEATS.bench;
  kit.box(WOOD, p.w, 0.04, p.d, p.x, h - 0.04, p.y);
  const along = p.d > p.w;
  for (const side of [-1, 1]) {
    const off = side * ((along ? p.d : p.w) / 2 - 0.15);
    kit.box(WOOD_DARK, along ? p.w - 0.06 : 0.05, h - 0.04, along ? 0.05 : p.d - 0.06, p.x + (along ? 0 : off), 0, p.y + (along ? off : 0));
  }
}

export function teacherDesk(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(WOOD, p.w, 0.04, p.d, p.x, floor + 0.72, p.y);
  kit.box(WOOD_DARK, p.w - 0.08, 0.68, 0.03, p.x, floor + 0.04, p.y + p.d / 2 - 0.05);
  for (const sx of [-1, 1]) kit.box(WOOD_DARK, 0.03, 0.72, p.d - 0.1, p.x + sx * (p.w / 2 - 0.05), floor, p.y);
  const { h, depth, back } = SEATS.chair;
  const cz = p.y - p.d / 2 - 0.35;
  kit.box(WOOD, depth, 0.03, depth, p.x, floor + h - 0.03, cz);
  kit.box(WOOD, depth, back * 0.5, 0.03, p.x, floor + h + back * 0.5, cz - depth / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(WOOD_DARK, 0.04, h - 0.03, 0.04, p.x + sx * (depth / 2 - 0.03), floor, cz + sz * (depth / 2 - 0.03));
}

export function lectern(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(WOOD_DARK, p.w, 1.05, p.d, p.x, floor, p.y);
  const top = new THREE.BoxGeometry(p.w + 0.08, 0.03, p.d + 0.1);
  top.rotateX(-0.3).translate(p.x, floor + 1.09, p.y);
  kit.solid(WOOD, top);
}
