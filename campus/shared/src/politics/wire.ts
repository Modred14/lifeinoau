import { parseCampusStates, type UnionState } from "./campus-state";
import type { PlayerCandidate } from "./candidates";
import type { CongressSitting } from "./congress";
import type { RaceResult } from "./count";
import { parseLook, type CampaignLook } from "./identity";
import type { GatheringSite } from "./posts";
import { parseRentedSpots, type RentedSpot } from "./rentals";
import type { UnitReturn } from "./results";

const ID_MAX = 80;

export type PoliticsAction =
  | { a: "status" }
  | { a: "form"; post: string; look: CampaignLook }
  | { a: "rent"; area: string }
  | { a: "celebrate" }
  | { a: "petition" }
  | { a: "relief" }
  | { a: "sign"; race: string }
  | { a: "campaign"; site: string }
  | { a: "material"; item: string }
  | { a: "endorse"; post: string; c: string }
  | { a: "vote"; post: string; c: string }
  | { a: "speak" }
  | { a: "attend" }
  | { a: "power" }
  | { a: "join"; g: string };

const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= ID_MAX;

export function parsePoliticsAction(payload: unknown): PoliticsAction | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  switch (p.a) {
    case "status":
      return { a: "status" };
    case "speak":
      return { a: "speak" };
    case "attend":
      return { a: "attend" };
    case "power":
      return { a: "power" };
    case "celebrate":
      return { a: "celebrate" };
    case "petition":
      return { a: "petition" };
    case "relief":
      return { a: "relief" };
    case "form": {
      const look = parseLook(p.nick, p.slogan, p.color);
      return text(p.post) && look ? { a: "form", post: p.post, look } : null;
    }
    case "rent":
      return text(p.area) ? { a: "rent", area: p.area } : null;
    case "sign":
      return text(p.race) ? { a: "sign", race: p.race } : null;
    case "campaign":
      return text(p.site) ? { a: "campaign", site: p.site } : null;
    case "material":
      return text(p.item) ? { a: "material", item: p.item } : null;
    case "endorse":
      return text(p.post) && text(p.c) ? { a: "endorse", post: p.post, c: p.c } : null;
    case "vote":
      return text(p.post) && text(p.c) ? { a: "vote", post: p.post, c: p.c } : null;
    case "join":
      return text(p.g) ? { a: "join", g: p.g } : null;
    default:
      return null;
  }
}

export interface MyCampaign {
  id: string;
  race: string;
  support: Record<string, number>;
  materials: string[];
  spoke: boolean;
  effort: number;
  look: CampaignLook;
  stops: Record<string, number>;
  rented: string[];
  speakingMs: number;
}

export interface RaceReturns {
  race: string;
  units: UnitReturn[];
}

export interface ImpeachmentView {
  race: string;
  ousted: string;
  successor: string;
  removed: boolean;
}

export type RaceOutcome = "" | "won" | "lost";

export interface OfficeHolderView {
  race: string;
  name: string;
  npc: boolean;
  mine: boolean;
}

export interface GatheringView {
  id: string;
  title: string;
  site: GatheringSite;
  until: number;
  fun: number;
}

export interface MyOffice {
  race: string;
  powerUsed: boolean;
}

export interface PoliticsStatus {
  ok: boolean;
  cycle: number;
  level: string;
  faculty: string;
  department: string;
  mine: MyCampaign | null;
  endorsed: string;
  voted: string[];
  marks: string[];
  players: PlayerCandidate[];
  endorsements: Record<string, number>;
  results: RaceResult[];
  holders: OfficeHolderView[];
  office: MyOffice | null;
  gatherings: GatheringView[];
  declared: boolean;
  returns: RaceReturns[];
  outcome: RaceOutcome;
  petitionFee: number;
  signed: string[];
  signatures: Record<string, number>;
  impeachments: ImpeachmentView[];
  claimed: string[];
}

export const candidateKey = (race: string, candidate: string): string => `${race}#${candidate}`;
export const formPayload = (post: string, look: CampaignLook) => ({ a: "form" as const, post, nick: look.nick, slogan: look.slogan, color: look.color });
export const DEBATE_MARK = "debate";
export const ALUTA_MARK = "aluta";
export const ALUTA_GATHERING = "aluta";
export const gatheringMark = (id: string): string => `g:${id}`;

export function parsePoliticsStatus(payload: unknown): PoliticsStatus | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Partial<PoliticsStatus>;
  const lists = [p.voted, p.marks, p.players, p.results, p.holders, p.gatherings];
  if (typeof p.cycle !== "number" || typeof p.ok !== "boolean" || lists.some((l) => !Array.isArray(l))) return null;
  if (typeof p.endorsements !== "object" || p.endorsements === null) return null;
  return p as PoliticsStatus;
}

export interface UnionWorld {
  cycle: number;
  rentals: RentedSpot[];
  states: UnionState[];
  called: CongressSitting | null;
}

function parseSitting(payload: unknown): CongressSitting | null {
  if (typeof payload !== "object" || payload === null) return null;
  const s = payload as Partial<CongressSitting>;
  return typeof s.id === "string" && typeof s.start === "number" && typeof s.motion === "string" ? { id: s.id, start: s.start, motion: s.motion, called: s.called === true } : null;
}

export function parseUnionWorld(payload: unknown): UnionWorld | null {
  if (typeof payload !== "object" || payload === null) return null;
  const w = payload as Partial<UnionWorld>;
  if (typeof w.cycle !== "number") return null;
  return { cycle: w.cycle, rentals: parseRentedSpots(w.rentals), states: parseCampusStates(w.states), called: parseSitting(w.called) };
}
