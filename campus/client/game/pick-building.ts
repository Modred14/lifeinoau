import { BUILDINGS, GRID_CELL, GRID_W, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, buildingCells, pointInPoly, type Building, type Place } from "@campuslife/shared";
import { toMap } from "./coords";

export interface Ray {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

export interface PickedBuilding {
  building: Building;
  place: Place;
}

const STEP_METERS = 0.5;
const MAX_RAY_METERS = 900;
const TALLEST = BUILDINGS.reduce((top, b) => Math.max(top, b.height), 0);

const placeByBuilding = new Map<number, Place>();
const placeByName = new Map<string, Place>();
for (const place of PLACES) {
  placeByName.set(place.name, place);
  if (place.building !== undefined && !placeByBuilding.has(place.building)) placeByBuilding.set(place.building, place);
}

function placeOf(building: Building): Place | undefined {
  const known = placeByBuilding.get(building.id) ?? (building.site ? placeByName.get(building.site) : undefined);
  if (known) return known;
  return PLACES.find((place) => pointInPoly(place.label.x, place.label.y, building.poly));
}

function buildingAt(x: number, y: number, height: number): Building | undefined {
  const cell = buildingCells[Math.floor(y / GRID_CELL) * GRID_W + Math.floor(x / GRID_CELL)];
  if (!cell) return undefined;
  for (const id of cell) {
    const b = BUILDINGS[id];
    const box = b.bbox;
    if (height > b.height || x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) continue;
    if (pointInPoly(x, y, b.poly)) return b;
  }
  return undefined;
}

export function pickBuilding(ray: Ray): PickedBuilding | null {
  const { origin, direction } = ray;
  if (direction.y >= 0) return null;
  const toGround = -origin.y / direction.y;
  const from = Math.max(0, (TALLEST - origin.y) / direction.y);
  const until = Math.min(toGround, from + MAX_RAY_METERS);
  for (let t = from; t <= until; t += STEP_METERS) {
    const height = origin.y + direction.y * t;
    const x = toMap(origin.x + direction.x * t);
    const y = toMap(origin.z + direction.z * t);
    if (x < 0 || y < 0 || x >= MAP_WIDTH_PX || y >= MAP_HEIGHT_PX) continue;
    const building = buildingAt(x, y, height);
    if (!building) continue;
    const place = placeOf(building);
    return place ? { building, place } : null;
  }
  return null;
}
