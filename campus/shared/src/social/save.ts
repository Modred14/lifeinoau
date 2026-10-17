export type TicketSave = [seconds: number, flags: number, moments: number, goals: number, day: number];

export interface PredictionSave {
  key: string;
  home: number;
  away: number;
}

export type SocialSave = {
  tickets?: Record<string, TicketSave>;
  club?: string;
  predict?: PredictionSave;
  signed?: string[];
  shirt?: number;
  shirtDay?: number;
  toast?: number;
  wins?: number;
  paid?: [week: number, count: number];
};

export const SOCIAL_LIMITS = { tickets: 48, signed: 64, keyLength: 32, goals: 9, counter: 9999 } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : undefined);
const key = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= SOCIAL_LIMITS.keyLength ? v : undefined);

function ticket(v: unknown): TicketSave | undefined {
  if (!Array.isArray(v) || v.length !== 5 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return [Math.max(0, v[0]), Math.max(0, Math.floor(v[1])), Math.max(0, Math.floor(v[2])), Math.max(0, Math.floor(v[3])), Math.floor(v[4])];
}

export function parseSocial(raw: unknown): SocialSave {
  const out: SocialSave = {};
  if (!isRecord(raw)) return out;
  if (isRecord(raw.tickets)) {
    const tickets: Record<string, TicketSave> = {};
    for (const [k, v] of Object.entries(raw.tickets).slice(-SOCIAL_LIMITS.tickets)) {
      const parsed = ticket(v);
      if (key(k) && parsed) tickets[k] = parsed;
    }
    out.tickets = tickets;
  }
  const club = key(raw.club);
  if (club) out.club = club;
  if (isRecord(raw.predict)) {
    const match = key(raw.predict.key);
    const home = whole(raw.predict.home, SOCIAL_LIMITS.goals);
    const away = whole(raw.predict.away, SOCIAL_LIMITS.goals);
    if (match && home !== undefined && away !== undefined) out.predict = { key: match, home, away };
  }
  if (Array.isArray(raw.signed)) out.signed = raw.signed.filter((s): s is string => key(s) !== undefined).slice(-SOCIAL_LIMITS.signed);
  for (const field of ["shirt", "shirtDay", "toast", "wins"] as const) {
    const n = whole(raw[field], field === "shirt" || field === "wins" ? SOCIAL_LIMITS.counter : Number.MAX_SAFE_INTEGER);
    if (n !== undefined) out[field] = n;
  }
  if (Array.isArray(raw.paid) && raw.paid.length === 2) {
    const count = whole(raw.paid[1], SOCIAL_LIMITS.counter);
    if (typeof raw.paid[0] === "number" && Number.isInteger(raw.paid[0]) && count !== undefined) out.paid = [raw.paid[0], count];
  }
  return out;
}
