import type { ConditionTaskKind, ConditionsPayload, ConditionsRecord } from "@campuslife/shared";

export interface Patient {
  x: number;
  y: number;
  food: number;
  energy: number;
  fun: number;
  cash: number;
  studySeconds: number;
  profileId: string;
  conditions: ConditionsRecord;
}

export interface ConditionsHost {
  notify(id: string, text: string): void;
  send(id: string, payload: ConditionsPayload): void;
  status(id: string, bits: number): void;
  readers?(place: number): number;
}

export interface RunningTask {
  kind: ConditionTaskKind;
  site: number;
  left: number;
  total: number;
  ends: number;
  number?: number;
  breakDue: boolean;
}

export interface Bedside {
  zone: number;
  lit: boolean;
  place: number;
  generator: boolean;
  sleptIn: number;
  hour: number;
  said: Set<string>;
  readingKey: string;
  moment: number;
  task?: RunningTask;
  sent: string;
  bits: number;
}
