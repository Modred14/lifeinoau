import type { SoundSettings } from "@campus/lib/settings";
import type { Random } from "./species";

export const MINUTES_PER_DAY = 1440;
export const BIRD_PEAK_RATE = 1.4;
export const BIRD_DAYLIGHT_FULL = 0.14;
export const BIRD_CURVE: readonly (readonly [number, number])[] = [
  [330, 0],
  [345, 0.6],
  [375, 1],
  [510, 1],
  [570, 0.45],
  [1020, 0.45],
  [1110, 0.2],
  [1155, 0],
];
export const NIGHT_DAYLIGHT_START = 0.35;
export const NIGHT_CALL_RATE = 0.07;
export const INDOOR_DUCK = 0.08;
export const MASTER_CEILING = 0.55;
export const MASTER_CURVE = 1.6;
export const MIN_CALL_GAP = 0.12;
export const MAX_GAP_FACTOR = 3;

export const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const smooth = (x: number) => x * x * (3 - 2 * x);

function curveAt(minute: number): number {
  const first = BIRD_CURVE[0];
  if (minute <= first[0]) return first[1];
  for (let i = 1; i < BIRD_CURVE.length; i++) {
    const [endMinute, endValue] = BIRD_CURVE[i];
    if (minute > endMinute) continue;
    const [startMinute, startValue] = BIRD_CURVE[i - 1];
    return startValue + ((endValue - startValue) * (minute - startMinute)) / (endMinute - startMinute);
  }
  return BIRD_CURVE[BIRD_CURVE.length - 1][1];
}

export function birdDensity(minuteOfDay: number, daylight: number): number {
  if (!Number.isFinite(minuteOfDay)) return 0;
  const minute = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const light = smooth(clamp01(clamp01(daylight) / BIRD_DAYLIGHT_FULL));
  return BIRD_PEAK_RATE * curveAt(minute) * light;
}

export function nightLevel(daylight: number): number {
  return smooth(clamp01(1 - clamp01(daylight) / NIGHT_DAYLIGHT_START));
}

export const nightCallRate = (daylight: number) => NIGHT_CALL_RATE * nightLevel(daylight);

export const duckFactor = (indoors: boolean) => (indoors ? INDOOR_DUCK : 1);

export function masterLevel(settings: SoundSettings): number {
  return settings.enabled ? MASTER_CEILING * clamp01(settings.volume) ** MASTER_CURVE : 0;
}

export function callGap(rate: number, random: Random): number {
  const wait = -Math.log(1 - Math.min(random(), 1 - Number.EPSILON)) / rate;
  return Math.min(MAX_GAP_FACTOR / rate, Math.max(MIN_CALL_GAP, wait));
}

export interface CallWindow {
  times: number[];
  cursor: number;
}

export function planWindow(cursor: number, until: number, rate: number, random: Random): CallWindow {
  const times: number[] = [];
  if (!(rate > 0)) return { times, cursor: until };
  let at = cursor;
  while (at < until) {
    times.push(at);
    at += callGap(rate, random);
  }
  return { times, cursor: at };
}
