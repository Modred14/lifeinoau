import { STORAGE_KEYS } from "@campus/lib/storage";

export interface ResumeDetails {
  name: string;
  school: string;
  level: string;
  department: string;
}

const FIELDS = ["name", "school", "level", "department"] as const;

export function loadResume(): ResumeDetails | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.resume);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const saved = data as Record<string, unknown>;
    if (!FIELDS.every((field) => typeof saved[field] === "string") || !saved.name) return null;
    const { name, school, level, department } = saved as unknown as ResumeDetails;
    return { name, school, level, department };
  } catch {
    return null;
  }
}

export function saveResume(details: ResumeDetails) {
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.resume, JSON.stringify(details));
  } catch {
    /* storage unavailable */
  }
}

export function clearResume() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEYS.resume);
  } catch {
    /* storage unavailable */
  }
}
