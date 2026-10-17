import type { Template } from "@campuslife/shared/interiors";

export function canteenFans(t: Template): [number, number][] {
  return [0.17, 0.42, 0.83].flatMap((fx) => [9, 17].map((z): [number, number] => [t.w * fx, z]));
}
