import { ACT_POSE, SEATS, SPOTS, type ActKind, type Spot } from "@campuslife/shared/interiors";
import type { Pose, PoseDetail } from "../avatar/pose-detail";

export interface ActivityLook {
  pose: Pose;
  detail?: PoseDetail;
}

const WRITING: ReadonlySet<ActKind> = new Set<ActKind>(["study", "exam"]);

export function activityLook(kind: ActKind | "none", spot: Spot | undefined): ActivityLook {
  if (kind === "none") return { pose: "stand" };
  if (kind === "eat") {
    if (!spot?.seat) return { pose: "eat", detail: { variant: "eat", dish: spot?.label } };
    const menu = spot.menu === undefined ? undefined : SPOTS[spot.menu];
    return { pose: "sit", detail: { variant: "eat", seat: SEATS[spot.seat], surface: spot.surface, dish: menu?.label } };
  }
  const pose = ACT_POSE[kind];
  if (pose !== "sit" || !spot?.seat) return { pose };
  const writing = WRITING.has(kind) && spot.surface !== undefined;
  return { pose, detail: { variant: writing ? "write" : "listen", seat: SEATS[spot.seat], surface: spot.surface, focused: kind === "exam" } };
}
