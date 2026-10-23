// Parking layout for the private garage view. Positions are in metres; the same
// dimensions are used by the driveable vehicle models.
import { carById } from "../lib/cars.js";

const SHAPES = {
  compact: [4.5, 1.78], sedan: [4.85, 1.85], sport: [4.65, 1.84], suv: [4.9, 1.95],
  "suv-large": [4.95, 2], "super-suv": [5.1, 2.02], supercar: [4.52, 1.93], cybertruck: [5.68, 2.03],
};
export const garageVehicleSize = (id) => { const c = carById(id), [length, width] = SHAPES[c?.shape] ?? [4.5, 1.85]; return { length, width }; };

/** Two facing rows with an aisle and room to expand to any collection size. */
export function garageLayout(vehicles = []) {
  const count = vehicles.length, columns = Math.max(1, Math.ceil(count / 2)), spacingX = 3.8;
  const width = Math.max(13, columns * spacingX + 4), center = (columns - 1) * spacingX / 2;
  const slots = vehicles.map((v, i) => {
    const row = i < columns ? 0 : 1, col = row === 0 ? i : i - columns;
    return { ...v, x: col * spacingX - center, z: row === 0 ? -5 : 5, yaw: row === 0 ? 0 : Math.PI, row, col };
  });
  const rows = Math.max(1, Math.ceil(count / columns));
  return { slots, columns, rows, width, depth: 34, houseWidth: Math.max(11, Math.min(width - 2, 18)), entranceZ: 15 };
}

/** A grid walk path that routes around parked cars instead of cutting through them. */
export function garageWalkPath(from, to, layout, step = 0.5) {
  const { width, entranceZ } = layout, minX = -width / 2 + 0.8, maxX = width / 2 - 0.8, minZ = -15, maxZ = entranceZ - 1;
  const cell = (p) => [Math.round((p.x - minX) / step), Math.round((p.z - minZ) / step)], pos = (x, z) => ({ x: minX + x * step, z: minZ + z * step });
  const [sx, sz] = cell(from), [gx, gz] = cell(to), nx = Math.floor((maxX - minX) / step), nz = Math.floor((maxZ - minZ) / step);
  const blocked = (x, z) => { const p = pos(x, z); if (p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ || (p.z < -11.8 && Math.abs(p.x) < layout.houseWidth / 2 + 0.5)) return true;
    return layout.slots.some((v) => { const { length, width: w } = garageVehicleSize(v.modelId); const dx = p.x - v.x, dz = p.z - v.z; return Math.abs(dx) < w / 2 + 0.55 && Math.abs(dz) < length / 2 + 0.55; }); };
  const key = (x, z) => `${x},${z}`, start = key(sx, sz), goal = key(gx, gz), came = new Map([[start, null]]), q = [[sx, sz]];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let i = 0; i < q.length && !came.has(goal); i++) { const [x,z] = q[i]; for (const [dx,dz] of dirs) { const a=x+dx,b=z+dz,k=key(a,b); if (a<0||b<0||a>nx||b>nz||came.has(k)||blocked(a,b)) continue; came.set(k,key(x,z)); q.push([a,b]); } }
  if (!came.has(goal)) return [];
  const path=[]; let k=goal; while (k) { const [x,z]=k.split(",").map(Number); path.push(pos(x,z)); k=came.get(k); }
  return path.reverse();
}
