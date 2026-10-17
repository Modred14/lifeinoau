import { floorHeightAt } from "@campuslife/shared/interiors";
import { toMap } from "../coords";

export const interiorGround = (x: number, z: number) => floorHeightAt(toMap(x), toMap(z));
