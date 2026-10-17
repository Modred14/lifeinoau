import type * as THREE from "three";
import type { Prop, Template, TemplateId } from "@campuslife/shared/interiors";
import { dressRoom, type Dressing } from "./dressing";
import { board, fridge, handWash, screen, servingCounter } from "./fixtures";
import { chair, diningTable, fixedBench, lectern, ledge, looseBench, schoolDesk, teacherDesk } from "./furniture";
import type { Kit } from "./kit";
import { legacyProp } from "./legacy-props";
import { DADO_CANTEEN, DADO_HALL } from "./palette";
import { WALL_H, buildShell, topLevel } from "./shell";
import { canteenFans } from "./canteen";
import { classroomFans } from "./classroom";
import { hallFans } from "./lecture-hall";
import { venueProp } from "./stage";

type Look = Omit<Dressing, "beam">;

const DRESSED: Partial<Record<TemplateId, (t: Template, wallH: number) => Look>> = {
  lecture: (t, wallH) => ({ wallH, dado: DADO_HALL, fans: hallFans(t), windowEvery: 1, windowFrom: 2 }),
  classroom: (t, wallH) => ({ wallH, dado: DADO_HALL, fans: classroomFans(t), windowEvery: 1, windowFrom: 1 }),
  foodcourt: (t, wallH) => ({ wallH, dado: DADO_CANTEEN, fans: canteenFans(t), windowEvery: 2, windowFrom: 2 }),
};

export function wallHeight(t: Template): number {
  return WALL_H + Math.ceil(topLevel(t) * 10) / 10;
}

function addProp(kit: Kit, t: Template, p: Prop, index: number) {
  if (venueProp(kit, t, p)) return;
  switch (p.type) {
    case "bench":
      if (p.seat === "fixed") return fixedBench(kit, p);
      if (p.seat === "bench") return looseBench(kit, p);
      break;
    case "ledge":
      return ledge(kit, p);
    case "chair":
      return chair(kit, p, index);
    case "desk":
      if (p.style === "school") return schoolDesk(kit, p);
      if (p.style === "teacher") return teacherDesk(kit, p);
      break;
    case "table":
      if (p.style) return diningTable(kit, p);
      break;
    case "counter":
      if (p.style === "serving") return servingCounter(kit, p);
      break;
    case "board":
      return board(kit, p);
    case "screen":
      return screen(kit, p);
    case "lectern":
      return lectern(kit, p);
    case "fridge":
      return fridge(kit, p);
    case "basin":
      return handWash(kit, p);
  }
  legacyProp(kit, t, p);
}

export function buildRoom(kit: Kit, t: Template, wallMaterial: () => THREE.Material) {
  const wallH = wallHeight(t);
  buildShell(kit, t, { wallH, wallMaterial });
  t.props.forEach((p, index) => addProp(kit, t, p, index));
  const dressing = DRESSED[t.id]?.(t, wallH);
  if (dressing) dressRoom(kit, t, { ...dressing, beam: wallMaterial });
}
