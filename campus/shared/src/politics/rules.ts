import { LEVELS } from "../levels";
import { UNION_BODY_INFO, type UnionBody, type UnionPost } from "./posts";

const FEE_STEP_PER_LEVEL = 0.1;
const LATE_FEE_FACTOR = 1.5;
const FEE_ROUND = 50;
const MAX_LEVEL_RANK = 5;

export interface Aspirant {
  cgpa: number;
  exams: number;
  malpractice: number;
  rusticated: boolean;
  level: string;
  cash: number;
}

export type FormRefusal = "tests" | "cgpa" | "malpractice" | "rusticated" | "cash";

export function levelRank(level: string): number {
  for (const list of [LEVELS.university, LEVELS.polytechnic, LEVELS.college]) {
    const i = list.indexOf(level);
    if (i >= 0) return Math.min(MAX_LEVEL_RANK, i);
  }
  return 0;
}

export function formFee(post: UnionPost, level: string, late = false): number {
  const fee = post.fee * (1 + levelRank(level) * FEE_STEP_PER_LEVEL) * (late ? LATE_FEE_FACTOR : 1);
  return Math.round(fee / FEE_ROUND) * FEE_ROUND;
}

export type Screening = { ok: true; fee: number } | { ok: false; fee: number; reason: FormRefusal };

export function screenAspirant(post: UnionPost, a: Aspirant, late = false): Screening {
  const rule = UNION_BODY_INFO[post.body];
  const fee = formFee(post, a.level, late);
  if (a.rusticated) return { ok: false, fee, reason: "rusticated" };
  if (a.malpractice > 0) return { ok: false, fee, reason: "malpractice" };
  if (a.exams < rule.minTests) return { ok: false, fee, reason: "tests" };
  if (a.exams > 0 && a.cgpa < rule.minCgpa) return { ok: false, fee, reason: "cgpa" };
  if (a.cash < fee) return { ok: false, fee, reason: "cash" };
  return { ok: true, fee };
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export function refusalText(post: UnionPost, s: Extract<Screening, { ok: false }>): string {
  const rule = UNION_BODY_INFO[post.body];
  if (s.reason === "rusticated") return "SUIEC screening: a rusticated student cannot contest.";
  if (s.reason === "malpractice") return "SUIEC screening: you have an exam malpractice case on record.";
  if (s.reason === "tests") return "SUIEC screening: write at least one test first so they can see your CGPA.";
  if (s.reason === "cgpa") return `SUIEC screening: ${post.title} needs a CGPA of ${rule.minCgpa.toFixed(2)} or better.`;
  return `The ${post.title} form costs ${naira(s.fee)}. You no get reach.`;
}

export const CAMPAIGN = {
  energy: 8,
  cost: 100,
  gain: 12,
  hallCap: 60,
  rallyFactor: 2,
  cooldownMs: 6000,
  debateBonus: 40,
  speechMs: 4000,
  fade: 0.6,
  minGain: 1,
} as const;

export const CAMPAIGN_TRAIN = {
  windowMs: 20_000,
  bonus: 10,
  cap: 40,
  key: "train",
} as const;

export const stopKey = (site: string, weekday: number): string => `${site}:${weekday}`;

export const DEBATE_FUN = 12;
export const ALUTA_FUN = 15;
export const PACKS_MAX = 9;

export interface CampaignMaterial {
  id: string;
  name: string;
  price: number;
  reach: number;
}

export const CAMPAIGN_MATERIALS: readonly CampaignMaterial[] = [
  { id: "posters", name: "Posters and handbills", price: 500, reach: 0.15 },
  { id: "banner", name: "Flex banner", price: 1500, reach: 0.25 },
  { id: "van", name: "Campaign jingle van", price: 4000, reach: 0.4 },
];

export const findMaterial = (id: unknown): CampaignMaterial | undefined => (typeof id === "string" ? CAMPAIGN_MATERIALS.find((m) => m.id === id) : undefined);
export const reachOf = (materials: readonly string[]): number => 1 + CAMPAIGN_MATERIALS.filter((m) => materials.includes(m.id)).reduce((sum, m) => sum + m.reach, 0);

export function campaignGain(body: UnionBody, current: number, atRally: boolean, stopsToday = 0): number {
  const scale = UNION_BODY_INFO[body].scale;
  const cap = Math.round(CAMPAIGN.hallCap * scale);
  const fresh = CAMPAIGN.gain * scale * (atRally ? CAMPAIGN.rallyFactor : 1);
  const gain = Math.max(CAMPAIGN.minGain, Math.round(fresh * CAMPAIGN.fade ** Math.max(0, stopsToday)));
  return Math.max(0, Math.min(gain, cap - current));
}

export function trainBonus(body: UnionBody, current: number): number {
  const scale = UNION_BODY_INFO[body].scale;
  return Math.max(0, Math.min(Math.round(CAMPAIGN_TRAIN.bonus * scale), Math.round(CAMPAIGN_TRAIN.cap * scale) - current));
}

export function effortOf(body: UnionBody, support: Readonly<Record<string, number>>, materials: readonly string[], spoke: boolean): number {
  const ground = Object.values(support).reduce((sum, v) => sum + v, 0);
  const stage = spoke ? CAMPAIGN.debateBonus * UNION_BODY_INFO[body].scale : 0;
  return Math.round((ground + stage) * reachOf(materials));
}
