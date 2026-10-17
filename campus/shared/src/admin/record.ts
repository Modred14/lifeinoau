export type HustleId = "typing" | "tray" | "hair";
export const HUSTLE_IDS: readonly HustleId[] = ["typing", "tray", "hair"];

export type RegistrationVia = "portal" | "centre";

export type AdminResult = {
  week: number;
  weekday: number;
  code: string;
  title: string;
  units: number;
  score: number;
};

export type AdminRecord = {
  reg: { week: number; late: boolean; by: RegistrationVia } | null;
  bed: { week: number; hall: string } | null;
  ballot: { week: number; from: number; tried: boolean };
  raided: number;
  handouts: { week: number; held: string[]; rep: string[]; credited: number[] };
  results: AdminResult[];
  carry: { code: string; week: number }[];
  hustle: { day: number; done: Record<HustleId, number> };
  skills: Record<HustleId, number>;
};

const NEVER = -1;
const MAX_CODE_LENGTH = 12;
const MAX_NAME_LENGTH = 80;
const MAX_HANDOUTS = 16;
const MAX_CREDITED = 40;
const MAX_CARRY = 8;
const MAX_SKILL = 100;
const MAX_SCORE = 100;
const MAX_UNITS = 6;
const LAST_WEEKDAY = 6;
export const ADMIN_RESULTS_KEPT = 15;

export function emptyAdminRecord(): AdminRecord {
  return {
    reg: null,
    bed: null,
    ballot: { week: NEVER, from: 0, tried: false },
    raided: NEVER,
    handouts: { week: NEVER, held: [], rep: [], credited: [] },
    results: [],
    carry: [],
    hustle: { day: NEVER, done: { typing: 0, tray: 0, hair: 0 } },
    skills: { typing: 0, tray: 0, hair: 0 },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback);
const text = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const codes = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((c): c is string => text(c, MAX_CODE_LENGTH) !== undefined))].slice(0, MAX_HANDOUTS) : []);

function perHustle(raw: unknown, max: number): Record<HustleId, number> {
  const from = isObject(raw) ? raw : {};
  return { typing: int(from.typing, 0, 0, max), tray: int(from.tray, 0, 0, max), hair: int(from.hair, 0, 0, max) };
}

function resultOf(raw: unknown): AdminResult | undefined {
  if (!isObject(raw)) return undefined;
  const code = text(raw.code, MAX_CODE_LENGTH);
  const title = text(raw.title, MAX_NAME_LENGTH);
  if (!code || !title || typeof raw.week !== "number") return undefined;
  return { week: int(raw.week, 0), weekday: int(raw.weekday, 0, 0, LAST_WEEKDAY), code, title, units: int(raw.units, 1, 1, MAX_UNITS), score: int(raw.score, 0, 0, MAX_SCORE) };
}

export function sanitizeAdminRecord(raw: unknown): AdminRecord {
  const out = emptyAdminRecord();
  if (!isObject(raw)) return out;
  if (isObject(raw.reg) && typeof raw.reg.week === "number") out.reg = { week: int(raw.reg.week, 0), late: raw.reg.late === true, by: raw.reg.by === "centre" ? "centre" : "portal" };
  if (isObject(raw.bed)) {
    const hall = text(raw.bed.hall, MAX_NAME_LENGTH);
    if (hall && typeof raw.bed.week === "number") out.bed = { week: int(raw.bed.week, 0), hall };
  }
  if (isObject(raw.ballot)) out.ballot = { week: int(raw.ballot.week, NEVER), from: int(raw.ballot.from, 0), tried: raw.ballot.tried === true };
  out.raided = int(raw.raided, NEVER);
  if (isObject(raw.handouts)) {
    const held = codes(raw.handouts.held);
    const credited = Array.isArray(raw.handouts.credited) ? raw.handouts.credited.filter((n): n is number => typeof n === "number" && Number.isFinite(n)).slice(-MAX_CREDITED) : [];
    out.handouts = { week: int(raw.handouts.week, NEVER), held, rep: codes(raw.handouts.rep).filter((code) => held.includes(code)), credited };
  }
  if (Array.isArray(raw.results)) out.results = raw.results.map(resultOf).filter((r): r is AdminResult => r !== undefined).slice(-ADMIN_RESULTS_KEPT);
  if (Array.isArray(raw.carry)) {
    for (const entry of raw.carry) {
      if (!isObject(entry) || out.carry.length >= MAX_CARRY) continue;
      const code = text(entry.code, MAX_CODE_LENGTH);
      if (code && typeof entry.week === "number" && !out.carry.some((c) => c.code === code && c.week === entry.week)) out.carry.push({ code, week: int(entry.week, 0) });
    }
  }
  if (isObject(raw.hustle)) out.hustle = { day: int(raw.hustle.day, NEVER), done: perHustle(raw.hustle.done, Number.MAX_SAFE_INTEGER) };
  out.skills = perHustle(raw.skills, MAX_SKILL);
  return out;
}

export function rollAdminWeek(record: AdminRecord, week: number): boolean {
  let changed = false;
  if (record.bed && record.bed.week !== week) {
    record.bed = null;
    changed = true;
  }
  if (record.reg && record.reg.week !== week) {
    record.reg = null;
    changed = true;
  }
  if (record.handouts.week !== week) {
    record.handouts = { week, held: [], rep: [], credited: [] };
    changed = true;
  }
  const carry = record.carry.filter((c) => c.week >= week);
  if (carry.length !== record.carry.length) {
    record.carry = carry;
    changed = true;
  }
  const results = record.results.filter((r) => r.week >= week - 1);
  if (results.length !== record.results.length) {
    record.results = results;
    changed = true;
  }
  return changed;
}
