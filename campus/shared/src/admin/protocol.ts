import { HUSTLE_IDS, sanitizeAdminRecord, type AdminRecord, type HustleId } from "./record";

export type AdminAction =
  | { a: "sync" }
  | { a: "register" }
  | { a: "centre" }
  | { a: "ballot"; hall: number }
  | { a: "handout"; code: string }
  | { a: "copy"; code: string }
  | { a: "hustle"; id: HustleId }
  | { a: "stop" };

export interface AdminShift {
  id: HustleId;
  left: number;
}

export interface AdminPayload {
  department: string;
  level: string;
  record: AdminRecord;
  shift?: AdminShift;
}

const MAX_CODE_LENGTH = 12;
const MAX_SHIFT_SECONDS = 600;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHustle = (v: unknown): v is HustleId => typeof v === "string" && (HUSTLE_IDS as readonly string[]).includes(v);
const isCode = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_CODE_LENGTH;

export function parseAdminAction(raw: unknown): AdminAction | undefined {
  if (!isObject(raw)) return undefined;
  switch (raw.a) {
    case "sync":
      return { a: "sync" };
    case "register":
      return { a: "register" };
    case "centre":
      return { a: "centre" };
    case "stop":
      return { a: "stop" };
    case "ballot":
      return typeof raw.hall === "number" && Number.isInteger(raw.hall) && raw.hall >= 0 ? { a: "ballot", hall: raw.hall } : undefined;
    case "handout":
      return isCode(raw.code) ? { a: "handout", code: raw.code } : undefined;
    case "copy":
      return isCode(raw.code) ? { a: "copy", code: raw.code } : undefined;
    case "hustle":
      return isHustle(raw.id) ? { a: "hustle", id: raw.id } : undefined;
    default:
      return undefined;
  }
}

export function parseAdminPayload(raw: unknown): AdminPayload | undefined {
  if (!isObject(raw) || typeof raw.department !== "string" || typeof raw.level !== "string") return undefined;
  const shift = isObject(raw.shift) && isHustle(raw.shift.id) && typeof raw.shift.left === "number" ? { id: raw.shift.id, left: Math.max(0, Math.min(MAX_SHIFT_SECONDS, raw.shift.left)) } : undefined;
  return { department: raw.department, level: raw.level, record: sanitizeAdminRecord(raw.record), shift };
}
