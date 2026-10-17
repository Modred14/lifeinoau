import { CLASSROOM, type Template } from "@campuslife/shared/interiors";

export function classroomFans(t: Template): [number, number][] {
  const mid = CLASSROOM.firstDesk + ((CLASSROOM.rows - 1) * CLASSROOM.pitch) / 2;
  return [t.w * 0.3, t.w * 0.7].flatMap((x) => [mid - 1.6, mid + 2.2].map((z): [number, number] => [x, z]));
}
