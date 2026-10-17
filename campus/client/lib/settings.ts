import { STORAGE_KEYS } from "./storage";

export interface ControlSettings {
  keyboard: boolean;
  tapToWalk: boolean;
  invertY: boolean;
  sensitivity: number;
}

export const SENSITIVITY_MIN = 0.4;
export const SENSITIVITY_MAX = 2;
export const SENSITIVITY_STEP = 0.1;

export const DEFAULT_CONTROLS: ControlSettings = {
  keyboard: true,
  tapToWalk: true,
  invertY: false,
  sensitivity: 1,
};

function flag(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function loadControls(): ControlSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.controls);
    if (!raw) return { ...DEFAULT_CONTROLS };
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return { ...DEFAULT_CONTROLS };
    const saved = data as Record<string, unknown>;
    const sensitivity = typeof saved.sensitivity === "number" && Number.isFinite(saved.sensitivity) ? saved.sensitivity : DEFAULT_CONTROLS.sensitivity;
    return {
      keyboard: flag(saved.keyboard, DEFAULT_CONTROLS.keyboard),
      tapToWalk: flag(saved.tapToWalk, DEFAULT_CONTROLS.tapToWalk),
      invertY: flag(saved.invertY, DEFAULT_CONTROLS.invertY),
      sensitivity: Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, sensitivity)),
    };
  } catch {
    return { ...DEFAULT_CONTROLS };
  }
}

export function saveControls(settings: ControlSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.controls, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

export interface SoundSettings {
  enabled: boolean;
  volume: number;
}

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1;
export const VOLUME_STEP = 0.05;

export const DEFAULT_SOUND: SoundSettings = {
  enabled: true,
  volume: 0.6,
};

export function parseSound(raw: string | null | undefined): SoundSettings {
  if (!raw) return { ...DEFAULT_SOUND };
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return { ...DEFAULT_SOUND };
    const saved = data as Record<string, unknown>;
    const volume = typeof saved.volume === "number" && Number.isFinite(saved.volume) ? saved.volume : DEFAULT_SOUND.volume;
    return {
      enabled: flag(saved.enabled, DEFAULT_SOUND.enabled),
      volume: Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, volume)),
    };
  } catch {
    return { ...DEFAULT_SOUND };
  }
}

export function loadSound(): SoundSettings {
  try {
    return parseSound(window.localStorage.getItem(STORAGE_KEYS.sound));
  } catch {
    return { ...DEFAULT_SOUND };
  }
}

export function saveSound(settings: SoundSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.sound, JSON.stringify(settings));
  } catch {
    return;
  }
}
