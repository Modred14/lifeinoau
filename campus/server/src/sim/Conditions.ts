import {
  HEALTH,
  INTERIORS,
  REAL_SECONDS_PER_GAME_MINUTE,
  VIEWING_SEAT_LABEL,
  WATER,
  conditionSeed,
  conditionStatus,
  currentMatch,
  fallSick,
  generatorRunning,
  healthStrain,
  interiorAt,
  isHostelPlace,
  outageAt,
  parseConditionsAct,
  placeLight,
  powerZoneAt,
  powerZoneOfPlace,
  readingStreak,
  restInBed,
  sanitizeConditions,
  screenLit,
  showAt,
  tapsReturned,
  wakeUp,
  zoneHasLight,
  type ConditionsPayload,
  type GameTime,
  type Spot,
} from "@campuslife/shared";
import { studyTick } from "./conditions/study";
import { startTask, tickTask } from "./conditions/tasks";
import { SAID_LIMIT, TEXT, UP_NEPA_FUN } from "./conditions/text";
import type { Bedside, ConditionsHost, Patient } from "./conditions/types";

export type { ConditionsHost, Patient } from "./conditions/types";
export { TEXT as CONDITIONS_TEXT, UP_NEPA_FUN } from "./conditions/text";

const VENUE_TEMPLATES = new Set(["amphitheatre", "auditorium"]);
const HOUR = 60;
const OUTDOORS = -1;
const SYNC_ASK = "sync";

export class ConditionsDesk {
  private desks = new Map<string, Bedside>();

  constructor(private host: ConditionsHost) {}

  join(id: string, patient: Patient, now: GameTime) {
    patient.conditions = sanitizeConditions(patient.conditions);
    this.desks.set(id, this.fresh(patient, now));
    this.sync(id, patient, now, true);
  }

  leave(id: string) {
    this.desks.delete(id);
  }

  resend(id: string, patient: Patient, payload: unknown, now: GameTime): boolean {
    if (typeof payload !== "object" || payload === null || (payload as Record<string, unknown>)[SYNC_ASK] !== true) return false;
    this.deskFor(id, patient, now);
    this.sync(id, patient, now, true);
    return true;
  }

  act(id: string, patient: Patient, payload: unknown, now: GameTime) {
    const ask = parseConditionsAct(payload);
    if (!ask) return;
    const text = startTask(this.deskFor(id, patient, now), patient, ask.site, now);
    if (text) this.host.notify(id, text);
    this.sync(id, patient, now);
  }

  blackout(id: string, spot: Spot, now: GameTime): boolean {
    if (spot.place < 0) return false;
    const venue = VENUE_TEMPLATES.has(INTERIORS[spot.place]?.template.id ?? "");
    const screen = spot.kind === "tv" && spot.label === VIEWING_SEAT_LABEL;
    const showing = venue ? !!showAt(spot.place, now) : screen && !!currentMatch(now);
    if (!showing) return false;
    if (venue ? placeLight(spot.place, now.total).lit : screenLit(spot.place, now.total)) return false;
    const desk = this.desks.get(id);
    const outage = outageAt(powerZoneOfPlace(spot.place).index, now.total);
    if (desk) this.say(id, desk, `pause:${spot.place}:${outage?.start ?? 0}`, TEXT.putOnGen);
    return true;
  }

  tick(id: string, patient: Patient, spot: Spot | undefined, kind: string | undefined, now: GameTime, dt: number) {
    const desk = this.deskFor(id, patient, now);
    const record = patient.conditions;
    const place = spot && spot.place >= 0 ? spot.place : (interiorAt(patient.x, patient.y)?.place ?? OUTDOORS);
    this.power(id, desk, patient, place, now);
    if (kind === "study" && place >= 0) studyTick(desk, patient, place, Math.max(0, (this.host.readers?.(place) ?? 1) - 1), now, dt, (key, text) => this.say(id, desk, key, text));
    this.sleep(id, desk, patient, kind === "sleep", place, now, dt);
    if (record.unwashed) {
      patient.fun -= WATER.unwashedFunDrain * dt;
      if (tapsReturned(record, now)) this.host.notify(id, TEXT.tapsBack);
    }
    healthStrain(record, patient.food, patient.energy, dt / REAL_SECONDS_PER_GAME_MINUTE);
    const hour = Math.floor(now.total / HOUR);
    if (hour !== desk.hour) {
      desk.hour = hour;
      const illness = fallSick(record, now, conditionSeed(patient.profileId));
      if (illness) this.host.notify(id, TEXT.sick(illness));
    }
    if (record.illness) patient.energy -= HEALTH.energyDrain * dt;
    for (const text of tickTask(desk, patient, !!spot, now, dt)) this.host.notify(id, text);
    this.sync(id, patient, now);
  }

  private fresh(patient: Patient, now: GameTime): Bedside {
    const zone = powerZoneAt(patient.x, patient.y).index;
    return { zone, lit: zoneHasLight(zone, now.total), place: OUTDOORS, generator: false, sleptIn: OUTDOORS, hour: Math.floor(now.total / HOUR), said: new Set(), readingKey: "", moment: 0, sent: "", bits: -1 };
  }

  private deskFor(id: string, patient: Patient, now: GameTime): Bedside {
    let desk = this.desks.get(id);
    if (!desk) {
      patient.conditions = sanitizeConditions(patient.conditions);
      this.desks.set(id, (desk = this.fresh(patient, now)));
    }
    return desk;
  }

  private say(id: string, desk: Bedside, key: string, text: string) {
    if (desk.said.has(key)) return;
    if (desk.said.size >= SAID_LIMIT) desk.said.clear();
    desk.said.add(key);
    this.host.notify(id, text);
  }

  private power(id: string, desk: Bedside, patient: Patient, place: number, now: GameTime) {
    const zone = place >= 0 ? powerZoneOfPlace(place).index : powerZoneAt(patient.x, patient.y).index;
    const lit = zoneHasLight(zone, now.total);
    if (zone === desk.zone && lit !== desk.lit) {
      if (lit) patient.fun += UP_NEPA_FUN;
      this.host.notify(id, lit ? TEXT.upNepa : TEXT.lightOut);
    }
    const generator = place >= 0 && generatorRunning(place, now.total);
    if (generator && !desk.generator && place === desk.place && !lit) this.host.notify(id, TEXT.genOn);
    desk.zone = zone;
    desk.lit = lit;
    desk.place = place;
    desk.generator = generator;
  }

  private sleep(id: string, desk: Bedside, patient: Patient, asleep: boolean, place: number, now: GameTime, dt: number) {
    if (asleep && isHostelPlace(place)) {
      desk.sleptIn = place;
      if (restInBed(patient.conditions, dt, now)) this.host.notify(id, TEXT.restCure);
      return;
    }
    if (desk.sleptIn < 0) return;
    const woke = wakeUp(patient.conditions, desk.sleptIn, now);
    desk.sleptIn = OUTDOORS;
    if (woke !== "dry") return;
    patient.fun -= WATER.wakeDryFun;
    this.host.notify(id, TEXT.dryTaps);
  }

  private sync(id: string, patient: Patient, now: GameTime, force = false) {
    const desk = this.desks.get(id);
    if (!desk) return;
    const record = patient.conditions;
    const bits = conditionStatus(record);
    if (bits !== desk.bits || force) {
      desk.bits = bits;
      this.host.status(id, bits);
    }
    const task = desk.task;
    const payload: ConditionsPayload = {
      illness: record.illness,
      unwashed: record.unwashed,
      nights: readingStreak(record, now),
      rest: record.illness ? Math.min(1, Math.round((record.rest / HEALTH.restCureSeconds) * 10) / 10) : 0,
      task: task && { kind: task.kind, site: task.site, ends: task.ends, number: task.number },
    };
    const key = JSON.stringify(payload);
    if (key === desk.sent && !force) return;
    desk.sent = key;
    this.host.send(id, payload);
  }
}
