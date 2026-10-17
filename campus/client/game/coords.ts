/**
 * Map <-> 3D world conversion. The shared simulation works in 2D map pixels
 * (x right, y down); the 3D world is metres on the XZ plane (y up).
 * Map +x -> world +x, map +y -> world +z ("south").
 */
import { PX_PER_METER } from "@campuslife/shared";

export { PX_PER_METER };

export const toWorld = (px: number) => px / PX_PER_METER;
export const toMap = (m: number) => m * PX_PER_METER;

/** three.js Y rotation for a shared 8-way direction (0 = east, clockwise). glTF models face +Z. */
export function yawForDir(dir: number): number {
  const a = (dir * Math.PI) / 4;
  return Math.atan2(Math.cos(a), Math.sin(a));
}

/** three.js Y rotation for a movement vector in map space. */
export function yawForVector(dx: number, dy: number): number {
  return Math.atan2(dx, dy);
}
