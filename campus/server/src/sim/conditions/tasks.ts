import {
  CLINIC_STAY,
  CONDITION_SITE_REACH,
  HEALTH,
  REAL_SECONDS_PER_GAME_MINUTE,
  WATER,
  bathe,
  chemistOpen,
  clinicOpen,
  clinicTicket,
  conditionSeed,
  conditionSite,
  cureIllness,
  type ConditionSite,
  type GameTime,
} from "@campuslife/shared";
import { TEXT } from "./text";
import type { Bedside, Patient, RunningTask } from "./types";

const REACH_SLACK = 1.5;
const BREAK_AT = 0.5;

const near = (patient: Patient, site: ConditionSite, reach: number) => Math.hypot(site.stand.x - patient.x, site.stand.y - patient.y) <= reach;

function begin(desk: Bedside, site: ConditionSite, kind: RunningTask["kind"], seconds: number, now: GameTime, number?: number, breakDue = false) {
  desk.task = { kind, site: site.id, left: seconds, total: seconds, ends: now.total + Math.ceil(seconds / REAL_SECONDS_PER_GAME_MINUTE), number, breakDue };
}

export function startTask(desk: Bedside, patient: Patient, siteId: number, now: GameTime): string {
  const site = conditionSite(siteId);
  if (!site) return "";
  if (desk.task) return TEXT.busy;
  if (!near(patient, site, CONDITION_SITE_REACH * REACH_SLACK)) return TEXT.tooFar;
  const record = patient.conditions;
  if (site.kind === "standpipe") {
    if (!record.unwashed) return TEXT.noNeedWater;
    begin(desk, site, "fetch", WATER.fetchSeconds, now);
    return TEXT.fetching(WATER.fetchSeconds);
  }
  if (!record.illness) return TEXT.notSick;
  if (site.kind === "chemist") {
    if (!chemistOpen(now)) return TEXT.chemistShut;
    if (patient.cash < HEALTH.chemistPrice) return TEXT.chemistBroke;
    begin(desk, site, "chemist", HEALTH.chemistSeconds, now);
    return TEXT.chemistWait;
  }
  if (!clinicOpen(now)) return TEXT.clinicShut;
  const ticket = clinicTicket(conditionSeed(patient.profileId), now);
  begin(desk, site, "clinic", ticket.wait * REAL_SECONDS_PER_GAME_MINUTE, now, ticket.number, ticket.doctorOnBreak);
  return TEXT.clinicNumber(ticket.number, ticket.wait);
}

function finish(task: RunningTask, patient: Patient, now: GameTime): string {
  const record = patient.conditions;
  if (task.kind === "fetch") {
    bathe(record, now);
    patient.energy -= WATER.fetchEnergy;
    patient.fun += WATER.fetchFun;
    return TEXT.fetched;
  }
  if (task.kind === "chemist") {
    if (patient.cash < HEALTH.chemistPrice) return TEXT.chemistBroke;
    patient.cash -= HEALTH.chemistPrice;
    cureIllness(record, now);
    return TEXT.chemistDone;
  }
  cureIllness(record, now);
  return TEXT.clinicDone;
}

export function tickTask(desk: Bedside, patient: Patient, seated: boolean, now: GameTime, dt: number): string[] {
  const task = desk.task;
  if (!task) return [];
  const site = conditionSite(task.site);
  const reach = task.kind === "clinic" ? CLINIC_STAY : CONDITION_SITE_REACH * REACH_SLACK;
  if (!site || seated || !near(patient, site, reach)) {
    desk.task = undefined;
    return [task.kind === "clinic" ? TEXT.leftQueue : TEXT.leftTask];
  }
  const out: string[] = [];
  task.left -= dt;
  if (task.breakDue && task.left <= task.total * BREAK_AT) {
    task.breakDue = false;
    out.push(TEXT.clinicBreak);
  }
  if (task.left > 0) return out;
  desk.task = undefined;
  out.push(finish(task, patient, now));
  return out;
}
