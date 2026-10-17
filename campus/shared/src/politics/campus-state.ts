import { MINUTES_PER_DAY } from "../clock";

export type CampusStateKind = "boycott" | "dialogue" | "protest" | "concession" | "standoff";
export const CAMPUS_STATE_KINDS: readonly CampusStateKind[] = ["boycott", "dialogue", "protest", "concession", "standoff"];

export interface UnionState {
  id: string;
  kind: CampusStateKind;
  issue: string;
  from: number;
  until: number;
  concession: string;
}

export interface Concession {
  id: string;
  label: string;
  line: string;
  fareFactor: number;
  lightHours: number;
  packs: number;
}

export const CONCESSIONS: readonly Concession[] = [
  { id: "fare", label: "Shuttle fare down", line: "Shuttle fare is down by a quarter for three days.", fareFactor: 0.75, lightHours: 0, packs: 0 },
  { id: "packs", label: "Food relief packs at the SUB", line: "Every student can collect one free food relief pack at the SUB.", fareFactor: 1, lightHours: 0, packs: 1 },
  { id: "light", label: "One extra hour of light", line: "The hostels get one extra hour of light each night for three days.", fareFactor: 1, lightHours: 1, packs: 0 },
];

export const findConcession = (id: string): Concession | undefined => CONCESSIONS.find((c) => c.id === id);

export const STATE_MINUTES: Record<CampusStateKind, number> = {
  boycott: 3 * MINUTES_PER_DAY,
  dialogue: 2 * MINUTES_PER_DAY,
  protest: MINUTES_PER_DAY,
  concession: 3 * MINUTES_PER_DAY,
  standoff: MINUTES_PER_DAY,
};

export const STATE_LABEL: Record<CampusStateKind, string> = {
  boycott: "Boycott of lectures",
  dialogue: "Dialogue with management",
  protest: "Peaceful protest",
  concession: "Management has agreed",
  standoff: "Management has not moved",
};

export function stateLine(state: UnionState): string {
  if (state.kind === "boycott") return `✊ Congress has declared a boycott of lectures over ${state.issue}. Nobody loses attendance while it lasts.`;
  if (state.kind === "dialogue") return `🤝 Congress chose dialogue with management over ${state.issue}. The executives will report back.`;
  if (state.kind === "protest") return `✊ Congress voted for a peaceful protest over ${state.issue}. The march forms at the Anglo-Moz car park tomorrow morning.`;
  if (state.kind === "concession") return `🎉 Management has agreed after the march over ${state.issue}. ${findConcession(state.concession)?.line ?? ""}`.trim();
  return `📰 The march over ${state.issue} was small. Management says it will look into it. Nothing has changed yet.`;
}

export interface CampusEffects {
  boycott: boolean;
  protest: boolean;
  fareFactor: number;
  extraLightHours: number;
  reliefPacks: number;
  relief: string;
}

export const activeStates = (states: readonly UnionState[], total: number): UnionState[] => states.filter((s) => total >= s.from && total < s.until);

export function campusEffects(states: readonly UnionState[], total: number): CampusEffects {
  const effects: CampusEffects = { boycott: false, protest: false, fareFactor: 1, extraLightHours: 0, reliefPacks: 0, relief: "" };
  for (const state of activeStates(states, total)) {
    if (state.kind === "boycott") effects.boycott = true;
    if (state.kind === "protest") effects.protest = true;
    const deal = state.kind === "concession" ? findConcession(state.concession) : undefined;
    if (!deal) continue;
    effects.fareFactor = Math.min(effects.fareFactor, deal.fareFactor);
    effects.extraLightHours = Math.max(effects.extraLightHours, deal.lightHours);
    if (deal.packs > effects.reliefPacks) {
      effects.reliefPacks = deal.packs;
      effects.relief = state.id;
    }
  }
  return effects;
}

export function parseCampusStates(payload: unknown): UnionState[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((s: unknown): s is UnionState => {
    if (typeof s !== "object" || s === null) return false;
    const state = s as Partial<UnionState>;
    return typeof state.id === "string" && typeof state.issue === "string" && typeof state.from === "number" && typeof state.until === "number" && typeof state.concession === "string" && CAMPUS_STATE_KINDS.includes(state.kind as CampusStateKind);
  });
}
