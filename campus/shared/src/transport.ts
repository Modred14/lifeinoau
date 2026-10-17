import data from "./data/school-transport.json";
import { PX_PER_METER } from "./map";

export const TRAVEL_MODES = ["walk", "okada", "keke", "shuttle", "bus"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const PAID_MODES = ["okada", "keke", "shuttle", "bus"] as const;
export type PaidMode = (typeof PAID_MODES)[number];
export const HAIL_MODES = ["okada", "keke"] as const;
export type HailMode = (typeof HAIL_MODES)[number];

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  walk: "Trek",
  okada: "Okada",
  keke: "Keke",
  shuttle: "Shuttle",
  bus: "Bus",
};

export const FARE_STEP = 50;
export const FARE_MIN = 100;
export const FARE_MAX = 400;
export const FARE_LIMIT = 100_000;
export const HAIL_POOL: Record<HailMode, number> = { okada: 6, keke: 4 };
export const HAIL_SLOTS = HAIL_POOL.okada + HAIL_POOL.keke;
export const HAIL_MIN_RIDE_PX = 120 * PX_PER_METER;
export const HAIL_BOARD_PX = 16 * PX_PER_METER;
export const HAIL_WAIT_SECONDS = 60;
export const HAIL_COOLDOWN_MS = 2000;
export const TRAVEL_CHOICE_MIN_PX = 150 * PX_PER_METER;
export const TRANSPORT_DEFAULT_SOURCE = "default";
export const TRANSPORT_DATABASE_SOURCE = "database";

export interface FareRule {
  base: number;
  perKm: number;
  max: number;
}

export type FareTable = Record<PaidMode, FareRule>;

export interface TransportEntry {
  modes?: TravelMode[];
  fares?: Partial<FareTable>;
  verified: boolean;
  source: string;
  sourceDate?: string;
  confidence?: string;
  note?: string;
}

export interface TransportData {
  default: TransportEntry & { modes: TravelMode[]; fares: FareTable };
  byType: Record<string, TransportEntry>;
  byState: Record<string, TransportEntry>;
  schools: Record<string, TransportEntry>;
}

export interface TransportOverride {
  schoolId: string;
  modes: TravelMode[] | null;
  fares: Partial<FareTable> | null;
  enabled: boolean;
}

export interface TransportConfig {
  school: string;
  modes: TravelMode[];
  fares: FareTable;
  verified: boolean;
  source: string;
}

export interface TransportSchool {
  id: string;
  type?: string;
  state?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isTravelMode(v: unknown): v is TravelMode {
  return typeof v === "string" && (TRAVEL_MODES as readonly string[]).includes(v);
}

export function isPaidMode(v: unknown): v is PaidMode {
  return typeof v === "string" && (PAID_MODES as readonly string[]).includes(v);
}

export function isHailMode(v: unknown): v is HailMode {
  return typeof v === "string" && (HAIL_MODES as readonly string[]).includes(v);
}

const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= FARE_LIMIT;

export function isFareRule(v: unknown): v is FareRule {
  return isRecord(v) && isAmount(v.base) && isAmount(v.perKm) && isAmount(v.max) && v.max >= v.base;
}

export function parseModes(v: unknown): TravelMode[] | null {
  if (!Array.isArray(v) || !v.length || !v.every(isTravelMode)) return null;
  const set = new Set<TravelMode>(v);
  set.add("walk");
  return TRAVEL_MODES.filter((m) => set.has(m));
}

export function parseFares(v: unknown): Partial<FareTable> | null {
  if (!isRecord(v)) return null;
  const out: Partial<FareTable> = {};
  for (const [mode, rule] of Object.entries(v)) {
    if (!isPaidMode(mode) || !isFareRule(rule)) return null;
    out[mode] = { base: rule.base, perKm: rule.perKm, max: rule.max };
  }
  return out;
}

export function parseTransportEntry(v: unknown): TransportEntry | null {
  if (!isRecord(v) || typeof v.verified !== "boolean" || typeof v.source !== "string" || !v.source) return null;
  const entry: TransportEntry = { verified: v.verified, source: v.source };
  if (v.modes !== undefined) {
    const modes = parseModes(v.modes);
    if (!modes) return null;
    entry.modes = modes;
  }
  if (v.fares !== undefined) {
    const fares = parseFares(v.fares);
    if (!fares) return null;
    entry.fares = fares;
  }
  for (const key of ["sourceDate", "confidence", "note"] as const) {
    const text = v[key];
    if (text === undefined) continue;
    if (typeof text !== "string") return null;
    entry[key] = text;
  }
  return entry;
}

export function parseTransportOverride(row: unknown): TransportOverride | null {
  if (!isRecord(row) || typeof row.schoolId !== "string" || !row.schoolId || typeof row.enabled !== "boolean") return null;
  const modes = row.modes === null || row.modes === undefined ? null : parseModes(row.modes);
  const fares = row.fares === null || row.fares === undefined ? null : parseFares(row.fares);
  if ((row.modes !== null && row.modes !== undefined && !modes) || (row.fares !== null && row.fares !== undefined && !fares)) return null;
  return { schoolId: row.schoolId, modes, fares, enabled: row.enabled };
}

function parseEntries(v: unknown, label: string): Record<string, TransportEntry> {
  if (!isRecord(v)) throw new Error(`school-transport.json: ${label} must be an object`);
  const out: Record<string, TransportEntry> = {};
  for (const [key, raw] of Object.entries(v)) {
    const entry = parseTransportEntry(raw);
    if (!entry) throw new Error(`school-transport.json: bad entry ${label}.${key}`);
    out[key] = entry;
  }
  return out;
}

export function parseTransportData(v: unknown): TransportData {
  if (!isRecord(v)) throw new Error("school-transport.json: must be an object");
  const base = parseTransportEntry(v.default);
  const fares = base?.fares;
  if (!base || !base.modes || !fares || !PAID_MODES.every((m) => fares[m])) throw new Error("school-transport.json: default needs modes and a fare for every paid mode");
  return {
    default: { ...base, modes: base.modes, fares: fares as FareTable },
    byType: parseEntries(v.byType, "byType"),
    byState: parseEntries(v.byState, "byState"),
    schools: parseEntries(v.schools, "schools"),
  };
}

export const TRANSPORT_DATA: TransportData = parseTransportData(data);

export type TransportOverrides = ReadonlyMap<string, TransportOverride>;

export function transportFor(school: TransportSchool | string | null | undefined, overrides?: TransportOverrides, source: TransportData = TRANSPORT_DATA): TransportConfig {
  const ref: TransportSchool = typeof school === "string" ? { id: school } : (school ?? { id: "" });
  const base = source.default;
  const config: TransportConfig = { school: ref.id, modes: [...base.modes], fares: { ...base.fares }, verified: base.verified, source: base.source };
  const layers = [ref.type ? source.byType[ref.type] : undefined, ref.state ? source.byState[ref.state] : undefined, ref.id ? source.schools[ref.id] : undefined];
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.modes) config.modes = [...layer.modes];
    if (layer.fares) config.fares = { ...config.fares, ...layer.fares };
    config.verified = layer.verified;
    config.source = layer.source;
  }
  const override = ref.id ? overrides?.get(ref.id) : undefined;
  if (override?.enabled) {
    if (override.modes) config.modes = [...override.modes];
    if (override.fares) config.fares = { ...config.fares, ...override.fares };
    config.source = TRANSPORT_DATABASE_SOURCE;
  }
  return config;
}

export const DEFAULT_TRANSPORT: TransportConfig = transportFor(null);

export function parseTransportConfig(v: unknown): TransportConfig | null {
  if (!isRecord(v) || typeof v.school !== "string" || typeof v.verified !== "boolean" || typeof v.source !== "string") return null;
  const modes = parseModes(v.modes);
  const fares = parseFares(v.fares);
  if (!modes || !fares || !PAID_MODES.every((m) => fares[m])) return null;
  return { school: v.school, modes, fares: fares as FareTable, verified: v.verified, source: v.source };
}

export const allowsMode = (config: TransportConfig, mode: TravelMode) => mode === "walk" || config.modes.includes(mode);

export function fareFor(config: TransportConfig, mode: PaidMode, distancePx = 0): number {
  const rule = config.fares[mode];
  const km = Math.max(0, distancePx) / PX_PER_METER / 1000;
  const raw = Math.round((rule.base + rule.perKm * km) / FARE_STEP) * FARE_STEP;
  const low = Math.min(FARE_MAX, Math.max(FARE_MIN, rule.base));
  const high = Math.min(FARE_MAX, Math.max(low, rule.max));
  return Math.min(high, Math.max(low, raw));
}

export function partFare(config: TransportConfig, mode: PaidMode, fare: number, share: number): number {
  const part = Math.round((fare * Math.min(1, Math.max(0, share))) / FARE_STEP) * FARE_STEP;
  return Math.min(fare, Math.max(Math.min(fare, fareFor(config, mode)), part));
}

export type HailRefusal = "mode" | "banned" | "inside" | "riding" | "hailing" | "none" | "unreachable" | "near" | "cash";

export interface HailRequest {
  mode: unknown;
  cash: number;
  riding: boolean;
  driving: boolean;
  inside: boolean;
  hailing: boolean;
  rideDistancePx: number | null;
  freeVehicle: boolean;
}

export type HailDecision = { ok: true; mode: HailMode; fare: number } | { ok: false; reason: HailRefusal; mode?: HailMode; fare?: number };

export function checkHail(config: TransportConfig, req: HailRequest): HailDecision {
  if (!isHailMode(req.mode)) return { ok: false, reason: "mode" };
  const mode = req.mode;
  if (!allowsMode(config, mode)) return { ok: false, reason: "banned", mode };
  if (req.inside) return { ok: false, reason: "inside", mode };
  if (req.riding || req.driving) return { ok: false, reason: "riding", mode };
  if (req.hailing) return { ok: false, reason: "hailing", mode };
  if (req.rideDistancePx === null) return { ok: false, reason: "unreachable", mode };
  if (req.rideDistancePx < HAIL_MIN_RIDE_PX) return { ok: false, reason: "near", mode };
  const fare = fareFor(config, mode, req.rideDistancePx);
  if (req.cash < fare) return { ok: false, reason: "cash", mode, fare };
  if (!req.freeVehicle) return { ok: false, reason: "none", mode, fare };
  return { ok: true, mode, fare };
}

export function hailRefusalText(reason: HailRefusal, mode?: HailMode, fare?: number): string {
  const ride = mode ? TRAVEL_MODE_LABEL[mode].toLowerCase() : "ride";
  switch (reason) {
    case "mode":
      return "Pick okada or keke.";
    case "banned":
      return `Your school does not allow ${ride} on campus.`;
    case "inside":
      return `Step outside to call ${mode === "okada" ? "an okada" : "a keke"}.`;
    case "riding":
      return "Get down first.";
    case "hailing":
      return "You already called a ride.";
    case "none":
      return `No free ${ride} right now. Try again soon.`;
    case "unreachable":
      return "No road goes there.";
    case "near":
      return "That is close. Just walk.";
    case "cash":
      return `The fare is ₦${fare ?? 0}. You no get money.`;
  }
}

export interface HailPayload {
  x: number;
  y: number;
  mode: HailMode;
}

export const HAIL_PHASES = ["coming", "waiting", "riding", "arrived", "ended"] as const;
export type HailPhase = (typeof HAIL_PHASES)[number];

export interface HailUpdate {
  phase: HailPhase;
  mode: HailMode;
  fare: number;
  vehicle: number;
  pickup?: { x: number; y: number };
  drop?: { x: number; y: number };
}

function parseSpot(v: unknown): { x: number; y: number } | undefined {
  return isRecord(v) && typeof v.x === "number" && typeof v.y === "number" && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : undefined;
}

export function parseHailUpdate(v: unknown): HailUpdate | null {
  if (!isRecord(v) || !isHailMode(v.mode) || typeof v.fare !== "number" || typeof v.vehicle !== "number") return null;
  const phase = HAIL_PHASES.find((p) => p === v.phase);
  if (!phase) return null;
  return { phase, mode: v.mode, fare: v.fare, vehicle: v.vehicle, pickup: parseSpot(v.pickup), drop: parseSpot(v.drop) };
}

export function collectOverrides(rows: readonly unknown[], knownSchool: (id: string) => boolean, onBad: (row: unknown, why: string) => void): Map<string, TransportOverride> {
  const out = new Map<string, TransportOverride>();
  for (const row of rows) {
    const override = parseTransportOverride(row);
    if (!override) {
      onBad(row, "invalid modes, fares or flags");
      continue;
    }
    if (!knownSchool(override.schoolId)) {
      onBad(row, "unknown school id");
      continue;
    }
    out.set(override.schoolId, override);
  }
  return out;
}
