import { SPOTS } from "../interiors";
import type { Point } from "../map";
import { SOCIAL_SITES } from "./place";
import { FORECOURT_LABEL, GYRATION_LABEL, TOUCHLINE_LABEL } from "./trades";

const LABELS: ReadonlySet<string> = new Set([FORECOURT_LABEL, GYRATION_LABEL, TOUCHLINE_LABEL]);

export const SOCIAL_POINTS: readonly Point[] = [
  ...SPOTS.filter((s) => s.place < 0 && LABELS.has(s.label)).map((s) => ({ x: s.x, y: s.y })),
  ...SOCIAL_SITES.finalists.map((f) => ({ x: f.x, y: f.y })),
];
