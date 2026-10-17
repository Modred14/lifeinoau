export type Pose = "stand" | "sit" | "lie" | "busy" | "dance" | "eat";

export type PoseVariant = "listen" | "write" | "eat";

export interface PoseSeat {
  h: number;
  hip: number;
}

export interface PoseSurface {
  h: number;
  near: number;
}

export interface PoseDetail {
  variant: PoseVariant;
  seat?: PoseSeat;
  surface?: PoseSurface;
  dish?: string;
  focused?: boolean;
}

export function poseKey(pose: Pose, detail?: PoseDetail): string {
  if (!detail) return pose;
  const { variant, seat, surface, dish, focused } = detail;
  return [pose, variant, seat?.h, seat?.hip, surface?.h, surface?.near, dish, focused].join("|");
}
