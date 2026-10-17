import { CONDITION_STATUS } from "./conditions/record";
import { HEALTH } from "./conditions/health";

export { POWER_ZONES, placesInZone, powerZone, powerZoneAt, powerZoneOfPlace } from "./conditions/zones";
export type { PowerZone, PowerZoneId } from "./conditions/zones";
export {
  DARK_READING_DAYLIGHT,
  GENERATOR_DELAY,
  GENERATOR_PLACES,
  darkIndoors,
  darkShare,
  generatorDelay,
  generatorRunning,
  hasGenerator,
  lightReliefHours,
  nextOutage,
  outageAt,
  outagesOn,
  placeLight,
  screenLit,
  setLightRelief,
  sparedZone,
  zoneHasLight,
} from "./conditions/power";
export type { LightRelief, PlaceLight, PowerOutage } from "./conditions/power";
export {
  DARK_STUDY_FACTOR,
  JACKING,
  READING_ROOMS,
  groupBonus,
  isJackingTime,
  isReadingRoom,
  nightIndex,
  noteReading,
  npcReaders,
  readingMoments,
  readingStreak,
  studyMultiplier,
} from "./conditions/reading";
export type { NightLog, ReadingMoment, ReadingMomentKind, StudyScene } from "./conditions/reading";
export { DRY_TAPS, WAKE_WINDOW, WATER, bathe, dryMorning, isHostel as isHostelPlace, tapsDry, tapsReturned, wakeUp } from "./conditions/water";
export type { BathLog, WakeResult } from "./conditions/water";
export { HEALTH, ILLNESS_NAME, chemistOpen, clinicOpen, clinicTicket, cure as cureIllness, fallSick, onsetChance, restInBed, strain as healthStrain } from "./conditions/health";
export type { ClinicTicket, HealthLog, Illness } from "./conditions/health";
export { CLINIC_STAY, CONDITION_POINTS, CONDITION_SITES, SITE_NAMES as CONDITION_SITE_NAMES, SITE_REACH as CONDITION_SITE_REACH, SITE_RULES as CONDITION_SITE_RULES, conditionSite, conditionSiteNear, siteIsLegal as conditionSiteIsLegal, standIsLegal as conditionStandIsLegal, standpipeOf } from "./conditions/sites";
export type { ConditionSite, ConditionSiteKind } from "./conditions/sites";
export { CONDITION_STATUS, conditionStatus, freshConditions, parseConditionsAct, parseConditionsPayload, sanitizeConditions } from "./conditions/record";
export type { ConditionTask, ConditionTaskKind, ConditionsActPayload, ConditionsPayload, ConditionsRecord } from "./conditions/record";
export { campusLight, conditionsNow, zoneLight } from "./conditions/now";
export type { ConditionsNow, LightState, ZoneLight } from "./conditions/now";
export { seedOf as conditionSeed } from "./conditions/seed";

export function conditionPace(status: number | undefined): number {
  return (status ?? 0) & CONDITION_STATUS.sick ? HEALTH.walkPace : 1;
}
