import { PLACES, PX_PER_METER, ROADS, type Place } from "@campuslife/shared";

const M = PX_PER_METER;

export const BED_SIZE = { radiusX: 4.8, radiusZ: 2.1 };

export interface FlowerBed {
  x: number;
  y: number;
  yaw: number;
  place: string;
}

const TARGETS: readonly [string, number][] = [
  ["oduduwa-hall", 2],
  ["student-union-building", 2],
  ["amphi-theatre", 1],
  ["hezekiah-oluwasanmi-library", 2],
  ["university-senate-building", 1],
  ["faculty-of-law", 1],
  ["faculty-of-education", 1],
  ["faculty-of-technology", 1],
  ["faculty-of-pharmacy", 1],
  ["1000-seater-lecture-theatre", 1],
  ...PLACES.filter((p) => p.kind === "hostel").map((p): [string, number] => [p.id, 1]),
  ["main-gate", 2],
];

export function bedPoint(bed: FlowerBed, x: number, z: number): { x: number; y: number } {
  const c = Math.cos(bed.yaw);
  const s = Math.sin(bed.yaw);
  return { x: bed.x + (x * c + z * s) * M, y: bed.y + (-x * s + z * c) * M };
}

export function insideBed(bed: FlowerBed, x: number, y: number, margin = 0): boolean {
  const dx = (x - bed.x) / M;
  const dz = (y - bed.y) / M;
  const c = Math.cos(bed.yaw);
  const s = Math.sin(bed.yaw);
  return ((dx * c - dz * s) / (BED_SIZE.radiusX + margin)) ** 2 + ((dx * s + dz * c) / (BED_SIZE.radiusZ + margin)) ** 2 <= 1;
}

function candidates(place: Place): FlowerBed[] {
  const out: FlowerBed[] = [];
  for (const road of ROADS)
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const ax = road.pts[i], ay = road.pts[i + 1];
      const dx = road.pts[i + 2] - ax, dy = road.pts[i + 3] - ay;
      const length = Math.hypot(dx, dy);
      if (length < 8 * M) continue;
      const t = Math.max(0, Math.min(1, ((place.door.x - ax) * dx + (place.door.y - ay) * dy) / length ** 2));
      if (Math.hypot(ax + dx * t - place.door.x, ay + dy * t - place.door.y) > 50 * M) continue;
      for (const offset of [0, -9, 9, -17, 17, -25, 25]) {
        const along = Math.max(0, Math.min(1, t + offset * M / length));
        for (const side of [-1, 1]) {
          const verge = side * (road.width / 2 + (BED_SIZE.radiusZ + 2.8) * M);
          const x = ax + dx * along - dy / length * verge;
          const y = ay + dy * along + dx / length * verge;
          const distance = Math.hypot(x - place.door.x, y - place.door.y);
          if (distance < 12 * M || distance > 50 * M) continue;
          out.push({ x, y, yaw: -Math.atan2(dy, dx), place: place.id });
        }
      }
    }
  return out.sort((a, b) => Math.hypot(a.x - place.door.x, a.y - place.door.y) - Math.hypot(b.x - place.door.x, b.y - place.door.y));
}

export function planFlowerBeds(clear: (x: number, y: number) => boolean): FlowerBed[] {
  const beds: FlowerBed[] = [];
  const fits = (bed: FlowerBed) => {
    if (beds.some((b) => Math.hypot(b.x - bed.x, b.y - bed.y) < 15 * M)) return false;
    for (let x = -BED_SIZE.radiusX; x <= BED_SIZE.radiusX + 0.01; x += 1.2)
      for (let z = -BED_SIZE.radiusZ; z <= BED_SIZE.radiusZ + 0.01; z += 0.7) {
        const at = bedPoint(bed, x, z);
        if (!clear(at.x, at.y)) return false;
      }
    return true;
  };
  for (const [id, count] of TARGETS) {
    const place = PLACES.find((p) => p.id === id);
    if (!place) continue;
    let made = 0;
    for (const candidate of candidates(place)) {
      if (!fits(candidate)) continue;
      beds.push(candidate);
      if (++made === count) break;
    }
  }
  return beds;
}
