// lib3d/garageLayout.js
// Layout of the private garage compound. Positions are in metres (x east, z south; the road is on the south side), and the same numbers are used by the
// scene that draws it, by the walking planner, and by the vehicle driving model (lib3d/garageDrive.js), so what you see is exactly what you can drive on.
//
//   house frontage (north) ........ the front of the house, with the garage shutter in line with the driveway
//   covered bays left and right ... every bay opens straight onto the driveway lane, nose towards it, so any car can pull out without moving another
//   driveway lane (LANE wide) ..... runs from the house down the middle of the compound, clear of everything, straight to the gate
//   vehicle gate (GATE wide) ...... an open gap in the front wall, wider than the lane
//   footpath, kerb, road .......... the lane meets the carriageway at a right angle, so a car drives out onto the road without any turn or step
import { carById } from "../lib/cars.js";

const SHAPES = {
  compact: [4.5, 1.78], sedan: [4.85, 1.85], sport: [4.65, 1.84], suv: [4.9, 1.95],
  "suv-large": [4.95, 2], "super-suv": [5.1, 2.02], supercar: [4.52, 1.93], cybertruck: [5.68, 2.03],
};
export const garageVehicleSize = (id) => { const c = carById(id), [length, width] = SHAPES[c?.shape] ?? [4.5, 1.85]; return { length, width }; };

export const G = Object.freeze({
  LANE: 6.4, // the driveway: room for two cars to pass, and for the widest vehicle to swing out of a bay
  GATE: 7.2, // the gap in the front wall
  PITCH: 4.2, // distance between bays along the lane
  NOSE: 0.7, // how far a parked car's nose stands back from the lane edge
  BAY_D: 6.6, // depth of a bay, from the lane edge to the back wheel stop
  WALL: 0.4, // thickness of the compound wall
  PAVEMENT: 2.2, // footpath between the front wall and the kerb
  ROAD: 8, // carriageway width
  HOUSE: 1.2, // clear space between the house frontage and the first bay
});

/** Two blocks of bays facing each other across the driveway; the compound deepens as the collection grows. */
export function garageLayout(vehicles = []) {
  const count = vehicles.length, perSide = Math.max(2, Math.ceil(count / 2)), laneHalf = G.LANE / 2;
  const halfW = laneHalf + G.NOSE + G.BAY_D + 1.4, zTop = 0, bays0 = zTop + 0.55 + G.HOUSE + G.PITCH / 2;
  const frontZ = bays0 + (perSide - 1) * G.PITCH + G.PITCH / 2 + 4.5; // the front wall, with room to turn before the gate
  const roadZ0 = frontZ + G.WALL / 2 + G.PAVEMENT, roadZ1 = roadZ0 + G.ROAD, roadHalf = halfW + 14;
  // left-hand bays (x < 0) first, then right-hand ones. A car in a left bay faces +x (towards the lane): yaw +PI/2; a right-hand car faces -x.
  const slots = vehicles.map((v, i) => {
    const row = i % 2, col = Math.floor(i / 2), { length } = garageVehicleSize(v.modelId), side = row === 0 ? -1 : 1;
    return { ...v, x: side * (laneHalf + G.NOSE + length / 2), z: bays0 + col * G.PITCH, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2, row, col };
  });
  const posts = []; // the carport posts stand between bays at the back, behind the cars' tails, so nothing stands where a car swings out of its bay
  for (const side of [-1, 1]) for (let i = 0; i <= perSide; i++) posts.push({ x: side * (laneHalf + G.NOSE + G.BAY_D - 0.25), z: bays0 - G.PITCH / 2 + i * G.PITCH, r: 0.16 });
  return {
    slots, columns: perSide, rows: 2, perSide, width: halfW * 2, halfW, depth: roadZ1 - zTop, houseWidth: Math.min(halfW * 2 - 2, 18),
    zTop, houseZ: zTop + 0.55, frontZ, front: { z: frontZ, gate: [-G.GATE / 2, G.GATE / 2] }, laneHalf, lane: { x0: -laneHalf, x1: laneHalf, z0: zTop + 0.75, z1: roadZ0 },
    road: { x0: -roadHalf, x1: roadHalf, z0: roadZ0, z1: roadZ1 }, roadHalf, pavement: { z0: frontZ + G.WALL / 2, z1: roadZ0 },
    posts, bays0, center: { x: 0, z: (zTop + roadZ1) / 2 }, start: { x: 0, z: frontZ - 2.2 }, entranceZ: frontZ,
    bounds: { minX: -halfW + 0.8, maxX: halfW - 0.8, minZ: zTop + 0.55 + 0.8, maxZ: frontZ + 1.2 },
  };
}

/** A grid walk path that routes around parked cars and posts instead of cutting through them. The person may walk up to the gate and just outside it. */
export function garageWalkPath(from, to, layout, step = 0.5) {
  const { minX, maxX, minZ, maxZ } = layout.bounds, gate = layout.front.gate;
  const cell = (p) => [Math.round((p.x - minX) / step), Math.round((p.z - minZ) / step)], pos = (x, z) => ({ x: minX + x * step, z: minZ + z * step });
  const [sx, sz] = cell(from), [gx, gz] = cell(to), nx = Math.floor((maxX - minX) / step), nz = Math.floor((maxZ - minZ) / step);
  const blocked = (x, z) => {
    const p = pos(x, z);
    if (p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ) return true;
    if (p.z > layout.frontZ - 0.6 && (p.x < gate[0] + 0.5 || p.x > gate[1] - 0.5)) return true; // the front wall: only the gate is open
    for (const q of layout.posts) if (Math.hypot(p.x - q.x, p.z - q.z) < q.r + 0.45) return true;
    return layout.slots.some((v) => { const { length, width: w } = garageVehicleSize(v.modelId); return Math.abs(p.x - v.x) < length / 2 + 0.55 && Math.abs(p.z - v.z) < w / 2 + 0.55; });
  };
  const key = (x, z) => `${x},${z}`, start = key(sx, sz), goal = key(gx, gz), came = new Map([[start, null]]), q = [[sx, sz]];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < q.length && !came.has(goal); i++) {
    const [x, z] = q[i];
    for (const [dx, dz] of dirs) {
      const a = x + dx, b = z + dz, k = key(a, b);
      if (a < 0 || b < 0 || a > nx || b > nz || came.has(k) || blocked(a, b)) continue;
      if (dx && dz && (blocked(x + dx, z) || blocked(x, z + dz))) continue; // never cut a corner
      came.set(k, key(x, z)); q.push([a, b]);
    }
  }
  if (!came.has(goal)) return [];
  const path = []; let k = goal; while (k) { const [x, z] = k.split(",").map(Number); path.push(pos(x, z)); k = came.get(k); }
  return path.reverse();
}
