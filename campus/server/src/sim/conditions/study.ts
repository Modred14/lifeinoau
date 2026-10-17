import {
  JACKING,
  PLACES,
  REAL_SECONDS_PER_GAME_MINUTE,
  darkIndoors,
  groupBonus,
  isJackingTime,
  isReadingRoom,
  isToc,
  nightIndex,
  noteReading,
  npcReaders,
  outageAt,
  powerZoneOfPlace,
  readingMoments,
  studyMultiplier,
  type GameTime,
} from "@campuslife/shared";
import { TEXT } from "./text";
import type { Bedside, Patient } from "./types";

const TOC_EXTRA = 0.5;

export function studyTick(desk: Bedside, patient: Patient, place: number, others: number, now: GameTime, dt: number, say: (key: string, text: string) => void) {
  const lit = !darkIndoors(place, now);
  const night = isJackingTime(now.minute);
  const jacking = lit && night && isReadingRoom(place);
  const npcs = jacking ? npcReaders(place, nightIndex(now)) : 0;
  const multiplier = studyMultiplier({ lit, jacking, npcs, players: others });
  const earned = dt * (1 + (isToc(now.minute) ? TOC_EXTRA : 0));
  patient.studySeconds += (multiplier - 1) * earned;
  if (!lit) {
    const outage = outageAt(powerZoneOfPlace(place).index, now.total);
    say(`dark:${place}:${outage?.start ?? now.dayIndex}`, TEXT.darkStudy);
  }
  if (night && noteReading(patient.conditions, now, dt / REAL_SECONDS_PER_GAME_MINUTE)) say(`streak:${nightIndex(now)}`, TEXT.streak(patient.conditions.nights));
  if (!jacking) return;
  patient.energy -= JACKING.energyCost * dt;
  say(`jack:${place}:${nightIndex(now)}`, TEXT.jacking(PLACES[place].name, npcs + others, groupBonus(npcs, others)));
  const key = `${place}:${nightIndex(now)}`;
  const moments = readingMoments(place, nightIndex(now));
  if (desk.readingKey !== key) {
    desk.readingKey = key;
    desk.moment = moments.filter((m) => m.at <= now.total).length;
  }
  while (desk.moment < moments.length && moments[desk.moment].at <= now.total) {
    const moment = moments[desk.moment++];
    patient.fun += moment.fun;
    patient.energy += moment.energy;
    say(`moment:${key}:${desk.moment}`, moment.text);
  }
}
