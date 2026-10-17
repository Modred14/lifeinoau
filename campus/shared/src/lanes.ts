import { PX_PER_METER, nearBuilding, nearestCarriageway, type Point } from "./map";

const M = PX_PER_METER;

export const LANE = {
  snapReach: 7 * M,
  sampleEvery: 8 * M,
  edgeGap: 0.15 * M,
  mergeBelow: 1.5 * M,
  straightBelow: 0.035,
  curveAbove: 0.16,
  curveCut: 6 * M,
  curveShare: 0.45,
  curveSteps: 5,
};

export const ROAD_LANES = {
  shuttle: [1.4, 0.9, 0.5],
  bus: [1.5, 0.95, 0.5],
  okada: [1.7, 1.1, 0.6],
  keke: [1.3, 0.85, 0.45],
  bicycle: [2.4, 1.6, 1.0, 0.6],
} as const;

function laneFor(width: number, lanes: readonly number[], halfWidth: number): number {
  for (const lane of lanes) if ((lane + halfWidth) * M + LANE.edgeGap <= width / 2) return lane * M;
  return 0;
}

export function shiftRight(points: readonly Point[], lanes: readonly number[], halfWidth: number, closed = false): Point[] {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const snap = span > 0 ? nearestCarriageway(p.x, p.y, (b.x - a.x) / span, (b.y - a.y) / span) : nearestCarriageway(p.x, p.y);
    if (!snap || snap.distance > LANE.snapReach) return { x: p.x, y: p.y };
    const along = (b.x - a.x) * snap.dx + (b.y - a.y) * snap.dy;
    const sign = along >= 0 ? 1 : -1;
    const lane = laneFor(snap.width, lanes, halfWidth);
    const x = snap.x - snap.dy * sign * lane;
    const y = snap.y + snap.dx * sign * lane;
    return nearBuilding(x, y, halfWidth * M) ? { x: p.x, y: p.y } : { x, y };
  });
}

const turnAt = (a: Point, b: Point, c: Point) => {
  const d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
  return Math.atan2(Math.sin(d), Math.cos(d));
};

export function tidy(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < LANE.mergeBelow) continue;
    while (out.length >= 2 && Math.abs(turnAt(out[out.length - 2], out[out.length - 1], p)) < LANE.straightBelow) out.pop();
    out.push({ x: p.x, y: p.y });
  }
  const end = points[points.length - 1];
  if (end && out.length) out[out.length - 1] = { x: end.x, y: end.y };
  return out;
}

export function roundCorners(points: readonly Point[]): Point[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const out: Point[] = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const la = Math.hypot(b.x - a.x, b.y - a.y);
    const lc = Math.hypot(c.x - b.x, c.y - b.y);
    if (Math.abs(turnAt(a, b, c)) < LANE.curveAbove || la < 1 || lc < 1) {
      out.push({ ...b });
      continue;
    }
    const cut = Math.min(LANE.curveCut, la * LANE.curveShare, lc * LANE.curveShare);
    const p0 = { x: b.x + ((a.x - b.x) * cut) / la, y: b.y + ((a.y - b.y) * cut) / la };
    const p1 = { x: b.x + ((c.x - b.x) * cut) / lc, y: b.y + ((c.y - b.y) * cut) / lc };
    for (let k = 0; k <= LANE.curveSteps; k++) {
      const t = k / LANE.curveSteps;
      const u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * b.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * b.y + t * t * p1.y });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

export function resample(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    out.push({ x: a.x, y: a.y });
    const b = points[i + 1];
    if (!b) break;
    const steps = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / LANE.sampleEvery);
    for (let k = 1; k < steps; k++) out.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
  }
  return out;
}

export function laneRoute(points: readonly Point[], lanes: readonly number[], halfWidth: number): Point[] {
  return roundCorners(tidy(shiftRight(resample(points), lanes, halfWidth)));
}

export function laneLoop(points: readonly Point[], lanes: readonly number[], halfWidth: number): Point[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const ring = resample([...points, points[0]]).slice(0, -1);
  const shifted = shiftRight(ring, lanes, halfWidth, true);
  return roundCorners(tidy([...shifted, shifted[0]])).slice(0, -1);
}
