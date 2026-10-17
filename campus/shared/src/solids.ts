import { GATE, GATE_PILLARS, GATE_PILLAR_RADIUS, PX_PER_METER, forCells, type Point } from "./map";

const M = PX_PER_METER;

export interface Solid extends Point {
  name: string;
  halfAlong: number;
  halfAcross: number;
  angle: number;
}

export interface SolidBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Indexed {
  solid: Solid;
  cos: number;
  sin: number;
}

const solids: Solid[] = [];
const cells = new Map<number, Indexed[]>();

export const SOLIDS: readonly Solid[] = solids;

export function solidBounds(s: Solid): SolidBounds {
  const c = Math.abs(Math.cos(s.angle));
  const n = Math.abs(Math.sin(s.angle));
  const hx = c * s.halfAlong + n * s.halfAcross;
  const hy = n * s.halfAlong + c * s.halfAcross;
  return { x0: s.x - hx, y0: s.y - hy, x1: s.x + hx, y1: s.y + hy };
}

export function addSolid(solid: Solid): Solid {
  const entry: Indexed = { solid, cos: Math.cos(solid.angle), sin: Math.sin(solid.angle) };
  const b = solidBounds(solid);
  solids.push(solid);
  forCells(b.x0, b.y0, b.x1, b.y1, (i) => {
    const list = cells.get(i);
    if (list) list.push(entry);
    else cells.set(i, [entry]);
  });
  return solid;
}

function touches(e: Indexed, x: number, y: number, r: number): boolean {
  const dx = x - e.solid.x;
  const dy = y - e.solid.y;
  const along = dx * e.cos + dy * e.sin;
  const across = dy * e.cos - dx * e.sin;
  const ox = Math.max(0, Math.abs(along) - e.solid.halfAlong);
  const oy = Math.max(0, Math.abs(across) - e.solid.halfAcross);
  return ox * ox + oy * oy < r * r;
}

export function solidBlocked(x: number, y: number, r: number): boolean {
  let hit = false;
  forCells(x - r, y - r, x + r, y + r, (i) => {
    const list = hit ? undefined : cells.get(i);
    if (list) hit = list.some((e) => touches(e, x, y, r));
  });
  return hit;
}

const GATEHOUSE_HALF = 1.5 * M;
const GATEHOUSE_ALONG = 8 * M;
export const GATEHOUSE_NAME = "Gatehouse";
export const GATE_PILLAR_NAME = "Gate pillar";

for (const p of GATE_PILLARS) addSolid({ name: GATE_PILLAR_NAME, x: p.x, y: p.y, halfAlong: GATE_PILLAR_RADIUS, halfAcross: GATE_PILLAR_RADIUS, angle: 0 });

export const GATEHOUSE: Solid | undefined = GATE
  ? addSolid({
      name: GATEHOUSE_NAME,
      x: GATE_PILLARS[0].x + Math.cos(GATE.angle) * GATEHOUSE_ALONG,
      y: GATE_PILLARS[0].y + Math.sin(GATE.angle) * GATEHOUSE_ALONG,
      halfAlong: GATEHOUSE_HALF,
      halfAcross: GATEHOUSE_HALF,
      angle: 0,
    })
  : undefined;
