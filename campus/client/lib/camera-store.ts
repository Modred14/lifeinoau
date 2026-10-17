import { STORAGE_KEYS } from "@campus/lib/storage";

export interface SavedCamera {
  yaw: number;
  pitch: number;
  zoom: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function loadCamera(): SavedCamera | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.camera);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const { yaw, pitch, zoom } = data as Record<string, unknown>;
    if (!finite(yaw) || !finite(pitch) || !finite(zoom) || zoom <= 0) return null;
    return { yaw, pitch, zoom };
  } catch {
    return null;
  }
}

export function saveCamera(camera: SavedCamera) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.camera, JSON.stringify(camera));
  } catch {
    /* storage unavailable */
  }
}
