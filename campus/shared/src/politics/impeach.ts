import { MINUTES_PER_DAY } from "../clock";
import { polRandom } from "./seed";

export const IMPEACH = {
  threshold: 300,
  playerWeight: 40,
  npc: [60, 200] as readonly [number, number],
  idleAfter: 2 * MINUTES_PER_DAY,
  idleBoost: 80,
  turnoutBoost: 60,
  house: 31,
  removeShare: 2 / 3,
  lean: 0.5,
  idleNudge: 0.18,
  turnoutNudge: 0.1,
  workedNudge: -0.12,
} as const;

export const IMPEACH_PREFIX = "imp:";
export const impeachMark = (race: string): string => `${IMPEACH_PREFIX}${race}`;

export interface HolderRecord {
  usedPower: boolean;
  turnoutFell: boolean;
  minutesInOffice: number;
}

const idle = (record: HolderRecord): boolean => !record.usedPower && record.minutesInOffice >= IMPEACH.idleAfter;

export function npcSignatures(term: number, race: string, record: HolderRecord): number {
  const base = IMPEACH.npc[0] + polRandom(`signatures:${term}:${race}`)() * (IMPEACH.npc[1] - IMPEACH.npc[0]);
  return Math.round(base + (idle(record) ? IMPEACH.idleBoost : 0) + (record.turnoutFell ? IMPEACH.turnoutBoost : 0));
}

export function signatureTotal(term: number, race: string, record: HolderRecord, real: number): number {
  return npcSignatures(term, race, record) + Math.max(0, Math.floor(real)) * IMPEACH.playerWeight;
}

export const sittingDue = (signatures: number): boolean => signatures >= IMPEACH.threshold;
export const votesToRemove = (): number => Math.ceil(IMPEACH.house * IMPEACH.removeShare);

export function removeChance(record: HolderRecord): number {
  const nudge = (idle(record) ? IMPEACH.idleNudge : 0) + (record.turnoutFell ? IMPEACH.turnoutNudge : 0) + (record.usedPower ? IMPEACH.workedNudge : 0);
  return Math.max(0, Math.min(1, IMPEACH.lean + nudge));
}

const NPC_WORK_RATE = 0.6;
export const npcWorked = (term: number, race: string): boolean => polRandom(`npc-work:${term}:${race}`)() < NPC_WORK_RATE;

export interface SrcVote {
  remove: number;
  keep: number;
  removed: boolean;
}

export function srcSitting(term: number, race: string, record: HolderRecord): SrcVote {
  const rand = polRandom(`src:${term}:${race}`);
  const chance = removeChance(record);
  let remove = 0;
  for (let seat = 0; seat < IMPEACH.house; seat++) if (rand() < chance) remove++;
  return { remove, keep: IMPEACH.house - remove, removed: remove >= votesToRemove() };
}

export function verdictLine(title: string, ousted: string, successor: string, vote: SrcVote): string {
  if (!vote.removed) return `⚖️ The SRC sat on the petition against ${ousted}, ${title}. Remove ${vote.remove}, keep ${vote.keep}. The house cleared them.`;
  return `⚖️ The SRC has removed ${ousted} as ${title} by ${vote.remove} votes to ${vote.keep}. ${successor} takes over.`;
}
